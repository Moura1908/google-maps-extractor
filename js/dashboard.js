'use strict';

/**
 * Dashboard: mostra a base local inteira, filtra e exporta.
 *
 * O export sempre respeita o filtro ativo (`"active"` no download do
 * Tabulator) — filtrar na tela e baixar a base inteira seria uma armadilha.
 */

/** Colunas conhecidas, na ordem que importa para prospecção. */
const COLUMN_ORDER = [
  'opportunity_score',
  'opportunity_reasons',
  'name',
  'phone',
  'phone_e164',
  'phone_type',
  'email',
  'website',
  'address',
  'category',
  'averageRating',
  'reviewCount',
  'instagram',
  'facebook',
  'linkedin',
  'twitter',
  'youtube',
  'yelp',
  'search_query',
  'scraped_at',
  'phone_country',
  'phone_legacy_8digits',
  'placeID',
  'cID',
  'latitude',
  'longitude',
];

/** Ruído para o dia a dia: existem, mas começam escondidas. */
const HIDDEN_BY_DEFAULT = new Set([
  'key',
  'placeID',
  'cID',
  'latitude',
  'longitude',
  'phone_country',
  'phone_legacy_8digits',
]);

const COLUMN_LABELS = {
  opportunity_score: 'Oportunidade',
  opportunity_reasons: 'Motivos',
  name: 'Nome',
  phone: 'Telefone',
  phone_e164: 'Telefone E.164',
  phone_type: 'Tipo',
  email: 'E-mail',
  website: 'Website',
  address: 'Endereço',
  category: 'Categoria',
  averageRating: 'Nota',
  reviewCount: 'Avaliações',
  search_query: 'Busca',
  scraped_at: 'Extraído em',
  phone_country: 'País',
  phone_legacy_8digits: 'Celular 8 dígitos',
  latitude: 'Latitude',
  longitude: 'Longitude',
};

const table = new Tabulator('#example-table', {
  layout: 'fitDataStretch',
  placeholder: 'Nenhum lead extraído ainda',
  height: '70vh',
  pagination: 'local',
  paginationSize: 100,
  // Oportunidade mais alta primeiro: é essa a fila de trabalho, não a ordem
  // de chegada da coleta.
  initialSort: [{ column: 'opportunity_score', dir: 'desc' }],
  // setColumns/setData só são seguros depois que a tabela existe de fato.
  tableBuilt: () => loadData(),
});

let allLeads = [];

function label(field) {
  if (COLUMN_LABELS[field]) return COLUMN_LABELS[field];
  return field.charAt(0).toUpperCase() + field.slice(1);
}

/** Achata objetos aninhados para que virem colunas do CSV. */
function flattenObject(source, prefix = '') {
  const flat = {};
  for (const [key, value] of Object.entries(source)) {
    const path = prefix ? `${prefix}_${key}` : key;
    if (typeof value === 'object' && value !== null) {
      Object.assign(flat, flattenObject(value, path));
    } else {
      flat[path] = value;
    }
  }
  return flat;
}

/** Colunas na ordem preferida; o resto (horários etc.) em ordem alfabética. */
function orderFields(foundFields) {
  const known = COLUMN_ORDER.filter((field) => foundFields.has(field));
  const extra = [...foundFields].filter((field) => !COLUMN_ORDER.includes(field)).sort();
  return [...known, ...extra];
}

const WIDE_COLUMNS = new Set(['address', 'website', 'opportunity_reasons']);

function columnWidth(field) {
  if (field === 'opportunity_score') return 110;
  if (WIDE_COLUMNS.has(field)) return 260;
  return 180;
}

function buildColumns(fields) {
  return fields.map((field) => ({
    title: label(field),
    field,
    width: columnWidth(field),
    resizable: true,
    headerFilter: 'input',
    visible: !HIDDEN_BY_DEFAULT.has(field),
    // Sem isso o Tabulator ordena "10" antes de "9" (comparação de string).
    sorter: field === 'opportunity_score' ? 'number' : undefined,
    // Neutraliza fórmula (CSV/XLSX Injection) só na exportação — a tela
    // continua mostrando o valor original. O nome do estabelecimento vem
    // do Google Maps, ou seja, é escrito por terceiro.
    accessorDownload: sanitizeForSpreadsheet,
  }));
}

function buildColumnToggles(fields) {
  const container = document.getElementById('column-toggles');
  container.innerHTML = '';
  for (const field of fields) {
    const wrapper = document.createElement('label');
    wrapper.className = 'check';

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = !HIDDEN_BY_DEFAULT.has(field);
    input.addEventListener('change', () => {
      if (input.checked) table.showColumn(field);
      else table.hideColumn(field);
    });

    const text = document.createElement('span');
    text.textContent = label(field);

    wrapper.append(input, text);
    container.appendChild(wrapper);
  }
}

// --- filtros ---------------------------------------------------------------

const filterControls = {
  query: () => document.getElementById('filter-query').value,
  email: () => document.getElementById('filter-email').checked,
  mobile: () => document.getElementById('filter-mobile').checked,
  phone: () => document.getElementById('filter-phone').checked,
  noWebsite: () => document.getElementById('filter-no-website').checked,
  minRating: () => parseFloat(document.getElementById('filter-rating').value),
  minReviews: () => parseFloat(document.getElementById('filter-reviews').value),
};

