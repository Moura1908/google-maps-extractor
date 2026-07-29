'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { summarizeByQuery } = require('../src/shared/campaigns.js');

function lead(query, scrapedAt) {
  return { search_query: query, scraped_at: scrapedAt };
}

test('array vazio devolve lista vazia', () => {
  assert.deepStrictEqual(summarizeByQuery([]), []);
});

test('agrupa leads pela mesma busca e conta corretamente', () => {
  const leads = [
    lead('cafeterias em brasília', '2026-07-01T10:00:00Z'),
    lead('cafeterias em brasília', '2026-07-01T10:05:00Z'),
    lead('cafeterias em brasília', '2026-07-01T10:10:00Z'),
  ];
  const result = summarizeByQuery(leads);

  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].query, 'cafeterias em brasília');
  assert.strictEqual(result[0].count, 3);
});

test('buscas diferentes viram grupos separados', () => {
  const leads = [
    lead('cafeterias em brasília', '2026-07-01T10:00:00Z'),
    lead('barbearias em taguatinga', '2026-07-02T10:00:00Z'),
  ];
  const result = summarizeByQuery(leads);

  assert.strictEqual(result.length, 2);
  assert.deepStrictEqual(
    result.map((g) => g.query).sort(),
    ['barbearias em taguatinga', 'cafeterias em brasília']
  );
});

test('a busca mais recente vem primeiro', () => {
  const leads = [
    lead('busca antiga', '2026-01-01T00:00:00Z'),
    lead('busca nova', '2026-07-29T00:00:00Z'),
    lead('busca do meio', '2026-04-15T00:00:00Z'),
  ];
  const result = summarizeByQuery(leads);

  assert.deepStrictEqual(
    result.map((g) => g.query),
    ['busca nova', 'busca do meio', 'busca antiga']
  );
});

test('leads sem search_query viram um grupo próprio, não são descartados', () => {
  const leads = [lead('', '2026-07-01T00:00:00Z'), lead(undefined, '2026-07-02T00:00:00Z'), lead('com busca', '2026-07-03T00:00:00Z')];
  const result = summarizeByQuery(leads);

  assert.strictEqual(result.length, 2);
  const emptyGroup = result.find((g) => g.query === '');
  assert.ok(emptyGroup, 'precisa existir um grupo com query vazia');
  assert.strictEqual(emptyGroup.count, 2, 'os dois leads sem query (\'\' e undefined) caem no mesmo grupo');
});

test('a data mais recente do grupo é a do lead mais novo, não a ordem de entrada', () => {
  const leads = [
    lead('mesma busca', '2026-07-01T00:00:00Z'),
    lead('mesma busca', '2026-06-01T00:00:00Z'), // mais antigo, entra depois
    lead('mesma busca', '2026-07-15T00:00:00Z'), // o mais novo de todos
  ];
  const result = summarizeByQuery(leads);
  assert.strictEqual(result[0].lastScrapedAt, '2026-07-15T00:00:00Z');
});

test('leads sem scraped_at não quebram a ordenação', () => {
  const leads = [lead('busca a', undefined), lead('busca b', '2026-07-01T00:00:00Z')];
  const result = summarizeByQuery(leads);
  assert.strictEqual(result.length, 2);
  assert.strictEqual(result[0].query, 'busca b');
});
