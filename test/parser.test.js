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
  // Con el feature id completo el Place ID se calcula, así que el enlace es
  // el directo y no el aproximado.
  assert.equal(parsed.placeIdCalculado, true);
  assert.equal(buildReviewLinks(parsed).confidence, 'exact');
});

test('el Place ID se calcula a partir del feature id', async () => {
  const { placeIdFromFtid } = await import('../public/parser.js');
  // Caso conocido: los dos enteros de 64 bits empaquetados en protobuf.
  assert.equal(
    placeIdFromFtid('0x95bcb5d08d830731:0x7f50e26552999af3'),
    'ChIJMQeDjdC1vJUR85qZUmXiUH8'
  );
  assert.equal(placeIdFromFtid('sin feature id'), null);
});

test('una URL larga da el mismo enlace para ordenador y para móvil', () => {
  const parsed = parseMapsLink(
    'https://www.google.com/maps/place/X/@0,0,17z/data=!4m6!3m5!1s0x95bcb5d08d830731:0x7f50e26552999af3!8m2!3d0!4d0'
  );
  const links = buildReviewLinks(parsed);
  assert.equal(links.confidence, 'exact');
  assert.equal(links.mobile, links.review);
  assert.equal(
    links.review,
    'https://search.google.com/local/writereview?placeid=ChIJMQeDjdC1vJUR85qZUmXiUH8'
  );
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

test('el caso aproximado ofrece un enlace distinto para el móvil', () => {
  const parsed = parseMapsLink('https://maps.google.com/?cid=11109174138712793719');
  const links = buildReviewLinks(parsed);
  assert.equal(links.confidence, 'partial');
  // El de escritorio usa el panel de la búsqueda, que en móvil no existe.
  assert.match(links.review, /#lrd=/);
  // El de móvil abre la ficha en la app de Maps.
  assert.equal(links.mobile, 'https://maps.google.com/?cid=11109174138712793719');
});

test('con Place ID el mismo enlace vale para ordenador y móvil', () => {
  const links = buildReviewLinks(parseMapsLink('ChIJN1t_tDeuEmsRUsoyG83frY4'));
  assert.equal(links.confidence, 'exact');
  assert.equal(links.mobile, links.review);
  assert.match(links.review, /^https:\/\/search\.google\.com\/local\/writereview\?placeid=/);
});
