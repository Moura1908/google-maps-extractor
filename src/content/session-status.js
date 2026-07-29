'use strict';

/**
 * Texto de status da sessão de coleta atual (desde o último clique em
 * "Iniciar extração") — distinto da contagem vitalícia da base
 * (`OverlayUI.setCount`) e do progresso da fila de enriquecimento
 * (`OverlayUI.setProgress`), que mostram outras coisas.
 */

function formatRollingMessage(sessionCount) {
  return `Rolando... ${sessionCount} novos leads nesta busca`;
}

/** Um texto por motivo de parada — ver runAutoExtract() em scraper.js. */
const COMPLETION_TEXT = {
  end_of_list: (count) => `Concluído — ${count} leads nesta busca (fim dos resultados)`,
  stalled: (count) => `Parado — ${count} leads nesta busca (lista não cresceu mais)`,
  user_stopped: (count) => `Interrompido — ${count} leads nesta busca`,
};

function formatCompletionMessage(reason, sessionCount) {
  const formatter = COMPLETION_TEXT[reason] || COMPLETION_TEXT.end_of_list;
  return formatter(sessionCount);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { formatRollingMessage, formatCompletionMessage };
}
