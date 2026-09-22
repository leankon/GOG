import { parseMapsLink, buildReviewLinks } from './parser.js';
import { VERSION } from './version.js';

const form = document.getElementById('form');
const input = document.getElementById('input');
const submit = document.getElementById('submit');
const statusBox = document.getElementById('status');
const result = document.getElementById('result');
const reviewUrl = document.getElementById('review-url');
const copyBtn = document.getElementById('copy');
const openLink = document.getElementById('open');
const badge = document.getElementById('badge');
const details = document.getElementById('details');
const note = document.getElementById('note');

// Sello de versión: deja ver en la propia página qué build se está sirviendo.
const versionBox = document.getElementById('version');
if (versionBox) {
  versionBox.textContent = 'v' + VERSION;
  fetch('/api/health', { cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : null))
    .then((data) => {
      if (!data) return;
      versionBox.textContent =
        data.version && data.version !== VERSION
          ? `v${VERSION} (API v${data.version}: despliegue desparejado)`
          : `v${VERSION} · API viva`;
    })
    .catch(() => {});
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  await generate(input.value);
});

for (const chip of document.querySelectorAll('.chip')) {
  chip.addEventListener('click', () => {
    input.value = chip.dataset.example;
    generate(input.value);
  });
}

copyBtn.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(reviewUrl.value);
    copyBtn.textContent = '¡Copiado!';
  } catch {
    reviewUrl.select();
    document.execCommand('copy');
    copyBtn.textContent = '¡Copiado!';
  }
  setTimeout(() => (copyBtn.textContent = 'Copiar'), 1800);
});

async function generate(value) {
  setBusy(true);
  hide(result);

  // 1. Análisis local: instantáneo y funciona aunque la app esté en un
  //    hosting estático sin servidor.
  let parsed = parseMapsLink(value);

  // 2. Los enlaces cortos sólo se pueden resolver desde el servidor (CORS).
  if (parsed.ok && parsed.needsResolution) {
    showStatus('Resolviendo el enlace corto…', 'loading');
    const remote = await askServer(value);
    setBusy(false);
    if (!remote || !remote.ok) {
      const reason = remote && remote.error ? remote.error : await diagnose();
      return showShortLinkHelp(parsed.url, reason);
    }
    parsed = remote;
  } else if (parsed.ok && !parsed.placeId) {
    // 3. Tenemos CID/FTID pero no el Place ID: si el servidor tiene clave de
    //    la Places API puede afinarlo. Si no, seguimos con lo que hay.
    const remote = await askServer(value);
    if (remote && remote.ok && remote.placeId) parsed = remote;
    setBusy(false);
  } else {
    setBusy(false);
  }

  if (!parsed.ok) return showStatus(parsed.error, 'error');

  const links = buildReviewLinks(parsed);
  if (!links.review) {
    return showStatus('No he encontrado el identificador del negocio en ese enlace.', 'error');
  }

  hide(statusBox);
  render(parsed, links);
}

async function askServer(url) {
  try {
    const response = await fetch('/api/resolve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    // Aunque el estado sea 4xx/5xx, el cuerpo trae el motivo: lo mostramos.
    const data = await response.json().catch(() => null);
    return data && typeof data === 'object' ? data : null;
  } catch {
    return null; // Sin servidor: modo estático.
  }
}

function render(parsed, links) {
  reviewUrl.value = links.review;
  openLink.href = links.review;

  const exact = links.confidence === 'exact';
  badge.textContent = exact ? 'Enlace directo' : 'Aproximado';
  badge.className = 'badge ' + links.confidence;

  details.innerHTML = '';
  addDetail('Negocio', parsed.name);
  addDetail('Place ID', parsed.placeId);
  addDetail('CID', parsed.cid);
  addDetail('FTID', parsed.ftid);
  for (const extra of links.extras) {
    addDetail(extra.label, `<a href="${extra.url}" target="_blank" rel="noopener noreferrer">abrir ↗</a>`, true);
  }

  if (exact) {
    note.hidden = true;
  } else {
    note.hidden = false;
    note.className = 'note warn';
    note.textContent =
      'Este enlace abre el panel de reseñas del negocio, pero no es el formulario directo: ' +
      'ese enlace canónico necesita el Place ID. Para obtenerlo, arranca la app con una clave ' +
      'de la Places API (GOOGLE_MAPS_API_KEY) o pega el Place ID del negocio.';
  }

  result.hidden = false;
  result.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function addDetail(label, value, isHtml = false) {
  if (!value) return;
  const dt = document.createElement('dt');
  dt.textContent = label;
  const dd = document.createElement('dd');
  if (isHtml) dd.innerHTML = value;
  else dd.textContent = value;
  details.append(dt, dd);
}

/**
 * Cuando el enlace corto no se puede resolver, lo importante es decir POR QUÉ
 * y dar una salida: en el móvil, abrir el enlace lleva a la app de Maps, no al
 * navegador, así que "copia la URL larga" sólo sirve en el ordenador.
 */
function showShortLinkHelp(shortUrl, reason) {
  statusBox.className = 'status error';
  statusBox.hidden = false;
  statusBox.replaceChildren();

  const title = document.createElement('strong');
  title.textContent = 'No he podido resolver el enlace corto.';

  const why = document.createElement('p');
  why.className = 'why';
  why.textContent = reason;

  const how = document.createElement('p');
  how.append(document.createTextNode('Salida rápida: abre '));
  const link = document.createElement('a');
  link.href = shortUrl || '#';
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = 'el enlace en un ordenador';
  how.append(link);
  how.append(
    document.createTextNode(
      ' y pega aquí la URL larga de la barra de direcciones (la que contiene /maps/place/…). ' +
        'En el móvil ese enlace abre la app de Maps, así que la URL larga no aparece.'
    )
  );

  statusBox.append(title, why, how);
}

/** Averigua si el problema es que no hay API desplegada, y lo dice claro. */
async function diagnose() {
  if (location.protocol === 'file:') {
    return 'Has abierto el HTML directamente desde el disco (file://), así que no hay ninguna API detrás. Arranca la app con "npm start".';
  }
  try {
    const response = await fetch('/api/health', { cache: 'no-store' });
    if (response.ok) {
      return 'La API responde, pero la resolución del enlace falló. Mira los logs del servidor.';
    }
    if (response.status === 404) {
      return 'La API no existe en este dominio: /api/health devuelve 404. El despliegue es sólo estático o le falta la carpeta api/ (redespliega la última versión).';
    }
    return 'La API respondió con un error ' + response.status + '.';
  } catch {
    return 'No se pudo contactar con la API (sin conexión, o bloqueada por el navegador).';
  }
}

function showStatus(message, kind) {
  statusBox.replaceChildren();
  statusBox.textContent = message;
  statusBox.className = 'status ' + (kind || '');
  statusBox.hidden = false;
}

function hide(element) {
  element.hidden = true;
}

function setBusy(busy) {
  submit.disabled = busy;
  submit.textContent = busy ? 'Generando…' : 'Generar';
}
