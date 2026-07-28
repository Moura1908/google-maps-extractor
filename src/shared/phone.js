'use strict';

/**
 * Normalização de telefone para E.164 e classificação celular/fixo.
 *
 * Sem libphonenumber de propósito: são ~500KB para um caso de uso que é
 * majoritariamente Brasil. As regras do BR estão implementadas de verdade;
 * outros países recebem apenas o código de discagem e ficam como `unknown`.
 * Chutar regra de numeração de país que não se conhece produz número plausível
 * e errado — pior que assumir a ignorância.
 */

/** Códigos de discagem dos países que a extensão sabe prefixar. */
const CALLING_CODES = {
  BR: '55',
  PT: '351',
  US: '1',
  CA: '1',
  MX: '52',
  AR: '54',
  CL: '56',
  CO: '57',
  ES: '34',
  GB: '44',
  FR: '33',
  DE: '49',
  IT: '39',
};

/** ccTLD do Google Maps -> país. Só entra aqui o que é inequívoco. */
const MAPS_TLD_TO_COUNTRY = {
  'com.br': 'BR',
  pt: 'PT',
  'com.mx': 'MX',
  'com.ar': 'AR',
  cl: 'CL',
  'com.co': 'CO',
  es: 'ES',
  'co.uk': 'GB',
  fr: 'FR',
  de: 'DE',
  it: 'IT',
};

/** `www.google.com.br` -> `BR`. Devolve null quando o domínio não diz nada. */
function countryFromMapsHost(host) {
  const clean = String(host || '').toLowerCase();
  for (const [tld, country] of Object.entries(MAPS_TLD_TO_COUNTRY)) {
    if (clean.endsWith(`.google.${tld}`) || clean === `google.${tld}`) return country;
  }
  return null;
}

function onlyDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

/**
 * Classifica um número nacional brasileiro (DDD + assinante).
 *
 * Celular no Brasil tem 9 dígitos e começa com 9; fixo tem 8 e começa entre
 * 2 e 5. Números de 8 dígitos começando em 6-9 são celulares antigos, de antes
 * do nono dígito.
 */
function classifyBrazilNumber(national) {
  if (national.length !== 10 && national.length !== 11) {
    return { type: 'unknown', legacy8: false, valid: false };
  }

  const areaCode = Number(national.slice(0, 2));
  if (areaCode < 11 || areaCode > 99) return { type: 'unknown', legacy8: false, valid: false };

  const subscriber = national.slice(2);
  if (subscriber.length === 9) {
    return { type: subscriber.startsWith('9') ? 'mobile' : 'unknown', legacy8: false, valid: true };
  }

  const firstDigit = Number(subscriber[0]);
  if (firstDigit >= 6) {
    // Celular sem o nono dígito. NÃO inserimos o 9 automaticamente: o número
    // resultante pode não existir, e num disparo isso vira mensagem para
    // um desconhecido. Fica sinalizado para decisão humana.
    return { type: 'mobile', legacy8: true, valid: true };
  }
  if (firstDigit >= 2) return { type: 'landline', legacy8: false, valid: true };
  return { type: 'unknown', legacy8: false, valid: false };
}

/**
 * Converte um telefone como o Maps entrega em E.164 + classificação.
 *
 * @param {string} raw telefone bruto ("(61) 99999-9999", "+55 61 ...")
 * @param {string} defaultCountry código ISO usado quando o número não traz "+"
 * @returns {{e164: string, type: string, country: string, legacy8: boolean}}
 */
function normalizePhone(raw, defaultCountry = 'BR') {
  const empty = { e164: '', type: 'unknown', country: '', legacy8: false };
  const text = String(raw || '').trim();
  if (!text) return empty;

  const hasPlus = text.startsWith('+');
  let digits = onlyDigits(text);
  if (!digits) return empty;

  const country = String(defaultCountry || 'BR').toUpperCase();
  const callingCode = CALLING_CODES[country];

  // Já internacional: o "+" manda, mesmo que discorde do país padrão.
  if (hasPlus) {
    if (digits.startsWith('55')) {
      const national = digits.slice(2);
      const info = classifyBrazilNumber(national);
      if (info.valid) {
        return { e164: `+55${national}`, type: info.type, country: 'BR', legacy8: info.legacy8 };
      }
    }
    // Outros países: preserva o número, sem inventar classificação.
    return { e164: `+${digits}`, type: 'unknown', country: '', legacy8: false };
  }

  if (country === 'BR') {
    // Formas que aparecem em campo: 55DDDNNNNNNNNN, 0DDNNNNNNNNN, DDDNNNNNNNNN.
    if (digits.length > 11 && digits.startsWith('55')) digits = digits.slice(2);
    if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
    if (digits.length === 12 && digits.startsWith('0')) digits = digits.slice(1);

    const info = classifyBrazilNumber(digits);
    if (!info.valid) return { e164: '', type: 'unknown', country: 'BR', legacy8: false };
    return { e164: `+55${digits}`, type: info.type, country: 'BR', legacy8: info.legacy8 };
  }

  // País conhecido só pelo código de discagem: prefixa, mas não classifica.
  if (callingCode) {
    const national = digits.startsWith(callingCode) ? digits.slice(callingCode.length) : digits;
    return { e164: `+${callingCode}${national}`, type: 'unknown', country, legacy8: false };
  }

  // País desconhecido e número sem "+": não há como montar E.164 confiável.
  return { e164: '', type: 'unknown', country: '', legacy8: false };
}

/** Acrescenta ao lead as colunas de telefone normalizado. */
function applyPhoneFields(lead, defaultCountry) {
  const result = normalizePhone(lead.phone, defaultCountry);
  lead.phone_e164 = result.e164;
  lead.phone_type = result.type;
  lead.phone_country = result.country;
  lead.phone_legacy_8digits = result.legacy8;
  return lead;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { normalizePhone, applyPhoneFields, classifyBrazilNumber, countryFromMapsHost, CALLING_CODES };
}
