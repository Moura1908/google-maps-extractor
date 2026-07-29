'use strict';

const test = require('node:test');
const assert = require('node:assert');
const {
  shouldAutoResumeCampaign,
  looksLikeGoogleCaptchaPage,
  formatCampaignProgressMessage,
  formatCampaignPauseMessage,
  formatCampaignCompleteMessage,
} = require('../src/content/campaign-runner.js');
const { createCampaign, advance } = require('../src/shared/campaign.js');

test('retoma sozinha quando a query da URL bate com o item pendente', () => {
  const campaign = createCampaign(['barbearias em Taguatinga', 'barbearias em Sobradinho']);
  const item = shouldAutoResumeCampaign(campaign, 'barbearias em Taguatinga');
  assert.ok(item);
  assert.strictEqual(item.query, 'barbearias em Taguatinga');
});

test('não retoma quando a query da URL não bate (Google pode ter reescrito)', () => {
  const campaign = createCampaign(['barbearias em Taguatinga']);
  assert.strictEqual(shouldAutoResumeCampaign(campaign, 'barbearias perto de taguatinga'), null);
});

test('não retoma quando não há campanha', () => {
  assert.strictEqual(shouldAutoResumeCampaign(null, 'qualquer coisa'), null);
});

test('não retoma quando a campanha já terminou', () => {
  let campaign = createCampaign(['única busca']);
  campaign = advance(campaign, 'end_of_list');
  assert.strictEqual(shouldAutoResumeCampaign(campaign, 'única busca'), null);
});

test('não retoma um item que já foi concluído (currentIndex já passou dele)', () => {
  let campaign = createCampaign(['busca a', 'busca b']);
  campaign = advance(campaign, 'end_of_list'); // "busca a" concluída, agora em "busca b"
  assert.strictEqual(shouldAutoResumeCampaign(campaign, 'busca a'), null, 'item já concluído não deveria retomar de novo');
  assert.ok(shouldAutoResumeCampaign(campaign, 'busca b'), 'o item atual, sim');
});

test('detecta a página de verificação do Google pelo path', () => {
  assert.strictEqual(looksLikeGoogleCaptchaPage('/sorry/index'), true);
  assert.strictEqual(looksLikeGoogleCaptchaPage('/sorry/'), true);
  assert.strictEqual(looksLikeGoogleCaptchaPage('/maps/search/barbearias'), false);
  assert.strictEqual(looksLikeGoogleCaptchaPage(''), false);
  assert.strictEqual(looksLikeGoogleCaptchaPage(undefined), false);
});

test('mensagem de progresso cita posição atual, total e a busca', () => {
  const campaign = createCampaign(['a', 'b', 'c']);
  assert.strictEqual(formatCampaignProgressMessage(campaign), 'Campanha 1/3: a');
});

test('mensagem de progresso avança junto com a campanha', () => {
  let campaign = createCampaign(['a', 'b', 'c']);
  campaign = advance(campaign, 'end_of_list');
  assert.strictEqual(formatCampaignProgressMessage(campaign), 'Campanha 2/3: b');
});

test('mensagem de pausa converte ms para segundos', () => {
  assert.strictEqual(formatCampaignPauseMessage(30000), 'Campanha: pausa de 30s antes da próxima busca...');
  assert.strictEqual(formatCampaignPauseMessage(5500), 'Campanha: pausa de 6s antes da próxima busca...');
});

test('mensagem de conclusão cita o total de buscas', () => {
  const campaign = createCampaign(['a', 'b']);
  assert.strictEqual(formatCampaignCompleteMessage(campaign), 'Campanha concluída — 2 buscas.');
});
