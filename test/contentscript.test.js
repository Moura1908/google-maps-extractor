'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const { createFakeEnvironment } = require('./helpers/fake-dom.js');
const { buildEntry, buildSearchResponse } = require('./fixtures.js');

const ROOT = path.join(__dirname, '..');
const MANIFEST = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));

/**
 * Carrega os content scripts na MESMA ordem e no MESMO escopo global que o
 * Chrome usa — é assim que se descobre que um arquivo depende de outro que
 * ainda não carregou, sem precisar abrir o navegador.
 */
function loadContentScripts(options = {}) {
  const env = createFakeEnvironment(options);
  const sandbox = {
    console: { log() {}, warn() {}, error() {} },
    document: env.documentStub,
    window: env.windowStub,
    chrome: env.chromeStub,
    MutationObserver: env.MutationObserverStub,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    Math,
    Date,
    JSON,
    URL,
    Set,
    Map,
    Promise,
    Object,
    Array,
    Number,
    String,
    Boolean,
    Error,
    RegExp,
  };
  sandbox.globalThis = sandbox;
  const context = vm.createContext(sandbox);

  const files = MANIFEST.content_scripts[1].js;
  for (const file of files) {
    const code = fs.readFileSync(path.join(ROOT, file), 'utf8');
    vm.runInContext(code, context, { filename: file });
  }
  return { env, context, files };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

test('todos os content scripts carregam na ordem do manifest, sem erro', () => {
  const { files } = loadContentScripts();
  assert.ok(files.length >= 7, 'o manifest precisa listar os módulos do content script');
});

test('o painel é construído e anexado mesmo sem os containers do Maps', async () => {
  const { env } = loadContentScripts();
  await tick();

  const panel = env.body.children.find((child) => child.className.includes('extension_gms_page'));
  assert.ok(panel, 'o painel deve cair no body quando .w6VYqd não existe');
  assert.ok(panel.classList.contains('extension_gms_floating'), 'e deve virar flutuante nesse caso');
  assert.ok(panel.find('extension_gms_start_btn'), 'botão de iniciar presente');
  assert.ok(panel.find('extension_gms_download_btn'), 'botão de exportar presente');
  assert.ok(panel.find('extension_gms_email_toggle'), 'toggle de e-mail presente');
});

test('o contador começa refletindo a base já existente', async () => {
  const storage = {
    'lead:place:antigo': { key: 'place:antigo', name: 'Lead de outra sessão' },
  };
  const { env } = loadContentScripts({ storage });
  await tick();
  await tick();

  const info = env.body.find('extension_gms_leads_info');
  assert.strictEqual(info.innerText, 'Leads: 1');
});

test('uma resposta de /search vira lead gravado na base local', async () => {
  const storage = {};
  const { env } = loadContentScripts({ storage, sendMessage: async () => ({}) });
  await tick();

  env.windowStub.postMessage({ type: 'search', data: buildSearchResponse([buildEntry()]) });
  await tick();

  // O buffer de escrita tem debounce: espera o flush.
  await new Promise((resolve) => setTimeout(resolve, 900));

  const keys = Object.keys(storage).filter((key) => key.startsWith('lead:'));
  assert.strictEqual(keys.length, 1);
  const lead = storage[keys[0]];
  assert.strictEqual(lead.name, 'Café Central');
  assert.strictEqual(lead.phone_e164, '+5561999991234');
  assert.strictEqual(lead.search_query, 'cafeterias em brasilia', 'a busca vem da URL do Maps');
  assert.strictEqual(env.body.find('extension_gms_leads_info').innerText, 'Leads: 1');
});

test('o lead é gravado ANTES do enriquecimento terminar', async () => {
  const storage = {};
  let releaseEnrichment;
  const pending = new Promise((resolve) => {
    releaseEnrichment = resolve;
  });

  const { env } = loadContentScripts({
    storage,
    sendMessage: async () => pending, // o site "demora" a responder
  });
  await tick();

  env.windowStub.postMessage({ type: 'search', data: buildSearchResponse([buildEntry()]) });
  await tick();
  await new Promise((resolve) => setTimeout(resolve, 900));

  const keys = Object.keys(storage).filter((key) => key.startsWith('lead:'));
  assert.strictEqual(keys.length, 1, 'o lead precisa estar salvo mesmo com o enriquecimento em voo');
  releaseEnrichment({ email: ['contato@cafecentral.com.br'] });
});

test('o enriquecimento atualiza o lead já gravado', async () => {
  const storage = {};
  const { env } = loadContentScripts({
    storage,
    sendMessage: async () => ({ email: ['contato@cafecentral.com.br'], instagram: [] }),
  });
  await tick();

  env.windowStub.postMessage({ type: 'search', data: buildSearchResponse([buildEntry()]) });
  await new Promise((resolve) => setTimeout(resolve, 1200));

  const lead = storage['lead:place:ChIJ_place_1'];
  assert.strictEqual(lead.email, 'contato@cafecentral.com.br');
});

test('score de oportunidade: website que é um link do Instagram já soma tudo na ingestão', async () => {
  const storage = {};
  const { env } = loadContentScripts({ storage, sendMessage: async () => ({ email: [], instagram: [] }) });
  await tick();

  // 40 (sem site de verdade) + 15 (perfil incompleto) + 15 (perfil social no
  // lugar de site) + 10 (celular) = 80. Nenhuma dessas regras depende de
  // e-mail/instagram vindos do enriquecimento — todas leem só o payload cru.
  env.windowStub.postMessage({
    type: 'search',
    data: buildSearchResponse([buildEntry({ website: 'https://www.instagram.com/loja' })]),
  });
  // A gravação tem debounce (ver src/shared/storage.js) — espera o flush.
  await new Promise((resolve) => setTimeout(resolve, 900));

  const lead = storage['lead:place:ChIJ_place_1'];
  assert.strictEqual(lead.opportunity_score, 80);
  assert.strictEqual(
    lead.opportunity_reasons,
    'sem site · perfil incompleto · só tem perfil social, sem site próprio · celular'
  );
});

test('score de oportunidade sobrevive intacto ao recálculo pós-enriquecimento', async () => {
  // O recálculo em enrichLead() é defensivo para regras futuras que dependam
  // de e-mail/redes sociais encontradas — hoje nenhuma das 7 regras depende
  // disso, então o valor não deve mudar entre a ingestão e o enriquecimento.
  const storage = {};
  const { env } = loadContentScripts({
    storage,
    sendMessage: async () => ({ email: ['contato@loja.com'], instagram: [] }),
  });
  await tick();

  env.windowStub.postMessage({
    type: 'search',
    data: buildSearchResponse([buildEntry({ website: 'https://www.instagram.com/loja' })]),
  });
  await new Promise((resolve) => setTimeout(resolve, 1200));

  const lead = storage['lead:place:ChIJ_place_1'];
  assert.strictEqual(lead.email, 'contato@loja.com', 'pré-condição: o enriquecimento rodou de verdade');
  assert.strictEqual(lead.opportunity_score, 80, 'o score não pode mudar por causa do enriquecimento');
});

test('sem lista de resultados na página, o usuário é avisado', async () => {
  // Aba num lugar específico do Maps, não numa busca: não há [role="feed"].
  const { env } = loadContentScripts();
  await tick();

  const button = env.body.find('extension_gms_start_btn');
  assert.strictEqual(button.innerText, 'Iniciar extração');

  button.dispatch('click');
  await new Promise((resolve) => setTimeout(resolve, 3200)); // espera o clique na busca

  assert.strictEqual(button.innerText, 'Iniciar extração', 'o ciclo termina sozinho');
  const message = env.body.children
    .find((child) => child.className.includes('extension_gms_page'))
    .children.find((child) => child.className === 'extension_gms_progress');
  assert.match(message.innerText, /Abra uma busca/, 'e explica por quê');
});

test('com a lista presente, a extração fica ativa até ser parada', async () => {
  const { env } = loadContentScripts();
  await tick();

  // Simula a sidebar de resultados do Maps.
  const feed = env.documentStub.createElement('div');
  feed.scrollTop = 0;
  feed.scrollHeight = 1000;
  env.documentStub.querySelector = (selector) => (selector === '[role="feed"]' ? feed : null);

  const button = env.body.find('extension_gms_start_btn');
  button.dispatch('click');
  await new Promise((resolve) => setTimeout(resolve, 3200));

  assert.strictEqual(button.innerText, 'Parar extração');

  button.dispatch('click');
  await tick();
  assert.strictEqual(button.innerText, 'Iniciar extração');
});

function findStatusLabel(env) {
  const panel = env.body.children.find((child) => child.className.includes('extension_gms_page'));
  return panel.children.find((child) => child.className === 'extension_gms_progress');
}

test('mensagem de conclusão: fim da lista', async () => {
  const { env } = loadContentScripts();
  await tick();

  const feed = env.documentStub.createElement('div');
  feed.scrollTop = 0;
  feed.scrollHeight = 1000;
  // '.HlvSq' já presente desde a primeira rolagem: dispara 'end_of_list' cedo.
  env.documentStub.querySelector = (selector) => {
    if (selector === '[role="feed"]') return feed;
    if (selector === '.HlvSq') return env.documentStub.createElement('div');
    return null;
  };

  env.body.find('extension_gms_start_btn').dispatch('click');
  await new Promise((resolve) => setTimeout(resolve, 3200));

  assert.strictEqual(env.body.find('extension_gms_start_btn').innerText, 'Iniciar extração');
  assert.match(findStatusLabel(env).innerText, /^Concluído — 0 leads nesta busca \(fim dos resultados\)$/);
});

test('mensagem de conclusão: trava de rolagem (lista para de crescer)', async () => {
  // Delays mínimos: sem isso, 21 iterações no ritmo real (1-3s cada) tornariam
  // este teste lento demais para rodar toda vez.
  const storage = { settings: { minScrollDelayMs: 1, maxScrollDelayMs: 2 } };
  const { env } = loadContentScripts({ storage });
  await tick();

  const feed = env.documentStub.createElement('div');
  feed.scrollTop = 0;
  feed.scrollHeight = 1000; // nunca muda: a lista "para de crescer" desde a 1ª rolagem
  env.documentStub.querySelector = (selector) => (selector === '[role="feed"]' ? feed : null);

  env.body.find('extension_gms_start_btn').dispatch('click');
  await new Promise((resolve) => setTimeout(resolve, 500));

  assert.strictEqual(env.body.find('extension_gms_start_btn').innerText, 'Iniciar extração');
  assert.match(findStatusLabel(env).innerText, /^Parado — 0 leads nesta busca \(lista não cresceu mais\)$/);
});

test('mensagem de conclusão: interrompido pelo usuário', async () => {
  const { env } = loadContentScripts();
  await tick();

  const feed = env.documentStub.createElement('div');
  feed.scrollTop = 0;
  feed.scrollHeight = 1000;
  env.documentStub.querySelector = (selector) => (selector === '[role="feed"]' ? feed : null);

  const button = env.body.find('extension_gms_start_btn');
  button.dispatch('click');
  await new Promise((resolve) => setTimeout(resolve, 200)); // entra no loop, mas não estabiliza nem termina
  button.dispatch('click'); // usuário clica em "Parar"

  await new Promise((resolve) => setTimeout(resolve, 3200)); // aguarda o loop notar e sair

  assert.match(findStatusLabel(env).innerText, /^Interrompido — 0 leads nesta busca$/);
});

function findEnrichProgressLabel(env) {
  const panel = env.body.children.find((child) => child.className.includes('extension_gms_page'));
  return panel.children.find((child) => child.className.includes('extension_gms_enrich_progress'));
}

test('mensagem de rolagem aparece assim que a extração começa', async () => {
  const { env } = loadContentScripts();
  await tick();

  const feed = env.documentStub.createElement('div');
  feed.scrollTop = 0;
  feed.scrollHeight = 1000;
  env.documentStub.querySelector = (selector) => (selector === '[role="feed"]' ? feed : null);

  env.body.find('extension_gms_start_btn').dispatch('click');
  await tick();

  assert.strictEqual(findStatusLabel(env).innerText, 'Rolando... 0 novos leads nesta busca');
});

test('progresso de enriquecimento e status da sessão não se sobrescrevem', async () => {
  const storage = {};
  let releaseEnrichment;
  const pending = new Promise((resolve) => {
    releaseEnrichment = resolve;
  });
  const { env } = loadContentScripts({ storage, sendMessage: async () => pending });
  await tick();

  // Extração ativa: é quando handleSearchPayload atualiza o status da sessão.
  const feed = env.documentStub.createElement('div');
  feed.scrollTop = 0;
  feed.scrollHeight = 1000;
  env.documentStub.querySelector = (selector) => (selector === '[role="feed"]' ? feed : null);
  env.body.find('extension_gms_start_btn').dispatch('click');
  await tick();

  // O lead da fixture tem website -> entra na fila de enriquecimento, que
  // dispara setProgress (elemento próprio) enquanto o enriquecimento não
  // termina (mock nunca resolve `pending` até releaseEnrichment ser chamado).
  env.windowStub.postMessage({ type: 'search', data: buildSearchResponse([buildEntry()]) });
  await tick();

  assert.match(findStatusLabel(env).innerText, /novos leads nesta busca/, 'status da sessão não pode ter sido apagado');
  assert.match(findEnrichProgressLabel(env).innerText, /Enriquecendo/, 'progresso da fila precisa estar no elemento próprio');

  releaseEnrichment({ email: [], instagram: [] });
});

test('limpar a base exige dois cliques', async () => {
  const storage = { 'lead:place:1': { key: 'place:1', name: 'Alvo' } };
  const { env } = loadContentScripts({ storage });
  await tick();
  await tick();

  const button = env.body.find('extension_gms_clear_btn');
  button.dispatch('click');
  await tick();
  assert.strictEqual(button.innerText, 'Confirmar?');
  assert.ok(storage['lead:place:1'], 'o primeiro clique não pode apagar nada');

  button.dispatch('click');
  await tick();
  await tick();
  assert.ok(!storage['lead:place:1'], 'o segundo clique apaga');
});

function findWarningLabel(env) {
  const panel = env.body.children.find((child) => child.className.includes('extension_gms_page'));
  return panel.children.find((child) => child.className === 'extension_gms_warning');
}

test('um lote com telefone sistematicamente vazio dispara o aviso de esquema quebrado', async () => {
  const { env } = loadContentScripts();
  await tick();

  const entries = Array.from({ length: 12 }, (_, i) =>
    buildEntry({ placeID: `place-broken-${i}`, cID: `cid-broken-${i}`, name: `Negócio ${i}`, phone: null })
  );
  env.windowStub.postMessage({ type: 'search', data: buildSearchResponse(entries) });
  await tick();

  const warning = findWarningLabel(env);
  assert.strictEqual(warning.style.display, 'block');
  assert.match(warning.innerText, /`phone`/);
  assert.match(warning.innerText, /não está sendo lido/);
});

test('um lote saudável subsequente limpa o aviso de esquema', async () => {
  const { env } = loadContentScripts();
  await tick();

  const broken = Array.from({ length: 12 }, (_, i) =>
    buildEntry({ placeID: `place-broken-${i}`, cID: `cid-broken-${i}`, phone: null })
  );
  env.windowStub.postMessage({ type: 'search', data: buildSearchResponse(broken) });
  await tick();
  assert.strictEqual(findWarningLabel(env).style.display, 'block', 'pré-condição: aviso ativo');

  const healthy = Array.from({ length: 12 }, (_, i) =>
    buildEntry({ placeID: `place-ok-${i}`, cID: `cid-ok-${i}` })
  );
  env.windowStub.postMessage({ type: 'search', data: buildSearchResponse(healthy) });
  await tick();

  const warning = findWarningLabel(env);
  assert.strictEqual(warning.style.display, 'none');
  assert.strictEqual(warning.innerText, '');
});

test('um lote pequeno com telefone vazio não dispara aviso (amostra insuficiente)', async () => {
  const { env } = loadContentScripts();
  await tick();

  const small = Array.from({ length: 3 }, (_, i) =>
    buildEntry({ placeID: `place-small-${i}`, cID: `cid-small-${i}`, phone: null })
  );
  env.windowStub.postMessage({ type: 'search', data: buildSearchResponse(small) });
  await tick();

  assert.strictEqual(findWarningLabel(env).style.display, 'none');
});

test('o mesmo lead chegando duas vezes não duplica na base', async () => {
  const storage = {};
  const { env } = loadContentScripts({ storage });
  await tick();

  const body = buildSearchResponse([buildEntry()]);
  env.windowStub.postMessage({ type: 'search', data: body });
  await tick();
  env.windowStub.postMessage({ type: 'search', data: body });
  await new Promise((resolve) => setTimeout(resolve, 900));

  const keys = Object.keys(storage).filter((key) => key.startsWith('lead:'));
  assert.strictEqual(keys.length, 1);
  assert.strictEqual(env.body.find('extension_gms_leads_info').innerText, 'Leads: 1');
});
