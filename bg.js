// Service worker: só o backend próprio. Nenhuma chamada a serviço externo.
try {
  importScripts('src/background/enrich.js', 'src/background/router.js');
} catch (error) {
  console.error(error);
}
