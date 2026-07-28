'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { parseSearchResponse } = require('../src/content/parser.js');
const { buildLeadKey } = require('../src/shared/leadkey.js');
const { buildEntry, buildSearchResponse } = require('./fixtures.js');

test('extrai todos os campos conhecidos de um estabelecimento', () => {
  const body = buildSearchResponse([buildEntry()]);
  const [lead] = parseSearchResponse(body);

  assert.strictEqual(lead.name, 'Café Central');
  assert.strictEqual(lead.phone, '(61) 99999-1234');
  assert.strictEqual(lead.website, 'https://cafecentral.com.br');
  assert.strictEqual(lead.address, 'SCLN 105,Brasília');
  assert.strictEqual(lead.placeID, 'ChIJ_place_1');
  assert.strictEqual(lead.cID, '123456789');
  assert.strictEqual(lead.category, 'Cafeteria;Padaria');
  assert.strictEqual(lead.reviewCount, 128);
  assert.strictEqual(lead.averageRating, 4.6);
  assert.strictEqual(lead.latitude, -15.79);
  assert.strictEqual(lead.longitude, -47.88);
});

test('item sem nome é descartado (linha de controle do feed)', () => {
  const body = buildSearchResponse([buildEntry({ name: null }), buildEntry()]);
  assert.strictEqual(parseSearchResponse(body).length, 1);
});

test('um índice que sumiu custa UM campo, não o lead inteiro', () => {
  // Simula o Google reordenando o array: telefone e horários desaparecem.
  const body = buildSearchResponse([buildEntry({ phone: null, website: null })]);
  const [lead] = parseSearchResponse(body);

  assert.strictEqual(lead.name, 'Café Central');
  assert.strictEqual(lead.phone, '');
  assert.strictEqual(lead.website, '');
  assert.strictEqual(lead.placeID, 'ChIJ_place_1');
});

test('horários viram colunas planas ordenadas pelo dia da semana', () => {
  const body = buildSearchResponse([
    buildEntry({
      workingHours: [
        ['terça-feira', 1, null, [['09:00–18:00']]],
        ['segunda-feira', 0, null, [['08:00–12:00'], ['14:00–18:00']]],
      ],
    }),
  ]);
  const [lead] = parseSearchResponse(body);

  assert.strictEqual(lead['0_segunda-feira'], '08:00–12:00, 14:00–18:00');
  assert.strictEqual(lead['1_terça-feira'], '09:00–18:00');
});

test('feed ausente devolve lista vazia em vez de explodir', () => {
  const body = `/*""*/${JSON.stringify({ d: `)]}'\n${JSON.stringify([])}` })}`;
  assert.deepStrictEqual(parseSearchResponse(body), []);
});

test('REGRESSÃO: leads sem placeID não se anulam na deduplicação', () => {
  // O bug original: chave = placeID. Sem placeID a chave virava "", o primeiro
  // lead ocupava o Set e todos os seguintes eram descartados em silêncio.
  const body = buildSearchResponse([
    buildEntry({ name: 'Barbearia A', placeID: null, cID: null, address: ['Rua 1'] }),
    buildEntry({ name: 'Barbearia B', placeID: null, cID: null, address: ['Rua 2'] }),
    buildEntry({ name: 'Barbearia C', placeID: null, cID: null, address: ['Rua 3'] }),
  ]);
  const leads = parseSearchResponse(body);
  const keys = new Set(leads.map(buildLeadKey));

  assert.strictEqual(leads.length, 3);
  assert.strictEqual(keys.size, 3, 'cada lead precisa de uma chave própria');
  assert.ok(![...keys].some((key) => key === '' || key === 'place:'), 'nenhuma chave vazia');
});

test('o mesmo estabelecimento em duas páginas gera a mesma chave', () => {
  const first = parseSearchResponse(buildSearchResponse([buildEntry()]))[0];
  const second = parseSearchResponse(buildSearchResponse([buildEntry()]))[0];
  assert.strictEqual(buildLeadKey(first), buildLeadKey(second));
});

test('sem placeID, a chave cai para o CID antes de nome+endereço', () => {
  const [lead] = parseSearchResponse(buildSearchResponse([buildEntry({ placeID: null })]));
  assert.strictEqual(buildLeadKey(lead), 'cid:123456789');
});
