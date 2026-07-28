'use strict';

/**
 * Roda no contexto DA PÁGINA (não no isolated world da extensão).
 *
 * O Google Maps não expõe API nas páginas de busca, mas ele mesmo consulta um
 * endpoint interno `/search`. Em vez de raspar o DOM renderizado, este script
 * intercepta a resposta crua dessa chamada e a repassa para o content script
 * via postMessage. Dados completos, sem depender de layout.
 */

(() => {
  const proto = XMLHttpRequest.prototype;
  const originalOpen = proto.open;
  const originalSend = proto.send;

  const XHR_EVENTS = 'loadstart load loadend progress error abort timeout readystatechange'.split(' ');

  proto.open = function (method, url) {
    this._method = method;
    this._url = url;
    return originalOpen.apply(this, arguments);
  };

  proto.send = function () {
    XHR_EVENTS.forEach((eventName) => {
      this.addEventListener(
        eventName,
        function () {
          if (!this._url || !this._url.startsWith('/search')) return;
          if (this.readyState !== 4) return;
          try {
            window.postMessage({ type: 'search', data: this.response }, '*');
          } catch (error) {
            console.error('[gms] falha ao repassar resposta XHR:', error);
          }
        }.bind(this)
      );
    });
    return originalSend.apply(this, arguments);
  };
})();
