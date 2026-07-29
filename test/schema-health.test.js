'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { assessSchemaHealth, formatSchemaWarning } = require('../src/content/schema-health.js');

/** Gera N leads com override comum a todos — cada um com placeID distinto. */
function makeLeads(count, overrides = {}) {
  return Array.from({ length: count }, (_, i) => ({
    name: `Negócio ${i}`,
    phone: '(61) 99999-0000',
    placeID: `place-${i}`,
    ...overrides,
  }));
}

test('12 leads sem telefone dispara o aviso citando phone', () => {
  const leads = makeLeads(12, { phone: '' });
  const result = assessSchemaHealth(leads);

  assert.strictEqual(result.healthy, false);
  assert.strictEqual(result.sampled, true);
  assert.deepStrictEqual(result.degraded, ['phone']);
});

test('12 leads normais não dispara nada', () => {
  const leads = makeLeads(12);
  const result = assessSchemaHealth(leads);

  assert.strictEqual(result.healthy, true);
  assert.strictEqual(result.sampled, true);
  assert.deepStrictEqual(result.degraded, []);
});

test('lote de 3 leads vazios não dispara — amostra pequena demais para avaliar', () => {
  const leads = makeLeads(3, { name: '', phone: '', placeID: '' });
  const result = assessSchemaHealth(leads);

  assert.strictEqual(result.healthy, true);
  assert.strictEqual(result.sampled, false, 'amostra abaixo do mínimo não deve ser avaliada');
});

test('exatamente no limiar (10 leads) já é avaliado; 9 ainda não', () => {
  assert.strictEqual(assessSchemaHealth(makeLeads(10, { phone: '' })).sampled, true);
  assert.strictEqual(assessSchemaHealth(makeLeads(9, { phone: '' })).sampled, false);
});

test('exatamente 50% preenchido não conta como degradado (só ABAIXO da metade)', () => {
  const half = makeLeads(5, { phone: '' });
  const otherHalf = makeLeads(5, { phone: '(61) 90000-0000' });
  const result = assessSchemaHealth([...half, ...otherHalf]);

  assert.strictEqual(result.healthy, true);
  assert.deepStrictEqual(result.degraded, []);
});

test('mais de um campo degradado ao mesmo tempo é reportado junto', () => {
  const leads = makeLeads(12, { phone: '', placeID: '' });
  const result = assessSchemaHealth(leads);

  assert.strictEqual(result.healthy, false);
  assert.deepStrictEqual(result.degraded.sort(), ['phone', 'placeID'].sort());
});

test('campo não numérico/booleano zero não conta como preenchido incorretamente', () => {
  // reviewCount=0 é um valor real (sem avaliações), mas não é um campo crítico
  // aqui — o teste garante que assessSchemaHealth só olha os campos configurados.
  const leads = makeLeads(12, { reviewCount: 0 });
  const result = assessSchemaHealth(leads);
  assert.strictEqual(result.healthy, true);
});

test('array vazio não dispara (sem amostra)', () => {
  const result = assessSchemaHealth([]);
  assert.strictEqual(result.healthy, true);
  assert.strictEqual(result.sampled, false);
});

test('formatSchemaWarning cita o campo no singular', () => {
  const text = formatSchemaWarning(['phone']);
  assert.match(text, /`phone`/);
  assert.match(text, /não está sendo lido/);
  assert.match(text, /docs\/payload-map\.md/);
});

test('formatSchemaWarning cita todos os campos no plural', () => {
  const text = formatSchemaWarning(['phone', 'placeID']);
  assert.match(text, /`phone`, `placeID`/);
  assert.match(text, /não estão sendo lidos/);
});

test('minSample e floor são configuráveis', () => {
  const leads = makeLeads(4, { phone: '' });
  assert.strictEqual(assessSchemaHealth(leads, { minSample: 4 }).sampled, true);
  assert.strictEqual(assessSchemaHealth(leads, { minSample: 4 }).healthy, false);

  const leads2 = makeLeads(10, { phone: '' });
  // floor mais permissivo: 0% preenchido só dispara se floor > 0
  assert.strictEqual(assessSchemaHealth(leads2, { floor: 0 }).healthy, true);
});
