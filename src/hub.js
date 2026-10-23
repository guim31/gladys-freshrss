// -----------------------------------------------------------------------------
// The hub: the link to one FreshRSS account and everything Gladys sees of it
// — the devices, their states, the connection status, the scene events, and
// the entries marked as read from scenes and from the widget.
//
// FreshRSS pushes nothing: the container reads it every `refresh_minutes`
// (5 by default) on its own timer (should_poll: false). A read is three small
// requests: the feeds (with their category), the unread counters, and the
// newest entry ids; then the contents of the entries that arrived since the
// previous read, when there are some. The user is read once.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import {
  MAX_CATEGORIES,
  MAX_FEEDS,
  accountIds,
  buildAccountDevice,
  buildAccountStates,
  buildCategoryDevice,
  buildFeedDevice,
  buildUnreadStates,
  categoryIds,
  feedIds,
  parseExternalId,
} from './devices.js';
import { FreshRssClient, FreshRssError, READING_LIST } from './freshrss/client.js';
import {
  categoryKey,
  labelStream,
  matchKeyword,
  parseIds,
  summarizeEntry,
  summarizeFeed,
} from './freshrss/model.js';
import { MemoryStore } from './store.js';
import { STATUS_TEXT, TEST_TEXT, commandMessage } from './texts.js';

const logger = createLogger({ name: 'freshrss-hub' });

export const WIDGET_KEY = 'unread';
export const TRIGGERS = { entry: 'new_entry' };

export const DEFAULT_TIMINGS = {
  // requestWidgetRefresh is dropped by the core beyond one call per 10 s.
  widgetGap: 10_500,
  // An unchanged value is sent again before Gladys calls it stale (48 h).
  heartbeat: 6 * 3_600_000,
  requestTimeout: 15_000,
  // How long the entries read for a widget are reused.
  widgetCache: 60_000,
};

// The entry ids asked at each read: past that many new ones (an import, a
// long outage), the oldest are recorded as seen without being announced.
export const NEW_PAGE = 50;
// Past that many events in one read, the rest is recorded as seen without firing.
export const MAX_EVENTS_PER_READ = 10;
// Reads after which an event Gladys keeps refusing is given up.
export const MAX_TRIES = 3;
export const MAX_READ = 10;

/** An Error carrying a coded, multi-language message. */
export class CommandError extends Error {
  constructor(code, language, values) {
    const messages = commandMessage(code, values);
    super(messages[language] ?? messages.en);
    this.code = code;
    this.messages = messages;
  }
}

const linkOf = (config) => JSON.stringify([config.url, config.username, config.password]);
// Entry ids are decimal strings of up to 19 digits: compared as BigInt.
const isId = (id) => typeof id === 'string' && /^\d{1,19}$/.test(id);
const after = (a, b) => BigInt(a) > BigInt(b);
const ints = (list) => (Array.isArray(list) ? list.filter(Number.isInteger) : []);

export class Hub {
  constructor({ gladys, fetch, timings, now = Date.now, store }) {
    this.gladys = gladys;
    this.fetch = fetch;
    this.timings = { ...DEFAULT_TIMINGS, ...timings };
    this.now = now;
    this.store = store ?? new MemoryStore();
    this.config = {
      url: null,
      urlInvalid: false,
      username: '',
      password: '',
      refreshMinutes: 5,
      keywords: [],
      language: 'fr',
    };
    this.client = null;
    /** the FreshRSS user name, once read */
    this.user = null;
    /** [{ key, name, stream, device, unread }] */
    this.categories = [];
    /** [{ id, title, site, category, categoryKey, stream, device, unread }] */
    this.feeds = [];
    /** { unread, feeds, categories } */
    this.counters = null;
    /** null (fine), or the kind of the last failure */
    this.failure = null;
    this.announced = false;
    this.lastStatus = '';
    /** what the trigger already saw: { user, server, lastId, feeds } */
    this.seen = null;
    /** entry id -> reads at which Gladys refused it */
    this.retries = new Map();
    this.eventFailing = false;
    this.devicesFailing = false;
    this.publishFailing = false;
    this.widgetLists = new Map();
    this.configuring = Promise.resolve();
    this.refreshTimer = null;
    this.refreshing = null;
    this.refreshAgain = false;
    this.widgetRefreshAt = 0;
    this.widgetTimer = null;
    this.stopped = false;
  }

