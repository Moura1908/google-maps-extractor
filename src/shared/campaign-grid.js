'use strict';

/**
 * Geração da grade de buscas do modo campanha.
 *
 * O Google Maps satura a lista de resultados em torno de 100–120 itens por
 * busca — rolar até o fim não traz mais, e as 120 primeiras são justamente as
 * que já têm marketing bom e já são assediadas por todo mundo. A cauda longa
 * (o lead que ninguém abordou) só aparece fatiando a busca em várias menores,
 * cuja união cobre muito mais do que uma busca única alcança.
 *
 * Duas estratégias, escolhidas conforme o que o usuário tem à mão:
 * - por região: nomes de bairros/cidades digitados à mão
 * - por coordenada: um grid geométrico ao redor de um centro
 */

/** "clínicas de estética" + ["Asa Sul", "Taguatinga"] -> uma busca por região. */
function buildRegionQueries(baseQuery, regions) {
  const query = String(baseQuery || '').trim();
  if (!query) return [];

  return (regions || [])
    .map((region) => String(region || '').trim())
    .filter(Boolean)
    .map((region) => `${query} em ${region}`);
}

/** 1 grau de latitude ~= 111,32 km, constante em qualquer lugar do planeta. */
const KM_PER_DEGREE_LAT = 111.32;

/** Converte km em graus de longitude na latitude informada (varia com a latitude). */
function kmToLngDegrees(km, atLatitudeDegrees) {
  const kmPerDegreeLng = KM_PER_DEGREE_LAT * Math.cos((atLatitudeDegrees * Math.PI) / 180);
  return kmPerDegreeLng === 0 ? 0 : km / kmPerDegreeLng;
}

/**
 * Gera um grid de coordenadas cobrindo um círculo de `radiusKm` ao redor do
 * centro, com `stepKm` de espaçamento entre pontos vizinhos.
 *
 * `stepKm` é uma escolha de compromisso: mais denso cobre melhor mas multiplica
 * o número de buscas (e o tempo); mais esparso corre risco de deixar buraco
 * na cobertura entre dois pontos. Não há valor "certo" — depende de quão
 * concentrados são os negócios buscados.
 */
function buildCoordinateGrid(center, { radiusKm, stepKm = 3, zoom = 14 } = {}) {
  if (!center || !Number.isFinite(center.lat) || !Number.isFinite(center.lng)) return [];

  if (!Number.isFinite(radiusKm) || radiusKm <= 0) {
    return [{ lat: center.lat, lng: center.lng, zoom }];
  }

  const step = Number.isFinite(stepKm) && stepKm > 0 ? stepKm : 3;
  const points = [];

  for (let dy = -radiusKm; dy <= radiusKm + 1e-9; dy += step) {
    for (let dx = -radiusKm; dx <= radiusKm + 1e-9; dx += step) {
      // Grid é quadrado por construção; descarta cantos fora do círculo.
      if (Math.sqrt(dx * dx + dy * dy) > radiusKm) continue;

      points.push({
        lat: center.lat + dy / KM_PER_DEGREE_LAT,
        lng: center.lng + kmToLngDegrees(dx, center.lat),
        zoom,
      });
    }
  }

  return points;
}

/**
 * Monta a URL de busca do Maps. Com coordenada, ancora a busca numa região
 * específica (`/@lat,lng,zoomz`); sem coordenada, depende só do texto da
 * busca para se localizar (funciona bem quando a região já está na query).
 */
function buildMapsSearchUrl(query, coordinate) {
  const path = `/maps/search/${encodeURIComponent(query)}`;
  if (!coordinate) return `https://www.google.com${path}`;

  const { lat, lng, zoom = 14 } = coordinate;
  return `https://www.google.com${path}/@${lat},${lng},${zoom}z`;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { buildRegionQueries, buildCoordinateGrid, buildMapsSearchUrl, kmToLngDegrees, KM_PER_DEGREE_LAT };
}
