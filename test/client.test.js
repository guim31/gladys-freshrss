// The FreshRSS client, the model and the configuration, on the answers
// recorded on a real FreshRSS 1.30.4.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConfig, normalizeUrl } from '../src/config.js';
import { parseExternalId } from '../src/devices.js';
import { FreshRssClient, FreshRssError } from '../src/freshrss/client.js';
import {
  categoryKey,
  itemId,
  parseIds,
  scrubUrls,
  summarizeEntry,
  summarizeFeed,
} from '../src/freshrss/model.js';
import { HOST, PASSWORD, USER, createFreshRss, fixture } from './helpers/fakeFreshRss.js';

const client = (server, options = {}) =>
  new FreshRssClient({
    url: HOST,
    username: USER,
    password: PASSWORD,
    fetch: server.fetch,
    ...options,
  });

test('the address: scheme, port, a pasted API address or reading page', () => {
  assert.equal(normalizeUrl('192.0.2.10'), 'http://192.0.2.10');
  assert.equal(normalizeUrl(' 192.0.2.10:8081/ '), 'http://192.0.2.10:8081');
  assert.equal(
    normalizeUrl('https://example.org/FreshRSS/p/api/greader.php'),
    'https://example.org/FreshRSS/p',
  );
  assert.equal(normalizeUrl('https://rss.example.org/i/'), 'https://rss.example.org');
  assert.equal(normalizeUrl('https://rss.example.org/api/'), 'https://rss.example.org');
  assert.equal(normalizeUrl('ftp://rss.example.org'), null);
  assert.equal(normalizeUrl('https://user:pw@rss.example.org'), null);
  assert.equal(normalizeUrl(''), null);
  const config = normalizeConfig({ url: 'nope nope', username: ' alice ', api_password: ' x ' });
  assert.equal(config.urlInvalid, true);
  assert.equal(config.username, 'alice');
  assert.equal(config.password, ' x ', 'a password is kept as typed');
  assert.equal(normalizeConfig({}).language, 'fr');
});

test('entry ids: the long hex form and the decimal form are the same id', () => {
  assert.equal(itemId('tag:google.com,2005:reader/item/00065e8a101e25bb'), '1792796929172923');
  assert.equal(itemId('1792796929172923'), '1792796929172923');
  assert.equal(itemId(1792796929172923), '1792796929172923');
  for (const bad of ['', '0', '-1', 'tag:google.com,2005:reader/item/zz', null, 1.5]) {
    assert.equal(itemId(bad), '', String(bad));
  }
  assert.deepEqual(parseIds('1792796929172923, 1792796929172922'), [
    '1792796929172923',
    '1792796929172922',
  ]);
  assert.equal(parseIds('tag:google.com,2005:reader/item/00065e8a101e25bb'), null);
  assert.equal(parseIds(''), null);
});

test('the recorded entries and feeds become small objects without feed URLs', () => {
  const items = fixture('stream-contents').body.items;
  const zigbee = summarizeEntry(items.find((i) => i.title === 'Zigbee 4.0 is out'));
  assert.deepEqual(zigbee, {
    id: '1792796929172923',
    title: 'Zigbee 4.0 is out',
    url: 'https://tech.example.org/zigbee-4',
    read: true,
    starred: false,
    feedId: 2,
    feed: 'Tech News',
    author: 'Alice',
    published: '2026-10-24T07:00:00.000Z',
    summary: 'Zigbee & friends <b>bold</b>',
  });
  const meteo = summarizeEntry(items.find((i) => i.title.startsWith('Météo')));
  assert.equal(meteo.read, false);
  assert.equal(meteo.summary, '');
  const subscriptions = fixture('subscription-list').body.subscriptions;
  const tech = summarizeFeed(subscriptions.find((s) => s.id === 'feed/2'));
  assert.deepEqual(tech, {
    id: 2,
    title: 'Tech News',
    site: 'https://tech.example.org/',
    category: 'Tech',
  });
  assert.equal(summarizeFeed(subscriptions.find((s) => s.id === 'feed/4')).site, '');
  assert.equal(
    scrubUrls('Get http://feeds.example.org/tech.xml?key=s3cr3t: 404'),
    'Get http://feeds.example.org/tech.xml: 404',
  );
});

