'use strict';

/**
 * Parser do payload interno de busca do Google Maps.
 *
 * O Maps não expõe API nas páginas de busca: a listagem trafega como um blob
 * JSON com prefixo anti-hijacking e arrays *posicionais* — sem nome de campo.
 * Os índices abaixo vieram de engenharia reversa e são a peça mais frágil da
 * extensão: quando o Google reordena o array, é exatamente aqui que quebra.
 *
 * Estrutura: corpo -> envelope.d (string) -> array gigante -> [64] é o feed.
 * Cada item do feed guarda os dados no ÚLTIMO elemento do próprio array.
 */

/** Índices conhecidos dentro do registro de um estabelecimento. */
const FIELD_PATHS = {
  name: [11],
  website: [7, 0],
  phone: [178, 0, 0],
  reviewCount: [4, 8],
  averageRating: [4, 7],
  categories: [13],
  placeID: [78],
  cID: [37, 0, 0, 29, 1],
  address: [2],
  latitude: [9, 2],
  longitude: [9, 3],
  workingHours: [203, 0],
};

/**
 * Lê um caminho de índices sem explodir quando algum nível não existe.
 * Um índice que mudou deve custar UM campo, nunca o lead inteiro.
 */
function pick(source, path, fallback = '') {
  let cursor = source;
  for (const step of path) {
    if (cursor === null || cursor === undefined) return fallback;
    cursor = cursor[step];
  }
  return cursor === null || cursor === undefined ? fallback : cursor;
}

/**
 * Desembrulha o corpo bruto da resposta de /search.
 * Formato: `/*""*\/` + JSON cujo campo `d` é uma string que começa com `)]}'\n`.
 */
function unwrapSearchBody(rawBody) {
  const envelope = JSON.parse(String(rawBody).replace('/*""*/', ''));
  return JSON.parse(envelope.d.slice(5));
}

/**
 * Horários vêm como [rótuloDoDia, índiceDaSemana, ?, [[faixa], ...]].
 * Viram colunas planas do tipo `0_segunda-feira` para caírem bem no CSV.
 */
function parseWorkingHours(entry) {
  const columns = {};
  const days = [];
  try {
    const raw = pick(entry, FIELD_PATHS.workingHours, null);
    if (!raw) return columns;
    for (const day of raw) {
      days.push({
        day: day[0],
        weekDay: day[1],
        hours: (day[3] || []).map((slot) => slot[0]).join(', '),
      });
    }
  } catch (error) {
    console.warn('[gms] erro ao processar horários:', error);
    return columns;
  }
  days.sort((a, b) => a.weekDay - b.weekDay);
  for (const day of days) columns[`${day.weekDay}_${day.day}`] = day.hours;
  return columns;
}

/** Converte um registro cru do feed em um lead. Devolve null se não der. */
function parseFeedEntry(feedItem) {
  const entry = feedItem[feedItem.length - 1];
  const name = pick(entry, FIELD_PATHS.name);
  // Sem nome não é um estabelecimento — é linha de controle do próprio feed.
  if (!name) return null;

  return {
    name,
    phone: pick(entry, FIELD_PATHS.phone),
    website: pick(entry, FIELD_PATHS.website),
    address: (pick(entry, FIELD_PATHS.address, []) || []).join(','),
    email: '',
    placeID: pick(entry, FIELD_PATHS.placeID),
    cID: pick(entry, FIELD_PATHS.cID),
    category: (pick(entry, FIELD_PATHS.categories, []) || []).join(';'),
    reviewCount: pick(entry, FIELD_PATHS.reviewCount),
    averageRating: pick(entry, FIELD_PATHS.averageRating),
    latitude: pick(entry, FIELD_PATHS.latitude),
    longitude: pick(entry, FIELD_PATHS.longitude),
    ...parseWorkingHours(entry),
  };
}

/** Recebe o corpo bruto de /search e devolve a lista de leads encontrados. */
function parseSearchResponse(rawBody) {
  const results = unwrapSearchBody(rawBody);
  const feed = results[64];
  if (!Array.isArray(feed)) return [];

  const leads = [];
  for (const feedItem of feed) {
    try {
      const lead = parseFeedEntry(feedItem);
      if (lead) leads.push(lead);
    } catch (error) {
      console.warn('[gms] erro ao processar item do feed:', error);
    }
  }
  return leads;
}

// Exportado para os testes em Node; no content script o escopo já é compartilhado.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { parseSearchResponse, parseFeedEntry, unwrapSearchBody, pick, FIELD_PATHS };
}
