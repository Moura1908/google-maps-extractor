'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { isWithinDays } = require('../src/shared/recency.js');

const NOW = new Date('2026-07-29T12:00:00Z');

test('timestamp de hoje está dentro de qualquer janela positiva', () => {
  assert.strictEqual(isWithinDays('2026-07-29T10:00:00Z', 7, NOW), true);
});

test('timestamp exatamente no limite da janela conta como dentro', () => {
  const sevenDaysAgo = '2026-07-22T12:00:00Z';
  assert.strictEqual(isWithinDays(sevenDaysAgo, 7, NOW), true);
});

test('timestamp um segundo além do limite fica fora', () => {
  const justOutside = '2026-07-22T11:59:59Z';
  assert.strictEqual(isWithinDays(justOutside, 7, NOW), false);
});

test('timestamp antigo fica fora de uma janela curta', () => {
  assert.strictEqual(isWithinDays('2026-01-01T00:00:00Z', 7, NOW), false);
});

test('janela maior alcança um timestamp mais antigo', () => {
  assert.strictEqual(isWithinDays('2026-01-01T00:00:00Z', 365, NOW), true);
});

test('timestamp vazio ou ausente não conta como recente', () => {
  assert.strictEqual(isWithinDays('', 7, NOW), false);
  assert.strictEqual(isWithinDays(undefined, 7, NOW), false);
  assert.strictEqual(isWithinDays(null, 7, NOW), false);
});

test('timestamp inválido não explode, só não conta como recente', () => {
  assert.strictEqual(isWithinDays('não é uma data', 7, NOW), false);
});

test('dias zero, negativo ou não-numérico não contam nada como recente', () => {
  assert.strictEqual(isWithinDays('2026-07-29T10:00:00Z', 0, NOW), false);
  assert.strictEqual(isWithinDays('2026-07-29T10:00:00Z', -1, NOW), false);
  assert.strictEqual(isWithinDays('2026-07-29T10:00:00Z', NaN, NOW), false);
});

test('usa Date.now() por padrão quando `now` não é informado', () => {
  const today = new Date().toISOString();
  assert.strictEqual(isWithinDays(today, 1), true);
});