test('external ids: user names with an underscore, category keys, feed ids', () => {
  const gladys = { externalId: (rest) => `ext:freshrss:${rest}` };
  assert.deepEqual(parseExternalId(gladys, 'ext:freshrss:account:jean_luc'), {
    kind: 'account',
    user: 'jean_luc',
  });
  const key = categoryKey('Maison & Jardin');
  assert.match(key, /^[0-9a-f]{12}$/);
  assert.deepEqual(parseExternalId(gladys, `ext:freshrss:category:jean_luc_${key}:unread`), {
    kind: 'category',
    user: 'jean_luc',
    key,
  });
  assert.deepEqual(parseExternalId(gladys, 'ext:freshrss:feed:jean_luc_12'), {
    kind: 'feed',
    user: 'jean_luc',
    feedId: 12,
  });
  assert.equal(parseExternalId(gladys, 'ext:freshrss:feed:_12'), null);
  assert.equal(parseExternalId(gladys, 'ext:freshrss:category:alice_Tech'), null);
  assert.equal(parseExternalId(gladys, 'ext:other:feed:alice_12'), null);
});

test('the counters of the recorded answer, by stream', async () => {
  const server = createFreshRss();
  const { counts, stocked } = await client(server).unreadCounts();
  assert.ok(stocked.has('feed/5'), 'a feed whose entries are all read holds entries');
  assert.ok(!stocked.has('feed/4'), 'the feed never fetched holds none');
  assert.equal(counts['user/-/state/com.google/reading-list'], 12);
  assert.equal(counts['feed/1'], 10);
  assert.equal(counts['user/-/label/Tech'], 1);
  const recorded = fixture('unread-count').body.unreadcounts;
  assert.equal(recorded.find((r) => r.id === 'user/-/state/com.google/reading-list').count, 12);
});

test('errors: refused password, disabled API, not FreshRSS, down, too slow', async () => {
  const server = createFreshRss();
  const fail = async (c, kind) => {
    await assert.rejects(c.userInfo(), (err) => err instanceof FreshRssError && err.kind === kind);
  };
  await fail(client(server, { password: 'wrong' }), 'unauthorized');
  await fail(client(server, { username: 'bad name!' }), 'unauthorized');
  server.state.disabled = true;
  await fail(client(server), 'disabled');
  server.state.disabled = false;
  server.state.html = true;
  await fail(client(server), 'invalid');
  server.state.html = false;
  server.goDown();
  await fail(client(server), 'unreachable');
  // Holds the event loop itself: the timer of AbortSignal.timeout does not (Node 22).
  const never = (url, init) =>
    new Promise((resolve, reject) => {
      const hold = setTimeout(() => {}, 5000);
      init.signal.addEventListener('abort', () => {
        clearTimeout(hold);
        reject(init.signal.reason);
      });
    });
  await fail(client({ fetch: never }, { timeout: 20 }), 'timeout');
  // http:// redirected to https://: the POST became a GET without its body.
  const redirected = async () =>
    Object.defineProperties(new Response('Bad Request!', { status: 400 }), {
      redirected: { value: true },
      url: { value: 'https://192.0.2.40/api/greader.php/accounts/ClientLogin' },
    });
  await fail(client({ fetch: redirected }), 'redirect');
});

test('a write sends the action token; a stale token is replaced once', async () => {
  const server = createFreshRss();
  const c = client(server);
  await c.markStreamRead('feed/1');
  assert.equal(server.unread().length, 2);
  c.actionToken = 'stale';
  await c.markEntriesRead(['1792796929172922']);
  assert.equal(server.unread().length, 1);
  assert.deepEqual(
    server.state.requests.filter((r) => r.includes('token') || r.includes('Login')),
    [
      'POST accounts/ClientLogin',
      'GET reader/api/0/token',
      'POST accounts/ClientLogin',
      'GET reader/api/0/token',
    ],
  );
  await assert.rejects(c.markStreamRead('user/-/label/Nope'), { kind: 'rejected' });
});
