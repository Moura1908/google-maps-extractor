'use strict';

/**
 * Orquestração da coleta na aba do Google Maps.
 *
 * Fluxo: o interceptor injetado na página reenvia o corpo de /search por
 * postMessage -> aqui o payload vira leads -> o lead é gravado na base local
 * IMEDIATAMENTE (antes do enriquecimento) -> uma fila com limite de paralelismo
 * busca e-mail/redes no site e atualiza o registro.
 *
 * Gravar antes de enriquecer é o que faz um F5 no meio da coleta não apagar
 * nada: o que já entrou está no disco, não na memória da aba.
 */

(() => {
  /** Marcador de "fim da lista" na sidebar do Maps. Classe ofuscada. */
  const END_OF_LIST_SELECTOR = '.HlvSq';
  /** Nº de rolagens sem crescimento da lista antes de desistir. */
  const MAX_STALLED_SCROLLS = 20;

  let settings = { ...LeadStore.DEFAULT_SETTINGS };
  let knownKeys = new Set();
  let leadCount = 0;
  let isExtracting = false;
  let queue = null;

  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  /** Pausa aleatória entre rolagens: evita cadência robótica perfeita. */
  function randomScrollDelay() {
    const min = settings.minScrollDelayMs;
    const max = Math.max(min, settings.maxScrollDelayMs);
    return min + Math.floor(Math.random() * (max - min + 1));
  }

  /** Termo buscado, lido da própria URL — vira coluna no export. */
  function currentSearchQuery() {
    const match = window.location.pathname.match(/\/maps\/search\/([^/]+)/);
    if (match) return decodeURIComponent(match[1].replace(/\+/g, ' '));
    return '';
  }

  // --- coleta ---------------------------------------------------------------

  /**
   * Rola o feed até o fim dos resultados, até travar ou até o usuário parar.
   * Cada rolagem faz o Maps buscar a próxima página — quem captura é o interceptor.
   */
  async function runAutoExtract() {
    const searchButton = document.querySelector('[role="search"] button');
    if (searchButton) {
      searchButton.click();
      await wait(3000);
    } else {
      console.error('[gms] botão de busca não encontrado');
    }

    const feed = document.querySelector('[role="feed"]');
    if (!feed) {
      console.error('[gms] lista de resultados não encontrada');
      return;
    }

    let stalledScrolls = 0;
    let lastScrollHeight = -1;

    while (isExtracting) {
      feed.scrollTop = feed.scrollHeight;
      await wait(randomScrollDelay());

      if (document.querySelector(END_OF_LIST_SELECTOR)) {
        console.log('[gms] fim dos resultados');
        break;
      }

      if (lastScrollHeight === feed.scrollHeight) {
        stalledScrolls += 1;
        if (stalledScrolls > MAX_STALLED_SCROLLS) {
          console.log(`[gms] lista sem crescer por ${MAX_STALLED_SCROLLS} rolagens`);
          break;
        }
      } else {
        stalledScrolls = 0;
        lastScrollHeight = feed.scrollHeight;
      }
    }
  }

  async function toggleExtract() {
    if (isExtracting) {
      isExtracting = false;
      OverlayUI.setExtracting(false);
      console.log('[gms] coleta interrompida');
      return;
    }

    isExtracting = true;
    OverlayUI.setExtracting(true);
    console.log('[gms] coleta iniciada');

    try {
      await runAutoExtract();
    } finally {
      isExtracting = false;
      OverlayUI.setExtracting(false);
      await LeadStore.flushNow();
      console.log('[gms] coleta finalizada');
    }
  }

  // --- enriquecimento -------------------------------------------------------

  /** Busca e-mail e redes sociais no site do lead (trabalho feito no service worker). */
  async function enrichLead(lead) {
    if (!lead.website || !settings.collectEmail) return;

    const found = await withRetry(() =>
      chrome.runtime.sendMessage({
        action: 'email',
        data: { website: lead.website, name: lead.name, deep_search: settings.deepSearch },
      })
    );

    if (!found) return;
    for (const field in found) {
      if (Array.isArray(found[field])) lead[field] = found[field].join();
    }
    LeadStore.save(lead);
  }

  // --- entrada de dados -----------------------------------------------------

  function handleSearchPayload(rawBody) {
    const fresh = ingestSearchPayload(rawBody, {
      knownKeys,
      query: currentSearchQuery(),
      country: countryFromMapsHost(window.location.host) || settings.defaultCountry,
    });

    for (const lead of fresh) {
      // Grava já, sem esperar o enriquecimento: F5 não pode custar o lead.
      LeadStore.save(lead);

      // Só entra na fila o que realmente dá trabalho — senão o progresso
      // mostraria centenas de tarefas que não fazem nada.
      if (!lead.website || !settings.collectEmail) continue;

      queue.push(async () => {
        try {
          await enrichLead(lead);
        } catch (error) {
          console.warn('[gms] falha ao enriquecer', lead.name, error);
        }
      });
    }

    if (fresh.length === 0) return;
    leadCount += fresh.length;
    OverlayUI.setCount(leadCount);
    console.log(`[gms] ${fresh.length} novos leads (total ${leadCount})`);
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    if (!event.data || event.data.type !== 'search' || !event.data.data) return;
    handleSearchPayload(event.data.data);
  });

  // --- ciclo de vida --------------------------------------------------------

  async function openDashboard() {
    await LeadStore.flushNow();
    chrome.runtime.sendMessage({ action: 'openPage' });
  }

  async function clearBase() {
    await LeadStore.clear();
    knownKeys = new Set();
    leadCount = 0;
    OverlayUI.setCount(0);
    console.log('[gms] base local apagada');
  }

  async function updateSettings(patch) {
    settings = await LeadStore.saveSettings(patch);
    if (queue) queue.setConcurrency(settings.concurrency);
  }

  (async function start() {
    settings = await LeadStore.getSettings();
    knownKeys = await LeadStore.allKeys();
    leadCount = knownKeys.size;

    queue = createTaskQueue({
      concurrency: settings.concurrency,
      onProgress: (stats) => OverlayUI.setProgress(stats),
    });

    OverlayUI.init(settings, {
      onToggleExtract: toggleExtract,
      onExport: openDashboard,
      onClear: clearBase,
      onSettingChange: updateSettings,
    });
    OverlayUI.setCount(leadCount);
  })();
})();
