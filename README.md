# FreshRSS for Gladys Assistant

A [Gladys Assistant](https://gladysassistant.com) external integration for
[FreshRSS](https://freshrss.org), the self-hosted feed aggregator: unread
counts per category and per feed, a trigger on every new article, articles
marked as read from scenes, and the newest unread articles on the dashboard.

Tested against a real FreshRSS 1.30.4 (the official Docker image) with test
feeds; not yet on a real Gladys installation: feedback welcome.

## Features

- **Devices**: a **FreshRSS** device (unread articles, online), one device per
  category and one per feed (their unread articles), with history.
- **Scene trigger**: _New article_ (filters: category, feed, keyword of the
  title; title, link, feed, category, author, article id passed on). For a
  threshold, the device trigger of Gladys on _Unread articles_ does it.
- **Scene actions**: mark a category, a feed or everything as read, mark
  articles as read (the article id of the trigger), read the newest unread
  titles (for a message), optionally marking them as read.
- **Dashboard widget**: unread count, the six newest unread articles,
  _Refresh_ and _Mark as read_ (with a confirmation) buttons; for everything,
  a category or a feed.
- English, French, German and Spanish.

### Compared with gladys-rss and gladys-miniflux

[gladys-rss](https://github.com/LM1LC3N7/gladys-rss) reads RSS and Atom feeds
directly, without any account: perfect to follow a few feeds. This
integration follows **your FreshRSS reader** instead: what you already read on
your phone or your computer is read in Gladys too, the counters are your real
unread pile, and Gladys can mark articles as read. It mirrors
[gladys-miniflux](https://github.com/guim31/gladys-miniflux), for the users of
Miniflux.

## Requirements

- Gladys Assistant 5.1 or later.
- FreshRSS, at home or on a public server, reachable from the Gladys machine,
  with the API allowed (**Administration → Authentication → Allow API
  access**) and an API password for the user (**Profile → API management**).

## Installation

1. In Gladys, open **Integrations → Install from GitHub** and enter
   `https://github.com/guim31/gladys-freshrss`.
2. In the **Configuration** tab, enter the address of FreshRSS (for example
   `192.168.1.50:8080`), the user name and the API password, then **Test the
   connection**.
3. Add the devices you want from the **Discovery** tab.

The user guide is in [`docs/en.md`](docs/en.md) (also in
[French](docs/fr.md), [German](docs/de.md) and [Spanish](docs/es.md)); Gladys
links it from the Configuration screen.

## How it works

FreshRSS pushes nothing: the container reads it every 5 minutes by default (1
to 60) through its Google Reader compatible API (`/api/greader.php`, a
`ClientLogin` with the API password, then `subscription/list`, `unread-count`
and `stream/items/ids`; the contents of the new articles only when there are
some — FreshRSS article ids only grow). Marking as read uses `edit-tag` and
`mark-all-as-read`. The devices are published with `should_poll: false`; only
changed states are sent to Gladys. The ids the trigger needs are kept in
`/data/freshrss-state.json`, so a restart announces nothing twice.

## Limitations

- One FreshRSS user.
- The trigger fires at the next read, once FreshRSS has fetched the feeds on
  its own schedule (the API cannot ask for a refresh); at most ten new articles
  per read; nothing at the first read, nor for the backlog of a feed just
  added.
- FreshRSS knows categories by their name only: a renamed category becomes a
  new device. The API tells no feed errors.
- Feeds, labels and starred articles are not managed from Gladys.

## Development

```bash
npm ci
npm run format:check && npm run lint && npm test
npx -y github:GladysAssistant/integration-store --skip-image-check .
```

The tests run against the SDK's fake Gladys and a fake FreshRSS answering with
bodies recorded on a real FreshRSS 1.30.4 (`test/fixtures/freshrss/`).

## Credits

- [FreshRSS](https://github.com/FreshRSS/FreshRSS), by its contributors
  (AGPL-3.0): this integration only talks to its API and contains none of its
  code.
- The cover shows the FreshRSS logo, from the
  [FreshRSS repository](https://github.com/FreshRSS/FreshRSS/blob/edge/p/themes/icons/FreshRSS-logo.svg)
  (AGPL-3.0).
- The features, trigger and widget follow
  [gladys-miniflux](https://github.com/guim31/gladys-miniflux), whose style
  comes from [gladys-rss](https://github.com/LM1LC3N7/gladys-rss) by LM1LC3N7.

## Disclaimer

This project is not affiliated with, endorsed or sponsored by the FreshRSS
project.

## License

Apache-2.0, see [LICENSE](LICENSE).