  get language() {
    return this.config.language;
  }

  get loaded() {
    return this.counters !== null;
  }

  async start(config) {
    const saved = await this.store.load();
    // A damaged file is a new baseline, not a crash on every read.
    this.seen =
      typeof saved.user === 'string' && isId(saved.lastId)
        ? {
            user: saved.user,
            server: typeof saved.server === 'string' ? saved.server : '',
            lastId: saved.lastId,
            feeds: ints(saved.feeds),
          }
        : null;
    await this.reconfigure(config);
  }

  /** One configuration change at a time: a second one waits for the first. */
  reconfigure(config) {
    const run = this.configuring.then(() => this.#reconfigure(config));
    this.configuring = run.catch(() => {});
    return run;
  }

  async #reconfigure(config) {
    const previous = this.config;
    this.config = config;
    const linkChanged = linkOf(previous) !== linkOf(config) || !this.client;
    if (linkChanged || previous.refreshMinutes !== config.refreshMinutes) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    if (linkChanged) {
      this.client = null;
      this.user = null;
      this.categories = [];
      this.feeds = [];
      this.counters = null;
      this.failure = null;
      this.announced = false;
      this.widgetLists.clear();
      if (config.url && config.username && config.password) {
        this.client = new FreshRssClient({
          url: config.url,
          username: config.username,
          password: config.password,
          fetch: this.fetch,
          timeout: this.timings.requestTimeout,
        });
      }
    }
    if (this.client && !this.refreshTimer) {
      this.refreshTimer = setInterval(
        () => this.refresh().catch((err) => logger.error('Read failed', err)),
        config.refreshMinutes * 60_000,
      );
      this.refreshTimer.unref?.();
    }
    if (linkChanged) {
      await this.refresh();
    } else {
      // Language, keywords or interval only: same data, new names and texts.
      this.gladys.forgetPublishedStates?.();
      this.widgetLists.clear();
      await this.#update();
    }
    await this.updateConnectionStatus();
  }

  /** Gladys reconnected (it may have restarted): send everything again. */
  async resync(config) {
    this.gladys.forgetPublishedStates?.();
    this.lastStatus = '';
    await this.reconfigure(config);
  }

  async stop() {
    this.stopped = true;
    clearInterval(this.refreshTimer);
    clearTimeout(this.widgetTimer);
    this.refreshTimer = null;
    await this.store.flush();
  }

  // --- Reading FreshRSS -----------------------------------------------------

  /** Read FreshRSS (one read at a time; a request during it runs once after). */
  refresh() {
    if (this.refreshing) {
      this.refreshAgain = true;
      return this.refreshing;
    }
    this.refreshing = (async () => {
      do {
        this.refreshAgain = false;
        try {
          await this.#refreshOnce();
        } catch (err) {
          // Never ends the loop: a read queued meanwhile (new address) still runs.
          logger.error('Read failed', err);
        }
      } while (this.refreshAgain && !this.stopped);
    })().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  async #refreshOnce() {
    const client = this.client;
    if (this.stopped) {
      return;
    }
    if (!client) {
      await this.publishDevices();
      return;
    }
    let user;
    let subscriptions;
    let counts;
    let recent;
    let fresh = [];
    try {
      user = this.user ?? (await client.userInfo()).userName;
      const known = this.#known(user);
      [subscriptions, counts, recent] = await Promise.all([
        client.subscriptions(),
        client.unreadCounts(),
        // The first read only needs the newest id: the baseline.
        client.itemIds({ count: known ? NEW_PAGE : 1 }),
      ]);
      if (known) {
        const ids = recent.ids.filter((id) => after(id, known.lastId));
        fresh = ids.length > 0 ? await client.itemContents(ids) : [];
      }
    } catch (err) {
      if (client !== this.client) {
        return;
      }
      this.#fail(err);
      await this.publishStates();
      await this.updateConnectionStatus();
      return;
    }
    if (client !== this.client || this.stopped) {
      return;
    }
    this.user = user;
    this.#load(subscriptions, counts);
    this.widgetLists.clear();
    this.#recover();
    await this.#update();
    if (client !== this.client || this.stopped || !this.user) {
      return; // the configuration changed meanwhile
    }
    await this.#announce(recent, fresh);
    await this.updateConnectionStatus();
  }

