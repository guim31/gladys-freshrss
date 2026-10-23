// The hub against the SDK's fake Gladys and a fake FreshRSS built on real
// FreshRSS 1.30.4 answers: devices and states, the trigger, the scene
// actions, the widget and the connection status.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { MemoryStore } from '../src/store.js';
import { HOST, PASSWORD, USER, createFreshRss } from './helpers/fakeFreshRss.js';
import {
  CONFIG,
  accountDevice,
  accountFeature,
  categoryDevice,
  createAll,
  createWorld,
  feedDevice,
} from './helpers/world.js';

const TECH = 2;
const JOURNAL = 3;
const events = (fake) => fake.sceneEvents.filter((e) => e.key === 'new_entry');
const unread = (device) => `${device}:unread`;

test('one FreshRSS device, one per category and per feed, states once added', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const devices = world.fake.discoveredDevices;
  assert.deepEqual(
    devices.map((d) => [d.external_id, d.name]),
    [
      [accountDevice, 'FreshRSS'],
      [categoryDevice('Actualités'), 'Actualités'],
      [categoryDevice('Maison & Jardin'), 'Maison & Jardin'],
      [categoryDevice('Tech'), 'Tech'],
      [categoryDevice('Uncategorized'), 'Uncategorized'],
      [feedDevice(4), 'Broken'],
      [feedDevice(3), 'Le Journal'],
      [feedDevice(5), 'Maison ＆ Jardin'],
      [feedDevice(2), 'Tech News'],
      [feedDevice(1), 'FreshRSS releases'],
    ],
  );
  assert.deepEqual(
    devices[0].features.map((f) => f.name),
    ['Articles non lus', 'FreshRSS joignable'],
  );
  assert.ok(
    !JSON.stringify(devices).includes('s3cr3t'),
    'no feed URL (it may hold a token) in the devices',
  );
  assert.equal(world.fake.lastState(accountFeature('unread')), undefined, 'nothing before adding');
  await createAll(world.fake);
  assert.equal(world.fake.lastState(accountFeature('unread')), 12);
  assert.equal(world.fake.lastState(accountFeature('online')), 1);
  assert.equal(world.fake.lastState(unread(categoryDevice('Tech'))), 1);
  assert.equal(world.fake.lastState(unread(categoryDevice('Uncategorized'))), 10);
  assert.equal(world.fake.lastState(unread(categoryDevice('Maison & Jardin'))), 0);
  assert.equal(world.fake.lastState(unread(feedDevice(JOURNAL))), 1);
  assert.equal(world.fake.lastState(unread(feedDevice(4))), 0);
  assert.equal((await world.fake.poll(devices[0])).success, true);
});

test('the counters follow FreshRSS at each read; online drops while it is down', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await createAll(world.fake);
  world.server.addEntry({ feedId: TECH });
  await world.hub.refresh();
  assert.equal(world.fake.lastState(accountFeature('unread')), 13);
  assert.equal(world.fake.lastState(unread(feedDevice(TECH))), 2);
  assert.equal(world.fake.lastState(unread(categoryDevice('Tech'))), 2);
  world.server.goDown();
  await world.hub.refresh();
  assert.equal(world.fake.lastState(accountFeature('online')), 0);
  assert.equal(world.fake.lastState(accountFeature('unread')), 13, 'the last value is kept');
  world.server.goUp();
  await world.hub.refresh();
  assert.equal(world.fake.lastState(accountFeature('online')), 1);
});

test('new articles: nothing at the first read, then one event per unread article', async (t) => {
  const world = await createWorld({ config: { ...CONFIG, keywords: 'zigbee, Météo' } });
  t.after(() => world.app.stop());
  assert.equal(world.fake.sceneEvents.length, 0, 'the first read is a baseline');
  const zigbee = world.server.addEntry({
    feedId: TECH,
    title: 'ZigBee 4.0 is here',
    url: 'https://blog.example.org/z',
    author: 'Alice',
  });
  world.server.addEntry({ feedId: JOURNAL, title: 'Meteo of the week' });
  world.server.addEntry({ feedId: JOURNAL, title: 'Read elsewhere already', read: true });
  await world.hub.refresh();
  const fired = events(world.fake);
  assert.equal(fired.length, 2);
  assert.deepEqual(fired[0].data, {
    category: categoryDevice('Tech'),
    feed: feedDevice(TECH),
    keyword: 'zigbee',
    title: 'ZigBee 4.0 is here',
    url: 'https://blog.example.org/z',
    feed_name: 'Tech News',
    category_name: 'Tech',
    author: 'Alice',
    published: fired[0].data.published,
    entry_id: Number(zigbee.decimal),
  });
  assert.match(fired[0].data.published, /^2026-10-2\dT/);
  assert.equal(fired[1].data.keyword, 'Météo', 'case and accents ignored');
  assert.equal(fired[1].data.category, categoryDevice('Actualités'));
  await world.hub.refresh();
  assert.equal(events(world.fake).length, 2, 'never twice');
});

