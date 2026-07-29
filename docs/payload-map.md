# Mapa do payload interno do Google Maps

> **Este é o ativo do projeto.** O código em `src/` foi reescrito em um dia; saber que
> `entry[178][0][0]` é o telefone é engenharia reversa que ninguém documenta e que pode
> quebrar sem aviso, em qualquer terça-feira, sem gerar um único erro no console.
>
> Última verificação: **2026-07-29** · Fonte: `src/content/parser.js`

Ver também [`docs/PLANO-DE-EVOLUCAO.md`](PLANO-DE-EVOLUCAO.md) §1.2 — este documento é o item
1.2 do Bloco 1 (proteger o ativo).

---

## Sumário

1. [Como o payload chega até aqui](#1-como-o-payload-chega-até-aqui)
2. [O envelope](#2-o-envelope)
3. [Onde cada estabelecimento mora no feed](#3-onde-cada-estabelecimento-mora-no-feed)
4. [Tabela de campos mapeados](#4-tabela-de-campos-mapeados)
5. [Campos ainda não mapeados](#5-campos-ainda-não-mapeados)
6. [Como remapear um índice quebrado](#6-como-remapear-um-índice-quebrado)
7. [Como o canário de esquema se encaixa aqui](#7-como-o-canário-de-esquema-se-encaixa-aqui)
8. [Histórico de verificação](#8-histórico-de-verificação)

---

## 1. Como o payload chega até aqui

O Google Maps não expõe API nas páginas de busca, mas ele mesmo consulta um endpoint interno
`/search` para preencher a lista de resultados. `src/page/interceptor.js` troca o protótipo de
`XMLHttpRequest` e de `fetch` no contexto da página e repassa a resposta crua desse endpoint via
`postMessage`. `src/content/parser.js` é quem decodifica essa resposta.

```
src/page/interceptor.js  → captura a resposta crua de /search (XHR e fetch)
        ↓ postMessage
src/content/parser.js    → este documento descreve o que ele lê
```

## 2. O envelope

O corpo bruto da resposta **não é JSON puro** — tem duas camadas de proteção contra
[JSON hijacking](https://haacked.com/archive/2009/06/25/json-hijacking.aspx/):

```
/*""*/{"d": ")]}'\n[ ... array gigante ... ]"}
```

`unwrapSearchBody()` remove as duas camadas:

```js
function unwrapSearchBody(rawBody) {
  const envelope = JSON.parse(String(rawBody).replace('/*""*/', ''));  // 1ª camada
  return JSON.parse(envelope.d.slice(5));                              // 2ª: corta ")]}'\n" (5 chars)
}
```

Se esta função começar a lançar `SyntaxError`, o problema não é um índice — é o próprio formato
do envelope que mudou. Isso apareceria como **toda** extração falhando, não um campo isolado.

## 3. Onde cada estabelecimento mora no feed

Depois de desembrulhado, o resultado é um array gigante e **posicional** (sem nome de campo).
O índice **64** desse array é o feed de resultados — uma lista onde cada item representa um
estabelecimento:

```js
const results = unwrapSearchBody(rawBody);
const feed = results[64];        // lista de estabelecimentos
```

Dentro de cada item do feed, os dados do estabelecimento estão no **último elemento do próprio
array** (não no início):

```js
const entry = feedItem[feedItem.length - 1];
```

A partir daqui, `entry[N]` é o índice de cada campo — a tabela da próxima seção.

## 4. Tabela de campos mapeados

| Campo | Caminho (`FIELD_PATHS`) | Verificado em | Observação |
|---|---|---|---|
| `name` | `entry[11]` | 2026-07-29 | Se vier vazio, o item é descartado — é tratado como "linha de controle do feed", não estabelecimento |
| `website` | `entry[7][0]` | 2026-07-29 | |
| `phone` | `entry[178][0][0]` | 2026-07-29 | Formato livre (o que o Google exibir); normalizado depois em `src/shared/phone.js` |
| `averageRating` | `entry[4][7]` | 2026-07-29 | |
| `reviewCount` | `entry[4][8]` | 2026-07-29 | |
| `categories` | `entry[13]` | 2026-07-29 | Array de strings; juntado com `;` no lead final |
| `placeID` | `entry[78]` | 2026-07-29 | Base do dedupe (ver `src/shared/leadkey.js`) |
| `cID` | `entry[37][0][0][29][1]` | 2026-07-29 | O índice mais profundo e mais provável de quebrar primeiro numa reordenação |
| `address` | `entry[2]` | 2026-07-29 | Array de strings; juntado com `,` |
| `latitude` | `entry[9][2]` | 2026-07-29 | |
| `longitude` | `entry[9][3]` | 2026-07-29 | |
| `workingHours` | `entry[203][0]` | 2026-07-29 | Ver formato abaixo — não é um valor escalar |

### Formato de `workingHours`

`entry[203][0]` é uma lista de dias, cada um no formato:

```
[ rótuloDoDia, índiceDaSemana (0=domingo?), null, [[faixaDeHorário, ...], ...] ]
```

`parseWorkingHours()` em `parser.js` converte isso em colunas planas `"0_segunda-feira": "08:00–12:00, 14:00–18:00"`, ordenadas por `índiceDaSemana`.

## 5. Campos ainda não mapeados

Existem no payload (o Maps mostra essas informações na UI), mas os índices ainda não foram
identificados. **Não adivinhe** — siga o procedimento da seção 6.

| Campo | Por que ainda não está mapeado |
|---|---|
| Plus Code | Nunca foi necessário até agora; aparece na UI do Maps como código curto de localização |
| `business_status` (aberto / fechado permanentemente / fechado temporariamente) | Provavelmente um índice próximo de `entry[203]` (horários), mas não confirmado |
| `price_level` (`$`, `$$`, `$$$`) | Só aparece para categorias específicas (restaurantes, bares); mais difícil de amostrar |

Se você mapear algum desses, **adicione a linha na tabela da seção 4** com a data e remova daqui.

## 6. Como remapear um índice quebrado

O canário de esquema (`src/content/schema-health.js`, Bloco 1.1 do
[plano de evolução](PLANO-DE-EVOLUCAO.md)) mostra um aviso vermelho no painel quando a taxa de
preenchimento de `name`, `phone` ou `placeID` cai abaixo de 50% num lote de 10+ leads. Quando
isso acontecer:

1. **Abra o console da aba do Google Maps** (F12 → Console).
2. Rode uma busca qualquer para gerar tráfego novo.
3. Inspecione o registro cru do último resultado capturado:

   ```js
   copy(__gmsDebug.lastEntry)
   ```

   Isso copia o array inteiro para a área de transferência — cole num editor de texto para
   navegar (é grande e profundamente aninhado).

4. **Procure o valor que você conhece** (o nome do estabelecimento, o telefone que aparece na
   tela, a nota) dentro do array copiado, e anote o novo caminho de índices.
5. Atualize `FIELD_PATHS` em `src/content/parser.js` com o caminho novo.
6. **Atualize a tabela da seção 4 deste documento** — campo, caminho novo, data de hoje, e uma
   observação dizendo que o índice mudou (não apague a data antiga do histórico da seção 8).
7. Rode `npm test` — se `test/parser.test.js` ainda passar com o índice antigo nas fixtures,
   **atualize as fixtures em `test/fixtures.js`** para refletir a nova posição real, senão o
   teste está validando um formato que não existe mais.

Se o array inteiro parecer ter mudado de estrutura (não só um campo, vários ao mesmo tempo),
suspeite de uma mudança na própria versão do endpoint `/search` — releia a seção 2 antes de
remapear campo por campo.

## 7. Como o canário de esquema se encaixa aqui

`pick(obj, path, fallback)` em `parser.js` garante que um índice quebrado custe **um campo**,
nunca o lead inteiro — mas isso, sozinho, torna a quebra invisível: a coleta continua, os leads
entram na base, e só na hora do disparo alguém percebe que o telefone estava vazio.

`assessSchemaHealth()` (`src/content/schema-health.js`) mede a taxa de preenchimento de
`name`/`phone`/`placeID` a cada lote com 10+ leads novos e aciona um aviso persistente no painel
quando menos de metade vem preenchido — abaixo de metade indica mudança de esquema, não
característica dos negócios daquela busca (nem todo estabelecimento tem telefone cadastrado).

Ver `test/schema-health.test.js` para os limiares exatos.

## 8. Histórico de verificação

| Data | O que mudou |
|---|---|
| 2026-07-29 | Mapa inicial, extraído do código desminificado. Todos os 12 campos de `FIELD_PATHS` conferidos contra `parser.js`. Nenhuma mudança de índice detectada desde a reescrita. |