function matchesQuickFilters(row) {
  const query = filterControls.query();
  if (query && (row.search_query || '') !== query) return false;

  if (filterControls.email() && !row.email) return false;
  if (filterControls.mobile() && row.phone_type !== 'mobile') return false;
  if (filterControls.phone() && !row.phone) return false;
  if (filterControls.noWebsite() && row.website) return false;

  const minRating = filterControls.minRating();
  if (!Number.isNaN(minRating) && !(parseFloat(row.averageRating) >= minRating)) return false;

  const minReviews = filterControls.minReviews();
  if (!Number.isNaN(minReviews) && !(parseFloat(row.reviewCount) >= minReviews)) return false;

  return true;
}

/**
 * Popula o <select> de campanha com as buscas presentes na base, mais
 * recente primeiro, cada uma com a contagem de leads. Preserva a seleção
 * atual quando ela ainda existir — `loadData()` roda de novo depois de
 * dedupe/limpeza, e trocar a campanha selecionada sozinho seria confuso.
 */
function populateQueryFilter(leads) {
  const select = document.getElementById('filter-query');
  const previousValue = select.value;
  const groups = summarizeByQuery(leads);

  select.innerHTML = '';
  const allOption = document.createElement('option');
  allOption.value = '';
  allOption.textContent = `Todas as buscas (${leads.length})`;
  select.appendChild(allOption);

  for (const group of groups) {
    const option = document.createElement('option');
    option.value = group.query;
    option.textContent = group.query ? `${group.query} (${group.count})` : `(sem busca registrada) (${group.count})`;
    select.appendChild(option);
  }

  if ([...select.options].some((option) => option.value === previousValue)) {
    select.value = previousValue;
  }
}

function applyFilters() {
  table.setFilter(matchesQuickFilters);
  updateCounter();
}

function resetFilters() {
  document.getElementById('filter-query').value = '';
  ['filter-email', 'filter-mobile', 'filter-phone', 'filter-no-website'].forEach((id) => {
    document.getElementById(id).checked = false;
  });
  document.getElementById('filter-rating').value = '';
  document.getElementById('filter-reviews').value = '';
  table.clearHeaderFilter();
  applyFilters();
}

function updateCounter() {
  const visible = table.getDataCount('active');
  const total = allLeads.length;
  const withEmail = allLeads.filter((lead) => lead.email).length;
  const mobiles = allLeads.filter((lead) => lead.phone_type === 'mobile').length;

  document.getElementById('counter').innerHTML =
    `Mostrando <strong>${visible}</strong> de <strong>${total}</strong> leads · ` +
    `${withEmail} com e-mail · ${mobiles} com celular`;
}

// --- carga e ações ---------------------------------------------------------

async function loadData() {
  allLeads = await LeadStore.allLeads();

  const fields = new Set();
  const rows = allLeads.map((lead) => {
    const flat = flattenObject(lead);
    Object.keys(flat).forEach((field) => fields.add(field));
    return flat;
  });

  const ordered = orderFields(fields);
  table.setColumns(buildColumns(ordered));
  buildColumnToggles(ordered);
  populateQueryFilter(allLeads);
  await table.setData(rows);
  applyFilters();
}

/**
 * Remove duplicatas que escaparam da chave: mesmo nome + endereço com
 * placeIDs diferentes (acontece quando o Google devolve a mesma empresa em
 * duas buscas com IDs distintos). Mantém a primeira ocorrência.
 */
async function removeDuplicates() {
  const seen = new Set();
  const toRemove = [];

  for (const lead of allLeads) {
    const identity = `${normalizeForKey(lead.name)}|${normalizeForKey(lead.address)}`;
    if (identity === '|') continue;
    if (seen.has(identity)) toRemove.push(lead.key);
    else seen.add(identity);
  }

  if (toRemove.length === 0) {
    document.getElementById('datastatus').textContent = 'Nenhuma duplicata encontrada.';
    return;
  }

  await LeadStore.removeMany(toRemove);
  document.getElementById('datastatus').textContent = `${toRemove.length} duplicatas removidas.`;
  await loadData();
}

document.getElementById('download-csv').addEventListener('click', () => {
  table.download('csv', 'leads.csv', {}, 'active');
});

document.getElementById('download-xlsx').addEventListener('click', () => {
  table.download('xlsx', 'leads.xlsx', { sheetName: 'Leads' }, 'active');
});

document.getElementById('dedupe').addEventListener('click', removeDuplicates);

document.getElementById('clear-base').addEventListener('click', async (event) => {
  const button = event.currentTarget;
  // Apagar a base é irreversível: exige um segundo clique consciente.
  if (button.dataset.armed !== 'true') {
    button.dataset.armed = 'true';
    button.textContent = 'Confirmar exclusão?';
    setTimeout(() => {
      button.dataset.armed = 'false';
      button.textContent = 'Limpar base';
    }, 4000);
    return;
  }
  button.dataset.armed = 'false';
  button.textContent = 'Limpar base';
  await LeadStore.clear();
  await loadData();
});

document.getElementById('filter-query').addEventListener('change', applyFilters);
['filter-email', 'filter-mobile', 'filter-phone', 'filter-no-website'].forEach((id) => {
  document.getElementById(id).addEventListener('change', applyFilters);
});
['filter-rating', 'filter-reviews'].forEach((id) => {
  document.getElementById(id).addEventListener('input', applyFilters);
});
document.getElementById('filter-reset').addEventListener('click', resetFilters);
