// -----------------------------------------------------------------------------
// A fake FreshRSS behind a `fetch` function: it starts from the bodies
// recorded on a real FreshRSS 1.30.4 (test/fixtures/freshrss/1.30.4/), keeps
// its feeds and entries in memory, and answers like the real API: plain-text
// 401 "Unauthorized!", 400 "Bad Request!", 503 "Service Unavailable!" when
// the API is disabled, "OK" to the writes, which need the action token T.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';

export const HOST = 'http://192.0.2.40:8080';
export const USER = 'alice';
export const PASSWORD = 'test-api-password-0123';
export const NOW = Date.parse('2026-10-24T08:00:00.000Z');
const AUTH = `${USER}/0123456789abcdef0123456789abcdef01234567`;
const T = '0123456789abcdef0123456789abcdef01234567ZZZZZZZZZZZZZZZZZ';

export const READ = 'user/-/state/com.google/read';
export const READING_LIST = 'user/-/state/com.google/reading-list';
const LABEL = 'user/-/label/';

export const fixture = (name) =>
  JSON.parse(
    readFileSync(new URL(`../fixtures/freshrss/1.30.4/${name}.json`, import.meta.url), 'utf8'),
  );

export const settle = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

const hexId = (id) =>
  `tag:google.com,2005:reader/item/${BigInt(id).toString(16).padStart(16, '0')}`;
const decId = (item) => BigInt(`0x${item.id.split('/').at(-1)}`).toString();

