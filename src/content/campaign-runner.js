'use strict';

/**
 * Decisões puras do modo campanha — separadas de scraper.js para serem
 * testáveis sem DOM. scraper.js só chama estas funções e faz a parte que
 * exige o browser de verdade (navegar a aba, ler window.location).
 */

/**
 * A campanha deve retomar sozinha na página atual quando o texto da busca
 * pendente bate com o que está na URL. Comparação exata de propósito: texto
 * diferente pode significar que o Google reescreveu a URL (risco conhecido,
 * ver docs/PLANO-DE-EVOLUCAO.md Bloco 3.1) — nesse caso é mais seguro pausar
 * e esperar o usuário decidir do que adivinhar.
 */
function shouldAutoResumeCampaign(campaign, currentQuery) {
  if (!campaign || isCampaignComplete(campaign)) return null;
  const item = campaign.items[campaign.currentIndex];
  if (!item || item.status !== 'pending') return null;
  if (item.query !== currentQuery) return null;
  return item;
}

function isCampaignComplete(campaign) {
  if (!campaign || !campaign.items) return true;
  return campaign.currentIndex >= campaign.items.length;
}

/**
 * Heurística best-effort para a página de verificação do Google (CAPTCHA /
 * "tráfego incomum"). O Google não documenta esse formato e ele pode mudar —
 * por isso é só um sinal a mais, não a única defesa contra volume alto (a
 * pausa configurável entre buscas é a defesa primária).
 */
function looksLikeGoogleCaptchaPage(pathname) {
  const path = String(pathname || '');
  return path.startsWith('/sorry/') || path.includes('/sorry/index');
}

function formatCampaignProgressMessage(campaign) {
  const done = Math.min(campaign.currentIndex, campaign.items.length);
  const total = campaign.items.length;
  const item = campaign.items[campaign.currentIndex];
  return `Campanha ${done + 1}/${total}: ${item ? item.query : ''}`;
}

function formatCampaignPauseMessage(pauseMs) {
  return `Campanha: pausa de ${Math.round(pauseMs / 1000)}s antes da próxima busca...`;
}

function formatCampaignCompleteMessage(campaign) {
  return `Campanha concluída — ${campaign.items.length} buscas.`;
}

function formatCaptchaMessage() {
  return 'Campanha pausada: o Google mostrou uma página de verificação. Resolva manualmente e reinicie a campanha pelo popup.';
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    shouldAutoResumeCampaign,
    isCampaignComplete,
    looksLikeGoogleCaptchaPage,
    formatCampaignProgressMessage,
    formatCampaignPauseMessage,
    formatCampaignCompleteMessage,
    formatCaptchaMessage,
  };
}
