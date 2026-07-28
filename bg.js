// Service worker: importa config de autenticação (removida na Fase 1) e o backend próprio.
try {
  importScripts(
    'auth/config.js',
    'auth/feedback/feedback.js',
    'auth/loginbg.js',
    'src/background/enrich.js',
    'src/background/router.js'
  );
} catch (error) {
  console.error(error);
}
