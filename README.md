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
3. A extensão rola a lista sozinha até o fim dos resultados
4. **Ver e exportar** abre o dashboard, com filtros e download em CSV/XLSX

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
src/content/ingest.js     deduplica, carimba busca/data, normaliza telefone
src/content/scraper.js    rola a lista e enfileira o enriquecimento
        ↓
src/background/enrich.js  busca e-mail e redes sociais no site do lead
```

Vantagem: dados completos e estáveis contra mudança de layout. Desvantagem: os campos são lidos por **posição no array** (`entry[11]` = nome, `entry[178][0][0]` = telefone…). Quando o Google reordena esse array, o campo correspondente vem vazio — e só ele, porque cada leitura é isolada.

### Quando um campo parar de vir

O payload cru do último lote fica exposto no console da aba do Maps:

```js
copy(__gmsDebug.lastEntry)   // registro completo do primeiro resultado
```

Compare com `FIELD_PATHS` em `src/content/parser.js` e corrija o índice.

## Dados extraídos

Nome · Telefone · **Telefone em E.164** · **Tipo (celular/fixo)** · E-mail · Website · Endereço · Categoria · Nota · Nº de avaliações · Instagram · Facebook · LinkedIn · Twitter/X · YouTube · Place ID · CID · Latitude/Longitude · Horário de funcionamento · Termo buscado · Data da extração

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

50 testes cobrindo o parser (contra fixtures do payload), a deduplicação, a normalização de telefone, a base local e a fila de concorrência. As partes que dependem do browser (DOM do Maps, injeção do interceptor) só se verificam carregando a extensão.

## Para onde o projeto vai

`docs/PLANO-DE-EVOLUCAO.md` tem o diagnóstico completo, o roadmap em blocos (com critério de
aceite e esforço por item), as decisões já tomadas e o que foi deliberadamente descartado.
Comece pelo **Bloco 0** — são três correções de segurança que somam ~1h15.

## Limitações conhecidas

- O e-mail é buscado com `fetch` estático: sites que só renderizam por JavaScript não entregam nada.
- O painel depende de classes ofuscadas do Maps (`.w6VYqd`, `.HlvSq`). Há fallback para o painel não sumir, mas a detecção de "fim da lista" pode falhar — nesse caso a coleta para pela trava de rolagem.
- Plus Code, status do negócio e faixa de preço aparecem no payload, mas os índices ainda não foram mapeados (use `__gmsDebug` acima).
- Volume alto de extração pode disparar o CAPTCHA do Google. O intervalo entre rolagens é aleatório justamente para reduzir isso.

## Aviso

Ferramenta para uso legítimo em prospecção B2B. Respeite os Termos de Serviço do Google, a LGPD/GDPR e as regras de consentimento para contato comercial.

## Licença

Ver `LICENSE` (do projeto original).
