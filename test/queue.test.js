'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { createTaskQueue, withRetry } = require('../src/content/queue.js');

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('nunca ultrapassa o limite de tarefas simultâneas', async () => {
  let running = 0;
  let peak = 0;
  let finished = 0;

  const queue = createTaskQueue({ concurrency: 3 });
  for (let i = 0; i < 20; i += 1) {
    queue.push(async () => {
      running += 1;
      peak = Math.max(peak, running);
      await delay(5);
      running -= 1;
      finished += 1;
    });
  }

  while (!queue.isIdle) await delay(5);

  assert.strictEqual(finished, 20, 'todas as tarefas precisam rodar');
  assert.ok(peak <= 3, `pico de ${peak} tarefas simultâneas ultrapassou o limite de 3`);
});

test('uma tarefa que falha não trava a fila', async () => {
  let completed = 0;
  const queue = createTaskQueue({ concurrency: 2 });

  queue.push(async () => {
    throw new Error('site fora do ar');
  });
  for (let i = 0; i < 5; i += 1) {
    queue.push(async () => {
      completed += 1;
    });
  }

  while (!queue.isIdle) await delay(5);
  assert.strictEqual(completed, 5);
});

test('o progresso reporta concluídas e total', async () => {
  const snapshots = [];
  const queue = createTaskQueue({ concurrency: 2, onProgress: (stats) => snapshots.push(stats) });

  for (let i = 0; i < 4; i += 1) queue.push(async () => delay(1));
  while (!queue.isIdle) await delay(5);

  const last = snapshots[snapshots.length - 1];
  assert.strictEqual(last.completed, 4);
  assert.strictEqual(last.total, 4);
});

test('withRetry tenta de novo depois de uma falha', async () => {
  let attempts = 0;
  const result = await withRetry(
    async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('falha de rede');
      return 'ok';
    },
    { attempts: 2, delayMs: 1 }
  );

  assert.strictEqual(result, 'ok');
  assert.strictEqual(attempts, 2);
});

test('withRetry propaga o erro quando todas as tentativas falham', async () => {
  let attempts = 0;
  await assert.rejects(
    () =>
      withRetry(
        async () => {
          attempts += 1;
          throw new Error('sempre falha');
        },
        { attempts: 2, delayMs: 1 }
      ),
    /sempre falha/
  );
  assert.strictEqual(attempts, 2);
});
