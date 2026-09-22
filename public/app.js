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
const reviewLabel = document.getElementById('review-label');
const mobileBlock = document.getElementById('mobile-block');
const mobileUrl = document.getElementById('mobile-url');
const copyMobileBtn = document.getElementById('copy-mobile');
const openMobile = document.getElementById('open-mobile');
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

// En el móvil, pegar a mano en un campo es incómodo: un botón lo resuelve.
const pasteBtn = document.getElementById('paste');
pasteBtn.addEventListener('click', async () => {
  try {
    const texto = await navigator.clipboard.readText();
    if (!texto.trim()) throw new Error('portapapeles vacío');
    input.value = texto.trim();
    await generate(input.value);
  } catch {
    // Safari y algunos navegadores no dejan leer el portapapeles sin gesto
    // explícito: al menos dejamos el campo listo para pegar a mano.
    input.focus();
    showStatus('Pega el enlace en el campo (mantén pulsado → Pegar) y dale a Generar.', 'loading');
  }
});

// El service worker sólo sirve para poder instalar la app: instalada, aparece
// en el menú "Compartir" de Google Maps (share_target del manifiesto).
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

// Permite llegar con el enlace ya puesto: ?u=<enlace> (lo usa el atajo de
// compartir del móvil) y también ?text= / ?url= del share target.
const entrada = new URLSearchParams(location.search);
const compartido = entrada.get('u') || entrada.get('url') || entrada.get('text') || entrada.get('shared');
if (compartido) {
  input.value = compartido.trim();
  generate(input.value);
}

for (const chip of document.querySelectorAll('.chip')) {
  chip.addEventListener('click', () => {
    input.value = chip.dataset.example;
    generate(input.value);
  });
}

async function copiar(campo, boton) {
  try {
    await navigator.clipboard.writeText(campo.value);
  } catch {
    campo.select();
    document.execCommand('copy');
  }
  boton.textContent = '¡Copiado!';
  setTimeout(() => (boton.textContent = 'Copiar'), 1800);
}

copyBtn.addEventListener('click', () => copiar(reviewUrl, copyBtn));
copyMobileBtn.addEventListener('click', () => copiar(mobileUrl, copyMobileBtn));

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

let ultimaRespuesta = null;

async function askServer(url) {
  try {
    const response = await fetch('/api/resolve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    // Aunque el estado sea 4xx/5xx, el cuerpo trae el motivo: lo mostramos.
    const data = await response.json().catch(() => null);
    ultimaRespuesta = data && typeof data === 'object' ? data : null;
    return ultimaRespuesta;
  } catch {
    return null; // Sin servidor: modo estático.
  }
}

function render(parsed, links) {
  reviewUrl.value = links.review;
  openLink.href = links.review;

  // El enlace aproximado usa el panel de reseñas de la búsqueda de escritorio,
  // que en el móvil no existe: ahí hay que ofrecer la ficha de la app de Maps.
  const necesitaAlternativaMovil = Boolean(links.mobile) && links.mobile !== links.review;
  reviewLabel.hidden = !necesitaAlternativaMovil;
  mobileBlock.hidden = !necesitaAlternativaMovil;
  if (necesitaAlternativaMovil) {
    mobileUrl.value = links.mobile;
    openMobile.href = links.mobile;
  }

  const exact = links.confidence === 'exact';
  badge.textContent = exact ? 'Enlace directo' : 'Aproximado';
  badge.className = 'badge ' + links.confidence;

  details.innerHTML = '';
  addDetail('Negocio', parsed.name);
  addDetail(parsed.placeIdCalculado ? 'Place ID (calculado)' : 'Place ID', parsed.placeId);
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
      'Este enlace venía sólo con el CID del negocio, y con eso no se puede calcular el ' +
      'Place ID. El enlace de arriba abre el panel de reseñas de la búsqueda de Google, que ' +
      'sólo existe en ordenador; en el móvil usa el segundo. Para un único enlace que valga ' +
      'en todos lados, pega la URL larga de la ficha (la que lleva /maps/place/… en la barra ' +
      'de direcciones): de ahí sí se calcula el Place ID.';
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
  if (ultimaRespuesta) statusBox.append(detallesTecnicos(ultimaRespuesta));
}

/** Detalle plegable: lo que hizo el servidor, para poder diagnosticar de verdad. */
function detallesTecnicos(respuesta) {
  const box = document.createElement('details');
  box.className = 'debug';
  const resumen = document.createElement('summary');
  resumen.textContent = 'Detalles técnicos';
  const pre = document.createElement('pre');
  pre.textContent = JSON.stringify(
    {
      pasos: respuesta.steps || [],
      debug: respuesta.debug || null,
      placeId: respuesta.placeId || null,
      cid: respuesta.cid || null,
      ftid: respuesta.ftid || null,
      apiKey: respuesta.apiKeyConfigured ?? null,
    },
    null,
    1
  );
  box.append(resumen, pre);
  return box;
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
