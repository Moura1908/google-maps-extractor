'use strict';

/**
 * Identidade de um lead para deduplicação.
 *
 * A versão original deduplicava só por `placeID`. Quando aquele índice do
 * payload falhava, o placeID virava string vazia — o primeiro lead sem ID
 * entrava no Set e TODOS os seguintes eram descartados em silêncio. Aqui
 * valor vazio nunca vira chave: cai para o próximo critério.
 */

function normalizeForKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/** Sempre devolve uma chave utilizável — nunca vazia, nunca compartilhada por engano. */
function buildLeadKey(lead) {
  if (lead.placeID) return `place:${lead.placeID}`;
  if (lead.cID) return `cid:${lead.cID}`;

  const name = normalizeForKey(lead.name);
  const address = normalizeForKey(lead.address);
  if (name) return `na:${name}|${address}`;

  // Último recurso: sem nenhum identificador, cada ocorrência é única.
  // Melhor duplicar do que apagar um lead real.
  return `anon:${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { buildLeadKey, normalizeForKey };
}
