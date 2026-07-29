'use strict';

/**
 * Score de oportunidade: transforma uma lista indiferenciada de leads numa
 * fila de trabalho ordenada.
 *
 * O gargalo real da prospecção não é conseguir 500 contatos — é decidir quais
 * 30 valem a ligação de hoje. Os sinais usados aqui já estão na base, sem
 * custar uma requisição a mais: falta de site, reputação, perfil incompleto,
 * tipo de telefone. `opportunity_reasons` é o rascunho do argumento de venda,
 * não só um número.
 */

/** Domínios de rede social que aparecem no campo "website" no lugar de um site próprio. */
const SOCIAL_PROFILE_DOMAINS = ['instagram.com', 'facebook.com', 'fb.com'];

/**
 * O enriquecimento só descobre Instagram/Facebook FAZENDO FETCH do valor de
 * `lead.website` (`src/background/enrich.js:extractContacts`) — ou seja,
 * `lead.instagram` só existe quando `lead.website` já era não-vazio. Checar
 * "tem instagram E não tem site" seria sempre falso por construção.
 *
 * O sinal real e comum no Maps é outro: o dono cadastra o link do Instagram
 * OU Facebook **no próprio campo "website"**, por não ter site de verdade.
 * Isso é diretamente checável sem depender do enriquecimento ter rodado.
 */
function isSocialProfileHost(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return SOCIAL_PROFILE_DOMAINS.some((domain) => host === domain || host === `www.${domain}` || host.endsWith(`.${domain}`));
  } catch (error) {
    return false;
  }
}

/**
 * Cada regra soma (ou subtrai) peso quando `test` bate, e contribui um
 * fragmento de texto legível via `reason`. A ordem aqui é a ordem em que os
 * motivos aparecem em `opportunity_reasons`.
 */
const OPPORTUNITY_RULES = [
  {
    // "Sem site de verdade": campo vazio OU preenchido só com um link de
    // rede social (ver `website_is_social_profile` abaixo, que soma um
    // extra quando é esse o caso específico).
    id: 'no_real_website',
    weight: 40,
    reason: () => 'sem site',
    test: (lead) => !lead.website || isSocialProfileHost(lead.website),
  },
  {
    // Guarda de 10+ avaliações: sem ela, um único review de 1 estrela
    // pontuaria igual a uma reputação de fato ruim.
    id: 'low_rating',
    weight: 25,
    reason: (lead) => `nota ${parseFloat(lead.averageRating).toFixed(1)}`,
    test: (lead) => {
      const rating = parseFloat(lead.averageRating);
      const reviews = parseFloat(lead.reviewCount);
      return Number.isFinite(rating) && Number.isFinite(reviews) && rating < 4.0 && reviews >= 10;
    },
  },
  {
    // Mutuamente exclusiva com `low_rating` por construção: uma exige
    // reviews >= 10 confirmado, a outra dispara quando isso NÃO é verdade
    // (inclui o caso de reviewCount ausente/vazio no payload).
    id: 'few_reviews',
    weight: 20,
    reason: (lead) => {
      const reviews = parseFloat(lead.reviewCount);
      return `${Number.isFinite(reviews) ? reviews : 0} avaliações`;
    },
    test: (lead) => {
      const reviews = parseFloat(lead.reviewCount);
      return !(Number.isFinite(reviews) && reviews >= 10);
    },
  },
  {
    id: 'no_working_hours',
    weight: 15,
    reason: () => 'perfil incompleto',
    test: (lead) => !lead.has_working_hours,
  },
  {
    // Dispara JUNTO com `no_real_website` nesse caso específico, de propósito:
    // o ponto aqui não é "não tem presença online" (o oposto: já investe em
    // marketing), é "falta transformar isso numa base própria".
    id: 'website_is_social_profile',
    weight: 15,
    reason: () => 'só tem perfil social, sem site próprio',
    test: (lead) => Boolean(lead.website) && isSocialProfileHost(lead.website),
  },
  {
    id: 'mobile_phone',
    weight: 10,
    reason: () => 'celular',
    test: (lead) => lead.phone_type === 'mobile',
  },
  {
    // Penalidade: sem telefone, o canal principal de prospecção (WhatsApp)
    // não existe. Isso não pode ser compensado por site ruim ou nota baixa.
    id: 'no_phone',
    weight: -50,
    reason: () => 'sem telefone',
    test: (lead) => !lead.phone,
  },
];

/** Avalia um lead contra as regras e devolve score bruto + motivos, sem mutar nada. */
function assessOpportunity(lead) {
  let rawScore = 0;
  const reasons = [];

  for (const rule of OPPORTUNITY_RULES) {
    if (rule.test(lead)) {
      rawScore += rule.weight;
      reasons.push(rule.reason(lead));
    }
  }

  const score = Math.max(0, Math.min(100, rawScore));
  return { score, reasons };
}

/** Grava `opportunity_score` e `opportunity_reasons` no próprio lead. */
function applyOpportunityFields(lead) {
  const { score, reasons } = assessOpportunity(lead);
  lead.opportunity_score = score;
  lead.opportunity_reasons = reasons.join(' · ');
  return lead;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { assessOpportunity, applyOpportunityFields, OPPORTUNITY_RULES };
}
