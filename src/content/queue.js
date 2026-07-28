'use strict';

/**
 * Fila com limite de tarefas simultâneas.
 *
 * O código original fazia `Promise.all` sobre a página inteira, e cada item
 * abria até 10 sub-páginas — dezenas de conexões de uma vez, sem retry e sem
 * o usuário saber o que estava acontecendo.
 *
 * A fila mora no content script, não no service worker: em MV3 o worker é
 * encerrado após ~30s ocioso e levaria junto qualquer estado que guardasse.
 * A aba do Maps, por outro lado, fica viva enquanto o usuário estiver coletando.
 */

function createTaskQueue({ concurrency = 5, onProgress = () => {} } = {}) {
  const waiting = [];
  let running = 0;
  let completed = 0;
  let total = 0;
  let limit = concurrency;

  function report() {
    onProgress({ completed, total, running, pending: waiting.length });
  }

  function pump() {
    while (running < limit && waiting.length > 0) {
      const task = waiting.shift();
      running += 1;
      task()
        .catch((error) => console.warn('[gms] tarefa da fila falhou:', error))
        .finally(() => {
          running -= 1;
          completed += 1;
          report();
          pump();
        });
    }
  }

  return {
    push(task) {
      total += 1;
      waiting.push(task);
      report();
      pump();
    },
    setConcurrency(value) {
      limit = Math.max(1, Number(value) || 1);
      pump();
    },
    /** Zera o contador quando não há mais nada em voo (fim de uma coleta). */
    resetIfIdle() {
      if (running === 0 && waiting.length === 0) {
        completed = 0;
        total = 0;
        report();
      }
    },
    get isIdle() {
      return running === 0 && waiting.length === 0;
    },
  };
}

/** Executa `task`, e em falha tenta mais uma vez após uma pausa curta. */
async function withRetry(task, { attempts = 2, delayMs = 1500 } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await task();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastError;
}
