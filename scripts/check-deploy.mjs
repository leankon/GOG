/**
 * Comprueba que un despliegue está completo: web estática + funciones.
 *
 *   node scripts/check-deploy.mjs https://mi-app.vercel.app
 */
const base = (process.argv[2] || 'http://localhost:3000').replace(/\/+$/, '');
const EJEMPLO = 'https://www.google.com/maps/place/?q=place_id:ChIJN1t_tDeuEmsRUsoyG83frY4';

async function comprobar(nombre, fn) {
  try {
    const detalle = await fn();
    console.log(`✓ ${nombre}${detalle ? ' — ' + detalle : ''}`);
    return true;
  } catch (error) {
    console.log(`✗ ${nombre} — ${error.message}`);
    return false;
  }
}

const web = await comprobar('Web estática', async () => {
  const res = await fetch(base + '/');
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const html = await res.text();
  if (!html.includes('id="form"')) throw new Error('la respuesta no es la página de la app');
  return 'index.html servido';
});

const health = await comprobar('API /api/health', async () => {
  const res = await fetch(base + '/api/health');
  if (res.status === 404) throw new Error('404: las funciones de api/ no están desplegadas');
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const data = await res.json();
  return `runtime ${data.runtime}, Places API ${data.apiKeyConfigured ? 'configurada' : 'sin clave'}`;
});

const resolve = await comprobar('API /api/resolve', async () => {
  const res = await fetch(base + '/api/resolve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: EJEMPLO }),
  });
  if (res.status === 404) throw new Error('404: la función no está desplegada');
  const data = await res.json().catch(() => {
    throw new Error('la respuesta no es JSON (HTTP ' + res.status + '): la función no está desplegada');
  });
  if (!data.links?.review) throw new Error('no devolvió enlace: ' + (data.error || 'respuesta inesperada'));
  return data.links.review;
});

if (!(web && health && resolve)) {
  console.log('\nRevisa en Vercel: Framework Preset "Other", Build Command vacío, Output Directory "public".');
  process.exit(1);
}
console.log('\nDespliegue correcto.');
