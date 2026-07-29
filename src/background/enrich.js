'use strict';

/**
 * Enriquecimento de leads: dado o site da empresa, procura e-mail e perfis
 * sociais. Roda no service worker porque o content script do Maps não pode
 * buscar outros domínios (CORS) — o worker tem host_permissions para isso.
 */

/** ccTLDs de 2 letras: usados para achar o "nome" do domínio em `algo.com.br`. */
const CCTLDS = new Set(
  ('ac ad ae af ag ai al am an ao aq ar as at au aw ax az ba bb bd be bf bg bh bi bj bm bn bo br bs bt bv bw by bz ' +
    'ca cc cd cf cg ch ci ck cl cm cn co cr cu cv cw cx cy cz de dj dk dm do dz ec ee eg eh er es et eu fi fj fk fm ' +
    'fo fr ga gb gd ge gf gg gh gi gl gm gn gp gq gr gs gt gu gw gy hk hm hn hr ht hu id ie il im in io iq ir is it ' +
    'je jm jo jp ke kg kh ki km kn kp kr kw ky kz la lb lc li lk lr ls lt lu lv ly ma mc md me mf mg mh mk ml mm mn ' +
    'mo mp mq mr ms mt mu mv mw mx my mz na nc ne nf ng ni nl no np nr nu nz om pa pe pf pg ph pk pl pm pn pr ps pt ' +
    'pw py qa re ro rs ru rw sa sb sc sd se sg sh si sj sk sl sm sn so sr ss st su sv sx sy sz tc td tf tg th tj tk ' +
    'tl tm tn to tr tt tv tw tz ua ug uk us uy uz va vc ve vg vi vn vu wf ws xk ye yt za zm zw').split(' ')
);

/** Caminhos genéricos demais para valerem como perfil social. */
const BLACKLISTED_PATHS = new Set(
  '/reel /about /tr /privacy /download /pg /settings /vp /profiles'.split(' ')
);

