'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { assessOpportunity, applyOpportunityFields } = require('../src/shared/opportunity.js');

/** Lead "neutro": nada dispara nenhuma regra, score deveria ser 0. */
function baseLead(overrides = {}) {
  return {
    website: 'https://exemplo.com.br',
    averageRating: 4.8,
    reviewCount: 200,
    has_working_hours: true,
    phone: '(61) 99999-0000',
    phone_type: 'landline',
    ...overrides,
  };
}

test('lead sem nenhum sinal negativo tem score 0', () => {
  const result = assessOpportunity(baseLead());
  assert.strictEqual(result.score, 0);
  assert.deepStrictEqual(result.reasons, []);
});

test('sem website soma +40 e aparece como "sem site"', () => {
  const result = assessOpportunity(baseLead({ website: '' }));
  assert.strictEqual(result.score, 40);
  assert.deepStrictEqual(result.reasons, ['sem site']);
});

test('nota baixa com 10+ avaliações soma +25', () => {
  const result = assessOpportunity(baseLead({ averageRating: 3.2, reviewCount: 50 }));
  assert.strictEqual(result.score, 25);
  assert.deepStrictEqual(result.reasons, ['nota 3.2']);
});

test('nota baixa com MENOS de 10 avaliações não dispara low_rating (evita 1 review de 1 estrela)', () => {
  const result = assessOpportunity(baseLead({ averageRating: 1.0, reviewCount: 1 }));
  // não deve contar "nota 1.0" — mas deve contar few_reviews (< 10 avaliações)
  assert.ok(!result.reasons.some((r) => r.startsWith('nota ')), 'não deveria citar a nota');
  assert.strictEqual(result.score, 20);
  assert.deepStrictEqual(result.reasons, ['1 avaliações']);
});

test('menos de 10 avaliações soma +20 e cita o número', () => {
  const result = assessOpportunity(baseLead({ reviewCount: 4 }));
  assert.strictEqual(result.score, 20);
  assert.deepStrictEqual(result.reasons, ['4 avaliações']);
});

test('reviewCount ausente/vazio conta como "menos de 10"', () => {
  const result = assessOpportunity(baseLead({ reviewCount: '' }));
  assert.strictEqual(result.score, 20);
  assert.deepStrictEqual(result.reasons, ['0 avaliações']);
});

test('sem horário cadastrado soma +15', () => {
  const result = assessOpportunity(baseLead({ has_working_hours: false }));
  assert.strictEqual(result.score, 15);
  assert.deepStrictEqual(result.reasons, ['perfil incompleto']);
});

test('website que na verdade é um link do Instagram soma sem-site (+40) E o extra (+15)', () => {
  // Padrão comum no Maps: o dono cadastra o Instagram no campo "website" por
  // não ter site de verdade. O enriquecimento só descobre redes sociais
  // fazendo fetch do que está em `website` — então esse sinal precisa ser
  // computável direto do payload, sem esperar o enriquecimento terminar.
  const result = assessOpportunity(baseLead({ website: 'https://www.instagram.com/loja' }));
  assert.strictEqual(result.score, 40 + 15);
  assert.deepStrictEqual(result.reasons, ['sem site', 'só tem perfil social, sem site próprio']);
});

test('website que na verdade é um link do Facebook também conta', () => {
  const result = assessOpportunity(baseLead({ website: 'https://www.facebook.com/loja' }));
  assert.strictEqual(result.score, 40 + 15);
});

test('website é um domínio de verdade: não dispara nem sem-site nem o extra de perfil social', () => {
  const result = assessOpportunity(baseLead({ website: 'https://minhaloja.com.br' }));
  assert.strictEqual(result.score, 0);
});

test('telefone celular soma +10', () => {
  const result = assessOpportunity(baseLead({ phone_type: 'mobile' }));
  assert.strictEqual(result.score, 10);
  assert.deepStrictEqual(result.reasons, ['celular']);
});

test('sem telefone algum subtrai 50', () => {
  const result = assessOpportunity(baseLead({ phone: '', phone_type: 'unknown' }));
  assert.strictEqual(result.score, 0, 'clamp: -50 vira 0, não negativo');
  assert.deepStrictEqual(result.reasons, ['sem telefone']);
});

test('sem telefone e sem site: soma bruta negativa (-10) também é clampada em 0', () => {
  const result = assessOpportunity(baseLead({ website: '', phone: '', phone_type: 'unknown' }));
  assert.strictEqual(result.score, 0);
  assert.deepStrictEqual(result.reasons, ['sem site', 'sem telefone']);
});

test('combinação: exemplo do plano — "sem site · N avaliações · perfil incompleto"', () => {
  const lead = baseLead({ website: '', reviewCount: 4, has_working_hours: false });
  const result = assessOpportunity(lead);
  assert.strictEqual(result.reasons.join(' · '), 'sem site · 4 avaliações · perfil incompleto');
});

test('teto em 100: soma de todos os sinais positivos ultrapassa 100 e é limitada', () => {
  const lead = baseLead({
    website: 'https://www.facebook.com/loja', // dispara sem-site (40) + perfil social (15)
    averageRating: 3.0,
    reviewCount: 50, // dispara low_rating (25), não few_reviews
    has_working_hours: false,
    phone_type: 'mobile',
  });
  const result = assessOpportunity(lead);
  // soma bruta: 40 (sem site) + 25 (nota) + 15 (horário) + 15 (perfil social) + 10 (celular) = 105
  assert.strictEqual(result.score, 100);
});

test('piso em 0: penalidade isolada não fica negativa', () => {
  const lead = baseLead({ phone: '', phone_type: 'unknown' });
  const result = assessOpportunity(lead);
  assert.strictEqual(result.score, 0);
  assert.ok(result.score >= 0);
});

test('lead sem telefone algum cai para o fim ao ordenar por score', () => {
  const withPhone = { ...baseLead({ website: '', reviewCount: 4 }), name: 'Com telefone' };
  const withoutPhone = {
    ...baseLead({ website: '', reviewCount: 4, phone: '', phone_type: 'unknown' }),
    name: 'Sem telefone',
  };

  const leads = [withoutPhone, withPhone]
    .map((lead) => ({ ...lead, ...assessOpportunity(lead) }))
    .sort((a, b) => b.score - a.score);

  assert.strictEqual(leads[0].name, 'Com telefone');
  assert.strictEqual(leads[leads.length - 1].name, 'Sem telefone');
});

test('applyOpportunityFields grava score e reasons (string) diretamente no lead', () => {
  const lead = baseLead({ website: '', reviewCount: 4, has_working_hours: false });
  applyOpportunityFields(lead);

  assert.strictEqual(lead.opportunity_score, 40 + 20 + 15);
  assert.strictEqual(lead.opportunity_reasons, 'sem site · 4 avaliações · perfil incompleto');
});
