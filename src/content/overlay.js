'use strict';

/**
 * Painel de controle injetado na barra lateral do Google Maps.
 *
 * O Maps é uma SPA que recria a sidebar sem avisar. A versão original sondava
 * o container a cada 2s com setInterval e dependia exclusivamente da classe
 * ofuscada `.w6VYqd` — quando o Google renomeia a classe, o painel some e não
 * há nem erro no console. Aqui há MutationObserver e uma cadeia de fallback
 * que termina no `document.body`: o painel pode ficar deslocado, mas aparece.
 */

const OverlayUI = (() => {
  /** Candidatos a container, do mais específico ao último recurso. */
  const MOUNT_SELECTORS = ['.w6VYqd', '[role="feed"]'];

  let panel = null;
  let statusLabel = null;
  let progressLabel = null;
  let warningLabel = null;
  let startButton = null;
  let exportButton = null;
  let clearButton = null;
  let clearArmed = false;
  let handlers = {};

  function createButton(id, label, backgroundColor) {
    const button = document.createElement('button');
    button.className = 'extension_gms_button';
    button.id = id;
    button.innerText = label;
    if (backgroundColor) button.style.backgroundColor = backgroundColor;
    return button;
  }

  function createToggle(id, label, checked, onChange) {
    const wrapper = document.createElement('label');
    wrapper.className = 'extension_gms_toggle';

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.id = id;
    input.checked = checked;
    input.addEventListener('change', () => onChange(input.checked));

    const text = document.createElement('span');
    text.innerText = label;

    wrapper.append(input, text);
    return wrapper;
  }

  function build(settings) {
    panel = document.createElement('div');
    panel.className = 'extension_gms_page';

    statusLabel = document.createElement('h1');
    statusLabel.id = 'extension_gms_leads_info';
    statusLabel.innerText = 'Leads: 0';

    progressLabel = document.createElement('p');
    progressLabel.className = 'extension_gms_progress';
    progressLabel.innerText = '';

    // Elemento próprio, separado do progresso: um índice do payload quebrado
    // não pode ser mostrado por um segundo e sumir no próximo tick da fila.
    warningLabel = document.createElement('p');
    warningLabel.className = 'extension_gms_warning';
    warningLabel.innerText = '';
    warningLabel.style.display = 'none';

    startButton = createButton('extension_gms_start_btn', 'Iniciar extração');
    startButton.addEventListener('click', () => handlers.onToggleExtract());

    exportButton = createButton('extension_gms_download_btn', 'Ver e exportar', '#54aced');
    exportButton.addEventListener('click', () => handlers.onExport());

    clearButton = createButton('extension_gms_clear_btn', 'Limpar base', '#4167b2');
    clearButton.addEventListener('click', () => {
      // Apagar a base é destrutivo: exige um segundo clique consciente.
      if (!clearArmed) {
        clearArmed = true;
        clearButton.innerText = 'Confirmar?';
        clearButton.style.backgroundColor = '#ea4335';
        setTimeout(() => {
          if (!clearArmed) return;
          clearArmed = false;
          clearButton.innerText = 'Limpar base';
          clearButton.style.backgroundColor = '#4167b2';
        }, 4000);
        return;
      }
      clearArmed = false;
      clearButton.innerText = 'Limpar base';
      clearButton.style.backgroundColor = '#4167b2';
      handlers.onClear();
    });

    const options = document.createElement('div');
    options.className = 'extension_gms_options';
    options.append(
      createToggle('extension_gms_email_toggle', 'Buscar e-mail no site', settings.collectEmail, (value) =>
        handlers.onSettingChange({ collectEmail: value })
      ),
      createToggle('extension_gms_deep_toggle', 'Vasculhar páginas de contato', settings.deepSearch, (value) =>
        handlers.onSettingChange({ deepSearch: value })
      )
    );

    panel.append(statusLabel, warningLabel, progressLabel, startButton, exportButton, clearButton, options);
    return panel;
  }

  function findMountPoint() {
    for (const selector of MOUNT_SELECTORS) {
      const element = document.querySelector(selector);
      if (element) return selector === '.w6VYqd' ? element : element.parentElement;
    }
    return null;
  }

  /** Reanexa o painel sempre que o Maps recria a árvore da sidebar. */
  function keepAttached() {
    const attach = () => {
      if (panel.isConnected) return;
      const mount = findMountPoint();
      if (mount) {
        panel.classList.remove('extension_gms_floating');
        mount.appendChild(panel);
      } else {
        // Nenhum container conhecido: flutua sobre a página em vez de sumir.
        panel.classList.add('extension_gms_floating');
        document.body.appendChild(panel);
      }
    };

    attach();
    new MutationObserver(attach).observe(document.body, { childList: true, subtree: true });
  }

  return {
    init(settings, eventHandlers) {
      handlers = eventHandlers;
      build(settings);
      keepAttached();
    },
    setCount(total) {
      if (statusLabel) statusLabel.innerText = `Leads: ${total}`;
    },
    setProgress({ completed, total }) {
      if (!progressLabel) return;
      progressLabel.innerText = total > completed ? `Enriquecendo ${completed}/${total}` : '';
    },
    /** Recado curto para o usuário (erro ou fim de coleta). */
    setMessage(text) {
      if (!progressLabel) return;
      progressLabel.innerText = text;
    },
    /**
     * Aviso persistente de alta severidade (ex.: esquema do payload quebrado).
     * Fica visível até ser limpo explicitamente — não é sobrescrito pelos
     * ticks de `setProgress`, que rodam a cada lead enriquecido.
     */
    setWarning(text) {
      if (!warningLabel) return;
      warningLabel.innerText = text;
      warningLabel.style.display = text ? 'block' : 'none';
    },
    setExtracting(isExtracting) {
      if (!startButton) return;
      startButton.innerText = isExtracting ? 'Parar extração' : 'Iniciar extração';
      startButton.style.backgroundColor = isExtracting ? '#ea4335' : '';
    },
  };
})();
