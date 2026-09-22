/**
 * Núcleo de la aplicación: a partir de un enlace de Google Maps extrae los
 * identificadores del negocio (Place ID, CID, FTID) y construye el enlace
 * directo para dejar una reseña.
 *
 * Este módulo es ESM puro y sin dependencias: lo usan tanto el navegador
 * (public/app.js) como el servidor (server.js).
 */

const SHORT_HOSTS = ['maps.app.goo.gl', 'goo.gl', 'g.co', 'app.goo.gl'];

/** Un Place ID pegado a pelo, sin URL alrededor. */
const BARE_PLACE_ID = /^(ChIJ|GhIJ)[A-Za-z0-9_-]{10,}$/;

/** Par hexadecimal que Google usa como "feature id": 0x<zona>:0x<cid en hex>. */
const FTID = /(0x[0-9a-f]+):(0x[0-9a-f]+)/i;

/**
 * ¿Hace falta pedirle al servidor que siga la redirección?
 * Los enlaces cortos (los que da el botón "Compartir") no contienen ningún
 * identificador: sólo se sabe a dónde apuntan resolviéndolos.
 */
export function isShortLink(value) {
  const url = toUrl(value);
  if (!url) return false;
  const host = url.hostname.toLowerCase();
  return SHORT_HOSTS.some((h) => host === h || host.endsWith('.' + h));
}

