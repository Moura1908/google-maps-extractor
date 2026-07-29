'use strict';

/**
 * Transforma um payload cru de /search nos leads novos que devem ser gravados.
 *
 * Função pura de propósito: não toca DOM, storage nem rede. É o caminho por
 * onde todo lead passa — parse, deduplicação e normalização de telefone — e
 * por isso precisa ser testável sem browser.
 *
 * `knownKeys` é mutado com as chaves aceitas: quem chama continua sabendo o
 * que já viu, inclusive entre páginas e entre sessões.
 */
function ingestSearchPayload(rawBody, { knownKeys, query = '', country = 'BR', now = new Date() } = {}) {
  let parsed;
  try {
    parsed = parseSearchResponse(rawBody);
  } catch (error) {
    console.warn('[gms] payload de busca ilegível:', error);
    return [];
  }

  const scrapedAt = now instanceof Date ? now.toISOString() : String(now);
  const fresh = [];

  for (const lead of parsed) {
    lead.key = buildLeadKey(lead);
    if (knownKeys.has(lead.key)) continue;
    knownKeys.add(lead.key);

    lead.search_query = query;
    lead.scraped_at = scrapedAt;
    applyPhoneFields(lead, country);
    // Score calculado já na ingestão: e-mail e redes ainda não chegaram, mas
    // os sinais mais fortes (sem site, nota, perfil incompleto) já estão
    // presentes. scraper.js recalcula depois que o enriquecimento retorna.
    applyOpportunityFields(lead);
    fresh.push(lead);
  }

  return fresh;
}

if (typeof module !== 'undefined' && module.exports) {
  // Em Node os módulos irmãos não compartilham escopo global: injeta aqui.
  const { parseSearchResponse } = require('./parser.js');
  const { buildLeadKey } = require('../shared/leadkey.js');
  const { applyPhoneFields } = require('../shared/phone.js');
  const { applyOpportunityFields } = require('../shared/opportunity.js');
  global.parseSearchResponse = global.parseSearchResponse || parseSearchResponse;
  global.buildLeadKey = global.buildLeadKey || buildLeadKey;
  global.applyPhoneFields = global.applyPhoneFields || applyPhoneFields;
  global.applyOpportunityFields = global.applyOpportunityFields || applyOpportunityFields;
  module.exports = { ingestSearchPayload };
}
