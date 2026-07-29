'use strict';

/**
 * DOM e APIs de extensão mínimos para carregar os content scripts em Node.
 *
 * Não é um browser: é só o suficiente para provar que os arquivos carregam na
 * ordem do manifest, que o painel é construído e que uma resposta de /search
 * chega até a base local. Sem isso, o boot do content script só seria testado
 * abrindo o Chrome na mão.
 */

function createElement(tagName) {
  const element = {
    tagName,
    children: [],
    parentNode: null,
    className: '',
    id: '',
    src: '',
    type: '',
    checked: false,
    innerText: '',
    innerHTML: '',
    textContent: '',
    style: {},
    dataset: {},
    listeners: {},
    classList: {
      _set: new Set(),
      add(name) {
        this._set.add(name);
      },
      remove(name) {
        this._set.delete(name);
      },
      contains(name) {
        return this._set.has(name);
      },
    },
    get isConnected() {
      let node = this;
      while (node.parentNode) node = node.parentNode;
      return node.isRoot === true;
    },
    addEventListener(event, handler) {
      (this.listeners[event] = this.listeners[event] || []).push(handler);
    },
    dispatch(event, payload = {}) {
      for (const handler of this.listeners[event] || []) handler({ target: this, currentTarget: this, ...payload });
    },
    appendChild(child) {
      child.parentNode = this;
      this.children.push(child);
      return child;
    },
    append(...nodes) {
      nodes.forEach((node) => this.appendChild(node));
    },
    contains(node) {
      if (node === this) return true;
      return this.children.some((child) => child.contains(node));
    },
    remove() {
      if (!this.parentNode) return;
      this.parentNode.children = this.parentNode.children.filter((child) => child !== this);
      this.parentNode = null;
    },
    /** Busca por id em toda a subárvore — usado pelos testes. */
    find(id) {
      if (this.id === id) return this;
      for (const child of this.children) {
        const hit = child.find(id);
        if (hit) return hit;
      }
      return null;
    },
  };
  return element;
}

function createFakeEnvironment({
  storage = {},
  sendMessage = async () => ({}),
  location = { host: 'www.google.com.br', pathname: '/maps/search/cafeterias+em+brasilia' },
} = {}) {
  const body = createElement('body');
  body.isRoot = true;

  const documentStub = {
    body,
    head: createElement('head'),
    documentElement: createElement('html'),
    createElement,
    querySelector: () => null,
    getElementsByClassName: () => [],
    getElementById: (id) => body.find(id),
  };

  const messageListeners = [];
  const windowStub = {
    // Objeto próprio (não o `location` recebido): permite ler/escrever
    // `.href` no teste sem mutar o valor default compartilhado entre testes.
    location: { ...location },
    addEventListener(event, handler) {
      if (event === 'message') messageListeners.push(handler);
    },
    postMessage(data) {
      for (const handler of messageListeners) handler({ source: windowStub, data });
    },
  };

  const chromeStub = {
    runtime: {
      sendMessage,
      getURL: (path) => `chrome-extension://fake/${path}`,
      onMessage: { addListener() {} },
    },
    storage: {
      local: {
        async get(keys) {
          if (keys === null || keys === undefined) return { ...storage };
          if (typeof keys === 'string') return keys in storage ? { [keys]: storage[keys] } : {};
          const result = {};
          for (const key of keys) if (key in storage) result[key] = storage[key];
          return result;
        },
        async set(items) {
          Object.assign(storage, items);
        },
        async remove(keys) {
          for (const key of [].concat(keys)) delete storage[key];
        },
      },
    },
    tabs: { create() {} },
  };

  class MutationObserverStub {
    constructor(callback) {
      this.callback = callback;
    }
    observe() {}
    disconnect() {}
  }

  return { body, storage, documentStub, windowStub, chromeStub, MutationObserverStub };
}

module.exports = { createElement, createFakeEnvironment };
