'use strict';

/**
 * Base local de leads em chrome.storage.local.
 *
 * Um lead por chave (`lead:<id>`) em vez de um array gigante numa chave só:
 * assim gravar 5 leads reescreve 5 registros, não a base inteira. As escritas
 * ainda passam por um buffer com debounce para não brigar com a fila de
 * enriquecimento, que atualiza o mesmo lead pouco depois de criá-lo.
 */

const LeadStore = (() => {
  const LEAD_PREFIX = 'lead:';
  const SETTINGS_KEY = 'settings';
  const FLUSH_DELAY_MS = 800;

  const DEFAULT_SETTINGS = {
    collectEmail: true,
    deepSearch: true,
    concurrency: 5,
    minScrollDelayMs: 1000,
    maxScrollDelayMs: 3000,
    defaultCountry: 'BR',
  };

  /** Leads aguardando gravação, indexados por chave (a última versão vence). */
  const pendingWrites = new Map();
  let flushTimer = null;

  function flush() {
    flushTimer = null;
    if (pendingWrites.size === 0) return Promise.resolve();

    const batch = {};
    for (const [key, lead] of pendingWrites) batch[LEAD_PREFIX + key] = lead;
    pendingWrites.clear();
    return chrome.storage.local.set(batch);
  }

  function scheduleFlush() {
    if (flushTimer) return;
    flushTimer = setTimeout(flush, FLUSH_DELAY_MS);
  }

  return {
    DEFAULT_SETTINGS,

    /** Grava (ou substitui) um lead. A escrita real acontece em lote. */
    save(lead) {
      pendingWrites.set(lead.key, lead);
      scheduleFlush();
    },

    /** Força a gravação imediata do que estiver pendente. */
    async flushNow() {
      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      await flush();
    },

    /** Todos os leads guardados, mais recentes primeiro. */
    async allLeads() {
      const stored = await chrome.storage.local.get(null);
      const leads = [];
      for (const [key, value] of Object.entries(stored)) {
        if (key.startsWith(LEAD_PREFIX)) leads.push(value);
      }
      // Inclui o que ainda não foi para o disco, senão a UI pisca para trás.
      for (const lead of pendingWrites.values()) {
        const index = leads.findIndex((existing) => existing.key === lead.key);
        if (index >= 0) leads[index] = lead;
        else leads.push(lead);
      }
      leads.sort((a, b) => String(b.scraped_at || '').localeCompare(String(a.scraped_at || '')));
      return leads;
    },

    /** Só as chaves — é o que a deduplicação precisa carregar no boot. */
    async allKeys() {
      const stored = await chrome.storage.local.get(null);
      const keys = new Set();
      for (const key of Object.keys(stored)) {
        if (key.startsWith(LEAD_PREFIX)) keys.add(key.slice(LEAD_PREFIX.length));
      }
      for (const key of pendingWrites.keys()) keys.add(key);
      return keys;
    },

    async count() {
      return (await this.allKeys()).size;
    },

    /** Remove leads específicos (usado pela limpeza de duplicatas). */
    async removeMany(keys) {
      if (!keys || keys.length === 0) return;
      for (const key of keys) pendingWrites.delete(key);
      await chrome.storage.local.remove(keys.map((key) => LEAD_PREFIX + key));
    },

    /** Apaga todos os leads. Preserva as preferências. */
    async clear() {
      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      pendingWrites.clear();
      const stored = await chrome.storage.local.get(null);
      const leadKeys = Object.keys(stored).filter((key) => key.startsWith(LEAD_PREFIX));
      // `leads` era a chave do formato antigo (array único) — some junto.
      if ('leads' in stored) leadKeys.push('leads');
      if (leadKeys.length > 0) await chrome.storage.local.remove(leadKeys);
    },

    async getSettings() {
      const stored = await chrome.storage.local.get(SETTINGS_KEY);
      return { ...DEFAULT_SETTINGS, ...(stored[SETTINGS_KEY] || {}) };
    },

    async saveSettings(patch) {
      const settings = { ...(await this.getSettings()), ...patch };
      await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
      return settings;
    },
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { LeadStore };
}
