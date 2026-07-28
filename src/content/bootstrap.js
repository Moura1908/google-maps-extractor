'use strict';

/**
 * Injeta o interceptor no contexto da página.
 *
 * Content scripts vivem num "isolated world" e não enxergam o XMLHttpRequest
 * que o Maps usa. Só um <script src> real, carregado da própria extensão,
 * consegue trocar o protótipo que a página enxerga — daí este empurrão.
 */

(() => {
  const script = document.createElement('script');
  script.src = chrome.runtime.getURL('src/page/interceptor.js');
  script.onload = function () {
    this.remove();
  };
  (document.head || document.documentElement).appendChild(script);
})();
