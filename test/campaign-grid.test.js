'use strict';

const test = require('node:test');
const assert = require('node:assert');
const {
  buildRegionQueries,
  buildCoordinateGrid,
  buildMapsSearchUrl,
} = require('../src/shared/campaign-grid.js');

test('buildRegionQueries combina o termo base com cada região', () => {
  const result = buildRegionQueries('clínicas de estética', ['Asa Sul', 'Taguatinga']);
  assert.deepStrictEqual(result, ['clínicas de estética em Asa Sul', 'clínicas de estética em Taguatinga']);
});

test('buildRegionQueries ignora regiões vazias ou só espaço', () => {
  const result = buildRegionQueries('barbearias', ['Águas Claras', '', '   ', 'Sobradinho']);
  assert.deepStrictEqual(result, ['barbearias em Águas Claras', 'barbearias em Sobradinho']);
});

test('buildRegionQueries com termo base vazio devolve lista vazia', () => {
  assert.deepStrictEqual(buildRegionQueries('', ['Asa Sul']), []);
  assert.deepStrictEqual(buildRegionQueries('   ', ['Asa Sul']), []);
});

test('buildRegionQueries sem regiões devolve lista vazia', () => {
  assert.deepStrictEqual(buildRegionQueries('barbearias', []), []);
  assert.deepStrictEqual(buildRegionQueries('barbearias', undefined), []);
});

test('buildCoordinateGrid sem raio devolve só o centro', () => {
  const grid = buildCoordinateGrid({ lat: -15.79, lng: -47.88 });
  assert.strictEqual(grid.length, 1);
  assert.strictEqual(grid[0].lat, -15.79);
  assert.strictEqual(grid[0].lng, -47.88);
});

test('buildCoordinateGrid com centro inválido devolve lista vazia', () => {
  assert.deepStrictEqual(buildCoordinateGrid(null), []);
  assert.deepStrictEqual(buildCoordinateGrid({ lat: 'x', lng: -47.88 }), []);
  assert.deepStrictEqual(buildCoordinateGrid(undefined, { radiusKm: 5 }), []);
});

test('buildCoordinateGrid com raio gera mais de um ponto', () => {
  const grid = buildCoordinateGrid({ lat: -15.79, lng: -47.88 }, { radiusKm: 5, stepKm: 2 });
  assert.ok(grid.length > 1, 'um raio maior que o passo precisa gerar vários pontos');
});

test('buildCoordinateGrid: todos os pontos ficam dentro do raio pedido (dentro da tolerância de km->grau)', () => {
  const center = { lat: -15.79, lng: -47.88 };
  const radiusKm = 6;
  const grid = buildCoordinateGrid(center, { radiusKm, stepKm: 2 });

  for (const point of grid) {
    const dLat = (point.lat - center.lat) * 111.32;
    const dLng = (point.lng - center.lng) * 111.32 * Math.cos((center.lat * Math.PI) / 180);
    const distanceKm = Math.sqrt(dLat * dLat + dLng * dLng);
    assert.ok(distanceKm <= radiusKm + 0.01, `ponto a ${distanceKm.toFixed(2)}km, além do raio de ${radiusKm}km`);
  }
});

test('buildCoordinateGrid inclui o centro exato quando o grid é alinhado nele', () => {
  const center = { lat: -15.79, lng: -47.88 };
  const grid = buildCoordinateGrid(center, { radiusKm: 4, stepKm: 2 });
  const hasCenter = grid.some((p) => Math.abs(p.lat - center.lat) < 1e-9 && Math.abs(p.lng - center.lng) < 1e-9);
  assert.ok(hasCenter, 'o próprio centro deveria estar entre os pontos gerados');
});

test('buildCoordinateGrid propaga o zoom para todos os pontos', () => {
  const grid = buildCoordinateGrid({ lat: 0, lng: 0 }, { radiusKm: 3, stepKm: 3, zoom: 16 });
  assert.ok(grid.every((p) => p.zoom === 16));
});

test('buildMapsSearchUrl sem coordenada usa só o texto', () => {
  const url = buildMapsSearchUrl('cafeterias em brasília');
  assert.strictEqual(url, 'https://www.google.com/maps/search/cafeterias%20em%20bras%C3%ADlia');
});

test('buildMapsSearchUrl com coordenada ancora a busca na região', () => {
  const url = buildMapsSearchUrl('cafeterias', { lat: -15.79, lng: -47.88, zoom: 15 });
  assert.strictEqual(url, 'https://www.google.com/maps/search/cafeterias/@-15.79,-47.88,15z');
});

test('buildMapsSearchUrl escapa caracteres especiais da busca', () => {
  const url = buildMapsSearchUrl('R&D / consultoria');
  assert.ok(url.includes(encodeURIComponent('R&D / consultoria')));
});
