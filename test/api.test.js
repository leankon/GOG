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
