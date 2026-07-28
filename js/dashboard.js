'use strict';

/** Colunas conhecidas, na ordem em que fazem sentido para prospecção. */
const PREFERRED_COLUMNS =
  'name phone email website address instagram facebook twitter linkedin yelp youtube placeID cID category reviewCount averageRating latitude longitude'.split(
    ' '
  );

const table = new Tabulator('#example-table', {
  layout: 'fitData',
  placeholder: 'Carregando',
  selectable: 1,
});

function capitalizeFirstLetter(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
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

/** Colunas preferidas primeiro; o resto (horários etc.) em ordem alfabética. */
function generateColumns(foundFields) {
  const columns = PREFERRED_COLUMNS.map((field) => ({
    title: capitalizeFirstLetter(field),
    field,
    width: 300,
    resizable: true,
  }));

  const known = new Set(PREFERRED_COLUMNS);
  Array.from(foundFields)
    .sort()
    .forEach((field) => {
      if (known.has(field)) return;
      columns.push({ title: capitalizeFirstLetter(field), field, width: 300, resizable: true });
    });

  table.setColumns(columns);
}

function showData() {
  chrome.storage.local.get(null, (stored) => {
    const leads = stored.leads || [];
    const fields = new Set();
    const rows = leads.map((lead) => {
      const flat = flattenObject(lead);
      Object.keys(flat).forEach((field) => fields.add(field));
      return flat;
    });
    generateColumns(fields);
    table.setData(rows);
  });
}

document.getElementById('download-csv').addEventListener('click', () => {
  table.download('csv', 'results.csv');
});

document.getElementById('download-xlsx').addEventListener('click', () => {
  table.download('xlsx', 'results.xlsx', { sheetName: 'My Data' });
});

$(document).ready(showData);
