'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { createCampaign, currentItem, isComplete, advance, progressSummary } = require('../src/shared/campaign.js');

test('createCampaign filtra buscas vazias e começa no item 0', () => {
  const campaign = createCampaign(['busca a', '', 'busca b']);
  assert.strictEqual(campaign.items.length, 2);
  assert.strictEqual(campaign.currentIndex, 0);
  assert.strictEqual(campaign.items[0].status, 'pending');
});

test('createCampaign usa 30s de pausa por padrão e aceita override', () => {
  assert.strictEqual(createCampaign(['a']).pauseMs, 30000);
  assert.strictEqual(createCampaign(['a'], { pauseMs: 5000 }).pauseMs, 5000);
});

test('duas campanhas têm ids diferentes', () => {
  const a = createCampaign(['x']);
  const b = createCampaign(['x']);
  assert.notStrictEqual(a.id, b.id);
});

test('currentItem devolve o item pendente atual', () => {
  const campaign = createCampaign(['busca a', 'busca b']);
  assert.strictEqual(currentItem(campaign).query, 'busca a');
});

test('currentItem devolve null quando a campanha já terminou ou não existe', () => {
  assert.strictEqual(currentItem(null), null);
  const campaign = createCampaign(['única busca']);
  const done = advance(campaign, 'end_of_list');
  assert.strictEqual(currentItem(done), null);
});

test('isComplete é falso enquanto houver item pendente', () => {
  const campaign = createCampaign(['a', 'b']);
  assert.strictEqual(isComplete(campaign), false);
});

test('isComplete fica verdadeiro depois do último item avançar', () => {
  let campaign = createCampaign(['única busca']);
  campaign = advance(campaign, 'end_of_list');
  assert.strictEqual(isComplete(campaign), true);
});

test('campanha nula ou sem items conta como completa (nada para fazer)', () => {
  assert.strictEqual(isComplete(null), true);
  assert.strictEqual(isComplete(createCampaign([])), true);
});

test('advance marca o item atual com o motivo e avança o índice, sem mutar o original', () => {
  const original = createCampaign(['a', 'b']);
  const updated = advance(original, 'stalled');

  assert.strictEqual(original.currentIndex, 0, 'o objeto original não pode ser mutado');
  assert.strictEqual(original.items[0].status, 'pending');

  assert.strictEqual(updated.currentIndex, 1);
  assert.strictEqual(updated.items[0].status, 'stalled');
  assert.ok(updated.items[0].finishedAt);
  assert.strictEqual(updated.items[1].status, 'pending', 'o próximo item não pode ser tocado ainda');
});

test('a campanha percorre todos os itens em sequência até completar', () => {
  let campaign = createCampaign(['a', 'b', 'c']);
  const outcomes = ['end_of_list', 'stalled', 'user_stopped'];

  for (const outcome of outcomes) {
    assert.strictEqual(isComplete(campaign), false);
    campaign = advance(campaign, outcome);
  }

  assert.strictEqual(isComplete(campaign), true);
  assert.deepStrictEqual(
    campaign.items.map((item) => item.status),
    outcomes
  );
});

test('progressSummary reflete quantos itens já foram concluídos', () => {
  let campaign = createCampaign(['a', 'b', 'c']);
  assert.deepStrictEqual(progressSummary(campaign), { done: 0, total: 3 });

  campaign = advance(campaign, 'end_of_list');
  assert.deepStrictEqual(progressSummary(campaign), { done: 1, total: 3 });
});

test('progressSummary de campanha nula não explode', () => {
  assert.deepStrictEqual(progressSummary(null), { done: 0, total: 0 });
});

test('advance sem outcome explícito cai para "done"', () => {
  const campaign = advance(createCampaign(['a']));
  assert.strictEqual(campaign.items[0].status, 'done');
});