test('the backlog of a feed added since the previous read is not announced', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const feed = world.server.addFeed({ title: 'Brand new', category: 'Tech' });
  for (let i = 0; i < 5; i += 1) {
    world.server.addEntry({ feedId: feed, title: `Old ${i}` });
  }
  await world.hub.refresh();
  assert.equal(events(world.fake).length, 0);
  world.server.addEntry({ feedId: feed, title: 'Really new' });
  await world.hub.refresh();
  assert.deepEqual(
    events(world.fake).map((e) => e.data.title),
    ['Really new'],
  );
});

test('the first batch of a feed added empty is its backlog, not news', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const feed = world.server.addFeed({ title: 'Fetched later' });
  await world.hub.refresh();
  for (let i = 0; i < 4; i += 1) {
    world.server.addEntry({ feedId: feed, title: `Backlog ${i}` });
  }
  world.server.addEntry({ feedId: 4, title: 'Broken works again' });
  await world.hub.refresh();
  assert.equal(events(world.fake).length, 0);
  world.server.addEntry({ feedId: feed, title: 'Really new' });
  await world.hub.refresh();
  assert.deepEqual(
    events(world.fake).map((e) => e.data.title),
    ['Really new'],
  );
});

test('a burst announces the ten newest; past a page, the rest is recorded as seen', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  for (let i = 0; i < 15; i += 1) {
    world.server.addEntry({ title: `Entry ${i}` });
  }
  await world.hub.refresh();
  const fired = events(world.fake);
  assert.equal(fired.length, 10);
  assert.equal(fired[0].data.title, 'Entry 5');
  assert.equal(fired[9].data.title, 'Entry 14');
  for (let i = 0; i < 70; i += 1) {
    world.server.addEntry({ title: `Import ${i}` });
  }
  await world.hub.refresh();
  assert.equal(events(world.fake).length, 20);
  assert.equal(events(world.fake).at(-1).data.title, 'Import 69');
  await world.hub.refresh();
  assert.equal(events(world.fake).length, 20);
});

test('an event Gladys did not take is fired again at the next read', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const publish = world.gladys.publishSceneEvent.bind(world.gladys);
  let down = true;
  world.gladys.publishSceneEvent = async (...args) => {
    if (down) {
      throw Object.assign(new Error('Gladys restarting'), { status: 503 });
    }
    return publish(...args);
  };
  world.server.addEntry({ title: 'First' });
  world.server.addEntry({ title: 'Second' });
  await world.hub.refresh();
  assert.equal(world.fake.sceneEvents.length, 0);
  down = false;
  await world.hub.refresh();
  assert.deepEqual(
    events(world.fake).map((e) => e.data.title),
    ['First', 'Second'],
  );
});

test('a refused event does not turn the backlog of a new feed into news', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const publish = world.gladys.publishSceneEvent.bind(world.gladys);
  let down = true;
  world.gladys.publishSceneEvent = async (...args) => {
    if (down) {
      throw Object.assign(new Error('Gladys restarting'), { status: 503 });
    }
    return publish(...args);
  };
  world.server.addEntry({ title: 'Real news' });
  const feed = world.server.addFeed({ title: 'Brand new' });
  world.server.addEntry({ feedId: feed, title: 'Backlog' });
  await world.hub.refresh();
  down = false;
  await world.hub.refresh();
  assert.deepEqual(
    events(world.fake).map((e) => e.data.title),
    ['Real news'],
  );
});

test('what was seen survives a restart; another server is a new baseline', async (t) => {
  const store = new MemoryStore();
  const server = createFreshRss();
  const first = await createWorld({ server, store });
  await first.app.stop();
  assert.equal(store.data.user, USER);
  assert.equal(store.data.server, HOST);
  assert.equal(store.data.lastId, '1792797061389826');
  assert.deepEqual(store.data.feeds, [3, 5, 2, 1], 'the empty feed 4 is not known yet');
  server.addEntry({ title: 'While stopped' });
  const second = await createWorld({ server, store });
  assert.deepEqual(
    events(second.fake).map((e) => e.data.title),
    ['While stopped'],
  );
  await second.app.stop();
  server.addEntry({ title: 'On the other server' });
  const third = await createWorld({
    server,
    store,
    config: { ...CONFIG, url: 'http://192.0.2.41' },
  });
  t.after(() => third.app.stop());
  assert.equal(third.fake.sceneEvents.length, 0);
});

