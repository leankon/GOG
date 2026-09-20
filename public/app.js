import { parseMapsLink, buildReviewLinks } from './parser.js';

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
    if (!remote) {
      setBusy(false);
      return showStatus(
        'No he podido resolver el enlace corto (el servidor no está disponible). ' +
          'Ábrelo en el navegador y copia aquí la URL larga que aparece en la barra de direcciones.',
        'error'
      );
    }
    parsed = remote;
  } else if (parsed.ok && !parsed.placeId) {
    // 3. Tenemos CID/FTID pero no el Place ID: si el servidor tiene clave de
    //    la Places API puede afinarlo. Si no, seguimos con lo que hay.
    const remote = await askServer(value);
    if (remote && remote.ok && remote.placeId) parsed = remote;
  }

  setBusy(false);

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

function showStatus(message, kind) {
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
