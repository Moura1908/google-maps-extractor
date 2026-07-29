# Google Maps Extractor

Extensão Chrome (Manifest V3) que extrai leads B2B das páginas de resultado do Google Maps e exporta para CSV/XLSX.

Fork local do [google-maps-extractor](https://github.com/) original, com o gate de conta removido, o código desminificado e correções de confiabilidade. **Roda 100% no seu navegador** — nenhum dado sai da máquina e não há chamada para servidor de licença.

## Instalação

Não há build step: a pasta é a extensão.

1. Abra `chrome://extensions`
2. Ative o **Modo do desenvolvedor**
3. **Carregar sem compactação** → selecione esta pasta

## Uso

1. Busque no Google Maps (`restaurantes em Brasília`, `clínicas odontológicas`, …)
2. No painel branco da barra lateral, clique em **Iniciar extração**
3. A extensão rola a lista sozinha até o fim dos resultados, mostrando "Rolando... N novos leads
   nesta busca" — e, ao parar, o motivo: fim da lista, lista que parou de crescer, ou interrupção manual
4. **Ver e exportar** abre o dashboard, já ordenado por oportunidade, com filtros e download em CSV/XLSX

O painel tem dois interruptores:

| Opção | O que faz | Custo |
|---|---|---|
| Buscar e-mail no site | Visita o site de cada lead procurando e-mail e redes sociais | 1 requisição por lead |
| Vasculhar páginas de contato | Também abre `/contato`, `/sobre`, `/equipe` etc. | Até 10 requisições extras por lead |

Desligue os dois para uma coleta rápida só com os dados do próprio Maps.

## Como funciona

O Maps não expõe API nas páginas de busca, mas ele mesmo consulta um endpoint interno `/search`. Em vez de raspar o HTML renderizado, a extensão intercepta a resposta crua dessa chamada:

```
src/page/interceptor.js   roda no contexto da página; envolve XHR e fetch,
                          e repassa o corpo de /search via postMessage
        ↓
src/content/parser.js     lê o JSON posicional do Google (índices mágicos)
src/content/ingest.js     deduplica, carimba busca/data, telefone, oportunidade
src/content/scraper.js    rola a lista e enfileira o enriquecimento
        ↓
src/background/enrich.js  busca e-mail e redes sociais no site do lead
```

Vantagem: dados completos e estáveis contra mudança de layout. Desvantagem: os campos são lidos por **posição no array** (`entry[11]` = nome, `entry[178][0][0]` = telefone…). Quando o Google reordena esse array, o campo correspondente vem vazio — e só ele, porque cada leitura é isolada.

Um canário de esquema (`src/content/schema-health.js`) mede a taxa de preenchimento de
`name`/`phone`/`placeID` a cada lote e mostra um aviso vermelho no painel quando o padrão indica
que o Google reordenou o array — em vez de deixar a exportação sair com telefone vazio em
silêncio.

### Quando um campo parar de vir

**`docs/payload-map.md`** tem a tabela completa de índices (com data da última verificação), o
formato do envelope e o passo a passo de remapeamento. Resumo rápido: o payload cru do último
lote fica exposto no console da aba do Maps —

```js
copy(__gmsDebug.lastEntry)   // registro completo do primeiro resultado
```

— compare com `FIELD_PATHS` em `src/content/parser.js`, corrija o índice, e **atualize a tabela
do payload-map.md** com a data.

## Dados extraídos

**Oportunidade (score + motivos)** · Nome · Telefone · **Telefone em E.164** · **Tipo (celular/fixo)** · E-mail · Website · Endereço · Categoria · Nota · Nº de avaliações · Instagram · Facebook · LinkedIn · Twitter/X · YouTube · Place ID · CID · Latitude/Longitude · Horário de funcionamento · Termo buscado · Data da extração

### Score de oportunidade

`src/shared/opportunity.js` transforma a lista em fila de trabalho: cada lead ganha
`opportunity_score` (0–100) e `opportunity_reasons` (o rascunho do argumento de venda, tipo
`"sem site · 4 avaliações · perfil incompleto"`). O dashboard já abre ordenado por esse score,
do mais promissor para o menos.

| Sinal | Peso | Por quê |
|---|---|---|
| Sem site de verdade (vazio ou é só um link de Instagram/Facebook) | +40 | Alvo direto para site/landing |
| Nota < 4,0 com 10+ avaliações | +25 | Dor de reputação confirmada (não é 1 review isolado) |
| Menos de 10 avaliações | +20 | Perfil negligenciado |
| Sem horário cadastrado | +15 | Perfil incompleto |
| O "website" cadastrado é, na verdade, um perfil social | +15 | Já investe em presença, falta base própria |
| Telefone é celular | +10 | Dono provavelmente atende o próprio WhatsApp |
| Sem telefone algum | −50 | Sem o canal principal, o lead é pouco acionável |

Calculado já na ingestão (antes do enriquecimento) e recalculado depois que e-mail/redes sociais
chegam — hoje nenhuma regra depende desses campos, mas o recálculo fica pronto para quando
alguma depender.

## Campanhas (separar buscas diferentes)

Todo lead grava a busca de origem (`search_query`). No dashboard, o seletor **Campanha** filtra
por uma busca específica — e a exportação respeita esse filtro, então dá para baixar só os leads
de uma campanha. No popup, **Últimas buscas** mostra as 5 mais recentes com a contagem de cada uma.

### Novos no mapa

O filtro **Novos nos últimos N dias** responde "quem apareceu desde a última vez que rodei essa
busca?" — sem precisar de nenhum campo novo. Como a base nunca reprocessa um lead que já existia
(dedupe global), `scraped_at` é sempre a data da **primeira** vez que aquele lead foi visto, mesmo
que a mesma campanha rode de novo 30 dias depois. Um negócio que acabou de entrar no Google Maps
ainda não foi abordado por ninguém — é o lead mais quente que existe nesse mercado.

## Modo campanha (quebrar o teto de ~120 resultados por busca)

O Google Maps satura a lista de resultados em torno de 100–120 itens. "Clínicas de estética em
Brasília" nunca devolve as clínicas de Brasília — devolve 120 delas, as que o Google já ranqueia
melhor (leia-se: as que já têm marketing bom e já são assediadas por todo mundo). A cauda longa —
o lead que ninguém abordou — só aparece fatiando a busca em várias menores.

No popup, em **Modo campanha**: preencha o termo de busca no campo de cima (ex.: `barbearias`),
liste uma região por linha em baixo (`Asa Sul`, `Taguatinga`, `Águas Claras`...) e clique em
**Iniciar campanha**. A extensão abre a primeira busca (`barbearias em Asa Sul`), extrai sozinha
até o fim, espera a pausa configurada (30s por padrão) e navega para a próxima — sequencialmente,
até a lista acabar. Como a base já é deduplicada globalmente (`placeID` → `cID` → nome+endereço),
não importa se a mesma empresa aparecer em duas regiões vizinhas: entra uma vez só.

Também existe geração de grid por coordenada (`buildCoordinateGrid` em
`src/shared/campaign-grid.js`, testada) para quem prefere cobrir um raio geográfico em vez de
listar bairros à mão — hoje só acessível programaticamente (sem campo na UI), porque um raio +
passo em km não cabe bem numa interface de popup de 320px sem afundar a experiência comum.

**Isto navega a aba automaticamente e em sequência — leia antes de usar em volume:**

- **Formato de URL pode mudar.** A campanha só retoma sozinha se o texto da busca na URL bater
  exatamente com o item pendente. Se o Google reescrever a URL de um jeito que a extensão não
  reconheça, a campanha **pausa** (não adivinha, não trava em loop) — abra `docs/payload-map.md`
  se isso acontecer com frequência.
- **Detecção de CAPTCHA é heurística e best-effort** (`looksLikeGoogleCaptchaPage` em
  `src/content/campaign-runner.js`): olha só o início do caminho da URL. Se o Google mostrar uma
  página de verificação sem mudar a URL de um jeito reconhecível, a extensão pode não perceber —
  a pausa configurável entre buscas é a defesa primária contra volume, a detecção é um extra.
- **Cancele pelo popup** (**Cancelar campanha**) a qualquer momento — mesmo com uma busca em
  andamento, o cancelamento vale assim que a busca atual terminar.
- **Execução ponta a ponta ainda não foi validada num browser real** por mim — as partes puras
  (geração da grade, máquina de estado, decisão de retomada) têm 39 testes automatizados; a
  navegação de verdade entre páginas do Maps só se confirma usando a extensão de fato.

### Telefone

`src/shared/phone.js` normaliza para E.164 e classifica sem depender de biblioteca externa:

- **Brasil**: DDD + 9 dígitos começando em 9 → `mobile`; DDD + 8 dígitos começando em 2–5 → `landline`
- **Celular antigo de 8 dígitos** (começa em 6–9): marcado como `mobile` com `phone_legacy_8digits = true`, e o nono dígito **não** é inserido automaticamente. Inventar o dígito produz um número que pode existir e pertencer a outra pessoa — num disparo de WhatsApp, isso é mensagem para desconhecido.
- **Outros países**: o número recebe o código de discagem, mas fica como `unknown`. As regras de numeração desses países não estão implementadas, e chutar produziria número plausível e errado.

## Base local

Os leads ficam em `chrome.storage.local`, um registro por lead, e são gravados **antes** do enriquecimento — recarregar a página do Maps no meio da coleta não perde nada. A base acumula entre buscas e sessões; a deduplicação usa `placeID` → `cID` → nome+endereço, nessa ordem.

Para zerar: **Limpar base**, no painel ou no dashboard (exige dois cliques).

## Testes

```bash
npm test    # node --test test/*.test.js
```

165 testes cobrindo o parser (contra fixtures do payload), a deduplicação, a normalização de telefone, o score de oportunidade, o agrupamento por campanha, a geração de grade e a máquina de estado do modo campanha, as mensagens de status da sessão, a sanitização de exportação, a guarda contra SSRF, o canário de esquema, a base local e a fila de concorrência. As partes que dependem do browser (DOM do Maps, injeção do interceptor, navegação real entre páginas) só se verificam carregando a extensão.

`npm install` instala um hook de pre-commit que roda `npm test` antes de cada commit (fonte em `scripts/git-hooks/pre-commit`; `.git/hooks/` não é versionado, por isso a instalação é automática em vez de manual). Para um commit só de documentação, pule com `git commit --no-verify`.

## Segurança

Exportação sanitizada contra injeção de fórmula (`src/shared/csvsafe.js`) e enriquecimento bloqueado contra requisição a rede local/loopback (`isPublicHttpUrl` em `src/background/enrich.js`) — ambos os campos de entrada (`name`, `website`) vêm do payload do Google Maps, ou seja, são escritos por terceiro.

## Para onde o projeto vai

`docs/PLANO-DE-EVOLUCAO.md` tem o diagnóstico completo, o roadmap em blocos (com critério de
aceite e esforço por item), as decisões já tomadas e o que foi deliberadamente descartado.
**Blocos 0-3 concluídos no código** — falta validar o modo campanha (Bloco 3.1) num browser real
antes de rodar em volume. Próximo: Bloco 4 (escala e conformidade, por gatilho) ou Bloco 5.

## Limitações conhecidas

- O e-mail é buscado com `fetch` estático: sites que só renderizam por JavaScript não entregam nada.
- O painel depende de classes ofuscadas do Maps (`.w6VYqd`, `.HlvSq`). Há fallback para o painel não sumir, mas a detecção de "fim da lista" pode falhar — nesse caso a coleta para pela trava de rolagem.
- Plus Code, status do negócio e faixa de preço aparecem no payload, mas os índices ainda não foram mapeados — ver `docs/payload-map.md` §5.
- Volume alto de extração pode disparar o CAPTCHA do Google. O intervalo entre rolagens é aleatório justamente para reduzir isso.

## Aviso

Ferramenta para uso legítimo em prospecção B2B. Respeite os Termos de Serviço do Google, a LGPD/GDPR e as regras de consentimento para contato comercial.

## Licença

Ver `LICENSE` (do projeto original).
