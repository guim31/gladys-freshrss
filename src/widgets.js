// -----------------------------------------------------------------------------
// The "FreshRSS" dashboard widget: the unread count, the newest unread
// articles, a "Refresh" button (FreshRSS read again now) and a "Mark as read"
// button (with a confirmation) for the articles listed. Set to a category or
// a feed device, the widget shows and marks that one only.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { CommandError, WIDGET_KEY } from './hub.js';
import { DONE_TEXT, NAMES, each, pick } from './texts.js';

export const MAX_ITEMS = 6;
export const ACTIONS = { read: 'mark_read', refresh: 'refresh' };

export const TEXT = {
  read: { en: 'Mark as read', fr: 'Marquer lu', de: 'Als gelesen markieren', es: 'Marcar leído' },
  refresh: { en: 'Refresh', fr: 'Actualiser', de: 'Aktualisieren', es: 'Actualizar' },
  open: {
    en: 'Read the article',
    fr: "Lire l'article",
    de: 'Artikel lesen',
    es: 'Leer el artículo',
  },
  open_freshrss: {
    en: 'Open in FreshRSS',
    fr: 'Ouvrir dans FreshRSS',
    de: 'In FreshRSS öffnen',
    es: 'Abrir en FreshRSS',
  },
  starred: { en: 'Starred', fr: 'Favori', de: 'Favorit', es: 'Favorito' },
  empty: {
    en: 'Nothing left to read.',
    fr: 'Plus rien à lire.',
    de: 'Nichts mehr zu lesen.',
    es: 'No queda nada por leer.',
  },
  unavailable: {
    en: 'FreshRSS does not answer right now.',
    fr: 'FreshRSS ne répond pas pour le moment.',
    de: 'FreshRSS antwortet gerade nicht.',
    es: 'FreshRSS no responde en este momento.',
  },
  waiting: {
    en: 'Waiting for FreshRSS: check the configuration of the integration.',
    fr: "En attente de FreshRSS : vérifiez la configuration de l'intégration.",
    de: 'Warte auf FreshRSS: Prüfe die Konfiguration der Integration.',
    es: 'Esperando a FreshRSS: compruebe la configuración de la integración.',
  },
};

const cut = (text, max) => (text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`);
const https = (url) => typeof url === 'string' && /^https:\/\//i.test(url) && url.length <= 2000;

function shortDate(iso, language) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return date.toLocaleDateString(
    { en: 'en-GB', fr: 'fr-FR', de: 'de-DE', es: 'es-ES' }[language] ?? 'en-GB',
    { day: 'numeric', month: 'short' },
  );
}

/** One row of the list. */
export function entryItem(entry, language, baseUrl) {
  const item = {
    title: cut(entry.title, 60),
    subtitle: cut(
      [entry.feed, shortDate(entry.published, language)].filter(Boolean).join(' · '),
      60,
    ),
  };
  if (entry.starred) {
    item.badge = { text: pick(TEXT.starred, language), color: WIDGET_COLORS.WARNING };
  }
  if (entry.summary) {
    item.description = cut(entry.summary, 600);
  }
  const links = [];
  // The links of a card must be https: an http article or FreshRSS is left out.
  if (https(entry.url)) {
    links.push({ url: entry.url, label: pick(TEXT.open, language) });
  }
  if (https(baseUrl) && Number.isInteger(entry.feedId)) {
    links.push({
      url: `${baseUrl}/i/?get=f_${entry.feedId}`,
      label: pick(TEXT.open_freshrss, language),
    });
  }
  if (links.length > 0) {
    item.links = links;
  }
  return item;
}

export async function buildContent(hub, { language = 'en', settings = {} } = {}) {
  if (!hub.loaded) {
    return {
      ttl_seconds: 60,
      components: [{ type: 'text', variant: 'body', text: pick(TEXT.waiting, language) }],
    };
  }
  const names = pick(NAMES, language);
  // A category or feed gone from FreshRSS shows the whole account.
  const scope = hub.scopeOf(settings?.source) ?? undefined;
  const components = [
    {
      type: 'value',
      label: cut(scope ? scope.name : names.unread, 24),
      value: scope ? scope.unread : hub.counters.unread,
      icon: 'inbox',
    },
  ];
  const entries = await hub.widgetEntries(scope, MAX_ITEMS);
  if (entries === null) {
    components.push({ type: 'text', variant: 'caption', text: pick(TEXT.unavailable, language) });
  } else if (entries.length === 0) {
    components.push({ type: 'text', variant: 'caption', text: pick(TEXT.empty, language) });
  } else {
    components.push({
      type: 'card-list',
      display: 'list',
      items: entries.map((e) => entryItem(e, language, hub.config.url ?? '')),
    });
  }
  components.push({
    type: 'button',
    label: pick(TEXT.refresh, language),
    icon: 'refresh-cw',
    style: 'secondary',
    action: { key: ACTIONS.refresh },
  });
  if (entries?.length > 0) {
    // Marks the entries listed, nothing else (not those arrived since).
    components.push({
      type: 'button',
      label: pick(TEXT.read, language),
      icon: 'check-circle',
      style: 'secondary',
      action: {
        key: ACTIONS.read,
        confirm: true,
        params: { entry_ids: entries.map((e) => e.id).join(',') },
      },
    });
  }
  // The hub nudges the widget after every read and every change.
  return { ttl_seconds: 300, components };
}

async function action(hub, { actionKey, params }) {
  const language = hub.language;
  try {
    if (actionKey === ACTIONS.refresh) {
      await hub.refresh();
      const status = hub.statusMessage();
      if (status) {
        throw new Error(pick(status, language));
      }
      return { message: each(DONE_TEXT, 'refresh') };
    }
    if (actionKey === ACTIONS.read) {
      // The entries the widget listed when it was drawn.
      await hub.markEntries(params?.entry_ids);
      return { message: each(DONE_TEXT, 'read') };
    }
  } catch (err) {
    if (err instanceof CommandError) {
      throw new Error(pick(err.messages, language), { cause: err });
    }
    throw err;
  }
  throw new Error(`Unknown action ${actionKey}`);
}

export const WIDGETS = {
  [WIDGET_KEY]: {
    get: (hub, request) => buildContent(hub, request),
    action,
  },
};