test('mark a category, a feed, or everything with the FreshRSS device, as read', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await createAll(world.fake);
  let ack = await world.fake.sceneAction('mark_all_read', { source: categoryDevice('Tech') });
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(ack.data.outputs, { count: 1, name: 'Tech' });
  assert.equal(world.fake.lastState(accountFeature('unread')), 11, 'read again at once');
  ack = await world.fake.sceneAction('mark_all_read', { source: feedDevice(JOURNAL) });
  assert.deepEqual(ack.data.outputs, { count: 1, name: 'Le Journal' });
  assert.equal(world.fake.lastState(unread(categoryDevice('Actualités'))), 0);
  ack = await world.fake.sceneAction('mark_all_read', { source: accountDevice });
  assert.deepEqual(ack.data.outputs, { count: 10, name: '' });
  assert.equal(world.fake.lastState(accountFeature('unread')), 0);
  // A category renamed in FreshRSS since the last read: 400 Bad Request.
  world.server.state.subscriptions.find((s) => s.id === 'feed/2').categories = [
    { id: 'user/-/label/Technique', label: 'Technique' },
  ];
  ack = await world.fake.sceneAction('mark_all_read', { source: categoryDevice('Tech') });
  assert.equal(ack.success, false);
  assert.match(ack.error, /n'existe plus/);
  ack = await world.fake.sceneAction('mark_all_read', { source: 'ext:other:thing' });
  assert.equal(ack.success, false);
});

test('mark articles as read: the id of a trigger, or a list', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const one = world.server.addEntry({ title: 'One' });
  const two = world.server.addEntry({ title: 'Two' });
  await world.hub.refresh();
  const id = events(world.fake)[0].data.entry_id;
  let ack = await world.fake.sceneAction('mark_entries_read', { entry_ids: id });
  assert.deepEqual(ack.data.outputs, { count: 1 });
  ack = await world.fake.sceneAction('mark_entries_read', {
    entry_ids: `${two.decimal}, ${one.decimal} ;${two.decimal}`,
  });
  assert.deepEqual(ack.data.outputs, { count: 2 }, 'deduplicated');
  assert.ok(!world.server.unread().includes('Two'));
  ack = await world.fake.sceneAction('mark_entries_read', { entry_ids: 'twelve' });
  assert.equal(ack.success, false);
  assert.match(ack.error, /identifiants/);
});

test('read the unread titles, of everything or one source, and mark them as read', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  let ack = await world.fake.sceneAction('read_unread', { count: '3' });
  assert.equal(ack.data.outputs.count, 3);
  assert.equal(ack.data.outputs.unread, 12);
  assert.equal(
    ack.data.outputs.titles,
    [
      'Météo : orages — Le Journal',
      'Gladys 5.2 released — Tech News',
      'FreshRSS 1.30.4 — FreshRSS releases',
    ].join('\n'),
  );
  assert.equal(ack.data.outputs.latest_url, 'http://journal.example.org/orages');
  ack = await world.fake.sceneAction('read_unread', {
    source: categoryDevice('Tech'),
    mark_read: true,
  });
  assert.equal(ack.data.outputs.count, 1);
  assert.equal(ack.data.outputs.latest_title, 'Gladys 5.2 released');
  ack = await world.fake.sceneAction('read_unread', { source: feedDevice(TECH) });
  assert.equal(ack.data.outputs.count, 0);
  assert.equal(ack.data.outputs.titles, '');
});

test('the widget: count, the newest unread articles, two buttons', async (t) => {
  const world = await createWorld({ config: { ...CONFIG, url: 'https://rss.example.org' } });
  t.after(() => world.app.stop());
  let content = (await world.fake.widgetGet('unread', { language: 'fr', settings: {} })).data
    .content;
  assert.deepEqual(validateWidgetContent(content).errors ?? [], []);
  const [count, list, refresh, read] = content.components;
  assert.deepEqual([count.label, count.value], ['Articles non lus', 12]);
  assert.equal(list.items.length, 6);
  assert.equal(list.items[1].title, 'Gladys 5.2 released');
  assert.match(list.items[1].subtitle, /^Tech News · 23 oct/);
  assert.equal(list.items[1].description, 'Hello world');
  // An http article link is left out; the link to FreshRSS is https.
  assert.deepEqual(
    list.items[0].links.map((l) => l.url),
    ['https://rss.example.org/i/?get=f_3'],
  );
  assert.equal(list.items[1].links[0].url, 'https://tech.example.org/gladys-52');
  assert.equal(refresh.action.key, 'refresh');
  assert.equal(read.action.key, 'mark_read');
  assert.equal(read.action.confirm, true);
  assert.equal(read.action.params.entry_ids.split(',').length, 6);

  content = (
    await world.fake.widgetGet('unread', {
      language: 'en',
      settings: { source: categoryDevice('Actualités') },
    })
  ).data.content;
  assert.deepEqual([content.components[0].label, content.components[0].value], ['Actualités', 1]);

  // An article arrives after the widget was drawn: the tap leaves it unread.
  world.server.addEntry({ feedId: JOURNAL, title: 'Not seen yet' });
  const button = content.components.find((c) => c.action?.key === 'mark_read');
  const ack = await world.fake.widgetAction('unread', 'mark_read', button.action.params, {
    settings: { source: categoryDevice('Actualités') },
  });
  assert.equal(ack.success, true, ack.error);
  assert.ok(world.server.unread().includes('Not seen yet'));
  assert.ok(!world.server.unread().includes('Météo : orages'));
  const again = await world.fake.widgetAction('unread', 'refresh', {}, { settings: {} });
  assert.equal(again.success, true, again.error);
  assert.equal(world.hub.counters.unread, 12);
});

