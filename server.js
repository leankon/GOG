/**
 * Servidor mínimo (sin dependencias) para la app de enlaces de reseña.
 *
 * Sirve la carpeta public/ y expone POST /api/resolve, que hace lo que el
 * navegador no puede hacer por CORS:
 *   1. seguir la redirección de los enlaces cortos maps.app.goo.gl / goo.gl,
 *   2. opcionalmente buscar el Place ID exacto con la Places API (New),
 *      si existe la variable de entorno GOOGLE_MAPS_API_KEY.
 */
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseMapsLink, buildReviewLinks } from './public/parser.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT) || 3000;
const API_KEY = process.env.GOOGLE_MAPS_API_KEY || '';
const FETCH_TIMEOUT_MS = 10_000;
const MAX_BODY_BYTES = 8 * 1024;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
};

/** Sólo seguimos redirecciones hacia dominios de Google: evita usar el servidor como proxy. */
function isAllowedHost(hostname) {
  const host = String(hostname).toLowerCase();
  return (
    /(^|\.)google\.[a-z.]+$/.test(host) ||
    /(^|\.)goo\.gl$/.test(host) ||
    /(^|\.)g\.co$/.test(host)
  );
}

async function expandShortLink(shortUrl) {
  const response = await fetch(shortUrl, {
    redirect: 'follow',
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; generador-resenas/1.0)',
      'Accept-Language': 'es-ES,es;q=0.9',
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (!response.ok && response.status >= 400) {
    throw new Error('Google respondió ' + response.status + ' al abrir el enlace.');
  }

  let finalUrl = new URL(response.url || shortUrl);
  // Google intercala a veces la pantalla de consentimiento: la URL real viaja
  // dentro del parámetro `continue`.
  if (/consent\.google\./i.test(finalUrl.hostname)) {
    const cont = finalUrl.searchParams.get('continue');
    if (cont) finalUrl = new URL(cont);
  }
  if (!isAllowedHost(finalUrl.hostname)) {
    throw new Error('La redirección apunta fuera de Google: ' + finalUrl.hostname);
  }
  if (finalUrl.href === shortUrl) {
    throw new Error('el enlace no redirigió a ninguna ficha de Google Maps.');
  }
  return finalUrl.href;
}

/** Places API (New): del nombre + coordenadas al Place ID canónico. */
async function lookupPlaceId({ name, coords }) {
  if (!API_KEY || !name) return null;
  const body = { textQuery: name, languageCode: 'es', maxResultCount: 1 };
  if (coords) {
    body.locationBias = {
      circle: { center: { latitude: coords.lat, longitude: coords.lng }, radius: 200 },
    };
  }
  const response = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': API_KEY,
      'X-Goog-FieldMask': 'places.id,places.displayName',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) return null;
  const data = await response.json();
  return data?.places?.[0]?.id || null;
}

async function resolve(input) {
  let parsed = parseMapsLink(input);
  const steps = [];

  if (parsed.needsResolution && parsed.url) {
    try {
      const expanded = await expandShortLink(parsed.url);
      steps.push('Enlace corto resuelto.');
      parsed = parseMapsLink(expanded);
      parsed.expandedUrl = expanded;
      if (parsed.needsResolution) {
        return {
          ...parsed,
          ok: false,
          error: 'El enlace corto llevó a otro enlace corto. Ábrelo en el navegador y copia la URL larga.',
          steps,
        };
      }
    } catch (error) {
      return {
        ...parsed,
        ok: false,
        error: 'No se pudo resolver el enlace corto: ' + error.message,
        steps,
      };
    }
  }

  if (parsed.ok && !parsed.placeId && parsed.name) {
    try {
      const placeId = await lookupPlaceId(parsed);
      if (placeId) {
        parsed.placeId = placeId;
        steps.push('Place ID obtenido con la Places API.');
      }
    } catch {
      // La búsqueda es un extra: si falla seguimos con CID/FTID.
    }
  }

  return { ...parsed, steps, links: buildReviewLinks(parsed), apiKeyConfigured: Boolean(API_KEY) };
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('Petición demasiado grande'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function serveStatic(req, res, pathname) {
  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const filePath = path.join(PUBLIC_DIR, relative);
  // Evita salir de public/ con ../
  if (!filePath.startsWith(PUBLIC_DIR + path.sep) && filePath !== path.join(PUBLIC_DIR, 'index.html')) {
    res.writeHead(403).end('Prohibido');
    return;
  }
  try {
    const data = await fs.readFile(filePath);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('No encontrado');
  }
}

const server = http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (pathname === '/api/resolve') {
    if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'Usa POST' });
    try {
      const { url } = JSON.parse((await readBody(req)) || '{}');
      if (typeof url !== 'string' || !url.trim()) {
        return sendJson(res, 400, { ok: false, error: 'Falta el campo "url".' });
      }
      return sendJson(res, 200, await resolve(url));
    } catch (error) {
      return sendJson(res, 400, { ok: false, error: error.message });
    }
  }

  if (pathname === '/api/health') {
    return sendJson(res, 200, { ok: true, apiKeyConfigured: Boolean(API_KEY) });
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return sendJson(res, 405, { ok: false, error: 'Método no permitido' });
  }
  await serveStatic(req, res, pathname);
});

server.listen(PORT, () => {
  console.log(`Generador de enlaces de reseña en http://localhost:${PORT}`);
  console.log(API_KEY ? 'Places API: configurada.' : 'Places API: sin clave (modo básico).');
});

export { resolve, expandShortLink, isAllowedHost };
