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
  // Zerado a cada "Iniciar extração": é o que aparece como "Rolando... N
  // novos" — distinto de leadCount, que é o total vitalício da base.
  let sessionNewLeads = 0;
  // Não-nulo só quando a extração atual foi disparada automaticamente pelo
  // modo campanha (ver start()) — é o que decide se, ao parar, a campanha
  // avança e navega para a próxima busca, ou se foi só uma extração manual.
  let activeCampaign = null;

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
      // Acontece quando a aba está num lugar específico em vez de uma busca.
      // Sem aviso, o botão só piscaria e voltaria sozinho. `null` sinaliza
      // "nem chegou a rodar" — toggleExtract não deve sobrescrever esta
      // mensagem com um texto de conclusão genérico.
      console.error('[gms] lista de resultados não encontrada');
      OverlayUI.setMessage('Abra uma busca no Maps para extrair.');
      return null;
    }

    let stalledScrolls = 0;
    let lastScrollHeight = -1;
    // Default: se o loop terminar porque isExtracting virou false por fora
    // (usuário clicou em "Parar"), nenhum dos `break` abaixo é alcançado.
    let stopReason = 'user_stopped';

    while (isExtracting) {
      feed.scrollTop = feed.scrollHeight;
      await wait(randomScrollDelay());

      if (document.querySelector(END_OF_LIST_SELECTOR)) {
        console.log('[gms] fim dos resultados');
        stopReason = 'end_of_list';
        break;
      }

      if (lastScrollHeight === feed.scrollHeight) {
        stalledScrolls += 1;
        if (stalledScrolls > MAX_STALLED_SCROLLS) {
          console.log(`[gms] lista sem crescer por ${MAX_STALLED_SCROLLS} rolagens`);
          stopReason = 'stalled';
          break;
        }
      } else {
        stalledScrolls = 0;
        lastScrollHeight = feed.scrollHeight;
      }
    }

    return stopReason;
  }

  async function toggleExtract() {
    if (isExtracting) {
      isExtracting = false;
      OverlayUI.setExtracting(false);
      console.log('[gms] coleta interrompida');
      return;
    }

    isExtracting = true;
    sessionNewLeads = 0;
    OverlayUI.setExtracting(true);
    OverlayUI.setMessage(formatRollingMessage(0));
    console.log('[gms] coleta iniciada');

    let stopReason = null;
    try {
      stopReason = await runAutoExtract();
      // null = nem chegou a rolar (sem feed): a mensagem já foi definida lá.
      if (stopReason) OverlayUI.setMessage(formatCompletionMessage(stopReason, sessionNewLeads));
    } finally {
      isExtracting = false;
      OverlayUI.setExtracting(false);
      await LeadStore.flushNow();
      console.log('[gms] coleta finalizada');
    }

    // Fora do finally: navegar para a próxima busca só depois que tudo
    // acima já assentou (leads gravados, painel atualizado).
    if (activeCampaign && stopReason) {
      await advanceCampaign(stopReason);
    }
  }

  // --- modo campanha ---------------------------------------------------------

  /**
   * Avança a campanha ativa e navega para a próxima busca — ou encerra, se
   * era a última. A navegação recarrega a página inteira; é por isso que o
   * estado da campanha vive em storage.local (LeadStore), não aqui: esta
   * função em si não sobrevive à navegação que ela mesma dispara.
   */
  async function advanceCampaign(stopReason) {
    const campaign = activeCampaign;
    activeCampaign = null;

    const updated = advance(campaign, stopReason);
    await LeadStore.saveCampaign(updated);

    if (isCampaignComplete(updated)) {
      OverlayUI.setMessage(formatCampaignCompleteMessage(updated));
      console.log('[gms] campanha concluída');
      return;
    }

    OverlayUI.setMessage(formatCampaignPauseMessage(updated.pauseMs));
    console.log(`[gms] campanha: pausa de ${updated.pauseMs}ms antes da próxima busca`);
    await wait(updated.pauseMs);

    const next = currentItem(updated);
    window.location.href = buildMapsSearchUrl(next.query);
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
    // Recalcula: e-mail e instagram só chegam agora, e a regra
    // "instagram sem site" depende de instagram estar preenchido.
    applyOpportunityFields(lead);
    LeadStore.save(lead);
  }

  // --- entrada de dados -----------------------------------------------------

  function handleSearchPayload(rawBody) {
    const fresh = ingestSearchPayload(rawBody, {
      knownKeys,
      query: currentSearchQuery(),
      country: countryFromMapsHost(window.location.host) || settings.defaultCountry,
    });

    // Canário de esquema: um índice do payload que mudou faz o campo vir
    // vazio em silêncio. Isso avisa na hora, em vez de na exportação.
    const health = assessSchemaHealth(fresh);
    if (!health.healthy) {
      console.error('[gms] esquema do payload degradado:', health.degraded);
      OverlayUI.setWarning(formatSchemaWarning(health.degraded));
    } else if (health.sampled) {
      // Só limpa um aviso anterior quando o lote atual foi grande o
      // suficiente para confirmar que voltou ao normal.
      OverlayUI.setWarning('');
    }

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

    // Contador da sessão atual (desde o último "Iniciar extração"), distinto
    // do total vitalício da base — atualiza mesmo quando o lote não trouxe
    // nada novo, para o "Rolando..." não parecer travado.
    if (isExtracting) {
      sessionNewLeads += fresh.length;
      OverlayUI.setMessage(formatRollingMessage(sessionNewLeads));
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

    await tryResumeCampaign();
  })();

  /**
   * Ao carregar a página, verifica se existe uma campanha esperando por
   * exatamente esta busca — se sim, inicia a extração sozinha, sem esperar
   * clique. É assim que a campanha atravessa a navegação entre buscas: cada
   * página nova roda este mesmo boot, e cada uma decide por si se é "a sua
   * vez" comparando o texto da busca com o item pendente da campanha.
   */
  async function tryResumeCampaign() {
    const campaign = await LeadStore.getCampaign();
    if (!campaign || isCampaignComplete(campaign)) return;

    if (looksLikeGoogleCaptchaPage(window.location.pathname)) {
      // Não avança, não navega de novo: cutucar o Google enquanto ele já
      // sinalizou tráfego suspeito só pioraria. Fica parado até o usuário
      // resolver a verificação e reiniciar a campanha pelo popup.
      console.error('[gms] campanha pausada: página de verificação do Google detectada');
      OverlayUI.setWarning(formatCaptchaMessage());
      return;
    }

    const item = shouldAutoResumeCampaign(campaign, currentSearchQuery());
    if (!item) {
      // A campanha existe mas esta página não é a busca esperada — pode ser
      // o Google tendo reescrito a URL (risco conhecido), ou uma aba aberta
      // à parte. Não adivinha: fica visível, mas não mexe em nada sozinho.
      console.warn('[gms] campanha ativa, mas a busca desta página não bate com o item pendente');
      return;
    }

    activeCampaign = campaign;
    OverlayUI.setMessage(formatCampaignProgressMessage(campaign));
    console.log('[gms] campanha retomando automaticamente:', item.query);
    // Dá um instante para a página assentar antes de rolar — mesmo espírito
    // do wait(3000) após clicar no botão de busca em runAutoExtract().
    await wait(2000);
    toggleExtract();
  }
})();
