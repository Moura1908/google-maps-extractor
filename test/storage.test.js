'use strict';

const test = require('node:test');
const assert = require('node:assert');

/** chrome.storage.local de mentira, com a mesma semântica de get(null)/set/remove. */
function installFakeChrome() {
  const store = {};
  global.chrome = {
    storage: {
      local: {
        async get(keys) {
          if (keys === null || keys === undefined) return { ...store };
          if (typeof keys === 'string') return keys in store ? { [keys]: store[keys] } : {};
          const result = {};
          for (const key of keys) if (key in store) result[key] = store[key];
          return result;
        },
        async set(items) {
          Object.assign(store, items);
        },
        async remove(keys) {
          for (const key of [].concat(keys)) delete store[key];
        },
      },
    },
  };
  return store;
}

let store;
let LeadStore;

test.beforeEach(() => {
  store = installFakeChrome();
  // Recarrega o módulo para zerar o buffer de escrita entre os testes.
  delete require.cache[require.resolve('../src/shared/storage.js')];
  ({ LeadStore } = require('../src/shared/storage.js'));
});

test('grava e lê um lead', async () => {
  LeadStore.save({ key: 'place:1', name: 'Café', scraped_at: '2026-01-01T00:00:00Z' });
  await LeadStore.flushNow();

  assert.strictEqual(Object.keys(store).length, 1);
  assert.ok('lead:place:1' in store);
  const leads = await LeadStore.allLeads();
  assert.strictEqual(leads.length, 1);
  assert.strictEqual(leads[0].name, 'Café');
});

test('lead ainda não gravado no disco já aparece na leitura', async () => {
  LeadStore.save({ key: 'place:1', name: 'Café' });
  // Sem flushNow: o buffer ainda segura o registro.
  const leads = await LeadStore.allLeads();
  assert.strictEqual(leads.length, 1);
  assert.ok((await LeadStore.allKeys()).has('place:1'));
});

test('gravar o mesmo lead duas vezes mantém a última versão', async () => {
  LeadStore.save({ key: 'place:1', name: 'Café', email: '' });
  LeadStore.save({ key: 'place:1', name: 'Café', email: 'contato@cafe.com.br' });
  await LeadStore.flushNow();

  const leads = await LeadStore.allLeads();
  assert.strictEqual(leads.length, 1);
  assert.strictEqual(leads[0].email, 'contato@cafe.com.br');
});

test('a gravação em lote não reescreve a base inteira', async () => {
  LeadStore.save({ key: 'place:1', name: 'A' });
  await LeadStore.flushNow();
  const setCalls = [];
  const originalSet = chrome.storage.local.set;
  chrome.storage.local.set = async (items) => {
    setCalls.push(Object.keys(items));
    return originalSet(items);
  };

  LeadStore.save({ key: 'place:2', name: 'B' });
  await LeadStore.flushNow();

  assert.deepStrictEqual(setCalls, [['lead:place:2']], 'só o lead novo deve ser escrito');
});

test('leads são ordenados do mais recente para o mais antigo', async () => {
  LeadStore.save({ key: 'a', name: 'Antigo', scraped_at: '2026-01-01T00:00:00Z' });
  LeadStore.save({ key: 'b', name: 'Novo', scraped_at: '2026-06-01T00:00:00Z' });
  await LeadStore.flushNow();

  const leads = await LeadStore.allLeads();
  assert.deepStrictEqual(leads.map((lead) => lead.name), ['Novo', 'Antigo']);
});

test('clear apaga leads e o formato antigo, mas preserva as preferências', async () => {
  LeadStore.save({ key: 'place:1', name: 'Café' });
  await LeadStore.flushNow();
  await LeadStore.saveSettings({ concurrency: 9 });
  store.leads = [{ name: 'lote do formato antigo' }];

  await LeadStore.clear();

  assert.deepStrictEqual(await LeadStore.allLeads(), []);
  assert.ok(!('leads' in store), 'a chave legada precisa sumir junto');
  assert.strictEqual((await LeadStore.getSettings()).concurrency, 9);
});

test('removeMany apaga só o que foi pedido', async () => {
  LeadStore.save({ key: 'a', name: 'A' });
  LeadStore.save({ key: 'b', name: 'B' });
  LeadStore.save({ key: 'c', name: 'C' });
  await LeadStore.flushNow();

  await LeadStore.removeMany(['a', 'c']);

  const names = (await LeadStore.allLeads()).map((lead) => lead.name);
  assert.deepStrictEqual(names, ['B']);
});

test('preferências partem do default e aceitam patch parcial', async () => {
  const defaults = await LeadStore.getSettings();
  assert.strictEqual(defaults.collectEmail, true);
  assert.strictEqual(defaults.concurrency, 5);

  const updated = await LeadStore.saveSettings({ deepSearch: false });
  assert.strictEqual(updated.deepSearch, false);
  assert.strictEqual(updated.concurrency, 5, 'patch não pode zerar o resto');
});

test('getCampaign devolve null quando não há campanha', async () => {
  assert.strictEqual(await LeadStore.getCampaign(), null);
});

test('saveCampaign persiste e getCampaign lê de volta', async () => {
  const campaign = { id: 'campaign_x', currentIndex: 0, items: [{ query: 'a', status: 'pending' }] };
  await LeadStore.saveCampaign(campaign);

  assert.deepStrictEqual(await LeadStore.getCampaign(), campaign);
  assert.ok('campaign' in store, 'precisa estar numa chave própria, fora do namespace lead:');
});

test('clearCampaign remove a campanha sem afetar leads ou preferências', async () => {
  LeadStore.save({ key: 'place:1', name: 'Alvo' });
  await LeadStore.flushNow();
  await LeadStore.saveSettings({ concurrency: 9 });
  await LeadStore.saveCampaign({ id: 'campaign_x', currentIndex: 0, items: [] });

  await LeadStore.clearCampaign();

  assert.strictEqual(await LeadStore.getCampaign(), null);
  assert.strictEqual((await LeadStore.allLeads()).length, 1, 'leads não podem ser afetados');
  assert.strictEqual((await LeadStore.getSettings()).concurrency, 9, 'preferências não podem ser afetadas');
});