/** Extrae la primera URL de un texto (la gente pega el enlace con más cosas). */
function toUrl(value) {
  if (value instanceof URL) return value;
  if (typeof value !== 'string') return null;
  const match = value.trim().match(/https?:\/\/[^\s<>"']+/i);
  if (!match) return null;
  try {
    return new URL(match[0]);
  } catch {
    return null;
  }
}

function decode(value) {
  if (!value) return null;
  try {
    return decodeURIComponent(value.replace(/\+/g, ' '));
  } catch {
    return value;
  }
}

/** El CID decimal es la segunda mitad del FTID, en hexadecimal. */
export function ftidToCid(ftid) {
  const match = String(ftid || '').match(FTID);
  if (!match) return null;
  try {
    return BigInt(match[2]).toString(10);
  } catch {
    return null;
  }
}

function cidToHex(cid) {
  try {
    return '0x' + BigInt(cid).toString(16);
  } catch {
    return null;
  }
}

/**
 * Analiza cualquier formato de enlace de Google Maps.
 *
 * @returns {{
 *   ok: boolean, error?: string, needsResolution: boolean,
 *   placeId: string|null, cid: string|null, ftid: string|null,
 *   name: string|null, coords: {lat: number, lng: number}|null,
 *   source: string
 * }}
 */
export function parseMapsLink(input) {
  const raw = typeof input === 'string' ? input.trim() : '';
  if (!raw) {
    return fail('Pega un enlace de Google Maps para empezar.');
  }

  // Caso 1: el usuario pega directamente el Place ID.
  if (BARE_PLACE_ID.test(raw)) {
    return result({ placeId: raw, source: 'place-id' });
  }

  const url = toUrl(raw);
  if (!url) {
    return fail('Eso no parece un enlace. Debe empezar por http:// o https://');
  }

  const host = url.hostname.toLowerCase();
  const isGoogle =
    /(^|\.)google\.[a-z]{2,}(\.[a-z]{2})?$/.test(host) || SHORT_HOSTS.some((h) => host === h || host.endsWith('.' + h));
  if (!isGoogle) {
    return fail('El enlace no es de Google Maps (dominio: ' + url.hostname + ').');
  }

  if (isShortLink(url)) {
    // No hay nada que extraer todavía: hay que seguir la redirección. Si el
    // usuario pegó el texto completo de "Compartir" del móvil, ese texto trae
    // el nombre del sitio: sirve de plan B para buscarlo por nombre.
    return result({
      needsResolution: true,
      source: 'short-link',
      url: url.href,
      name: extractSharedName(raw, url.href),
    });
  }

  const href = url.href;
  const params = url.searchParams;
  const name = extractName(url);
  const coords = extractCoords(href);

  // Caso 2: Place ID explícito, en cualquiera de sus variantes.
  const placeId =
    params.get('place_id') ||
    params.get('placeid') ||
    params.get('query_place_id') ||
    params.get('destination_place_id') ||
    firstMatch(href, /place_id[:=]([A-Za-z0-9_-]{10,})/) ||
    firstMatch(href, /!1s(ChIJ[A-Za-z0-9_-]{10,})/) ||
    firstMatch(href, /(ChIJ[A-Za-z0-9_-]{15,})/);

  // Caso 3: FTID (el par 0x...:0x... que aparece en el parámetro `data`).
  const ftid =
    normalizeFtid(params.get('ftid')) ||
    normalizeFtid(firstMatch(href, /!1s(0x[0-9a-f]+:0x[0-9a-f]+)/i)) ||
    normalizeFtid(firstMatch(url.hash, /lrd=(0x[0-9a-f]+:0x[0-9a-f]+)/i)) ||
    normalizeFtid(firstMatch(href, /(0x[0-9a-f]+:0x[0-9a-f]+)/i));

  // Caso 4: CID (el identificador numérico de la ficha).
  const cid =
    cleanCid(params.get('cid')) ||
    cleanCid(params.get('ludocid')) ||
    cleanCid(firstMatch(href, /[?&](?:cid|ludocid)=(\d{6,})/)) ||
    (ftid ? ftidToCid(ftid) : null);

  if (!placeId && !ftid && !cid) {
    return result({
      ok: false,
      error:
        'El enlace no contiene el identificador del negocio. Abre la ficha del ' +
        'sitio en Google Maps (no sólo unas coordenadas) y copia la URL de la barra de direcciones.',
      name,
      coords,
      source: 'maps-url',
    });
  }

  return result({ placeId, ftid, cid, name, coords, source: 'maps-url' });
}

function normalizeFtid(value) {
  const match = String(value || '').match(FTID);
  return match ? `${match[1].toLowerCase()}:${match[2].toLowerCase()}` : null;
}

function cleanCid(value) {
  return /^\d{6,}$/.test(String(value || '')) ? String(value) : null;
}

function firstMatch(text, regex) {
  const match = String(text || '').match(regex);
  return match ? match[1] : null;
}

function extractName(url) {
  const inPath = firstMatch(url.pathname, /\/maps\/place\/([^/@]+)/);
  if (inPath && !inPath.startsWith('data=')) {
    const name = decode(inPath);
    if (name && !/^@/.test(name) && !/^place_id:/.test(name)) return name;
  }
  const q = url.searchParams.get('q') || url.searchParams.get('query');
  if (q && !/^place_id:/.test(q) && !/^-?\d+(\.\d+)?,/.test(q)) return decode(q);
  return null;
}

/**
 * Texto de "Compartir" de Google Maps en el móvil:
 *
 *   Nombre del sitio
 *   Calle Mayor 1, Madrid
 *   https://maps.app.goo.gl/xxxx
 *
 * Nos quedamos con la primera línea que no sea una URL.
 */
function extractSharedName(raw, url) {
  const text = String(raw).split(url).join(' ');
  for (const line of text.split(/[\n\r]+/)) {
    const clean = line.replace(/https?:\/\/\S+/g, '').trim().replace(/^[-–—:·|]+|[-–—:·|]+$/g, '').trim();
    if (clean.length >= 3 && clean.length <= 120) return clean;
  }
  return null;
}

function extractCoords(href) {
  const match =
    String(href).match(/@(-?\d+\.\d+),(-?\d+\.\d+)/) ||
    String(href).match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
  if (!match) return null;
  return { lat: Number(match[1]), lng: Number(match[2]) };
}

function fail(error) {
  return result({ ok: false, error });
}

function result(fields = {}) {
  return {
    ok: fields.ok !== false,
    error: fields.error || null,
    needsResolution: Boolean(fields.needsResolution),
    placeId: fields.placeId || null,
    cid: fields.cid || null,
    ftid: fields.ftid || null,
    name: fields.name || null,
    coords: fields.coords || null,
    url: fields.url || null,
    source: fields.source || 'unknown',
  };
}

/**
 * Construye los enlaces a partir de lo que se haya podido extraer.
 *
 * `confidence: 'exact'` significa enlace canónico de Google que abre el
 * formulario de reseña directamente. `'partial'` es la mejor aproximación
 * cuando sólo tenemos el CID: abre la ficha o el panel de reseñas.
 */
export function buildReviewLinks(parsed) {
  if (!parsed || !parsed.ok) return { review: null, confidence: 'none', extras: [] };

  const extras = [];
  let review = null;
  let confidence = 'none';

  if (parsed.placeId) {
    review = `https://search.google.com/local/writereview?placeid=${encodeURIComponent(parsed.placeId)}`;
    confidence = 'exact';
    extras.push({
      label: 'Ficha del negocio',
      url: `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(parsed.placeId)}`,
    });
  }

  const ftid = parsed.ftid || (parsed.cid ? `0x0:${cidToHex(parsed.cid)}` : null);
  if (!review && ftid) {
    // Sin Place ID, lo más cerca que se llega es el panel de reseñas de la
    // búsqueda: el sufijo ",3" abre la pestaña de escribir reseña.
    const query = parsed.name ? encodeURIComponent(parsed.name) : '';
    review = `https://www.google.com/search?q=${query}#lrd=${ftid},3,,,`;
    confidence = 'partial';
  }

  if (parsed.cid) {
    extras.push({ label: 'Ficha por CID', url: `https://maps.google.com/?cid=${parsed.cid}` });
  }

  return { review, confidence, extras };
}
