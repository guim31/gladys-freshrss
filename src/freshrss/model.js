// -----------------------------------------------------------------------------
// FreshRSS answers -> the small, bounded objects the rest of the code uses.
// Pure functions. Nothing here keeps a feed URL: it may carry a private token
// (`?key=...`).
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';

export const READ_TAG = 'user/-/state/com.google/read';
export const STARRED_TAG = 'user/-/state/com.google/starred';

const str = (value, max = 1000) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** The text of an HTML fragment: tags dropped, common entities decoded, spaces folded. */
export function plainText(html, max = 2000) {
  if (typeof html !== 'string') {
    return '';
  }
  return html
    .slice(0, 50_000)
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (all, code) => {
      if (code[0] === '#') {
        const n =
          code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : Number(code.slice(1));
        return Number.isInteger(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ' ';
      }
      return ENTITIES[code.toLowerCase()] ?? all;
    })
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

/** A text with its web addresses cut to scheme, host and path (a query may hold a token). */
export const scrubUrls = (text) =>
  text.replace(/\bhttps?:\/\/[^\s"'<>]+/gi, (url) => {
    const tail = url.match(/[).,;:]*$/)[0];
    return (siteOf(url.slice(0, url.length - tail.length)) || 'URL') + tail;
  });

/** The site address of a feed, without query string (it may hold a token). */
export function siteOf(url) {
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return '';
    }
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}`.slice(0, 1000);
  } catch {
    return '';
  }
}

const LABEL = 'user/-/label/';
const ITEM_PREFIX = 'tag:google.com,2005:reader/item/';

/**
 * An entry id in its decimal form, from the decimal or the long form
 * (`tag:google.com,2005:reader/item/<16 hex digits>`); '' when it is neither.
 */
export function itemId(raw) {
  if (typeof raw === 'number' && Number.isSafeInteger(raw) && raw > 0) {
    return String(raw);
  }
  if (typeof raw !== 'string') {
    return '';
  }
  const text = raw.trim();
  if (/^[1-9]\d{0,18}$/.test(text)) {
    return text;
  }
  const hex = text.startsWith(ITEM_PREFIX) ? text.slice(ITEM_PREFIX.length) : '';
  return /^[0-9a-f]{1,16}$/i.test(hex) && /[1-9a-f]/i.test(hex)
    ? BigInt(`0x${hex}`).toString()
    : '';
}

/** `feed/12` -> 12, or null. */
export function feedIdOf(streamId) {
  const match = typeof streamId === 'string' ? streamId.match(/^feed\/(\d{1,15})$/) : null;
  return match ? Number(match[1]) : null;
}

/** The stream of a category, from its name. */
export const labelStream = (name) => `${LABEL}${name}`;

/** A stable short key for a category, which FreshRSS knows by its name only. */
export const categoryKey = (name) => createHash('sha256').update(name).digest('hex').slice(0, 12);

const href = (list) => {
  const url = Array.isArray(list) ? list.find((link) => typeof link?.href === 'string')?.href : '';
  return /^https?:\/\//i.test(url ?? '') ? str(url, 2000) : '';
};

/**
 * @param {object} raw an item of `stream/contents` or `stream/items/contents`
 */
export function summarizeEntry(raw) {
  const tags = Array.isArray(raw?.categories) ? raw.categories : [];
  const published = Number(raw?.published);
  const url = href(raw?.canonical) || href(raw?.alternate);
  return {
    id: itemId(raw?.id),
    title: str(raw?.title) || url || '…',
    url,
    read: tags.includes(READ_TAG),
    starred: tags.includes(STARRED_TAG),
    feedId: feedIdOf(raw?.origin?.streamId),
    feed: str(raw?.origin?.title, 200),
    author: str(raw?.author, 200),
    published:
      Number.isFinite(published) && published > 0 ? new Date(published * 1000).toISOString() : '',
    summary: plainText(raw?.summary?.content ?? raw?.content?.content, 1000),
  };
}

/**
 * @param {object} raw a subscription of `subscription/list`
 */
export function summarizeFeed(raw) {
  const id = feedIdOf(raw?.id);
  const label = Array.isArray(raw?.categories)
    ? raw.categories.find((c) => typeof c?.id === 'string' && c.id.startsWith(LABEL))
    : undefined;
  const category = label ? str(label.label, 200) || label.id.slice(LABEL.length) : '';
  return {
    id,
    title: str(raw?.title, 200) || siteOf(raw?.htmlUrl) || String(id),
    site: siteOf(raw?.htmlUrl),
    category,
  };
}

/** The first keyword found in a title (case and accents ignored), or ''. */
export function matchKeyword(title, keywords) {
  const fold = (text) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  const haystack = fold(title);
  return keywords.find((keyword) => haystack.includes(fold(keyword))) ?? '';
}

/**
 * Entry ids typed in a scene ("1792796929172923", "a, b", the variable of the
 * trigger), in decimal: the long form holds a comma.
 */
export function parseIds(raw) {
  const text = typeof raw === 'number' ? String(raw) : typeof raw === 'string' ? raw : '';
  const ids = text
    .split(/[\s,;]+/)
    .filter(Boolean)
    .map((id) => (/^\d+$/.test(id) ? itemId(id) : ''));
  if (ids.length === 0 || ids.some((id) => id === '')) {
    return null;
  }
  return [...new Set(ids)].slice(0, 100);
}
