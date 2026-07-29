'use strict';

/**
 * Dashboard: mostra a base local inteira, filtra e exporta.
 *
 * O export sempre respeita o filtro ativo (`"active"` no download do
 * Tabulator) — filtrar na tela e baixar a base inteira seria uma armadilha.
 */

/** Colunas conhecidas, na ordem que importa para prospecção. */
const COLUMN_ORDER = [
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

function buildColumns(fields) {
  return fields.map((field) => ({
    title: label(field),
    field,
    width: field === 'address' || field === 'website' ? 260 : 180,
    resizable: true,
    headerFilter: 'input',
    visible: !HIDDEN_BY_DEFAULT.has(field),
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
  email: () => document.getElementById('filter-email').checked,
  mobile: () => document.getElementById('filter-mobile').checked,
  phone: () => document.getElementById('filter-phone').checked,
  noWebsite: () => document.getElementById('filter-no-website').checked,
  minRating: () => parseFloat(document.getElementById('filter-rating').value),
  minReviews: () => parseFloat(document.getElementById('filter-reviews').value),
};

function matchesQuickFilters(row) {
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

function applyFilters() {
  table.setFilter(matchesQuickFilters);
  updateCounter();
}

function resetFilters() {
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

['filter-email', 'filter-mobile', 'filter-phone', 'filter-no-website'].forEach((id) => {
  document.getElementById(id).addEventListener('change', applyFilters);
});
['filter-rating', 'filter-reviews'].forEach((id) => {
  document.getElementById(id).addEventListener('input', applyFilters);
});
document.getElementById('filter-reset').addEventListener('click', resetFilters);
