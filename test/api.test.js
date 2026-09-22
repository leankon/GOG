import test from 'node:test';
import assert from 'node:assert/strict';
import { isAllowedHost } from '../lib/resolve.js';
import handler from '../api/resolve.js';
import health from '../api/health.js';

/** Imita el objeto `res` de Vercel lo justo para las aserciones. */
function fakeRes() {
  return {
    statusCode: null,
    body: null,
    setHeader() {
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

test('sólo se siguen redirecciones a dominios de Google', () => {
  for (const host of ['www.google.com', 'maps.google.es', 'maps.app.goo.gl', 'g.co']) {
    assert.equal(isAllowedHost(host), true, host);
  }
  for (const host of ['example.com', 'google.com.evil.net', 'localhost', '169.254.169.254']) {
    assert.equal(isAllowedHost(host), false, host);
  }
});

test('la función serverless devuelve los enlaces de una URL con Place ID', async () => {
  const res = fakeRes();
  await handler({ method: 'POST', body: { url: 'https://www.google.com/maps/place/?q=place_id:ChIJN1t_tDeuEmsRUsoyG83frY4' } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(
    res.body.links.review,
    'https://search.google.com/local/writereview?placeid=ChIJN1t_tDeuEmsRUsoyG83frY4'
  );
});

test('la función acepta el cuerpo sin parsear', async () => {
  const res = fakeRes();
  await handler({ method: 'POST', body: JSON.stringify({ url: 'ChIJN1t_tDeuEmsRUsoyG83frY4' }) }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.placeId, 'ChIJN1t_tDeuEmsRUsoyG83frY4');
});

test('la función rechaza método y cuerpo inválidos con JSON, no con un 500', async () => {
  const getRes = fakeRes();
  await handler({ method: 'GET' }, getRes);
  assert.equal(getRes.statusCode, 405);

  const emptyRes = fakeRes();
  await handler({ method: 'POST', body: {} }, emptyRes);
  assert.equal(emptyRes.statusCode, 400);
  assert.equal(emptyRes.body.ok, false);

  const brokenRes = fakeRes();
  await handler({ method: 'POST', body: '{no es json' }, brokenRes);
  assert.equal(brokenRes.statusCode, 500);
  assert.match(brokenRes.body.error, /Error al resolver/);
});

test('health responde sin tocar la red', () => {
  const res = fakeRes();
  health({ method: 'GET' }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
});

test('el parser tampoco acepta dominios que sólo contienen "google."', async () => {
  const { parseMapsLink } = await import('../public/parser.js');
  const parsed = parseMapsLink('https://google.com.evil.net/maps/place/?q=place_id:ChIJN1t_tDeuEmsRUsoyG83frY4');
  assert.equal(parsed.ok, false);
  assert.match(parsed.error, /no es de Google Maps/);
});

test('parseFromHtml rescata el identificador del HTML de destino', async () => {
  const { parseFromHtml } = await import('../lib/resolve.js');

  // URL incrustada con las barras escapadas, como la sirve Google.
  const conPlace = parseFromHtml(
    '<script>var x="https:\\/\\/www.google.com\\/maps\\/place\\/Bar+Manolo\\/data=!4m2!3m1!1s0xd42287b4e0a1c8f:0x9a2f1f4b0c3d5e77";</script>'
  );
  assert.equal(conPlace.ftid, '0xd42287b4e0a1c8f:0x9a2f1f4b0c3d5e77');
  assert.equal(conPlace.name, 'Bar Manolo');

  // Sin URL completa, pero con el Place ID suelto en la página.
  const suelto = parseFromHtml('<meta content="ChIJN1t_tDeuEmsRUsoyG83frY4">');
  assert.equal(suelto.placeId, 'ChIJN1t_tDeuEmsRUsoyG83frY4');

  // Una página sin nada aprovechable no inventa resultados.
  assert.equal(parseFromHtml('<html><body>Sin datos</body></html>'), null);
  assert.equal(parseFromHtml(''), null);
});

test('la versión de la web y la de la API son la misma', async () => {
  const { VERSION } = await import('../public/version.js');
  const res = fakeRes();
  health({ method: 'GET' }, res);
  assert.equal(res.body.version, VERSION);
});
