'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { ingestSearchPayload } = require('../src/content/ingest.js');
const { buildEntry, buildSearchResponse } = require('./fixtures.js');

test('um lead completo sai pronto para o CSV', () => {
  const body = buildSearchResponse([buildEntry()]);
  const [lead] = ingestSearchPayload(body, {
    knownKeys: new Set(),
    query: 'cafeterias em brasília',
    country: 'BR',
    now: new Date('2026-07-28T12:00:00Z'),
  });

  assert.strictEqual(lead.name, 'Café Central');
  assert.strictEqual(lead.key, 'place:ChIJ_place_1');
  assert.strictEqual(lead.search_query, 'cafeterias em brasília');
  assert.strictEqual(lead.scraped_at, '2026-07-28T12:00:00.000Z');
  assert.strictEqual(lead.phone_e164, '+5561999991234');
  assert.strictEqual(lead.phone_type, 'mobile');
});

test('a mesma página processada duas vezes não duplica', () => {
  const knownKeys = new Set();
  const body = buildSearchResponse([buildEntry(), buildEntry({ placeID: 'ChIJ_place_2', name: 'Padaria' })]);

  assert.strictEqual(ingestSearchPayload(body, { knownKeys }).length, 2);
  assert.strictEqual(ingestSearchPayload(body, { knownKeys }).length, 0, 'segunda passada não traz nada novo');
  assert.strictEqual(knownKeys.size, 2);
});

test('REGRESSÃO: leads sem placeID continuam entrando na base', () => {
  // Antes, o segundo e o terceiro sumiam porque a chave era o placeID vazio.
  const knownKeys = new Set();
  const body = buildSearchResponse([
    buildEntry({ name: 'Barbearia A', placeID: null, cID: null, address: ['Rua 1'] }),
    buildEntry({ name: 'Barbearia B', placeID: null, cID: null, address: ['Rua 2'] }),
    buildEntry({ name: 'Barbearia C', placeID: null, cID: null, address: ['Rua 3'] }),
  ]);

  const leads = ingestSearchPayload(body, { knownKeys });
  assert.strictEqual(leads.length, 3);
  assert.deepStrictEqual(leads.map((lead) => lead.name), ['Barbearia A', 'Barbearia B', 'Barbearia C']);
});

test('payload corrompido devolve lista vazia em vez de derrubar a coleta', () => {
  const leads = ingestSearchPayload('isso não é json', { knownKeys: new Set() });
  assert.deepStrictEqual(leads, []);
});

test('estabelecimento sem telefone não inventa E.164', () => {
  const body = buildSearchResponse([buildEntry({ phone: null })]);
  const [lead] = ingestSearchPayload(body, { knownKeys: new Set() });

  assert.strictEqual(lead.phone, '');
  assert.strictEqual(lead.phone_e164, '');
  assert.strictEqual(lead.phone_type, 'unknown');
});

test('o país do payload segue o parâmetro, não um default fixo', () => {
  const body = buildSearchResponse([buildEntry({ phone: '912 345 678' })]);
  const [lead] = ingestSearchPayload(body, { knownKeys: new Set(), country: 'PT' });
  assert.strictEqual(lead.phone_e164, '+351912345678');
});
