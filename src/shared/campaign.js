'use strict';

/**
 * Máquina de estado de uma campanha: uma lista de buscas a executar em
 * sequência, com status por item.
 *
 * Vive em `chrome.storage.local` (ver `LeadStore.getCampaign`/`saveCampaign`),
 * nunca só em memória — cada busca da campanha navega a aba para uma URL
 * nova, o que recarrega a página inteira e destrói qualquer estado que
 * estivesse só no JavaScript do content script anterior.
 */

/** Gera um id só para diferenciar campanhas na UI — não precisa ser criptográfico. */
function generateCampaignId() {
  return `campaign_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * @param {string[]} queries termos de busca já prontos (ver campaign-grid.js)
 * @param {{pauseMs?: number}} options pausa entre uma busca e a próxima
 */
function createCampaign(queries, { pauseMs = 30000 } = {}) {
  return {
    id: generateCampaignId(),
    createdAt: new Date().toISOString(),
    pauseMs,
    currentIndex: 0,
    items: (queries || []).filter(Boolean).map((query) => ({ query, status: 'pending', finishedAt: null })),
  };
}

/** Item que a campanha está executando agora, ou `null` se já terminou (ou não existe). */
function currentItem(campaign) {
  if (!campaign || !campaign.items) return null;
  return campaign.items[campaign.currentIndex] || null;
}

function isComplete(campaign) {
  if (!campaign || !campaign.items) return true;
  return campaign.currentIndex >= campaign.items.length;
}

/**
 * Marca o item atual com o motivo de parada da coleta (`end_of_list`,
 * `stalled`, `user_stopped`, ou `captcha`/`no_results` em falhas) e avança
 * para o próximo. Não muta `campaign` — devolve uma cópia, para que quem
 * chama sempre persista o retorno em vez de confiar em mutação silenciosa.
 */
function advance(campaign, outcome) {
  const items = campaign.items.map((item, index) =>
    index === campaign.currentIndex ? { ...item, status: outcome || 'done', finishedAt: new Date().toISOString() } : item
  );
  return { ...campaign, items, currentIndex: campaign.currentIndex + 1 };
}

function progressSummary(campaign) {
  if (!campaign || !campaign.items) return { done: 0, total: 0 };
  return { done: Math.min(campaign.currentIndex, campaign.items.length), total: campaign.items.length };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { createCampaign, currentItem, isComplete, advance, progressSummary };
}