const SOCIAL_MEDIA_PLATFORMS = {
  instagram: /(((http|https):\/\/)?((www\.)?(?:instagram.com|instagr.am)\/([A-Za-z0-9_.]{2,30})))/gi,
  facebook: /(?:https?:)?\/\/(?:www\.)?(?:facebook|fb)\.com\/((?![A-z]+\.php)(?!marketplace|gaming|watch|me|messages|help|search|groups)[A-z0-9_\-\.]+)\/?/gi,
  youtube: /(?:https?:)?\/\/(?:[A-z]+\.)?youtube\.com\/(channel\/([A-z0-9-_]+)|user\/([A-z0-9]+))\/?/gi,
  linkedin: /(?:https?:)?\/\/(?:[\w]+\.)?linkedin\.com\/((company|school)\/[A-z0-9-À-ÿ\.]+|in\/[\w\-_À-ÿ%]+)\/?/gi,
  twitter: /(?:(?:http|https):\/\/)?(?:www.)?(?:twitter\.com|x\.com)\/(?!(oauth|account|tos|privacy|signup|home|hashtag|search|login|widgets|i|settings|start|share|intent|oct)(['"\?\.\/]|$))([A-Za-z0-9_]{1,15})/gim,
  email: /\b[A-Z0-9._%+-]{1,64}@(?!-)(?:[A-Z0-9-]+\.)+[A-Z]{2,63}\b/gi,
};

/** Páginas onde o e-mail costuma estar quando não está na home. */
const CONTACT_PAGE_PATHS =
  '/contact /contact-us /contact-me /about /about-me /about-us /team /our-team /meet-the-team /support /customer-service /feedback /help /sales /return /location /faq'.split(
    ' '
  );

/** Ruído recorrente: arquivos, e-mails de plataforma e endereços de exemplo. */
const EMAIL_BLACKLIST = new Set(
  '.png .jpg .jpeg .gif .webp wixpress.com sentry.io noreply abuse no-reply subscribe mailer-daemon domain.com email.com yourname wix.com'.split(
    ' '
  )
);

const SOCIAL_MEDIA_DOMAINS = new Set(['instagram', 'facebook', 'youtube', 'linkedin', 'twitter']);

const EMPTY_RESULT = () => ({
  instagram: new Set(),
  facebook: new Set(),
  youtube: new Set(),
  linkedin: new Set(),
  twitter: new Set(),
  email: new Set(),
});

function getTimestamp() {
  return `[${new Date().toISOString()}]`;
}

/**
 * Guarda contra SSRF: o campo `website` do lead vem do payload do Google Maps,
 * ou seja, é escrito por um terceiro (o dono do estabelecimento). Sem esta
 * checagem, um valor como `http://192.168.1.1/admin` ou `http://localhost:8080`
 * faria a extensão buscar a rede local do próprio usuário e devolver o
 * conteúdo para os regex de e-mail/redes sociais.
 *
 * Cobre loopback, RFC 1918, link-local e IPv6 loopback por nome/IP literal —
 * não cobre DNS rebinding (domínio público resolvendo para IP privado), que
 * a extensão não tem como verificar sem um proxy próprio.
 */
const BLOCKED_HOSTS = /^(localhost|127\.|10\.|192\.168\.|169\.254\.|\[?::1\]?)/i;
const BLOCKED_172_RANGE = /^172\.(1[6-9]|2\d|3[01])\./;

function isPublicHttpUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch (error) {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;

  const host = parsed.hostname.toLowerCase();
  if (BLOCKED_HOSTS.test(host) || BLOCKED_172_RANGE.test(host)) return false;
  if (host.endsWith('.local') || host.endsWith('.internal')) return false;

  return true;
}

/** Cloudflare troca o e-mail por um hex cifrado com XOR de 1 byte. */
function decodeCloudflareEmail(hex) {
  let decoded = '';
  const key = parseInt(hex.slice(0, 2), 16);
  for (let i = 2; hex.length - i; i += 2) {
    decoded += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16) ^ key);
  }
  return decoded;
}

/** Nome do domínio sem TLD: `loja.com.br` -> `loja`. Usado para priorizar e-mails próprios. */
function getDomainName(url) {
  const parts = new URL(url).host.toLowerCase().split('.');
  if (parts.length >= 3 && CCTLDS.has(parts[parts.length - 1])) return parts[parts.length - 3];
  return parts.length >= 2 ? parts[parts.length - 2] : parts[0];
}

/** Deixa o link social canônico para que a deduplicação funcione. */
function normalizeSocialLink(rawUrl) {
  try {
    let url = rawUrl;
    if (url.startsWith('//')) url = `https:${url}`;
    if (!url.startsWith('http')) url = `https://${url}`;

    const parsed = new URL(url);
    if (parsed.protocol === 'http:' || parsed.protocol === '') parsed.protocol = 'https:';
    if (parsed.host === 'instagram.com') parsed.host = 'www.instagram.com';
    if (parsed.host === 'facebook.com') parsed.host = 'www.facebook.com';
    if (parsed.host === 'yelp.com') parsed.host = 'www.yelp.com';
    if (parsed.host === 'www.twitter.com') parsed.host = 'twitter.com';
    if (parsed.host === 'www.x.com') parsed.host = 'x.com';
    if (parsed.pathname.endsWith('/')) parsed.pathname = parsed.pathname.slice(0, -1);

    return BLACKLISTED_PATHS.has(parsed.pathname) ? '' : parsed.toString();
  } catch (error) {
    console.warn(getTimestamp(), '[gms] link social inválido:', rawUrl, error);
  }
  return '';
}

/** Busca uma URL com timeout — site lento não pode travar a fila inteira. */
async function fetchUrlContent(url, timeoutMs = 10000) {
  if (!isPublicHttpUrl(url)) {
    console.warn(getTimestamp(), '[gms] destino bloqueado (rede local ou esquema inválido):', url);
    return '';
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    console.log(getTimestamp(), '[gms] visitando:', url);
    const response = await fetch(url, { signal: controller.signal, redirect: 'follow' });
    if (!response.ok) {
      console.warn(getTimestamp(), '[gms] resposta ruim:', url, response.status);
      return '';
    }
    return await response.text();
  } catch (error) {
    const reason = error.name === 'AbortError' ? 'timeout' : error.message;
    console.warn(getTimestamp(), '[gms] falha ao buscar', url, reason);
    return '';
  } finally {
    clearTimeout(timer);
  }
}

function isSocialHost(host, platform) {
  if (platform === 'twitter') {
    return (
      host === 'twitter.com' ||
      host === 'www.twitter.com' ||
      host.endsWith('.twitter.com') ||
      host === 'x.com' ||
      host === 'www.x.com' ||
      host.endsWith('.x.com')
    );
  }
  return host === `${platform}.com` || host === `www.${platform}.com` || host.endsWith(`.${platform}.com`);
}

/**
 * Extrai e-mails e perfis sociais de uma página.
 * Com `deepSearch`, também visita as páginas de contato/sobre encontradas.
 */
async function extractContacts(rawUrl, _name, deepSearch) {
  try {
    let url = rawUrl;
    if (url.startsWith('//')) url = `https:${url}`;
    if (!url.startsWith('http')) url = `https://${url}`;

    const html = await fetchUrlContent(url);
    if (!html || typeof html !== 'string' || html.length < 10) {
      console.warn(getTimestamp(), '[gms] página vazia:', url);
      return EMPTY_RESULT();
    }

    // NFKC evita que caracteres "largos" escapem das regex.
    const text = html.normalize('NFKC');
    const found = EMPTY_RESULT();

    for (const platform in SOCIAL_MEDIA_PLATFORMS) {
      const matches = text.match(SOCIAL_MEDIA_PLATFORMS[platform]);
      if (!matches) continue;
      for (const match of matches) {
        if (!match) continue;
        if (platform === 'email') {
          found.email.add(match);
        } else {
          const normalized = normalizeSocialLink(match);
          if (normalized) found[platform].add(normalized);
        }
      }
    }

    let base;
    try {
      base = new URL(url);
    } catch (error) {
      console.warn(getTimestamp(), '[gms] URL inválida:', url, error);
      return found;
    }

    // Varre os <a href> da página: links absolutos servem para achar contato e social.
    const links = [];
    try {
      const cfMatch = text.match(/data-cfemail="([a-f0-9]+)"/i);
      if (cfMatch && cfMatch[1]) found.email.add(decodeCloudflareEmail(cfMatch[1]));

      const hrefPattern = /<a[^>]+href=["']([^"']+)["']/gi;
      let match;
      while ((match = hrefPattern.exec(text)) !== null) {
        try {
          if (match[1]) links.push(new URL(match[1], base).toString());
        } catch (error) {
          /* href relativo inválido: ignora */
        }
      }
    } catch (error) {
      console.warn(getTimestamp(), '[gms] falha ao extrair links:', url, error);
    }

    const contactPages = new Set();
    for (const link of links) {
      try {
        const path = new URL(link).pathname.toLowerCase();
        if (CONTACT_PAGE_PATHS.some((candidate) => path.includes(candidate))) contactPages.add(link);
      } catch (error) {
        /* link inválido: ignora */
      }
    }

    for (const link of links) {
      try {
        const host = new URL(link).host.toLowerCase();
        for (const platform of SOCIAL_MEDIA_DOMAINS) {
          if (!isSocialHost(host, platform)) continue;
          const normalized = normalizeSocialLink(link);
          if (normalized) found[platform].add(normalized);
          break;
        }
      } catch (error) {
        /* link inválido: ignora */
      }
    }

    if (deepSearch && contactPages.size > 0) {
      const pages = [...contactPages];
      const results = [];
      // Lotes de 10 para não abrir dezenas de conexões de uma vez.
      for (let i = 0; i < pages.length; i += 10) {
        const batch = pages.slice(i, i + 10).map((page) => extractContacts(page, '', false));
        results.push(...(await Promise.all(batch)));
      }
      for (const result of results) {
        if (!result) continue;
        for (const field in result) {
          if (result[field] && typeof result[field].forEach === 'function') {
            result[field].forEach((value) => found[field].add(value));
          }
        }
      }
    }

    // E-mail do próprio domínio vale mais que qualquer outro achado na página.
    const allEmails = new Set();
    const ownDomainEmails = new Set();
    let domainName = null;
    try {
      domainName = getDomainName(url);
    } catch (error) {
      console.warn(getTimestamp(), '[gms] domínio ilegível:', url, error);
    }

    found.email.forEach((raw) => {
      const email = raw.replace('u003e', '').toLowerCase();
      if ([...EMAIL_BLACKLIST].some((noise) => email.includes(noise))) return;
      allEmails.add(email);
      if (domainName && email.includes(domainName)) ownDomainEmails.add(email);
    });
    found.email = ownDomainEmails.size > 0 ? ownDomainEmails : allEmails;

    return found;
  } catch (error) {
    console.warn(getTimestamp(), `[gms] erro ao processar ${rawUrl}`, error);
    return EMPTY_RESULT();
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { isPublicHttpUrl, fetchUrlContent, extractContacts, getDomainName, decodeCloudflareEmail };
}
