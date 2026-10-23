// -----------------------------------------------------------------------------
// Integration configuration: defaults (they mirror the `default` values of the
// manifest `config_schema`, see test/manifest.test.js) and normalization, so
// the rest of the code never deals with strings, blanks or `undefined`.
// -----------------------------------------------------------------------------

export const LANGUAGES = ['en', 'fr', 'de', 'es'];

export const REFRESH_MINUTES = ['1', '5', '15', '30', '60'];

export const DEFAULT_CONFIG = {
  url: '',
  username: '',
  api_password: '',
  refresh_minutes: '5',
  keywords: '',
  language: 'fr',
};

// Keywords beyond that are ignored (one event carries one keyword anyway).
export const MAX_KEYWORDS = 20;

/**
 * Turn what the user typed into the base URL of FreshRSS:
 * - `192.0.2.10` or `freshrss.local` (no scheme): http, port 80 (the port of
 *   the official image);
 * - `192.0.2.10:8081`: that port;
 * - `https://example.org/freshrss/`: exactly that address (reverse proxy).
 * The API address FreshRSS shows in Profile → API management
 * (`…/api/greader.php`) is accepted as is, and so is a pasted `/i/` (the
 * reading page). Returns null when it is not usable.
 * @param {unknown} raw
 * @returns {string | null}
 */
export function normalizeUrl(raw) {
  if (typeof raw !== 'string') {
    return null;
  }
  const text = raw.trim();
  if (text === '') {
    return null;
  }
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text);
  let url;
  try {
    url = new URL(hasScheme ? text : `http://${text}`);
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.hostname === '') {
    return null;
  }
  if (url.username || url.password || url.search || url.hash) {
    // Credentials in the URL would end up in logs and error messages.
    return null;
  }
  const path = url.pathname
    .replace(/\/+$/, '')
    .replace(/\/(api\/(greader|fever)\.php|api|i)$/i, '')
    .replace(/\/+$/, '');
  return `${url.protocol}//${url.host}${path}`;
}

/** "Gladys, Home Assistant ;zigbee" -> ['Gladys', 'Home Assistant', 'zigbee']. */
export function parseKeywords(raw) {
  if (typeof raw !== 'string') {
    return [];
  }
  const seen = new Set();
  const keywords = [];
  for (const part of raw.split(/[,;\n]/)) {
    const keyword = part.trim().slice(0, 100);
    if (keyword !== '' && !seen.has(keyword.toLowerCase())) {
      seen.add(keyword.toLowerCase());
      keywords.push(keyword);
    }
  }
  return keywords.slice(0, MAX_KEYWORDS);
}

const text = (value) => (typeof value === 'string' ? value.trim() : '');

/**
 * @param {Record<string, unknown>} raw the configuration returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const typed = text(source.url);
  const url = normalizeUrl(typed);
  const refresh = String(source.refresh_minutes ?? '');
  return {
    url,
    urlInvalid: typed !== '' && url === null,
    username: text(source.username),
    password: typeof source.api_password === 'string' ? source.api_password : '',
    refreshMinutes: Number(
      REFRESH_MINUTES.includes(refresh) ? refresh : DEFAULT_CONFIG.refresh_minutes,
    ),
    keywords: parseKeywords(source.keywords),
    language: LANGUAGES.includes(source.language) ? source.language : DEFAULT_CONFIG.language,
  };
}
