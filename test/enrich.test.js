'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { isPublicHttpUrl, fetchUrlContent } = require('../src/background/enrich.js');

test('bloqueia loopback IPv4', () => {
  assert.strictEqual(isPublicHttpUrl('http://127.0.0.1/admin'), false);
  assert.strictEqual(isPublicHttpUrl('http://localhost:8080'), false);
});

test('bloqueia loopback IPv6', () => {
  assert.strictEqual(isPublicHttpUrl('http://[::1]:8080/x'), false);
});

test('bloqueia as três faixas RFC 1918', () => {
  assert.strictEqual(isPublicHttpUrl('http://10.0.0.5/x'), false);
  assert.strictEqual(isPublicHttpUrl('http://172.16.0.5/x'), false);
  assert.strictEqual(isPublicHttpUrl('http://172.31.255.255/x'), false);
  assert.strictEqual(isPublicHttpUrl('http://192.168.1.1/x'), false);
});

test('não confunde 172.15 e 172.32 (fora da faixa privada) com bloqueado', () => {
  assert.strictEqual(isPublicHttpUrl('http://172.15.0.1/x'), true);
  assert.strictEqual(isPublicHttpUrl('http://172.32.0.1/x'), true);
});

test('bloqueia link-local (metadado de nuvem costuma morar aqui)', () => {
  assert.strictEqual(isPublicHttpUrl('http://169.254.169.254/latest/meta-data'), false);
});

test('bloqueia domínios .local e .internal', () => {
  assert.strictEqual(isPublicHttpUrl('http://printer.local/'), false);
  assert.strictEqual(isPublicHttpUrl('http://api.internal/'), false);
});

test('bloqueia esquemas que não são http/https', () => {
  assert.strictEqual(isPublicHttpUrl('file:///etc/passwd'), false);
  assert.strictEqual(isPublicHttpUrl('ftp://example.com/x'), false);
  assert.strictEqual(isPublicHttpUrl('chrome-extension://abc/x'), false);
});

test('URL inválida não explode, só é rejeitada', () => {
  assert.strictEqual(isPublicHttpUrl('não é uma url'), false);
  assert.strictEqual(isPublicHttpUrl(''), false);
});

test('domínio público legítimo passa', () => {
  assert.strictEqual(isPublicHttpUrl('http://cafecentral.com.br'), true);
  assert.strictEqual(isPublicHttpUrl('https://www.exemplo.com/contato'), true);
});

test('fetchUrlContent nunca chama fetch para destino bloqueado (SSRF)', async () => {
  let fetchCalled = false;
  const originalFetch = global.fetch;
  global.fetch = async () => {
    fetchCalled = true;
    return { ok: true, text: async () => 'não deveria chegar aqui' };
  };

  try {
    const result = await fetchUrlContent('http://192.168.0.1/admin');
    assert.strictEqual(result, '');
    assert.strictEqual(fetchCalled, false, 'fetch real não pode ser chamado para host privado');
  } finally {
    global.fetch = originalFetch;
  }
});

test('fetchUrlContent chama fetch normalmente para destino público', async () => {
  let fetchCalled = false;
  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    fetchCalled = true;
    assert.strictEqual(url, 'https://exemplo.com/');
    return { ok: true, text: async () => '<html>ok</html>' };
  };

  try {
    const result = await fetchUrlContent('https://exemplo.com/');
    assert.strictEqual(result, '<html>ok</html>');
    assert.strictEqual(fetchCalled, true);
  } finally {
    global.fetch = originalFetch;
  }
});
