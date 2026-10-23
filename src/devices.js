// -----------------------------------------------------------------------------
// FreshRSS -> Gladys devices:
// - one "FreshRSS" device per user (`account:<user name>`): unread entries,
//   online (input/binary: 0 while FreshRSS does not answer);
// - one device per category (`category:<user>_<key>`, the key being a hash of
//   its name: FreshRSS gives categories no id) and one per feed
//   (`feed:<user>_<feed id>`): their unread entries. Every category and feed
//   is offered in Discovery; the user adds the ones they care about.
// Everything is read only: entries are marked as read through the scene
// actions and the widget button, never through a device feature.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as CAT,
  DEVICE_FEATURE_TYPES as TYPE,
} from '@gladysassistant/integration-sdk';
import { NAMES, pick } from './texts.js';

export const ACCOUNT_TYPE = 'account';
export const CATEGORY_TYPE = 'category';
export const FEED_TYPE = 'feed';
// Gladys keeps every discovered device in its list: a reader with hundreds
// of categories or feeds offers the first ones only.
export const MAX_CATEGORIES = 100;
export const MAX_FEEDS = 200;

const MAX_COUNT = 10_000_000;

export const accountIds = (gladys, user) => gladys.externalIds(ACCOUNT_TYPE, user);
export const categoryIds = (gladys, user, key) =>
  gladys.externalIds(CATEGORY_TYPE, `${user}_${key}`);
export const feedIds = (gladys, user, feedId) => gladys.externalIds(FEED_TYPE, `${user}_${feedId}`);

const counter = (name, externalId) => ({
  name,
  external_id: externalId,
  category: CAT.COUNTER_SENSOR,
  type: TYPE.SENSOR.INTEGER,
  read_only: true,
  has_feedback: false,
  min: 0,
  max: MAX_COUNT,
  keep_history: true,
});

/**
 * @param {object} gladys
 * @param {string} user the FreshRSS user name
 * @param {string} language
 * @param {string} url FreshRSS base URL (a device param, shown in Gladys)
 */
export function buildAccountDevice(gladys, user, language, url) {
  const names = pick(NAMES, language);
  const ids = accountIds(gladys, user);
  return {
    name: 'FreshRSS',
    external_id: ids.device,
    model: 'FreshRSS',
    should_poll: false,
    features: [
      counter(names.unread, ids.feature('unread')),
      {
        name: names.online,
        external_id: ids.feature('online'),
        category: CAT.INPUT,
        type: TYPE.SENSOR.BINARY,
        read_only: true,
        has_feedback: false,
        min: 0,
        max: 1,
        keep_history: true,
      },
    ],
    params: [
      { name: 'FRESHRSS_URL', value: url },
      { name: 'FRESHRSS_USER', value: user.slice(0, 100) },
    ],
  };
}

/** @param {{ key: string, name: string }} category */
export function buildCategoryDevice(gladys, user, category, language) {
  const ids = categoryIds(gladys, user, category.key);
  return {
    name: category.name.slice(0, 100),
    external_id: ids.device,
    model: 'FreshRSS category',
    should_poll: false,
    features: [counter(pick(NAMES, language).unread, ids.feature('unread'))],
    params: [{ name: 'FRESHRSS_CATEGORY', value: category.name.slice(0, 200) }],
  };
}

/** @param {{ id: number, title: string, category: string }} feed */
export function buildFeedDevice(gladys, user, feed, language) {
  const ids = feedIds(gladys, user, feed.id);
  return {
    name: feed.title.slice(0, 100),
    external_id: ids.device,
    model: 'FreshRSS feed',
    should_poll: false,
    features: [counter(pick(NAMES, language).unread, ids.feature('unread'))],
    params: [
      { name: 'FRESHRSS_FEED_ID', value: String(feed.id) },
      { name: 'FRESHRSS_CATEGORY', value: feed.category.slice(0, 200) },
    ],
  };
}

/** @param {{ unread: number } | null} counters null: FreshRSS does not answer */
export function buildAccountStates(gladys, user, counters, online) {
  const ids = accountIds(gladys, user);
  const states = [{ device_feature_external_id: ids.feature('online'), state: online ? 1 : 0 }];
  if (counters) {
    states.unshift({ device_feature_external_id: ids.feature('unread'), state: counters.unread });
  }
  return states;
}

/** @param {{ device: string, unread: number }} source a category or a feed */
export const buildUnreadStates = (source) => [
  { device_feature_external_id: `${source.device}:unread`, state: source.unread },
];

/**
 * `ext:...:account:<user>` -> { kind: 'account', user },
 * `ext:...:category:<user>_<key>` -> { kind: 'category', user, key },
 * `ext:...:feed:<user>_<id>` -> { kind: 'feed', user, feedId };
 * null when not ours. User names may hold `_`: the key or id comes after the
 * last one.
 */
export function parseExternalId(gladys, externalId) {
  if (typeof externalId !== 'string') {
    return null;
  }
  for (const kind of [ACCOUNT_TYPE, CATEGORY_TYPE, FEED_TYPE]) {
    const prefix = gladys.externalId(`${kind}:`);
    if (!externalId.startsWith(prefix)) {
      continue;
    }
    const id = externalId.slice(prefix.length).split(':')[0];
    if (kind === ACCOUNT_TYPE) {
      return id === '' ? null : { kind, user: id };
    }
    const cut = id.lastIndexOf('_');
    const user = id.slice(0, cut);
    const rest = id.slice(cut + 1);
    if (cut <= 0) {
      return null;
    }
    if (kind === CATEGORY_TYPE) {
      return /^[0-9a-f]{12}$/.test(rest) ? { kind, user, key: rest } : null;
    }
    return /^\d{1,15}$/.test(rest) ? { kind, user, feedId: Number(rest) } : null;
  }
  return null;
}
