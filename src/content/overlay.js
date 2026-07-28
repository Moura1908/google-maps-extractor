'use strict';

/**
 * Painel de controle injetado na barra lateral do Google Maps.
 *
 * O painel é criado uma única vez e re-anexado sempre que o Maps recria a
 * árvore da sidebar (a navegação é SPA e destrói o container sem avisar).
 */

const OverlayUI = (() => {
  /** Container da sidebar do Maps. Classe ofuscada — muda sem aviso. */
  const SIDEBAR_SELECTOR = '.w6VYqd';

  let panel = null;
  let leadsLabel = null;
  let startButton = null;
  let exportButton = null;
  let clearButton = null;

  function createButton(id, label, backgroundColor) {
    const button = document.createElement('button');
    button.className = 'extension_gms_button';
    button.id = id;
    button.innerText = label;
    if (backgroundColor) button.style.backgroundColor = backgroundColor;
    return button;
  }

  function build({ onToggleExtract, onExport, onClear }) {
    panel = document.createElement('div');
    panel.className = 'extension_gms_page';

    leadsLabel = document.createElement('h1');
    leadsLabel.id = 'extension_gms_leads_info';
    leadsLabel.innerHTML = 'Leads: 0';

    startButton = createButton('extension_gms_start_btn', 'Start Auto Extract');
    startButton.addEventListener('click', onToggleExtract);

    exportButton = createButton('extension_gms_download_btn', 'Export Leads (0)', '#54aced');
    exportButton.addEventListener('click', onExport);

    clearButton = createButton('extension_gms_clear_btn', 'Clear', '#4167b2');
    clearButton.addEventListener('click', onClear);

    panel.append(leadsLabel, startButton, exportButton, clearButton);
    return panel;
  }

  /** Mantém o painel preso à sidebar mesmo depois de o Maps recriá-la. */
  function keepAttached() {
    setInterval(() => {
      const sidebar = document.getElementsByClassName(SIDEBAR_SELECTOR.slice(1))[0];
      if (sidebar && !sidebar.contains(panel)) {
        sidebar.appendChild(panel);
        console.log('[gms] painel inserido na sidebar');
      }
    }, 2000);
  }

  return {
    init(handlers) {
      build(handlers);
      keepAttached();
    },
    setCount(total) {
      if (leadsLabel) leadsLabel.innerHTML = `Leads: ${total}`;
      if (exportButton) exportButton.innerText = `Export Leads (${total})`;
    },
    setExtracting(isExtracting) {
      if (!startButton) return;
      startButton.innerText = isExtracting ? 'Stop Auto Extract' : 'Start Auto Extract';
      startButton.style.backgroundColor = isExtracting ? '#ea4335' : '';
    },
  };
})();
