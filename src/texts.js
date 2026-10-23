// -----------------------------------------------------------------------------
// Every text the container produces, in the four languages of the Gladys
// interface, with the words of the FreshRSS interface (fr "non lus", "flux",
// "catégorie", de "ungelesen", "Feed", "Kategorie", es "no leídos", "fuente").
// German says "du", Spanish "usted" (test/i18n.test.js).
// -----------------------------------------------------------------------------

// Feature names (frozen by Gladys at creation).
export const NAMES = {
  en: { unread: 'Unread articles', online: 'FreshRSS online' },
  fr: { unread: 'Articles non lus', online: 'FreshRSS joignable' },
  de: { unread: 'Ungelesene Artikel', online: 'FreshRSS erreichbar' },
  es: { unread: 'Artículos no leídos', online: 'FreshRSS accesible' },
};

export const STATUS_TEXT = {
  en: {
    none: 'Enter the address of FreshRSS, a user name and its API password in the configuration.',
    invalid: 'The FreshRSS address is not valid: enter an address like 192.168.1.50:8080.',
    user: 'Enter your FreshRSS user name.',
    password: 'Enter the API password of the user (FreshRSS → Profile → API management).',
    unauthorized:
      'FreshRSS refused the user name or the API password: check them in Profile → API management.',
    disabled:
      'The API of FreshRSS is disabled: allow API access in Administration → Authentication.',
    unreachable: 'FreshRSS does not answer: check its address and that it is running.',
    error: 'FreshRSS answered with an error: see the logs of the integration.',
    invalid_answer: 'This address does not answer like FreshRSS: check the address and the port.',
  },
  fr: {
    none: "Saisissez l'adresse de FreshRSS, un nom d'utilisateur et son mot de passe d'API dans la configuration.",
    invalid:
      "L'adresse de FreshRSS n'est pas valide : saisissez une adresse comme 192.168.1.50:8080.",
    user: "Saisissez votre nom d'utilisateur FreshRSS.",
    password:
      "Saisissez le mot de passe d'API de l'utilisateur (FreshRSS → Profil → Gestion de l'API).",
    unauthorized:
      "FreshRSS a refusé le nom d'utilisateur ou le mot de passe d'API : vérifiez-les dans Profil → Gestion de l'API.",
    disabled:
      "L'API de FreshRSS est désactivée : autorisez l'accès par l'API dans Administration → Authentification.",
    unreachable: "FreshRSS ne répond pas : vérifiez son adresse et qu'il est démarré.",
    error: "FreshRSS a répondu par une erreur : consultez les journaux de l'intégration.",
    invalid_answer: "Cette adresse ne répond pas comme FreshRSS : vérifiez l'adresse et le port.",
  },
  de: {
    none: 'Gib in der Konfiguration die Adresse von FreshRSS, einen Benutzernamen und sein API-Passwort ein.',
    invalid: 'Die FreshRSS-Adresse ist ungültig: Gib eine Adresse wie 192.168.1.50:8080 ein.',
    user: 'Gib deinen FreshRSS-Benutzernamen ein.',
    password: 'Gib das API-Passwort des Benutzers ein (FreshRSS → Profil → API-Verwaltung).',
    unauthorized:
      'FreshRSS hat den Benutzernamen oder das API-Passwort abgelehnt: Prüfe sie unter Profil → API-Verwaltung.',
    disabled:
      'Die API von FreshRSS ist deaktiviert: Erlaube den API-Zugriff unter Administration → Authentifizierung.',
    unreachable: 'FreshRSS antwortet nicht: Prüfe die Adresse und ob es läuft.',
    error: 'FreshRSS hat mit einem Fehler geantwortet: Sieh dir die Logs der Integration an.',
    invalid_answer: 'Diese Adresse antwortet nicht wie FreshRSS: Prüfe Adresse und Port.',
  },
  es: {
    none: 'Introduzca la dirección de FreshRSS, un nombre de usuario y su contraseña de API en la configuración.',
    invalid:
      'La dirección de FreshRSS no es válida: introduzca una dirección como 192.168.1.50:8080.',
    user: 'Introduzca su nombre de usuario de FreshRSS.',
    password:
      'Introduzca la contraseña de API del usuario (FreshRSS → Perfil → Gestión de la API).',
    unauthorized:
      'FreshRSS rechazó el nombre de usuario o la contraseña de API: compruébelos en Perfil → Gestión de la API.',
    disabled:
      'La API de FreshRSS está desactivada: permita el acceso por API en Administración → Autenticación.',
    unreachable: 'FreshRSS no responde: compruebe su dirección y que esté en marcha.',
    error: 'FreshRSS respondió con un error: consulte los registros de la integración.',
    invalid_answer: 'Esta dirección no responde como FreshRSS: compruebe la dirección y el puerto.',
  },
};