  /** The feeds and categories of a read, with their unread counters. */
  #load(subscriptions, counts) {
    const unreadOf = (stream) => counts[stream] ?? 0;
    const user = this.user;
    this.feeds = subscriptions
      .map(summarizeFeed)
      .filter((f) => Number.isInteger(f.id))
      .map((f) => ({
        ...f,
        categoryKey: f.category ? categoryKey(f.category) : '',
        stream: `feed/${f.id}`,
        device: feedIds(this.gladys, user, f.id).device,
        unread: unreadOf(`feed/${f.id}`),
      }));
    const names = [...new Set(this.feeds.map((f) => f.category).filter(Boolean))];
    this.categories = names.map((name) => {
      const key = categoryKey(name);
      const stream = labelStream(name);
      return {
        key,
        name,
        stream,
        device: categoryIds(this.gladys, user, key).device,
        unread:
          counts[stream] ??
          this.feeds.filter((f) => f.category === name).reduce((s, f) => s + f.unread, 0),
      };
    });
    this.counters = {
      unread: counts[READING_LIST] ?? this.feeds.reduce((sum, f) => sum + f.unread, 0),
      feeds: this.feeds.length,
      categories: this.categories.length,
    };
  }

  /**
   * What the trigger saw of this user on this server: another server is a
   * new baseline, even for the same user name.
   */
  #known(user) {
    const seen = this.seen;
    return seen?.user === user && seen.server === (this.config.url ?? '') ? seen : null;
  }

  /** Devices, states and widget from the last read. */
  async #update() {
    if (!this.user || !this.counters) {
      return; // nothing read yet: never replace the Discovery list by nothing
    }
    await this.publishDevices();
    await this.publishStates();
    this.refreshWidget();
  }

  #fail(err) {
    const kind = err instanceof FreshRssError ? err.kind : 'unreachable';
    if (this.failure === null) {
      logger.warn(`FreshRSS: ${err.message}`);
    } else {
      logger.debug(`FreshRSS still failing: ${err.message}`);
    }
    this.failure = kind;
  }

  #recover() {
    const { unread, feeds } = this.counters;
    if (this.failure !== null) {
      logger.info(`FreshRSS answers again (${feeds} feeds, ${unread} unread)`);
    } else if (!this.announced) {
      logger.info(`Connected to FreshRSS (${feeds} feeds, ${unread} unread)`);
    }
    this.announced = true;
    this.failure = null;
  }

  // --- Scene events ---------------------------------------------------------

  /**
   * Fire the unread entries that arrived since the last read. The first read
   * of a FreshRSS user is a silent baseline: installing the integration
   * announces nothing already there. Neither are the entries of a feed added
   * since the previous read (its backlog).
   * @param {{ ids: string[], more: boolean }} recent the newest ids
   * @param {object[]} fresh the raw entries newer than the last one seen
   */
  async #announce(recent, fresh) {
    const user = this.user;
    const known = this.#known(user);
    const feedIdsNow = this.feeds.map((f) => f.id);
    let lastId = known?.lastId ?? '0';
    for (const id of recent.ids) {
      if (after(id, lastId)) {
        lastId = id;
      }
    }
    let rewound = false;
    if (known) {
      const knownFeeds = new Set(known.feeds);
      const entries = fresh
        .map(summarizeEntry)
        .filter((e) => isId(e.id) && after(e.id, known.lastId))
        .sort((a, b) => (after(a.id, b.id) ? 1 : -1));
      const unread = entries.filter((e) => !e.read && knownFeeds.has(e.feedId));
      const newIds = recent.ids.filter((id) => after(id, known.lastId)).length;
      if ((recent.more && newIds === recent.ids.length) || unread.length > MAX_EVENTS_PER_READ) {
        logger.info(
          `${Math.max(newIds, unread.length)} new articles at once: ${MAX_EVENTS_PER_READ} announced at most`,
        );
      }
      // The newest ones: the oldest of a burst are the least worth a message.
      for (const entry of unread.slice(-MAX_EVENTS_PER_READ)) {
        const outcome = await this.#fire(TRIGGERS.entry, entry.id, this.#entryData(entry));
        if (outcome === 'retry') {
          lastId = (BigInt(entry.id) - 1n).toString();
          rewound = true;
          break;
        }
      }
    }
    // Rewound: the feeds new in this read stay new, or their backlog would
    // be announced at the next read.
    const feeds = rewound ? feedIdsNow.filter((id) => known.feeds.includes(id)) : feedIdsNow;
    const next = { user, server: this.config.url ?? '', lastId, feeds };
    if (JSON.stringify(next) !== JSON.stringify(this.seen)) {
      this.seen = next;
      await this.store.save(next);
    }
  }

  /** @returns {Promise<'sent' | 'retry' | 'dropped'>} */
  async #fire(key, id, data) {
    logger.debug(`${key}: ${id}`);
    try {
      await this.gladys.publishSceneEvent(key, data);
      if (this.eventFailing) {
        logger.info('Scene events accepted again');
      }
      this.eventFailing = false;
      this.retries.delete(id);
      return 'sent';
    } catch (err) {
      if (this.eventFailing) {
        logger.debug(`Cannot fire ${key}: ${err.message}`);
      } else {
        logger.warn(`Cannot fire ${key}: ${err.message}`);
      }
      this.eventFailing = true;
      // A refusal for good (4xx but 429) is not retried: it would be refused
      // at every read. Otherwise (Gladys restarting), it is fired again at the
      // next read, up to MAX_TRIES reads.
      const status = err?.status;
      const final = Number.isInteger(status) && status >= 400 && status < 500 && status !== 429;
      const tries = (this.retries.get(id) ?? 0) + 1;
      if (!final && tries < MAX_TRIES) {
        this.retries.set(id, tries);
        return 'retry';
      }
      this.retries.delete(id);
      if (!final) {
        logger.warn(`${key} ${id} given up: Gladys refused it ${tries} times`);
      }
      return 'dropped';
    }
  }

  #entryData(entry) {
    const feed = this.feeds.find((f) => f.id === entry.feedId);
    const category = this.categories.find((c) => c.name === feed?.category);
    return {
      // The filters of the trigger: the category and feed devices, as picked
      // in the editor; the first keyword of the configuration found.
      category: category?.device ?? '',
      feed: feed?.device ?? '',
      keyword: matchKeyword(entry.title, this.config.keywords),
      title: entry.title,
      url: entry.url.slice(0, 1000),
      feed_name: feed?.title ?? entry.feed,
      category_name: feed?.category ?? '',
      author: entry.author,
      published: entry.published,
      entry_id: Number(entry.id),
    };
  }

  // --- Devices and states ---------------------------------------------------

  #isCreated(externalId) {
    return (this.gladys.devices ?? []).some((device) => device.external_id === externalId);
  }

  buildDevices() {
    if (!this.user || !this.counters) {
      return [];
    }
    return [
      buildAccountDevice(this.gladys, this.user, this.language, this.config.url ?? ''),
      ...this.categories
        .slice(0, MAX_CATEGORIES)
        .map((c) => buildCategoryDevice(this.gladys, this.user, c, this.language)),
      ...this.feeds
        .slice(0, MAX_FEEDS)
        .map((f) => buildFeedDevice(this.gladys, this.user, f, this.language)),
    ];
  }

  async publishDevices() {
    if (this.stopped) {
      return;
    }
    try {
      await this.gladys.publishDiscoveredDevices(this.buildDevices());
    } catch (err) {
      if (this.devicesFailing) {
        logger.debug(`Cannot publish the devices: ${err.message}`);
      } else {
        logger.warn(`Cannot publish the devices: ${err.message}`);
      }
      this.devicesFailing = true;
      return;
    }
    this.devicesFailing = false;
  }

  /**
   * The states of the devices the user added (Gladys drops the others).
   * While FreshRSS fails, only "online" (0) is sent: the counters keep their
   * last value.
   * @param {string} [justCreated] the external id of a device just added
   */
  async publishStates(justCreated) {
    if (!this.user || !this.counters || this.stopped) {
      return;
    }
    const created = (id) => id === justCreated || this.#isCreated(id);
    const online = this.failure === null;
    const states = [];
    if (created(accountIds(this.gladys, this.user).device)) {
      states.push(
        ...buildAccountStates(this.gladys, this.user, online ? this.counters : null, online),
      );
    }
    if (online) {
      for (const source of [
        ...this.categories.slice(0, MAX_CATEGORIES),
        ...this.feeds.slice(0, MAX_FEEDS),
      ]) {
        if (created(source.device)) {
          states.push(...buildUnreadStates(source));
        }
      }
    }
    if (states.length === 0) {
      return;
    }
    try {
      await this.gladys.publishChangedStates(states, { heartbeat: this.timings.heartbeat });
    } catch (err) {
      if (this.publishFailing) {
        logger.debug(`Cannot publish the states: ${err.message}`);
      } else {
        logger.warn(`Cannot publish the states: ${err.message}`);
      }
      this.publishFailing = true;
      return;
    }
    if (this.publishFailing) {
      logger.info('States published again');
    }
    this.publishFailing = false;
  }

  #ours(device) {
    const parsed = parseExternalId(this.gladys, device?.external_id);
    return parsed !== null && parsed.user === this.user;
  }

  /** The user added a device: states sent before were dropped by Gladys. */
  async onDeviceCreated(device) {
    if (!this.#ours(device)) {
      return;
    }
    this.gladys.forgetPublishedStates?.(device.external_id);
    await this.publishStates(device.external_id);
    this.refreshWidget();
  }

  /** onPoll (the devices are not polled: the container reads on its timer). */
  async poll(device) {
    if (this.#ours(device)) {
      await this.publishStates(device.external_id);
    }
  }

  // --- Widget ---------------------------------------------------------------

  /** Nudge the open dashboards, with a trailing call inside the core's 10 s gap. */
  refreshWidget() {
    if (this.stopped) {
      return;
    }
    const wait = this.widgetRefreshAt + this.timings.widgetGap - this.now();
    if (wait <= 0) {
      this.widgetRefreshAt = this.now();
      this.gladys.requestWidgetRefresh(WIDGET_KEY);
      return;
    }
    if (!this.widgetTimer) {
      this.widgetTimer = setTimeout(() => {
        this.widgetTimer = null;
        this.refreshWidget();
      }, wait);
      this.widgetTimer.unref?.();
    }
  }

  /**
   * What a device picked in a widget setting or a scene field designates:
   * undefined (nothing picked, or the FreshRSS device: everything), a
   * category or a feed of the last read (`{ kind, name, stream, unread }`),
   * or null (not ours, or gone from FreshRSS).
   */
  scopeOf(externalId) {
    if (externalId === undefined || externalId === null || externalId === '') {
      return undefined;
    }
    const parsed = parseExternalId(this.gladys, externalId);
    if (!parsed || parsed.user !== this.user) {
      return null;
    }
    if (parsed.kind === 'account') {
      return undefined;
    }
    if (parsed.kind === 'category') {
      const category = this.categories.find((c) => c.key === parsed.key);
      return category ? { kind: 'category', ...category } : null;
    }
    const feed = this.feeds.find((f) => f.id === parsed.feedId);
    return feed ? { kind: 'feed', name: feed.title, ...feed } : null;
  }

  /**
   * The newest unread entries, of everything or of one category or feed,
   * read on demand and reused a minute. Null when FreshRSS cannot be read.
   */
  async widgetEntries(scope, count) {
    if (!this.loaded || this.failure !== null) {
      return null;
    }
    const stream = scope?.stream ?? READING_LIST;
    const cached = this.widgetLists.get(stream);
    if (cached && this.now() - cached.at < this.timings.widgetCache) {
      return cached.entries.slice(0, count);
    }
    const client = this.client;
    try {
      const items = await client.streamContents({ stream, count, unreadOnly: true });
      const entries = items.map(summarizeEntry).filter((e) => isId(e.id));
      if (client === this.client) {
        this.widgetLists.set(stream, { at: this.now(), entries });
      }
      return entries;
    } catch (err) {
      logger.debug(`Widget list not read: ${err.message}`);
      return null;
    }
  }

  // --- Connection status ----------------------------------------------------

  statusKey() {
    if (this.config.urlInvalid) {
      return 'invalid';
    }
    if (!this.config.url) {
      return 'none';
    }
    if (!this.config.username) {
      return 'user';
    }
    if (!this.config.password) {
      return 'password';
    }
    if (this.failure) {
      return (
        {
          unauthorized: 'unauthorized',
          disabled: 'disabled',
          invalid: 'invalid_answer',
          http: 'error',
          rejected: 'error',
        }[this.failure] ?? 'unreachable'
      );
    }
    return null;
  }

  statusMessage() {
    const key = this.statusKey();
    return key ? this.#statusOf(key) : null;
  }

  #statusOf(key) {
    return Object.fromEntries(
      Object.entries(STATUS_TEXT).map(([language, table]) => [language, table[key]]),
    );
  }

  async updateConnectionStatus() {
    if (this.stopped) {
      return;
    }
    // Nothing to say before the first answer or failure.
    if (this.client && !this.loaded && this.failure === null) {
      return;
    }
    const message = this.statusMessage();
    const connected = Boolean(this.client) && this.loaded && this.failure === null;
    const fingerprint = JSON.stringify({ connected, message });
    if (fingerprint === this.lastStatus) {
      return;
    }
    try {
      await this.gladys.setConnectionStatus(connected, message ?? undefined);
      // Recorded once Gladys took it: a failed call is sent again next time.
      this.lastStatus = fingerprint;
    } catch (err) {
      logger.warn(`Cannot set the connection status: ${err.message}`);
    }
  }

  // --- Actions --------------------------------------------------------------

  /** "Test the connection": a fresh read, then its outcome. */
  async testReport() {
    if (!this.client) {
      return this.statusMessage();
    }
    await this.refresh();
    const message = this.statusMessage();
    if (message) {
      return message;
    }
    if (!this.loaded || !this.user) {
      // The configuration changed during the test: nothing read yet.
      return this.#statusOf('unreachable');
    }
    const { unread, feeds, categories } = this.counters;
    return Object.fromEntries(
      Object.entries(TEST_TEXT).map(([language, render]) => [
        language,
        render(this.user, unread, feeds, categories),
      ]),
    );
  }

  /** The client, once FreshRSS was read, or a coded error. */
  async #ready() {
    const client = this.client;
    if (!client) {
      throw new CommandError('unreachable', this.language);
    }
    if (!this.loaded) {
      await this.refresh();
    }
    if (!this.loaded || client !== this.client) {
      throw this.#commandError(new FreshRssError(this.failure ?? 'unreachable', ''), 'read');
    }
    return client;
  }

  /** A device picked in a scene or a widget -> undefined (all), a category or a feed. */
  #scopeOrFail(externalId) {
    const scope = this.scopeOf(externalId);
    if (scope === null) {
      throw new CommandError('source', this.language);
    }
    return scope;
  }

  /**
   * Mark every unread entry of a category, a feed or the whole account as read.
   * @param {unknown} target the external id of a device of the integration
   * @returns {Promise<{ count: number, name: string }>}
   */
  async markRead(target) {
    const client = await this.#ready();
    const scope = this.#scopeOrFail(target);
    const count = scope ? scope.unread : this.counters.unread;
    try {
      await client.markStreamRead(scope?.stream ?? READING_LIST);
    } catch (err) {
      // 400: a category renamed or deleted since the last read.
      if (err instanceof FreshRssError && err.kind === 'rejected') {
        throw new CommandError('source', this.language);
      }
      throw this.#commandError(err, 'http');
    }
    logger.info(`Marked as read: ${scope ? `a ${scope.kind}` : 'everything'} (${count} articles)`);
    await this.refresh();
    return { count, name: scope?.name ?? '' };
  }

  /**
   * @param {unknown} raw entry ids, "1792796929172923" or "a, b"
   * @returns {Promise<{ count: number }>}
   */
  async markEntries(raw) {
    const ids = parseIds(raw);
    if (!ids) {
      throw new CommandError('ids', this.language);
    }
    const client = await this.#ready();
    try {
      await client.markEntriesRead(ids);
    } catch (err) {
      throw this.#commandError(err, 'http');
    }
    logger.info(`Marked as read: ${ids.length} article(s)`);
    await this.refresh();
    return { count: ids.length };
  }

  /**
   * The newest unread entries, of everything or of one category or feed, read now.
   * @param {{ source?: unknown, count?: unknown, markRead?: unknown }} request
   * @returns {Promise<{ entries: object[], total: number }>}
   */
  async readUnread({ source, count, markRead }) {
    const client = await this.#ready();
    const scope = this.#scopeOrFail(source);
    const wanted = Math.min(Math.max(Math.round(Number(count)) || 5, 1), MAX_READ);
    let entries;
    try {
      const items = await client.streamContents({
        stream: scope?.stream ?? READING_LIST,
        count: wanted,
        unreadOnly: true,
      });
      entries = items.map(summarizeEntry).filter((e) => isId(e.id));
    } catch (err) {
      throw this.#commandError(err, 'read');
    }
    const total = scope ? scope.unread : this.counters.unread;
    if ((markRead === true || markRead === 'true') && entries.length > 0) {
      try {
        await client.markEntriesRead(entries.map((e) => e.id));
      } catch (err) {
        throw this.#commandError(err, 'http');
      }
      logger.info(`Read and marked as read: ${entries.length} articles`);
      await this.refresh();
    }
    return { entries, total };
  }

  #commandError(err, fallback) {
    if (err instanceof CommandError) {
      return err;
    }
    const kind = err instanceof FreshRssError ? err.kind : 'unreachable';
    const detail = err.message.replace(/^[^:]*: /, '');
    if (kind === 'unauthorized') {
      return new CommandError('unauthorized', this.language);
    }
    if (kind === 'timeout' && fallback === 'http') {
      // The request may have reached FreshRSS: the change may be done.
      return new CommandError('timeout', this.language);
    }
    if (kind === 'unreachable' || kind === 'timeout') {
      return new CommandError('unreachable', this.language);
    }
    return new CommandError(fallback, this.language, { detail });
  }
}