export function createFreshRss() {
  const state = {
    subscriptions: structuredClone(fixture('subscription-list').body.subscriptions),
    items: structuredClone(fixture('stream-contents').body.items),
    down: false,
    html: false,
    disabled: false,
    logins: 0,
    requests: [],
    clock: 1792797061389826n,
  };
  const answer = (status, body, type = 'text/plain; charset=UTF-8') =>
    new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status,
      headers: { 'content-type': type },
    });
  const json = (body) => answer(200, body, 'application/json; charset=UTF-8');
  const feedOf = (item) => state.subscriptions.find((s) => s.id === item.origin.streamId);
  const labelOf = (item) => feedOf(item)?.categories[0]?.id;
  const isRead = (item) => item.categories.includes(READ);
  const inStream = (stream) => (item) =>
    stream === READING_LIST ||
    item.origin.streamId === stream ||
    (stream.startsWith(LABEL) && labelOf(item) === stream);

  /** A new entry, as FreshRSS stores it after reading a feed. */
  function addEntry({ feedId = 2, title = 'A new article', url, read = false, author } = {}) {
    state.clock += 1000n;
    const feed = state.subscriptions.find((s) => s.id === `feed/${feedId}`);
    const link = url ?? `https://news.example.org/${state.clock}`;
    const item = {
      id: hexId(state.clock),
      crawlTimeMsec: String(state.clock / 1000n),
      timestampUsec: String(state.clock),
      published: Number(state.clock / 1_000_000n) - 3600,
      title,
      canonical: [{ href: link }],
      alternate: [{ href: link }],
      categories: [
        READING_LIST,
        feed.categories[0].id,
        'user/-/state/org.freshrss/main',
        ...(read ? [READ] : []),
      ],
      origin: { streamId: feed.id, htmlUrl: feed.htmlUrl, title: feed.title },
      summary: { content: `<p>Summary of <b>${title}</b> &amp; more.</p>` },
      ...(author ? { author } : {}),
    };
    state.items.unshift(item);
    return { ...item, decimal: String(state.clock) };
  }

  function addFeed({ title = 'New Feed', category = 'Tech' } = {}) {
    const id = Math.max(...state.subscriptions.map((s) => Number(s.id.slice(5)))) + 1;
    const feed = {
      id: `feed/${id}`,
      title,
      categories: [{ id: `${LABEL}${category}`, label: category }],
      url: `https://feeds.example.org/${id}.xml`,
      htmlUrl: `https://site${id}.example.org/`,
      iconUrl: '',
      'frss:priority': 'main',
    };
    state.subscriptions.push(feed);
    return id;
  }

  const unreadCounts = () => {
    const counts = new Map();
    const add = (id, n) => counts.set(id, (counts.get(id) ?? 0) + n);
    for (const feed of state.subscriptions) {
      add(feed.id, 0);
      add(feed.categories[0].id, 0);
    }
    const newest = new Map();
    for (const item of state.items) {
      for (const id of [item.origin.streamId, labelOf(item), READING_LIST]) {
        if (BigInt(decId(item)) > BigInt(newest.get(id) ?? 0)) {
          newest.set(id, decId(item));
        }
      }
    }
    for (const item of state.items.filter((i) => !isRead(i))) {
      add(item.origin.streamId, 1);
      add(labelOf(item), 1);
      add(READING_LIST, 1);
    }
    add(READING_LIST, 0);
    return {
      max: counts.get(READING_LIST),
      unreadcounts: [...counts].map(([id, count]) => ({
        id,
        count,
        newestItemTimestampUsec: newest.get(id) ?? '0',
      })),
    };
  };

  const markRead = (item) => {
    if (!isRead(item)) {
      item.categories.push(READ);
    }
  };

  async function fetch(url, init = {}) {
    const parsed = new URL(url);
    const method = init.method ?? 'GET';
    const path = decodeURIComponent(parsed.pathname.replace(/^.*\/api\/greader\.php\//, ''));
    const form = new URLSearchParams(init.body ?? '');
    state.requests.push(`${method} ${path}`);
    if (state.down) {
      throw new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } });
    }
    if (state.html) {
      return answer(200, '<html>Login</html>', 'text/html');
    }
    if (state.disabled) {
      return answer(503, 'Service Unavailable!');
    }
    if (path === 'accounts/ClientLogin' && method === 'POST') {
      if (!/^[0-9a-zA-Z_][0-9a-zA-Z_.@-]{1,38}$/.test(form.get('Email') ?? '')) {
        return answer(400, 'Bad Request!');
      }
      if (form.get('Email') !== USER || form.get('Passwd') !== PASSWORD) {
        return answer(401, 'Unauthorized!');
      }
      state.logins += 1;
      return answer(200, `SID=${AUTH}\nLSID=null\nAuth=${AUTH}\n`);
    }
    if (init.headers?.Authorization !== `GoogleLogin auth=${AUTH}`) {
      return answer(401, 'Unauthorized!');
    }
    const q = parsed.searchParams;
    if (method === 'GET' && path === 'reader/api/0/user-info') {
      return answer(200, JSON.stringify(fixture('user-info').body), 'text/html; charset=UTF-8');
    }
    if (method === 'GET' && path === 'reader/api/0/subscription/list') {
      return json({ subscriptions: state.subscriptions });
    }
    if (method === 'GET' && path === 'reader/api/0/unread-count') {
      return json(unreadCounts());
    }
    if (method === 'GET' && path === 'reader/api/0/token') {
      return answer(200, `${T}\n`, 'text/html; charset=UTF-8');
    }
    const unreadOnly = q.get('xt') === READ;
    const count = Number(q.get('n') ?? 20);
    if (method === 'GET' && path === 'reader/api/0/stream/items/ids') {
      const list = state.items
        .filter(inStream(q.get('s')))
        .filter((i) => !unreadOnly || !isRead(i));
      const body = { itemRefs: list.slice(0, count).map((i) => ({ id: decId(i) })) };
      if (list.length > count) {
        body.continuation = decId(list[count - 1]);
      }
      return answer(200, JSON.stringify(body), 'text/html; charset=UTF-8');
    }
    const contents = path.match(/^reader\/api\/0\/stream\/contents\/(.+)$/);
    if (method === 'GET' && contents) {
      const list = state.items
        .filter(inStream(contents[1]))
        .filter((i) => !unreadOnly || !isRead(i));
      return json({ id: READING_LIST, updated: 0, items: list.slice(0, count) });
    }
    if (method === 'POST' && path === 'reader/api/0/stream/items/contents') {
      const ids = form.getAll('i');
      return json({ id: READING_LIST, items: state.items.filter((i) => ids.includes(decId(i))) });
    }
    if (
      method === 'POST' &&
      ['reader/api/0/edit-tag', 'reader/api/0/mark-all-as-read'].includes(path)
    ) {
      if (form.get('T') !== T) {
        return answer(401, 'Unauthorized!');
      }
      if (path.endsWith('edit-tag')) {
        const ids = form.getAll('i');
        if (form.get('a') === READ) {
          state.items.filter((i) => ids.includes(decId(i))).forEach(markRead);
        }
        return answer(200, 'OK', 'text/html; charset=UTF-8');
      }
      const stream = form.get('s') ?? '';
      if (
        stream.startsWith(LABEL) &&
        !state.subscriptions.some((s) => s.categories[0].id === stream)
      ) {
        return answer(400, 'Bad Request!');
      }
      state.items.filter(inStream(stream)).forEach(markRead);
      return answer(200, 'OK', 'text/html; charset=UTF-8');
    }
    return answer(400, 'Bad Request!');
  }

  return {
    state,
    fetch,
    addEntry,
    addFeed,
    unread: () => state.items.filter((i) => !isRead(i)).map((i) => i.title),
    goDown() {
      state.down = true;
    },
    goUp() {
      state.down = false;
    },
  };
}
