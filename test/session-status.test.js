'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { formatRollingMessage, formatCompletionMessage } = require('../src/content/session-status.js');

test('mensagem de rolagem cita o contador da sessão', () => {
  assert.strictEqual(formatRollingMessage(0), 'Rolando... 0 novos leads nesta busca');
  assert.strictEqual(formatRollingMessage(42), 'Rolando... 42 novos leads nesta busca');
});

test('fim da lista', () => {
  assert.strictEqual(formatCompletionMessage('end_of_list', 87), 'Concluído — 87 leads nesta busca (fim dos resultados)');
});

test('trava de rolagem', () => {
  assert.strictEqual(formatCompletionMessage('stalled', 12), 'Parado — 12 leads nesta busca (lista não cresceu mais)');
});

test('interrupção do usuário', () => {
  assert.strictEqual(formatCompletionMessage('user_stopped', 5), 'Interrompido — 5 leads nesta busca');
});

test('motivo desconhecido cai para o texto de conclusão normal', () => {
  assert.strictEqual(formatCompletionMessage('algo_novo', 3), 'Concluído — 3 leads nesta busca (fim dos resultados)');
});

test('os três motivos citam textos diferentes entre si', () => {
  const texts = new Set([
    formatCompletionMessage('end_of_list', 10),
    formatCompletionMessage('stalled', 10),
    formatCompletionMessage('user_stopped', 10),
  ]);
  assert.strictEqual(texts.size, 3);
});
