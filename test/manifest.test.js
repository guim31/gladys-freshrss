// -----------------------------------------------------------------------------
// Consistency checks between `gladys-assistant-integration.json` and the code.
// The manifest is validated by the store indexer, but nothing there can know
// which handlers the code actually registers — these tests keep both in sync.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DEFAULT_CONFIG, LANGUAGES, REFRESH_MINUTES } from '../src/config.js';
import { TRIGGERS, WIDGET_KEY } from '../src/hub.js';
import { SCENE_ACTIONS } from '../src/scenes.js';
import { WIDGETS } from '../src/widgets.js';
import { CONFIG, categoryDevice, createWorld, feedDevice } from './helpers/world.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

const allFields = [
  ...(manifest.config_schema ?? []),
  ...[
    ...(manifest.actions ?? []),
    ...(manifest.scene_triggers ?? []),
    ...(manifest.scene_actions ?? []),
  ].flatMap((item) => item.fields ?? []),
  ...(manifest.widgets ?? []).flatMap((widget) => widget.settings ?? []),
];
const keysOf = (list) => (list ?? []).map((entry) => entry.key);
const field = (key) => manifest.config_schema.find((f) => f.key === key);

test('identity: name, image, local and cloud transports, services category', () => {
  assert.equal(manifest.name, 'FreshRSS');
  assert.equal(manifest.type, 'device');
  assert.match(manifest.docker_image, /^ghcr\.io\/guim31\/gladys-freshrss:/);
  assert.equal(
    manifest.cover_image,
    'https://raw.githubusercontent.com/guim31/gladys-freshrss/main/cover.png',
  );
  // FreshRSS is self-hosted, at home or on a public server.
  assert.deepEqual(manifest.transports, ['local', 'cloud']);
  assert.deepEqual(manifest.categories, ['services']);
});

test('the manifest version is the package version, and the image is tagged with it', () => {
  assert.equal(manifest.version, pkg.version);
  assert.ok(manifest.docker_image.endsWith(`:${manifest.version}`));
});

test('widgets, triggers and scene actions need Gladys 5.1.0', () => {
  assert.equal(manifest.gladys_version, '>=5.1.0');
});

test('config_schema: the defaults and options of the code', () => {
  const keys = manifest.config_schema.filter((f) => f.type !== 'section').map((f) => f.key);
  assert.deepEqual([...keys].sort(), Object.keys(DEFAULT_CONFIG).sort());
  for (const item of manifest.config_schema) {
    if (item.default !== undefined) {
      assert.equal(DEFAULT_CONFIG[item.key], item.default, `default of ${item.key}`);
    }
  }
  assert.equal(field('api_password').type, 'secret');
  assert.deepEqual(
    field('refresh_minutes').options.map((o) => o.value),
    REFRESH_MINUTES,
  );
  assert.deepEqual(
    field('language').options.map((o) => o.value),
    LANGUAGES,
  );
  for (const section of manifest.config_schema.filter((f) => f.type === 'section')) {
    for (const link of section.links ?? []) {
      assert.match(link.url, /^https:\/\//);
    }
  }
});

test('every action, scene action and widget has a handler, and vice versa', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const fake = world.fake;
  assert.match((await fake.action('nope')).error, /not implemented/i);
  for (const action of manifest.actions) {
    const ack = await fake.action(action.key, {});
    assert.equal(ack.success, true, `action ${action.key}: ${ack.error}`);
  }
  assert.deepEqual(keysOf(manifest.scene_actions).sort(), Object.keys(SCENE_ACTIONS).sort());
  assert.deepEqual(keysOf(manifest.widgets), [WIDGET_KEY]);
  assert.deepEqual(Object.keys(WIDGETS), [WIDGET_KEY]);
  assert.equal(manifest.widgets[0].settings[0].source, 'devices');
  assert.equal((await fake.widgetGet(WIDGET_KEY, { settings: {} })).success, true);
});

test('scene action fields and outputs are the ones the code reads and returns', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const samples = {
    read_unread: { source: categoryDevice('Tech'), count: '3', mark_read: false },
    mark_entries_read: { entry_ids: '1792796929172921, 1792796929172922' },
    mark_all_read: { source: feedDevice(3) },
  };
  for (const action of manifest.scene_actions) {
    assert.deepEqual(keysOf(action.fields).sort(), Object.keys(samples[action.key]).sort());
    const ack = await world.fake.sceneAction(action.key, samples[action.key]);
    assert.equal(ack.success, true, `${action.key}: ${ack.error}`);
    assert.deepEqual(
      Object.keys(ack.data?.outputs ?? {}).sort(),
      keysOf(action.outputs).sort(),
      action.key,
    );
    for (const output of action.outputs ?? []) {
      assert.equal(typeof ack.data.outputs[output.key], output.type, output.key);
    }
  }
});

test('the scene triggers the hub fires are declared, with exactly their data', async (t) => {
  assert.deepEqual(keysOf(manifest.scene_triggers).sort(), Object.values(TRIGGERS).sort());
  const world = await createWorld({ config: { ...CONFIG, keywords: 'gladys' } });
  t.after(() => world.app.stop());
  await world.hub.refresh(); // a baseline after the first read
  world.server.addEntry({ feedId: 2, title: 'Gladys news', author: 'Bob' });
  await world.hub.refresh();
  const events = world.fake.sceneEvents;
  const devices = world.fake.discoveredDevices.map((d) => d.external_id);
  for (const trigger of manifest.scene_triggers) {
    const event = events.find((e) => e.key === trigger.key);
    assert.ok(event, trigger.key);
    const declared = new Set([...keysOf(trigger.fields), ...keysOf(trigger.variables)]);
    assert.deepEqual(Object.keys(event.data).sort(), [...declared].sort(), trigger.key);
    for (const variable of trigger.variables) {
      assert.equal(typeof event.data[variable.key], variable.type, variable.key);
    }
    // The category and feed filters are the external ids of devices.
    assert.ok(devices.includes(event.data.category), `${trigger.key}.category`);
    assert.ok(devices.includes(event.data.feed), `${trigger.key}.feed`);
  }
});

test('dynamic selects only use the devices source', () => {
  for (const item of allFields.filter((f) => f.source !== undefined)) {
    assert.equal(item.source, 'devices');
    assert.equal(item.options, undefined, item.key);
  }
});

test('actions declare no secret field, no required field (Gladys#3154/#3155)', () => {
  for (const action of manifest.actions ?? []) {
    for (const item of action.fields ?? []) {
      assert.notEqual(item.type, 'secret');
      assert.notEqual(item.required, true);
    }
  }
});

test('trigger filters never use a boolean (no "any" state)', () => {
  for (const trigger of manifest.scene_triggers) {
    for (const item of trigger.fields ?? []) {
      assert.notEqual(item.type, 'boolean', `${trigger.key}.${item.key}`);
    }
  }
});

test('the catalog description holds 10 to 100 characters per language', () => {
  for (const [lang, text] of Object.entries(manifest.description)) {
    assert.ok(text.length >= 10 && text.length <= 100, `description.${lang}: ${text.length}`);
  }
});
