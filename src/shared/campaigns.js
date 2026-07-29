'use strict';

/**
 * Agrupa leads por termo de busca (`search_query`) — é o que separa
 * campanhas diferentes dentro da mesma base persistente e acumulada.
 *
 * Leads sem `search_query` (extraídos antes deste campo existir, ou de uma
 * página do Maps que não é uma busca) viram um grupo próprio com query vazia,
 * nunca são descartados do agrupamento.
 */
function summarizeByQuery(leads) {
  const groups = new Map();

  for (const lead of leads || []) {
    const query = lead.search_query || '';
    if (!groups.has(query)) groups.set(query, { query, count: 0, lastScrapedAt: '' });

    const group = groups.get(query);
    group.count += 1;

    const scrapedAt = lead.scraped_at || '';
    if (scrapedAt > group.lastScrapedAt) group.lastScrapedAt = scrapedAt;
  }

  // Mais recente primeiro: é a campanha em que se está trabalhando agora.
  return [...groups.values()].sort((a, b) => b.lastScrapedAt.localeCompare(a.lastScrapedAt));
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { summarizeByQuery };
}
