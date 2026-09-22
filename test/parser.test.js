import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMapsLink, buildReviewLinks, isShortLink, ftidToCid } from '../public/parser.js';

test('URL con place_id explícito', () => {
  const parsed = parseMapsLink('https://www.google.com/maps/place/?q=place_id:ChIJN1t_tDeuEmsRUsoyG83frY4');
  assert.equal(parsed.ok, true);
  assert.equal(parsed.placeId, 'ChIJN1t_tDeuEmsRUsoyG83frY4');
  assert.equal(
    buildReviewLinks(parsed).review,
    'https://search.google.com/local/writereview?placeid=ChIJN1t_tDeuEmsRUsoyG83frY4'
  );
  assert.equal(buildReviewLinks(parsed).confidence, 'exact');
});

test('Place ID pegado a pelo', () => {
  const parsed = parseMapsLink('  ChIJN1t_tDeuEmsRUsoyG83frY4 ');
  assert.equal(parsed.placeId, 'ChIJN1t_tDeuEmsRUsoyG83frY4');
  assert.equal(parsed.source, 'place-id');
});

test('URL larga con data=!1s0x…:0x… devuelve FTID, CID, nombre y coordenadas', () => {
  const parsed = parseMapsLink(
    'https://www.google.com/maps/place/Mercado+de+San+Miguel/@40.4153,-3.7091,17z/data=!3m1!4b1!4m6!3m5!1s0xd42287b4e0a1c8f:0x9a2f1f4b0c3d5e77!8m2!3d40.4153!4d-3.7091'
  );
  assert.equal(parsed.ok, true);
  assert.equal(parsed.ftid, '0xd42287b4e0a1c8f:0x9a2f1f4b0c3d5e77');
  assert.equal(parsed.cid, BigInt('0x9a2f1f4b0c3d5e77').toString(10));
  assert.equal(parsed.name, 'Mercado de San Miguel');
  assert.deepEqual(parsed.coords, { lat: 40.4153, lng: -3.7091 });
  assert.equal(buildReviewLinks(parsed).confidence, 'partial');
});

test('URL con query_place_id (enlaces de indicaciones)', () => {
  const parsed = parseMapsLink(
    'https://www.google.com/maps/search/?api=1&query=Museo&query_place_id=ChIJrTLr-GyuEmsRBfy61i59si0'
  );
  assert.equal(parsed.placeId, 'ChIJrTLr-GyuEmsRBfy61i59si0');
});

test('URL con cid numérico', () => {
  const parsed = parseMapsLink('https://maps.google.com/?cid=11109174138712793719');
  assert.equal(parsed.cid, '11109174138712793719');
  const links = buildReviewLinks(parsed);
  assert.equal(links.confidence, 'partial');
  assert.ok(links.extras.some((e) => e.url.includes('cid=11109174138712793719')));
});

test('enlaces cortos se marcan para resolver en el servidor', () => {
  for (const url of ['https://maps.app.goo.gl/AbCdEf123', 'https://goo.gl/maps/xyz']) {
    const parsed = parseMapsLink(url);
    assert.equal(parsed.needsResolution, true, url);
    assert.equal(isShortLink(url), true, url);
  }
});

test('texto con el enlace dentro', () => {
  const parsed = parseMapsLink('Mira este sitio https://www.google.com/maps/place/?q=place_id:ChIJN1t_tDeuEmsRUsoyG83frY4 ¿te gusta?');
  assert.equal(parsed.placeId, 'ChIJN1t_tDeuEmsRUsoyG83frY4');
});

test('entradas inválidas dan un error claro', () => {
  assert.match(parseMapsLink('').error, /Pega un enlace/);
  assert.match(parseMapsLink('hola').error, /no parece un enlace/);
  assert.match(parseMapsLink('https://example.com/sitio').error, /no es de Google Maps/);
  assert.match(
    parseMapsLink('https://www.google.com/maps/@40.4,-3.7,15z').error,
    /no contiene el identificador/
  );
});

test('ftidToCid convierte la segunda mitad hexadecimal a decimal', () => {
  assert.equal(ftidToCid('0x0:0x1f'), '31');
  assert.equal(ftidToCid('sin hex'), null);
});

test('sin datos utilizables no se inventa enlace', () => {
  const links = buildReviewLinks(parseMapsLink('hola'));
  assert.equal(links.review, null);
  assert.equal(links.confidence, 'none');
});

test('texto de "Compartir" del móvil: se queda con el enlace y el nombre', () => {
  const parsed = parseMapsLink('Bar Manolo\nCalle Mayor 1, 28013 Madrid\nhttps://maps.app.goo.gl/AbCdEf123');
  assert.equal(parsed.needsResolution, true);
  assert.equal(parsed.url, 'https://maps.app.goo.gl/AbCdEf123');
  assert.equal(parsed.name, 'Bar Manolo');
});

test('un enlace corto a secas no inventa nombre', () => {
  assert.equal(parseMapsLink('https://maps.app.goo.gl/AbCdEf123').name, null);
});
