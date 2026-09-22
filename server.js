/**
 * Servidor de desarrollo (sin dependencias).
 *
 * Sirve public/ y expone los mismos endpoints que las funciones serverless de
 * api/, reutilizando lib/resolve.js: lo que ves en local es lo que se despliega.
 */
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolve } from './lib/resolve.js';
import { VERSION } from './public/version.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT) || 3000;
const MAX_BODY_BYTES = 8 * 1024;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
};

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolveBody, reject) => {
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
    req.on('end', () => resolveBody(Buffer.concat(chunks).toString('utf8')));
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
    return sendJson(res, 200, {
      ok: true,
      version: VERSION,
      apiKeyConfigured: Boolean(process.env.GOOGLE_MAPS_API_KEY),
      runtime: process.version,
    });
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return sendJson(res, 405, { ok: false, error: 'Método no permitido' });
  }
  await serveStatic(req, res, pathname);
});

server.listen(PORT, () => {
  console.log(`Generador de enlaces de reseña en http://localhost:${PORT}`);
  console.log(
    process.env.GOOGLE_MAPS_API_KEY ? 'Places API: configurada.' : 'Places API: sin clave (modo básico).'
  );
});
