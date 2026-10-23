# FreshRSS

Connect Gladys to [FreshRSS](https://freshrss.org), the self-hosted feed
aggregator: follow your unread articles per category and per feed, react when
a new article arrives, mark articles as read from your scenes, and see the
newest unread articles on the dashboard. The integration follows the state of
your reader (read / unread, the same in all your FreshRSS apps), not the feeds
themselves.

Tested against a real FreshRSS 1.30.4 (the official Docker image) with test
feeds. Feedback welcome on the Gladys forum.

## Prerequisites

- Gladys Assistant 5.1 or later.
- FreshRSS, at home or on a public server, reachable from the Gladys machine.
- The API of FreshRSS allowed: as an administrator, open **Administration →
  Authentication** and tick **Allow API access**.
- An API password for your user: open **Profile → API management**, enter an
  **API password** and save. It is not your login password; FreshRSS shows the
  API address on the same page.

## Configuration

1. Open the **Configuration** tab of the integration.
2. In **FreshRSS address**, enter the address you open FreshRSS at, for example
   `192.168.1.50:8080` (http when no scheme is given) or
   `https://rss.example.org`. The API address shown by FreshRSS
   (`…/api/greader.php`) works too.
3. Enter your **User name** and the **API password**.
4. Optional: **Read FreshRSS every** (5 minutes by default), and **Keywords to
   watch**, separated by commas, for the keyword filter of the "New article"
   trigger.
5. Click **Test the connection**: it shows the user, the unread articles, the
   feeds and the categories.
6. Open the **Discovery** tab and add the devices you want.

## Devices

- **FreshRSS**: _Unread articles_ (everything) and _FreshRSS online_ (0 while
  FreshRSS does not answer).
- **One device per category** and **one device per feed** (offered for each of
  them): their _Unread articles_.

The values are read every few minutes (the setting above) and right after
every change made from Gladys. They are kept in the history, for a chart of
your unread pile. To act above a threshold, use the device trigger of Gladys:
_Unread articles_ above 50, for instance.

## Dashboard widget

**FreshRSS**: the number of unread articles, the six newest unread articles
(feed, date, summary, links to the article and to the feed in FreshRSS when
they are https), a **Refresh** button that reads FreshRSS again now, and a
**Mark as read** button, with a confirmation, that marks the listed articles
as read (only them). Set to a category or a feed device, the widget shows that
one only.

## Scene triggers

- **New article**: an unread article arrived in FreshRSS. Filters: a category
  (a category device), a feed (a feed device), a keyword (one of the keywords
  of the configuration, found in the title, case and accents ignored).
  Information passed on: title, link, feed, category, author, keyword found,
  publication date and article id.

Nothing fires at the first read after installing the integration, nor for the
articles already there when a feed is added, nor for articles already read in
another app. At most 10 articles are announced per read.

## Scene actions

- **Mark FreshRSS articles as read**: every unread article of a category or a
  feed; pick the FreshRSS device to mark everything. Results: articles marked,
  category or feed.
- **Mark articles as read by id**: one or more article ids, typically the
  article id of the "New article" trigger. Result: articles marked.
- **Read the unread FreshRSS titles**: the newest unread articles (1 to 10), of
  everything or of a category or feed, optionally marked as read afterwards.
  Results: number read, unread articles in all, titles one per line ("Title —
  Feed"), title, link and feed of the newest one.

## Scene examples

- **Morning briefing**: at 7:30, _Read the unread FreshRSS titles_ (category
  News, 5 articles, then mark them as read), then send a Telegram message with
  its _Titles_ result (insert it with the variable picker).
- **Watch a topic**: with `Gladys` in the keywords, _New article_ with the
  keyword `Gladys` → send a message with the _Title_ and the _Link_ of the
  article, then _Mark articles as read by id_ with its _Article id_.
- **Too much to read**: device trigger _Unread articles_ of the FreshRSS
  device above 100 → _Mark FreshRSS articles as read_ on the category
  Uncategorized.

## Troubleshooting

- **"The API of FreshRSS is disabled"**: allow API access in Administration →
  Authentication (an administrator of FreshRSS has to do it).
- **"FreshRSS refused the user name or the API password"**: the API password is
  not the login password; set it again in Profile → API management.
- **"FreshRSS does not answer"**: check the address and the port from the
  Gladys machine. Behind a reverse proxy, enter the full address, path
  included.
- **"FreshRSS redirects to another address"**: FreshRSS answers on another
  address, often the same one in `https://`: enter that one.
- **"This address does not answer like FreshRSS"**: the address leads to
  another service, or to a login page (an authentication proxy in front of
  FreshRSS must let `/api/` through).
- **No "New article" event**: articles arrive when FreshRSS refreshes its feeds
  (its cron job, `CRON_MIN` in the official Docker image; each feed at most
  once per hour by default), then at the next read of the integration.
- More details: set the `LOG_LEVEL` variable of the integration to `debug`.

## Limits

- FreshRSS knows categories by their name only: renaming a category in
  FreshRSS offers a new device, the old one stays without values.
- The API of FreshRSS does not tell the feeds in error, and cannot ask for a
  refresh of the feeds: FreshRSS keeps its own schedule.
- The trigger filters only compare exact values: the keyword filter is one of
  the configured keywords, written as in the configuration (the first one
  found in the title).
- Starred articles, labels and the feeds themselves are not managed from
  Gladys. At most 100 categories and 200 feeds are offered as devices.
- The widget links open https addresses only: an article or a FreshRSS on
  plain http has no link.
- Not affiliated with FreshRSS.