/** "Test the connection" once FreshRSS answered. */
export const TEST_TEXT = {
  en: (user, unread, feeds, categories) =>
    `Connected to FreshRSS as ${user}: ${unread} unread article(s), ${feeds} feed(s) in ${categories} categor${categories === 1 ? 'y' : 'ies'}.`,
  fr: (user, unread, feeds, categories) =>
    `Connecté à FreshRSS en tant que ${user} : ${unread} article(s) non lu(s), ${feeds} flux dans ${categories} catégorie(s).`,
  de: (user, unread, feeds, categories) =>
    `Mit FreshRSS verbunden als ${user}: ${unread} ungelesene(r) Artikel, ${feeds} Feed(s) in ${categories} Kategorie(n).`,
  es: (user, unread, feeds, categories) =>
    `Conectado a FreshRSS como ${user}: ${unread} artículo(s) no leído(s), ${feeds} fuente(s) en ${categories} categoría(s).`,
};

export const INIT_FAILED = {
  en: 'The integration could not start: see its logs.',
  fr: "L'intégration n'a pas pu démarrer : consultez ses journaux.",
  de: 'Die Integration konnte nicht starten: Sieh dir ihre Logs an.',
  es: 'La integración no pudo iniciarse: consulte sus registros.',
};

// Errors of the scene actions and of the widget buttons. `{detail}` is the
// reason FreshRSS gave.
export const COMMAND_ERRORS = {
  en: {
    timeout: 'FreshRSS answered too late: the change may have been made anyway.',
    http: 'FreshRSS could not do it: {detail}',
    read: 'FreshRSS could not be read: {detail}',
    unreachable: 'FreshRSS does not answer: nothing was done.',
    unauthorized: 'FreshRSS refused the API password: nothing was done.',
    source: 'This category or feed is not in FreshRSS any more: pick another one.',
    ids: 'Enter one or more article ids (numbers separated by commas).',
  },
  fr: {
    timeout: 'FreshRSS a répondu trop tard : la modification a peut-être été faite quand même.',
    http: "FreshRSS n'a pas pu le faire : {detail}",
    read: "FreshRSS n'a pas pu être lu : {detail}",
    unreachable: "FreshRSS ne répond pas : rien n'a été fait.",
    unauthorized: "FreshRSS a refusé le mot de passe d'API : rien n'a été fait.",
    source: "Cette catégorie ou ce flux n'existe plus dans FreshRSS : choisissez-en un autre.",
    ids: "Saisissez un ou plusieurs identifiants d'article (nombres séparés par des virgules).",
  },
  de: {
    timeout: 'FreshRSS hat zu spät geantwortet: Die Änderung wurde vielleicht trotzdem gemacht.',
    http: 'FreshRSS konnte es nicht ausführen: {detail}',
    read: 'FreshRSS konnte nicht gelesen werden: {detail}',
    unreachable: 'FreshRSS antwortet nicht: Es wurde nichts getan.',
    unauthorized: 'FreshRSS hat das API-Passwort abgelehnt: Es wurde nichts getan.',
    source: 'Diese Kategorie oder diesen Feed gibt es in FreshRSS nicht mehr: Wähle etwas anderes.',
    ids: 'Gib eine oder mehrere Artikel-IDs ein (Zahlen, durch Kommas getrennt).',
  },
  es: {
    timeout:
      'FreshRSS respondió demasiado tarde: puede que el cambio se haya hecho de todos modos.',
    http: 'FreshRSS no pudo hacerlo: {detail}',
    read: 'No se pudo leer FreshRSS: {detail}',
    unreachable: 'FreshRSS no responde: no se ha hecho nada.',
    unauthorized: 'FreshRSS rechazó la contraseña de API: no se ha hecho nada.',
    source: 'Esta categoría o fuente ya no existe en FreshRSS: elija otra.',
    ids: 'Introduzca uno o varios identificadores de artículo (números separados por comas).',
  },
};

/** The toasts of the widget buttons. */
export const DONE_TEXT = {
  en: { read: 'Marked as read in FreshRSS.', refresh: 'FreshRSS read again.' },
  fr: { read: 'Marqué comme lu dans FreshRSS.', refresh: 'FreshRSS relu.' },
  de: { read: 'In FreshRSS als gelesen markiert.', refresh: 'FreshRSS neu gelesen.' },
  es: { read: 'Marcado como leído en FreshRSS.', refresh: 'FreshRSS leído de nuevo.' },
};

/** A coded message in every language, details filled in. */
export function commandMessage(code, values = {}) {
  return Object.fromEntries(
    Object.entries(COMMAND_ERRORS).map(([language, table]) => [
      language,
      (table[code] ?? table.unreachable).replace('{detail}', values.detail ?? '').slice(0, 200),
    ]),
  );
}

/** Every language of a table entry: `{ en: table.en[key], ... }`. */
export const each = (table, key) =>
  Object.fromEntries(Object.entries(table).map(([language, entries]) => [language, entries[key]]));

export const pick = (table, language) => table[language] ?? table.en;
