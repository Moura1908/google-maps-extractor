'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { normalizePhone, countryFromMapsHost } = require('../src/shared/phone.js');

test('celular BR com nono dígito', () => {
  const result = normalizePhone('(61) 99999-9999', 'BR');
  assert.strictEqual(result.e164, '+5561999999999');
  assert.strictEqual(result.type, 'mobile');
  assert.strictEqual(result.country, 'BR');
  assert.strictEqual(result.legacy8, false);
});

test('fixo BR', () => {
  const result = normalizePhone('(61) 3333-4444', 'BR');
  assert.strictEqual(result.e164, '+556133334444');
  assert.strictEqual(result.type, 'landline');
  assert.strictEqual(result.legacy8, false);
});

test('celular BR antigo de 8 dígitos é sinalizado e NÃO ganha o nono dígito', () => {
  const result = normalizePhone('(61) 9999-8888', 'BR');
  assert.strictEqual(result.e164, '+556199998888');
  assert.strictEqual(result.type, 'mobile');
  assert.strictEqual(result.legacy8, true);
});

test('número já em formato internacional BR', () => {
  const result = normalizePhone('+55 61 98765-4321', 'BR');
  assert.strictEqual(result.e164, '+5561987654321');
  assert.strictEqual(result.type, 'mobile');
});

test('prefixo 55 sem "+" não é confundido com DDD', () => {
  const result = normalizePhone('5561987654321', 'BR');
  assert.strictEqual(result.e164, '+5561987654321');
  assert.strictEqual(result.type, 'mobile');
});

test('zero de operadora é descartado', () => {
  const result = normalizePhone('061 3333-4444', 'BR');
  assert.strictEqual(result.e164, '+556133334444');
  assert.strictEqual(result.type, 'landline');
});

test('número internacional de outro país passa sem classificação', () => {
  const result = normalizePhone('+1 415 555 0100', 'BR');
  assert.strictEqual(result.e164, '+14155550100');
  assert.strictEqual(result.type, 'unknown');
});

test('o "+" vence o país padrão', () => {
  const result = normalizePhone('+351 912 345 678', 'BR');
  assert.strictEqual(result.e164, '+351912345678');
  assert.strictEqual(result.country, '');
});

test('DDD inválido não vira E.164', () => {
  const result = normalizePhone('(01) 3333-4444', 'BR');
  assert.strictEqual(result.e164, '');
  assert.strictEqual(result.type, 'unknown');
});

test('número curto demais não vira E.164', () => {
  assert.strictEqual(normalizePhone('3333-4444', 'BR').e164, '');
});

test('entrada vazia é tratada', () => {
  for (const input of ['', null, undefined, '   ']) {
    assert.strictEqual(normalizePhone(input, 'BR').e164, '');
  }
});

test('país conhecido só pelo código de discagem recebe prefixo, sem classificar', () => {
  const result = normalizePhone('912 345 678', 'PT');
  assert.strictEqual(result.e164, '+351912345678');
  assert.strictEqual(result.type, 'unknown');
});

test('país do TLD do Maps', () => {
  assert.strictEqual(countryFromMapsHost('www.google.com.br'), 'BR');
  assert.strictEqual(countryFromMapsHost('www.google.pt'), 'PT');
  assert.strictEqual(countryFromMapsHost('www.google.com'), null);
});
