'use strict';

/**
 * Orquestração da coleta na aba do Google Maps.
 *
 * Fluxo: o interceptor injetado na página reenvia o corpo de /search por
 * postMessage -> aqui o payload vira leads -> cada lead com site é enriquecido
 * pelo service worker -> o painel mostra o total.
 *
 * O auto-extract não lê o DOM para extrair dados: ele apenas rola a lista para
 * o Maps disparar as próximas requisições de /search sozinho.
 */

(() => {
  /** Marcador de "fim da lista" na sidebar do Maps. Classe ofuscada. */
  const END_OF_LIST_SELECTOR = '.HlvSq';
  /** Nº de rolagens sem crescimento da lista antes de desistir. */
  const MAX_STALLED_SCROLLS = 20;

  const leads = [];
  const seenPlaceIds = new Set();
  let isExtracting = false;
  let collectEmail = true;

  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  /** Pausa aleatória entre rolagens: evita cadência robótica perfeita. */
  const randomScrollDelay = () => 1000 * (Math.floor(Math.random() * 3) + 1);

  function refreshCount() {
    OverlayUI.setCount(leads.length);
  }

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
      console.log('[gms] paginando...');
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

      console.log(`[gms] travas: ${stalledScrolls}, altura: ${feed.scrollHeight}`);
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
      console.log('[gms] coleta finalizada');
    }
  }

  function exportLeads() {
    chrome.runtime.sendMessage({ action: 'openPage', data: leads });
  }

  function clearLeads() {
    leads.length = 0;
    seenPlaceIds.clear();
    refreshCount();
  }

  /** Busca e-mail e redes sociais no site do lead (trabalho feito no service worker). */
  async function enrichLead(lead) {
    if (!lead.website || !collectEmail) return lead;
    try {
      const found = await chrome.runtime.sendMessage({
        action: 'email',
        data: { website: lead.website, name: lead.name, deep_search: true },
      });
      if (found) {
        for (const field in found) lead[field] = found[field].join();
      }
    } catch (error) {
      console.warn('[gms] falha ao enriquecer lead:', lead.name, error);
    }
    return lead;
  }

  async function handleSearchPayload(rawBody) {
    const parsed = parseSearchResponse(rawBody);
    const fresh = [];

    for (const lead of parsed) {
      if (seenPlaceIds.has(lead.placeID)) continue;
      seenPlaceIds.add(lead.placeID);
      fresh.push(lead);
    }

    const enriched = await Promise.all(fresh.map(enrichLead));
    leads.push(...enriched);
    console.log(`[gms] ${enriched.length} novos leads (total ${leads.length})`);
    refreshCount();
  }

  window.addEventListener('message', (event) => {
    if (!event.data || event.data.type !== 'search' || !event.data.data) return;
    handleSearchPayload(event.data.data);
  });

  OverlayUI.init({
    onToggleExtract: toggleExtract,
    onExport: exportLeads,
    onClear: clearLeads,
  });
})();
