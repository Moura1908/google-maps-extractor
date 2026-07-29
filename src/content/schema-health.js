'use strict';

/**
 * Canário de esquema do parser.
 *
 * `pick()` (em src/content/parser.js) garante que um índice do payload que
 * mudou custe UM campo, não o lead inteiro — mas isso tem um efeito colateral:
 * a quebra vira invisível. A coleta continua, os leads entram na base, e só
 * na hora do disparo alguém percebe que o telefone estava vazio.
 *
 * Este módulo mede, a cada lote recém-ingerido, a taxa de preenchimento dos
 * campos críticos. Se ela despencar, é sinal de que o Google reordenou o
 * array e um índice de FIELD_PATHS precisa ser remapeado — não que os
 * negócios daquela busca simplesmente não têm telefone.
 */

const CRITICAL_FIELDS = ['name', 'phone', 'placeID'];

/**
 * Avalia se `name`, `phone` e `placeID` estão vindo preenchidos no lote.
 *
 * Nem todo estabelecimento tem telefone ou site cadastrado — uma fatia vazia
 * é normal. Abaixo de METADE num lote de 10+ leads, porém, o padrão indica
 * mudança de esquema, não característica dos negócios.
 *
 * Lotes menores que `minSample` não são amostra estatística: `sampled: false`
 * sinaliza isso para quem chama, para não confundir "não avaliado" com
 * "avaliado e saudável".
 */
function assessSchemaHealth(leads, { minSample = 10, floor = 0.5, fields = CRITICAL_FIELDS } = {}) {
  if (!Array.isArray(leads) || leads.length < minSample) {
    return { healthy: true, degraded: [], sampled: false };
  }

  const degraded = fields.filter((field) => {
    const filled = leads.filter((lead) => Boolean(lead[field])).length;
    return filled / leads.length < floor;
  });

  return { healthy: degraded.length === 0, degraded, sampled: true };
}

/** Texto para o painel — cita exatamente o(s) campo(s) afetado(s). */
function formatSchemaWarning(degradedFields) {
  const fieldList = degradedFields.map((field) => `\`${field}\``).join(', ');
  const verb = degradedFields.length > 1 ? 'não estão sendo lidos' : 'não está sendo lido';
  return `O formato do Google mudou — ${fieldList} ${verb}. Veja docs/payload-map.md.`;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { assessSchemaHealth, formatSchemaWarning, CRITICAL_FIELDS };
}