test('the widget Mark as read without the listed ids marks nothing', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const ack = await world.fake.widgetAction('unread', 'mark_read', {}, { settings: {} });
  assert.equal(ack.success, false);
  assert.equal(world.server.unread().length, 12);
});

test('connection status: missing settings, refused password, API disabled, down, not FreshRSS', async (t) => {
  const world = await createWorld({ config: {} });
  t.after(() => world.app.stop());
  assert.match(world.fake.connectionStatus.message.en, /Enter the address/);
  await world.fake.configUpdated({ ...CONFIG, url: 'ftp://nope' });
  assert.match(world.fake.connectionStatus.message.en, /not valid/);
  await world.fake.configUpdated({ url: HOST, api_password: PASSWORD });
  assert.match(world.fake.connectionStatus.message.en, /user name/);
  await world.fake.configUpdated({ url: HOST, username: USER });
  assert.match(world.fake.connectionStatus.message.en, /API password/);
  await world.fake.configUpdated({ ...CONFIG, api_password: 'wrong' });
  assert.equal(world.fake.connectionStatus.connected, false);
  assert.match(world.fake.connectionStatus.message.fr, /a refusé/);
  await world.fake.configUpdated({ ...CONFIG, username: 'bad name!' });
  assert.match(world.fake.connectionStatus.message.fr, /a refusé/);
  await world.fake.configUpdated(CONFIG);
  assert.equal(world.fake.connectionStatus.connected, true);
  world.server.state.disabled = true;
  await world.hub.refresh();
  assert.match(world.fake.connectionStatus.message.en, /API of FreshRSS is disabled/);
  world.server.state.disabled = false;
  world.server.goDown();
  await world.hub.refresh();
  assert.match(world.fake.connectionStatus.message.en, /does not answer/);
  const widget = (await world.fake.widgetGet('unread', { settings: {} })).data.content;
  assert.ok(widget.components.some((c) => /does not answer/.test(c.text ?? '')));
  const tap = await world.fake.widgetAction('unread', 'refresh', {}, { settings: {} });
  assert.equal(tap.success, false);
  world.server.goUp();
  await world.hub.refresh();
  assert.equal(world.fake.connectionStatus.connected, true);
  world.server.state.html = true;
  await world.hub.refresh();
  assert.match(world.fake.connectionStatus.message.en, /does not answer like FreshRSS/);
});

test('the login is done once, and again when FreshRSS refuses the token', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await world.hub.refresh();
  await world.fake.sceneAction('mark_all_read', { source: feedDevice(TECH) });
  assert.equal(world.server.state.logins, 1);
  // The API password changed and changed back: the old token is refused once.
  world.hub.client.auth = `${USER}/stale`;
  world.hub.client.actionToken = 'stale';
  const ack = await world.fake.sceneAction('mark_all_read', { source: feedDevice(JOURNAL) });
  assert.equal(ack.success, true, ack.error);
  assert.equal(world.server.state.logins, 2);
});

test('test_connection: who and how many', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const ack = await world.fake.action('test_connection');
  assert.equal(
    ack.data.message.fr,
    'Connecté à FreshRSS en tant que alice : 12 article(s) non lu(s), 5 flux dans 4 catégorie(s).',
  );
});

test('a new language renames the features at the next discovery', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await world.fake.configUpdated({ ...CONFIG, language: 'de' });
  assert.deepEqual(
    world.fake.discoveredDevices[0].features.map((f) => f.name),
    ['Ungelesene Artikel', 'FreshRSS erreichbar'],
  );
});
