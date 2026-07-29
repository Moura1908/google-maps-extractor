'use strict';

/** Abre a busca do Maps já com o termo digitado. */
document.getElementById('addprofilebtn').addEventListener('click', () => {
  const query = document.getElementById('profileid').value.trim();
  if (!query) return;
  window.open(`https://www.google.com/maps/search/${encodeURIComponent(query)}`);
});

document.getElementById('opendashboard').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html') });
});

const MAX_RECENT_QUERIES = 5;

/** Mostra as últimas buscas com contagem — separar campanhas começa aqui. */
function renderRecentQueries(leads) {
  const container = document.getElementById('recentqueries');
  const groups = summarizeByQuery(leads).filter((group) => group.query).slice(0, MAX_RECENT_QUERIES);

  if (groups.length === 0) return;

  const title = document.createElement('p');
  title.textContent = 'Últimas buscas';
  title.style.cssText = 'margin: 0 0 8px; font-size: 12px; font-weight: 600; color: #666;';
  container.appendChild(title);

  for (const group of groups) {
    const row = document.createElement('div');
    row.style.cssText =
      'display: flex; justify-content: space-between; gap: 8px; padding: 4px 0; font-size: 13px;';

    const query = document.createElement('span');
    query.textContent = group.query;
    query.style.cssText = 'overflow: hidden; text-overflow: ellipsis; white-space: nowrap;';
    query.title = group.query;

    const count = document.createElement('span');
    count.textContent = group.count;
    count.style.cssText = 'color: #666; flex-shrink: 0;';

    row.append(query, count);
    container.appendChild(row);
  }
}

/** Mostra quantos leads já estão guardados na base local. */
(async () => {
  const leads = await LeadStore.allLeads();
  document.getElementById('leadcount').textContent =
    leads.length > 0 ? `${leads.length} leads na base local` : 'Nenhum lead extraído ainda';
  renderRecentQueries(leads);
})();
