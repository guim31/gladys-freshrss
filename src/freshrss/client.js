// -----------------------------------------------------------------------------
// The Google Reader compatible API of FreshRSS (`<base>/api/greader.php/...`),
// the few calls the integration needs.
//
// Facts checked on a real server, FreshRSS 1.30.4 (freshrss/freshrss), see
// test/fixtures/freshrss/1.30.4/:
// - `POST accounts/ClientLogin` (Email, Passwd = the API password of the
//   user, not the login password) answers `SID=…\nLSID=null\nAuth=user/hash`
//   in plain text. The token never expires: it changes with the API password.
//   Every other call sends `Authorization: GoogleLogin auth=user/hash`;
// - errors are plain text: 401 "Unauthorized!" (wrong password, wrong or
//   missing token), 400 "Bad Request!" (unknown route, unknown category, a
//   user name with forbidden characters), 503 "Service Unavailable!" when
//   the API is disabled in FreshRSS (Administration → Authentication);
// - reads answer JSON with `output=json` (some with a text/html type);
// - writes (`edit-tag`, `mark-all-as-read`) answer "OK" and need the action
//   token `T` of `GET reader/api/0/token` (401 without it). An unknown entry
//   id or feed id is "OK" too: nothing to tell;
// - categories have no id, only their name (`user/-/label/<name>`); feeds
//   are `feed/<integer>`; an entry id is the microsecond time FreshRSS stored
//   it, so ids only grow: decimal in `stream/items/ids`, 16 hex digits in
//   `tag:google.com,2005:reader/item/<hex>` elsewhere;
// - no call tells the feeds in error, nor refreshes a feed.
// -----------------------------------------------------------------------------

import { READ_TAG, scrubUrls } from './model.js';

export const DEFAULT_TIMEOUT = 15_000;

export const READING_LIST = 'user/-/state/com.google/reading-list';

export class FreshRssError extends Error {
  /**
   * @param {'unreachable' | 'unauthorized' | 'disabled' | 'redirect' | 'timeout' | 'http' | 'invalid' | 'rejected'} kind
   * @param {string} message never carries a credential
   * @param {number} [status]
   */
  constructor(kind, message, status) {
    super(message);
    this.name = 'FreshRssError';
    this.kind = kind;
    this.status = status;
  }
}

export class FreshRssClient {
  /**
   * @param {object} options
   * @param {string} options.url normalized base URL (see normalizeUrl)
   * @param {string} options.username
   * @param {string} options.password the API password
   * @param {typeof fetch} [options.fetch]
   * @param {number} [options.timeout]
   */
  constructor({ url, username, password, fetch: fetchImpl, timeout }) {
    this.url = url;
    this.username = username;
    this.password = password;
    this.fetch = fetchImpl ?? globalThis.fetch;
    this.timeout = timeout ?? DEFAULT_TIMEOUT;
    this.auth = null;
    this.actionToken = null;
  }

