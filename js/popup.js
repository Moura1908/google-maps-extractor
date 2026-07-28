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

/** Mostra quantos leads já estão guardados localmente. */
chrome.storage.local.get('leads', (stored) => {
  const total = (stored.leads || []).length;
  document.getElementById('leadcount').textContent =
    total > 0 ? `${total} leads no último lote extraído` : 'Nenhum lead extraído ainda';
});
