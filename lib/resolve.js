/**
 * Resolución en servidor: lo que el navegador no puede hacer por CORS.
 *
 *   1. Seguir la redirección de los enlaces cortos (maps.app.goo.gl / goo.gl).
 *   2. Si hay GOOGLE_MAPS_API_KEY, buscar el Place ID exacto con la
 *      Places API (New).
 *
 * Lo usan tanto el servidor local (server.js) como la función serverless
 * (api/resolve.js), para que el comportamiento sea idéntico en ambos.
 */
import { parseMapsLink, buildReviewLinks } from '../public/parser.js';

const FETCH_TIMEOUT_MS = 10_000;

function apiKey() {
  return process.env.GOOGLE_MAPS_API_KEY || '';
}

/** Sólo seguimos redirecciones hacia dominios de Google: evita usar esto como proxy abierto. */
export function isAllowedHost(hostname) {
  const host = String(hostname).toLowerCase();
  // El dominio debe TERMINAR en google.<tld> (admite google.co.uk,
  // google.com.mx). Sin acotar el TLD, "google.com.evil.net" colaría.
  return (
    /(^|\.)google\.[a-z]{2,}(\.[a-z]{2})?$/.test(host) ||
    /(^|\.)goo\.gl$/.test(host) ||
    /(^|\.)g\.co$/.test(host)
  );
}

/**
 * Plan B cuando la redirección no deja los identificadores en la URL final
 * (Google a veces responde con una página que redirige por JavaScript):
 * se buscan en el cuerpo de la respuesta.
 */
export function parseFromHtml(html) {
  if (!html) return null;
  // El HTML escapa las barras y los & de las URLs incrustadas.
  const text = String(html).replace(/\\u0026/g, '&').replace(/\\\//g, '/');

  const candidatos = [
    text.match(/https:\/\/www\.google\.[a-z.]+\/maps\/place\/[^"'\\\s<>]+/),
    text.match(/https:\/\/maps\.google\.[a-z.]+\/[^"'\\\s<>]*[?&]cid=\d+[^"'\\\s<>]*/),
  ];
  for (const candidato of candidatos) {
    if (!candidato) continue;
    const parsed = parseMapsLink(candidato[0]);
    if (parsed.ok && (parsed.placeId || parsed.cid || parsed.ftid)) return parsed;
  }

  // Último recurso: los identificadores sueltos dentro de la página.
  const suelto =
    text.match(/0x[0-9a-f]+:0x[0-9a-f]+/i) || text.match(/ChIJ[A-Za-z0-9_-]{15,}/);
  if (suelto) {
    const parsed = parseMapsLink('https://www.google.com/maps/place/?q=' + suelto[0]);
    if (parsed.ok && (parsed.placeId || parsed.cid || parsed.ftid)) return parsed;
  }
  return null;
}

export async function expandShortLink(shortUrl) {
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
  // El cuerpo se guarda por si la URL final no trae los identificadores.
  const body = (await response.text().catch(() => '')).slice(0, 500_000);

  if (finalUrl.href === shortUrl && !body) {
    throw new Error('el enlace no redirigió a ninguna ficha de Google Maps.');
  }
  return { url: finalUrl.href, body };
}

/** Places API (New): del nombre + coordenadas al Place ID canónico. */
export async function lookupPlaceId({ name, coords }) {
  const key = apiKey();
  if (!key || !name) return null;

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
      'X-Goog-Api-Key': key,
      'X-Goog-FieldMask': 'places.id,places.displayName',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) return null;
  const data = await response.json();
  return data?.places?.[0]?.id || null;
}

/** Analiza el enlace y lo completa con lo que haga falta pedir a la red. */
export async function resolve(input) {
  let parsed = parseMapsLink(input);
  const steps = [];

  if (parsed.needsResolution && parsed.url) {
    try {
      const { url: expanded, body } = await expandShortLink(parsed.url);
      const nombreCompartido = parsed.name;
      let siguiente = parseMapsLink(expanded);
      steps.push('Enlace corto resuelto.');

      if (!siguiente.placeId && !siguiente.cid && !siguiente.ftid) {
        const desdeHtml = parseFromHtml(body);
        if (desdeHtml) {
          siguiente = { ...desdeHtml, name: desdeHtml.name || nombreCompartido };
          steps.push('Identificador encontrado en la página de destino.');
        }
      }

      parsed = { ...siguiente, name: siguiente.name || nombreCompartido };
      parsed.expandedUrl = expanded;
      if (parsed.needsResolution) {
        return {
          ...parsed,
          ok: false,
          error: 'El enlace corto llevó a otro enlace corto. Ábrelo en el navegador y copia la URL larga.',
          steps,
          links: buildReviewLinks({ ok: false }),
        };
      }
    } catch (error) {
      // Plan B: si el texto de "Compartir" traía el nombre del sitio y hay
      // clave de la Places API, se puede encontrar sin resolver el enlace.
      const byName = parsed.name ? await lookupPlaceId(parsed).catch(() => null) : null;
      if (byName) {
        parsed = { ...parsed, ok: true, needsResolution: false, placeId: byName, source: 'text-search' };
        steps.push('Enlace corto no resuelto; negocio encontrado por nombre con la Places API.');
        return { ...parsed, steps, links: buildReviewLinks(parsed), apiKeyConfigured: Boolean(apiKey()) };
      }
      return {
        ...parsed,
        ok: false,
        error: 'No se pudo resolver el enlace corto: ' + error.message,
        steps,
        links: buildReviewLinks({ ok: false }),
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

  return { ...parsed, steps, links: buildReviewLinks(parsed), apiKeyConfigured: Boolean(apiKey()) };
}
