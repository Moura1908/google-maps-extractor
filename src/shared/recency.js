'use strict';

/**
 * "Novos no mapa": responde "quem apareceu desde a última vez que rodei essa
 * campanha?" sem precisar de nenhum campo novo.
 *
 * A base é deduplicada globalmente (ver src/shared/leadkey.js) — um lead que
 * já estava na base nunca é reprocessado quando reaparece numa campanha
 * posterior (ver `knownKeys` em src/content/scraper.js). Isso significa que
 * `scraped_at` sempre reflete a PRIMEIRA vez que aquele lead foi visto, nunca
 * uma visita repetida: é, por construção, a data de "primeiro avistamento",
 * mesmo sem existir um campo chamado `first_seen_at`.
 */
function isWithinDays(isoTimestamp, days, now = new Date()) {
  if (!isoTimestamp || !Number.isFinite(days) || days <= 0) return false;

  const timestamp = new Date(isoTimestamp).getTime();
  if (!Number.isFinite(timestamp)) return false;

  const cutoffMs = now.getTime() - days * 24 * 60 * 60 * 1000;
  return timestamp >= cutoffMs;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { isWithinDays };
}
