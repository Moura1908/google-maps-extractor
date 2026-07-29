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

// --- modo campanha ----------------------------------------------------------

/**
 * Alterna entre o formulário de criar campanha e o status de uma campanha em
 * andamento — as duas telas nunca fazem sentido ao mesmo tempo.
 */
async function refreshCampaignSection() {
  const campaign = await LeadStore.getCampaign();
  const active = campaign && !isComplete(campaign);

  document.getElementById('campaignstatus').style.display = active ? 'flex' : 'none';
  document.getElementById('campaignform').style.display = active ? 'none' : 'flex';

  if (active) {
    const { done, total } = progressSummary(campaign);
    document.getElementById('campaignprogresstext').textContent = `Campanha em andamento: ${done}/${total} buscas`;
  }
}

document.getElementById('startcampaignbtn').addEventListener('click', async () => {
  const errorEl = document.getElementById('campaignerror');
  errorEl.textContent = '';

  const baseQuery = document.getElementById('profileid').value.trim();
  const regions = document
    .getElementById('campaignregions')
    .value.split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const pauseSeconds = parseFloat(document.getElementById('campaignpause').value);

  if (!baseQuery) {
    errorEl.textContent = 'Preencha o termo de busca no campo acima primeiro.';
    return;
  }
  const queries = buildRegionQueries(baseQuery, regions);
  if (queries.length === 0) {
    errorEl.textContent = 'Liste ao menos uma região, uma por linha.';
    return;
  }

  const pauseMs = Number.isFinite(pauseSeconds) && pauseSeconds > 0 ? pauseSeconds * 1000 : 30000;
  const campaign = createCampaign(queries, { pauseMs });
  await LeadStore.saveCampaign(campaign);

  // Aba nova: o popup fecha assim que perde o foco, então chrome.tabs.create
  // (não window.open) é o mesmo padrão já usado no botão do dashboard.
  chrome.tabs.create({ url: buildMapsSearchUrl(currentItem(campaign).query) });
  await refreshCampaignSection();
});

document.getElementById('cancelcampaignbtn').addEventListener('click', async () => {
  await LeadStore.clearCampaign();
  await refreshCampaignSection();
});

/** Mostra quantos leads já estão guardados na base local. */
(async () => {
  const leads = await LeadStore.allLeads();
  document.getElementById('leadcount').textContent =
    leads.length > 0 ? `${leads.length} leads na base local` : 'Nenhum lead extraído ainda';
  renderRecentQueries(leads);
  await refreshCampaignSection();
})();