  /** One HTTP exchange: the raw text of a 2xx answer, or a FreshRssError. */
  async #exchange(method, path, { form, auth } = {}) {
    const headers = {};
    if (auth) {
      headers.Authorization = `GoogleLogin auth=${auth}`;
    }
    if (form) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
    }
    let response;
    let raw;
    try {
      response = await this.fetch(`${this.url}/api/greader.php/${path}`, {
        method,
        headers,
        body: form ? new URLSearchParams(form).toString() : undefined,
        signal: AbortSignal.timeout(this.timeout),
        redirect: 'follow',
      });
      raw = await response.text();
    } catch (err) {
      if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
        throw new FreshRssError('timeout', `No answer from FreshRSS within ${this.timeout} ms`);
      }
      const cause = err?.cause?.code ?? err?.cause?.message ?? err?.message ?? 'error';
      throw new FreshRssError('unreachable', `FreshRSS unreachable (${cause})`);
    }
    if (response.redirected && new URL(response.url).origin !== new URL(this.url).origin) {
      // fetch turns a redirected POST into a GET and drops Authorization on
      // another origin: the usual case is http:// redirected to https://.
      throw new FreshRssError('redirect', `${path}: redirected to another address`);
    }
    if (!response.ok) {
      throw FreshRssClient.#fail(path, response.status, raw);
    }
    return raw;
  }

  static #fail(path, status, raw) {
    let detail = raw.trim() || `HTTP ${status}`;
    if (/^\s*</.test(detail)) {
      detail = `HTTP ${status}`;
    }
    const kind =
      status === 401 || status === 403
        ? 'unauthorized'
        : status === 503 && /Service Unavailable!/.test(raw)
          ? 'disabled'
          : status === 400
            ? 'rejected'
            : status === 404
              ? 'invalid'
              : 'http';
    return new FreshRssError(
      kind,
      `${path.split('?')[0]}: ${scrubUrls(detail).replace(/\s+/g, ' ').slice(0, 120)}`,
      status,
    );
  }

  async #login() {
    let raw;
    try {
      raw = await this.#exchange('POST', 'accounts/ClientLogin', {
        form: { Email: this.username, Passwd: this.password },
      });
    } catch (err) {
      // 400: a user name FreshRSS does not accept (forbidden characters).
      if (err instanceof FreshRssError && err.kind === 'rejected') {
        throw new FreshRssError('unauthorized', 'accounts/ClientLogin: user name refused', 400);
      }
      throw err;
    }
    const auth = raw.match(/^Auth=(\S+)\s*$/m)?.[1];
    if (!auth) {
      // A proxy login page answering 200, a web server that is not FreshRSS.
      throw new FreshRssError('invalid', 'This address does not answer like FreshRSS');
    }
    this.auth = auth;
    return auth;
  }

  /**
   * An authenticated call; logs in first, and once more when the token was
   * refused (the API password changed meanwhile).
   */
  async #call(method, path, form) {
    const fresh = !this.auth;
    const auth = this.auth ?? (await this.#login());
    try {
      return await this.#exchange(method, path, { form, auth });
    } catch (err) {
      if (fresh || !(err instanceof FreshRssError) || err.kind !== 'unauthorized') {
        throw err;
      }
      this.actionToken = null;
      await this.#login();
      const signed = await this.#signed(form);
      return this.#exchange(method, path, { form: signed, auth: this.auth });
    }
  }

  /** A form with the action token of the current login, when it has one. */
  async #signed(form) {
    if (!form?.some(([key]) => key === 'T')) {
      return form;
    }
    const token = await this.#token();
    return form.map(([key, value]) => [key, key === 'T' ? token : value]);
  }

  async #token() {
    if (!this.actionToken) {
      const raw = await this.#call('GET', 'reader/api/0/token');
      this.actionToken = raw.trim();
    }
    return this.actionToken;
  }

  async #json(path, what) {
    const raw = await this.#call('GET', path);
    try {
      return JSON.parse(raw);
    } catch {
      throw new FreshRssError('invalid', `FreshRSS did not answer its ${what}`);
    }
  }

  /** A write: `edit-tag` or `mark-all-as-read`, with the action token. */
  async #write(path, fields) {
    const form = [...fields, ['T', await this.#token()]];
    const raw = await this.#call('POST', path, form);
    if (raw.trim() !== 'OK') {
      throw new FreshRssError('invalid', `${path}: unexpected answer`);
    }
  }

  /** `{ userId, userName }` */
  async userInfo() {
    const data = await this.#json('reader/api/0/user-info?output=json', 'user');
    if (typeof data?.userName !== 'string' || data.userName === '') {
      throw new FreshRssError('invalid', 'This address does not answer like FreshRSS');
    }
    return data;
  }

  /** `[{ id: 'feed/1', title, categories: [{ id, label }], htmlUrl, ... }]` */
  async subscriptions() {
    const data = await this.#json('reader/api/0/subscription/list?output=json', 'feeds');
    if (!Array.isArray(data?.subscriptions)) {
      throw new FreshRssError('invalid', 'FreshRSS did not answer its feeds');
    }
    return data.subscriptions;
  }

  /**
   * `counts`: `{ streamId: unread }` (`feed/1`, `user/-/label/<name>`, the
   * reading list); `stocked`: the streams holding at least one entry, read or
   * not (`newestItemTimestampUsec` is "0" for a feed never fetched).
   * @returns {Promise<{ counts: Record<string, number>, stocked: Set<string> }>}
   */
  async unreadCounts() {
    const data = await this.#json('reader/api/0/unread-count?output=json', 'counters');
    if (!Array.isArray(data?.unreadcounts)) {
      throw new FreshRssError('invalid', 'FreshRSS did not answer its counters');
    }
    const counts = {};
    const stocked = new Set();
    for (const row of data.unreadcounts) {
      const n = Number(row?.count);
      if (typeof row?.id === 'string' && Number.isInteger(n) && n >= 0) {
        counts[row.id] = n;
        if (n > 0 || /^[1-9]\d*$/.test(row.newestItemTimestampUsec ?? '')) {
          stocked.add(row.id);
        }
      }
    }
    return { counts, stocked };
  }

  /**
   * The newest entry ids of a stream (newest first), and whether there are more.
   * @returns {Promise<{ ids: string[], more: boolean }>}
   */
  async itemIds({ stream = READING_LIST, count = 50, unreadOnly = false } = {}) {
    const params = new URLSearchParams({ s: stream, n: String(count), output: 'json' });
    if (unreadOnly) {
      params.set('xt', READ_TAG);
    }
    const data = await this.#json(`reader/api/0/stream/items/ids?${params}`, 'entries');
    if (!Array.isArray(data?.itemRefs)) {
      throw new FreshRssError('invalid', 'FreshRSS did not answer its entries');
    }
    return {
      ids: data.itemRefs.map((ref) => ref?.id).filter((id) => /^\d{1,19}$/.test(id ?? '')),
      more: typeof data.continuation === 'string' && data.continuation !== '',
    };
  }

  /**
   * The entries of a stream, newest first.
   * @returns {Promise<object[]>} the raw items
   */
  async streamContents({ stream = READING_LIST, count = 20, unreadOnly = false } = {}) {
    const params = new URLSearchParams({ n: String(count), output: 'json' });
    if (unreadOnly) {
      params.set('xt', READ_TAG);
    }
    const path = `reader/api/0/stream/contents/${stream.split('/').map(encodeURIComponent).join('/')}`;
    const data = await this.#json(`${path}?${params}`, 'entries');
    if (!Array.isArray(data?.items)) {
      throw new FreshRssError('invalid', 'FreshRSS did not answer its entries');
    }
    return data.items;
  }

  /** The entries of some ids (decimal). */
  async itemContents(ids) {
    if (ids.length === 0) {
      return [];
    }
    const raw = await this.#call(
      'POST',
      'reader/api/0/stream/items/contents?output=json',
      ids.map((id) => ['i', id]),
    );
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      throw new FreshRssError('invalid', 'FreshRSS did not answer its entries');
    }
    if (!Array.isArray(data?.items)) {
      throw new FreshRssError('invalid', 'FreshRSS did not answer its entries');
    }
    return data.items;
  }

  /** @param {string[]} ids decimal entry ids */
  async markEntriesRead(ids) {
    await this.#write('reader/api/0/edit-tag', [...ids.map((id) => ['i', id]), ['a', READ_TAG]]);
  }

  /**
   * Every entry of a stream (`feed/<id>`, `user/-/label/<name>`, the reading
   * list) marked as read; `ts` 0 means up to now.
   */
  async markStreamRead(stream) {
    await this.#write('reader/api/0/mark-all-as-read', [
      ['s', stream],
      ['ts', '0'],
    ]);
  }
}
