'use strict';

/**
 * Fixture do payload de /search.
 *
 * Reproduz a estrutura real (envelope + array posicional com o feed em [64] e
 * os dados no último elemento de cada item), com apenas os índices que o
 * parser lê. Isso permite testar o parser sem depender de uma captura viva do
 * Maps — inclusive os casos que só aparecem quando o Google muda algo.
 */

/** Monta o registro de um estabelecimento nos índices esperados. */
function buildEntry({
  name = 'Café Central',
  website = 'https://cafecentral.com.br',
  phone = '(61) 99999-1234',
  reviewCount = 128,
  averageRating = 4.6,
  categories = ['Cafeteria', 'Padaria'],
  placeID = 'ChIJ_place_1',
  cID = '123456789',
  address = ['SCLN 105', 'Brasília'],
  latitude = -15.79,
  longitude = -47.88,
  workingHours = null,
} = {}) {
  const entry = [];
  if (address !== null) entry[2] = address;
  if (reviewCount !== null || averageRating !== null) {
    entry[4] = [];
    entry[4][7] = averageRating;
    entry[4][8] = reviewCount;
  }
  if (website !== null) entry[7] = [website];
  if (latitude !== null) entry[9] = [null, null, latitude, longitude];
  if (name !== null) entry[11] = name;
  if (categories !== null) entry[13] = categories;
  if (cID !== null) entry[37] = [[{ 29: [null, cID] }]];
  if (placeID !== null) entry[78] = placeID;
  if (phone !== null) entry[178] = [[phone]];
  if (workingHours !== null) entry[203] = [workingHours];
  return entry;
}

/** Empacota entries no formato que chega pela rede. */
function buildSearchResponse(entries) {
  const feed = entries.map((entry) => ['ignorado', entry]);
  const results = [];
  results[64] = feed;
  return `/*""*/${JSON.stringify({ d: `)]}'\n${JSON.stringify(results)}` })}`;
}

module.exports = { buildEntry, buildSearchResponse };
