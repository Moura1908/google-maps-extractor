'use strict';

/**
 * Instala os hooks de scripts/git-hooks/ em .git/hooks/.
 *
 * Roda automaticamente via `npm install` (script "prepare" do package.json).
 * .git/hooks/ não é versionado pelo git — sem isso, o hook existiria só na
 * máquina de quem o criou e se perderia num clone novo do repositório. A
 * fonte fica versionada aqui; a cópia em .git/hooks é regenerada sempre.
 *
 * Falha em silêncio (aviso, não erro) quando não há repositório git — por
 * exemplo, se este pacote for extraído fora do controle de versão. Um script
 * "prepare" que falha bloqueia o `npm install` inteiro, o que seria pior do
 * que simplesmente não instalar o hook.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const GIT_DIR = path.join(ROOT, '.git');
const SOURCE_DIR = path.join(ROOT, 'scripts', 'git-hooks');

function main() {
  if (!fs.existsSync(GIT_DIR) || !fs.statSync(GIT_DIR).isDirectory()) {
    console.warn('[hooks] .git não encontrado — pulando instalação de hooks (normal fora de um clone).');
    return;
  }

  const hooksDir = path.join(GIT_DIR, 'hooks');
  fs.mkdirSync(hooksDir, { recursive: true });

  for (const name of fs.readdirSync(SOURCE_DIR)) {
    const source = path.join(SOURCE_DIR, name);
    const destination = path.join(hooksDir, name);
    fs.copyFileSync(source, destination);
    fs.chmodSync(destination, 0o755);
    console.log(`[hooks] instalado: .git/hooks/${name}`);
  }
}

main();
