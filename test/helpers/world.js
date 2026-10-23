// -----------------------------------------------------------------------------
// A complete test world: the SDK's fake Gladys (a real GladysIntegration on an
// in-memory transport), the integration wired on it by registerHandlers, and
// a fake FreshRSS.
// -----------------------------------------------------------------------------

import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../../src/app.js';
import { categoryKey } from '../../src/freshrss/model.js';
import { MemoryStore } from '../../src/store.js';
import { HOST, NOW, PASSWORD, USER, createFreshRss, settle } from './fakeFreshRss.js';

export const FAST_TIMINGS = { widgetGap: 0, requestTimeout: 200 };
export const CONFIG = { url: HOST, username: USER, api_password: PASSWORD };

export async function createWorld({
  server = createFreshRss(),
  config = CONFIG,
  devices = [],
  connect = true,
  store = new MemoryStore(),
  clock = { now: NOW },
} = {}) {
  const gladys = createFakeGladys({ config, devices });
  const app = registerHandlers(gladys, {
    fetch: server.fetch,
    timings: FAST_TIMINGS,
    now: () => clock.now,
    store,
  });
  if (connect) {
    await gladys.connect();
    await settle(20);
  }
  return { gladys, app, hub: app.hub, server, store, clock, fake: gladys.fake };
}

// The devices of the fixtures' user.
export const accountDevice = `ext:test-integration:account:${USER}`;
export const accountFeature = (key) => `${accountDevice}:${key}`;
export const categoryDevice = (name) =>
  `ext:test-integration:category:${USER}_${categoryKey(name)}`;
export const feedDevice = (id) => `ext:test-integration:feed:${USER}_${id}`;

/** Add every discovered device to Gladys, as the user would. */
export async function createAll(fake) {
  for (const device of fake.discoveredDevices) {
    await fake.deviceCreated(device);
  }
  await settle();
}
