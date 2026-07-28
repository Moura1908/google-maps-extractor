'use strict';

/**
 * Roda no contexto DA PÁGINA (não no isolated world da extensão).
 *
 * O Google Maps não expõe API nas páginas de busca, mas ele mesmo consulta um
 * endpoint interno `/search`. Em vez de raspar o DOM renderizado, este script
 * intercepta a resposta crua dessa chamada e a repassa para o content script
 * via postMessage. Dados completos, sem depender de layout.
 *
 * Intercepta XHR **e** fetch: o Maps usa XHR hoje, mas uma migração para fetch
 * deixaria a extensão silenciosamente vazia — sem erro, sem lead, sem pista.
 */

(() => {
  const SEARCH_PATH = '/search';

  function isSearchUrl(url) {
    if (!url) return false;
    try {
      // URLs relativas ("/search?...") e absolutas do próprio Maps.
      const path = url.startsWith('http') ? new URL(url).pathname : String(url);
      return path.startsWith(SEARCH_PATH);
    } catch (error) {
      return String(url).startsWith(SEARCH_PATH);
    }
  }

  function publish(body, source) {
    if (!body) return;
    try {
      window.postMessage({ type: 'search', data: body, source }, '*');
    } catch (error) {
      console.error('[gms] falha ao repassar resposta:', error);
    }
  }

  // --- XMLHttpRequest -------------------------------------------------------
  const proto = XMLHttpRequest.prototype;
  const originalOpen = proto.open;
  const originalSend = proto.send;

  proto.open = function (method, url) {
    this._gmsUrl = url;
    return originalOpen.apply(this, arguments);
  };

  proto.send = function () {
    this.addEventListener('readystatechange', () => {
      if (this.readyState !== 4) return;
      if (!isSearchUrl(this._gmsUrl)) return;
      publish(this.response, 'xhr');
    });
    return originalSend.apply(this, arguments);
  };

  // --- fetch ----------------------------------------------------------------
  const originalFetch = window.fetch;
  if (typeof originalFetch === 'function') {
    window.fetch = async function (input, init) {
      const response = await originalFetch.apply(this, arguments);
      try {
        const url = typeof input === 'string' ? input : input && input.url;
        if (isSearchUrl(url)) {
          // clone() é obrigatório: ler o corpo original deixaria a página sem ele.
          response
            .clone()
            .text()
            .then((body) => publish(body, 'fetch'))
            .catch(() => {});
        }
      } catch (error) {
        console.error('[gms] falha ao inspecionar fetch:', error);
      }
      return response;
    };
  }
})();
