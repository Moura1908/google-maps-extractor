'use strict';

/**
 * Roteador de mensagens do service worker.
 *
 * Retornar `true` mantém o canal aberto para resposta assíncrona — sem isso
 * o `sendResponse` cai no vazio e quem pediu fica esperando para sempre.
 */

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  switch (message.action) {
    // Salva o lote e abre o dashboard numa aba nova.
    case 'openPage':
      chrome.storage.local.set({ leads: message.data }, () => {
        chrome.tabs.create({ url: 'dashboard.html' });
      });
      return false;

    // Busca uma URL qualquer sem esbarrar em CORS.
    case 'access':
      (async () => sendResponse(await fetchUrlContent(message.data.url)))();
      return true;

    // Enriquece um lead: e-mail + perfis sociais a partir do site.
    case 'email':
      (async () => {
        const { website, name, deep_search: deepSearch } = message.data;
        const found = await extractContacts(website, name, deepSearch);
        // Set não sobrevive à serialização entre contextos: vira array.
        const serializable = {};
        for (const field in found) serializable[field] = Array.from(found[field]);
        sendResponse(serializable);
      })();
      return true;

    default:
      return false;
  }
});
