-- =============================================
-- FrameSphere Agency – Board-Schema (D1: webcontrol-hq)
-- =============================================
-- Rein additiv. Fasst keine bestehende Tabelle an.
-- Ausführen:  npm run db:agentur          (lokal)
--             npm run db:agentur:remote   (produktiv)
--
-- Grundidee: FUNKTION = Skill (wenige, generisch),
--            MITARBEITER = Datensatz (beliebig viele, austauschbar).
-- Jemanden einstellen = eine Zeile hier + eine Charakterdatei im
-- Agency-Repo. Kein neuer Skill, kein Deploy.
-- =============================================

-- Abteilungen (= Projekt-Kontext)
CREATE TABLE IF NOT EXISTS ag_abteilungen (
  id             TEXT PRIMARY KEY,        -- 'frametrain'
  name           TEXT NOT NULL,
  projekt        TEXT,                    -- verweist auf sites.id
  kontext_datei  TEXT,                    -- 'abteilungen/frametrain.md'
  beschreibung   TEXT,
  farbe          TEXT DEFAULT '#3b82f6',
  gsc_property   TEXT,                    -- exakt wie in der Search Console
  aktiv          INTEGER DEFAULT 1,
  sortierung     INTEGER DEFAULT 0,
  erstellt_am    DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Funktionen (= Skill). Wenige, generisch, ändern sich selten.
CREATE TABLE IF NOT EXISTS ag_funktionen (
  id            TEXT PRIMARY KEY,         -- 'seo-analyst'
  name          TEXT NOT NULL,            -- 'SEO-Analyst'
  skill         TEXT NOT NULL,            -- Skill-Name im Agency-Repo
  beschreibung  TEXT,
  icon          TEXT DEFAULT 'user',      -- lucide-Icon
  liefert       TEXT,                     -- was diese Funktion produziert
  aktiv         INTEGER DEFAULT 1,
  erstellt_am   DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Mitarbeiter (= Person). Beliebig erweiterbar.
CREATE TABLE IF NOT EXISTS ag_mitarbeiter (
  id                TEXT PRIMARY KEY,     -- 'marcel'
  name              TEXT NOT NULL,        -- 'Marcel'
  funktion_id       TEXT NOT NULL,
  abteilung_id      TEXT NOT NULL,
  charakter         TEXT,                 -- kurz, fürs Dashboard
  charakter_datei   TEXT,                 -- 'personal/marcel.md' im Agency-Repo
  farbe             TEXT DEFAULT '#3b82f6',
  avatar            TEXT DEFAULT 'a',     -- Variante des SVG-Avatars
  schreibtisch      INTEGER DEFAULT 0,    -- Platz im Büro (Sortierung)
  aktiv             INTEGER DEFAULT 1,    -- 0 = beurlaubt, bleibt sichtbar
  eingestellt_am    DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (funktion_id)  REFERENCES ag_funktionen(id),
  FOREIGN KEY (abteilung_id) REFERENCES ag_abteilungen(id)
);

-- Aufgaben. Übergabe = Wechsel von zustaendig + ein Eintrag der Art 'uebergabe'.
CREATE TABLE IF NOT EXISTS ag_aufgaben (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  abteilung_id      TEXT NOT NULL,
  titel             TEXT NOT NULL,
  beschreibung      TEXT,
  status            TEXT NOT NULL DEFAULT 'offen',
    -- offen | in_arbeit | zur_pruefung | zur_freigabe | erledigt | fehlgeschlagen | verworfen
  zustaendig        TEXT,                 -- ag_mitarbeiter.id
  uebergeben_von    TEXT,                 -- ag_mitarbeiter.id
  prioritaet        TEXT DEFAULT 'normal',-- niedrig | normal | hoch
  modus             TEXT DEFAULT 'einzeln', -- einzeln | runde
  runde_teilnehmer  TEXT,                 -- JSON-Array mitarbeiter_id, Reihenfolge
  runde_index       INTEGER DEFAULT 0,    -- wer ist als Nächstes dran
  quelle_befund_id  INTEGER,              -- falls aus einem Befund entstanden
  erstellt_von      TEXT DEFAULT 'mensch',
  erstellt_am       DATETIME DEFAULT CURRENT_TIMESTAMP,
  aktualisiert_am   DATETIME DEFAULT CURRENT_TIMESTAMP,
  faellig_am        TEXT,
  erledigt_am       DATETIME
);

-- Läufe. Ein Lauf = eine Session eines Mitarbeiters.
CREATE TABLE IF NOT EXISTS ag_laeufe (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  mitarbeiter_id    TEXT NOT NULL,
  abteilung_id      TEXT NOT NULL,
  ausloeser         TEXT DEFAULT 'manuell',  -- manuell | cron | actions | kette
  gestartet_am      DATETIME DEFAULT CURRENT_TIMESTAMP,
  beendet_am        DATETIME,
  status            TEXT DEFAULT 'laeuft',   -- laeuft | erfolgreich | leerlauf | fehlgeschlagen
  zusammenfassung   TEXT,
  fehler            TEXT,
  aufgaben_beruehrt INTEGER DEFAULT 0,
  eintraege_anzahl  INTEGER DEFAULT 0,
  dauer_ms          INTEGER,
  kosten_tokens     INTEGER,
  kosten_usd        REAL      -- was der Lauf tatsächlich gekostet hat
);

-- Einträge = der Verlauf. Alles, was jemand produziert, landet hier.
CREATE TABLE IF NOT EXISTS ag_eintraege (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  aufgabe_id     INTEGER,
  lauf_id        INTEGER,
  abteilung_id   TEXT NOT NULL,
  mitarbeiter_id TEXT,
  art            TEXT NOT NULL DEFAULT 'notiz',
    -- bericht | uebergabe | befund | beitrag | pruefung | fehler | notiz
  titel          TEXT,
  text           TEXT,                    -- Markdown
  artefakt_url   TEXT,
  daten          TEXT,                    -- optionales JSON (Zahlen für Diagramme)
  erstellt_am    DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Befunde = konkrete Fundstücke (veraltet / kaputt / fehlt / seo).
CREATE TABLE IF NOT EXISTS ag_befunde (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  abteilung_id    TEXT NOT NULL,
  lauf_id         INTEGER,
  mitarbeiter_id  TEXT,
  art             TEXT NOT NULL DEFAULT 'veraltet',
    -- veraltet | kaputt | fehlt | seo | inhalt
  schwere         TEXT DEFAULT 'mittel',  -- hoch | mittel | niedrig
  titel           TEXT NOT NULL,
  beschreibung    TEXT,
  url             TEXT,                   -- wo gefunden
  beleg           TEXT,                   -- Zitat/Messwert, macht es prüfbar
  soll            TEXT,                   -- was stattdessen stimmen müsste
  status          TEXT DEFAULT 'offen',   -- offen | aufgabe | erledigt | verworfen
  aufgabe_id      INTEGER,
  fingerprint     TEXT,                   -- verhindert Dubletten über Läufe hinweg
  erstellt_am     DATETIME DEFAULT CURRENT_TIMESTAMP,
  aktualisiert_am DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Kennzahlen = Zeitreihe für die Diagramme (Search Console u. a.)
CREATE TABLE IF NOT EXISTS ag_kennzahlen (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  abteilung_id  TEXT NOT NULL,
  datum         TEXT NOT NULL,            -- YYYY-MM-DD
  quelle        TEXT NOT NULL DEFAULT 'gsc',
  name          TEXT NOT NULL,            -- klicks | impressionen | ctr | position
  wert          REAL NOT NULL,
  dimension     TEXT DEFAULT '',          -- '' = Gesamtwert. Nie NULL: SQLite
                                          -- behandelt NULLs in UNIQUE als
                                          -- verschieden, ON CONFLICT griffe nicht.
  erstellt_am   DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(abteilung_id, datum, quelle, name, dimension)
);

-- ── Indizes ──────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS ix_ag_aufgaben_abt    ON ag_aufgaben(abteilung_id, status);
CREATE INDEX IF NOT EXISTS ix_ag_aufgaben_zust   ON ag_aufgaben(zustaendig, status);
CREATE INDEX IF NOT EXISTS ix_ag_eintraege_auf   ON ag_eintraege(aufgabe_id, id);
CREATE INDEX IF NOT EXISTS ix_ag_eintraege_lauf  ON ag_eintraege(lauf_id);
CREATE INDEX IF NOT EXISTS ix_ag_eintraege_abt   ON ag_eintraege(abteilung_id, id);
CREATE INDEX IF NOT EXISTS ix_ag_laeufe_mit      ON ag_laeufe(mitarbeiter_id, id);
CREATE INDEX IF NOT EXISTS ix_ag_laeufe_offen    ON ag_laeufe(status, beendet_am);
CREATE INDEX IF NOT EXISTS ix_ag_befunde_abt     ON ag_befunde(abteilung_id, status);
CREATE INDEX IF NOT EXISTS ix_ag_befunde_fp      ON ag_befunde(fingerprint);
CREATE INDEX IF NOT EXISTS ix_ag_kennzahlen      ON ag_kennzahlen(abteilung_id, name, datum);

-- ── Grundbestand ─────────────────────────────────────────────────

INSERT OR IGNORE INTO ag_abteilungen (id, name, projekt, kontext_datei, beschreibung, farbe, gsc_property, sortierung) VALUES
  ('frametrain', 'FrameTrain', 'frametrain', 'abteilungen/frametrain.md',
   'Desktop-App und Webseite frame-train.com', '#f59e0b', 'https://frame-train.com/', 1);

INSERT OR IGNORE INTO ag_funktionen (id, name, skill, beschreibung, icon, liefert) VALUES
  ('seo-analyst',     'SEO-Analyst',      'seo-analyst',
   'Wertet Search-Console-Werte aus: hohe Impressionen bei niedriger CTR, Position 8–15, Rankingverluste über vier Wochen.',
   'trending-up', 'bericht'),
  ('inhalts-pruefer', 'Inhalts-Prüfer',   'inhalts-pruefer',
   'Geht die Webseite durch und meldet Veraltetes, Kaputtes und Fehlendes – jeweils mit URL und Beleg.',
   'file-search',  'befund'),
  ('marketing',       'Marketing-Manager','marketing',
   'Macht aus Berichten Texte und Posts. Alles landet zur Freigabe, nichts geht ungeprüft raus.',
   'megaphone',    'entwurf'),
  ('pruefer',         'Qualitätssicherung','pruefer',
   'Sieht nur das Ergebnis, nie die Begründung. Prüft gegen feste Checkliste: bestanden oder durchgefallen.',
   'shield-check', 'pruefung'),
  ('product-owner',   'Product Owner',    'product-owner',
   'Macht aus Befunden maximal drei Aufgaben pro Lauf, sortiert nach Aufwand und Wirkung. Verwirft begründet.',
   'list-checks',  'aufgaben'),
  ('abteilungsleiter','Abteilungsleiter', 'abteilungsleiter',
   'Verteilt Aufgaben, fasst Diskussionsrunden zusammen, eskaliert Hänger. Wird ab drei Personen je Abteilung besetzt.',
   'users',        'zusammenfassung'),
  ('fehler-analyst',  'Fehler-Analyst',   'fehler-analyst',
   'Arbeitet gemeldete App-Fehler auf und übergibt sie mit Ursachenanalyse an den Programmierer.',
   'bug',          'befund'),
  ('programmierer',   'Programmierer',    'programmierer',
   'Erarbeitet Lösungsvorschläge zu übergebenen Befunden. Dockt an die bestehende Auto-Fix-Pipeline an.',
   'code',         'vorschlag');

INSERT OR IGNORE INTO ag_mitarbeiter
  (id, name, funktion_id, abteilung_id, charakter, charakter_datei, farbe, avatar, schreibtisch, aktiv) VALUES
  ('marcel',  'Marcel',  'seo-analyst',     'frametrain',
   'Nüchtern, zahlenfixiert. Jede Aussage mit Zahl, Zeitraum und Quelle. Bei dünner Datenlage: keine Aussage.',
   'personal/marcel.md',  '#22c55e', 'a', 1, 1),
  ('juergen', 'Jürgen',  'inhalts-pruefer', 'frametrain',
   'Pedantisch und kleinlich. Meldet nur, was gegen den Soll-Stand belegbar falsch ist – mit URL und Zitat.',
   'personal/juergen.md', '#06b6d4', 'b', 2, 1),
  ('florian', 'Florian', 'marketing',       'frametrain',
   'Erzählerisch und schnell, neigt zum Übertreiben. Darf keine Zahl nennen, die nicht im Board steht.',
   'personal/florian.md', '#a855f7', 'c', 3, 1),
  ('kilian',  'Kilian',  'pruefer',         'frametrain',
   'Misstrauisch und wortkarg. Sieht nur das Ergebnis. Antwortet bestanden oder durchgefallen, sonst nichts.',
   'personal/kilian.md',  '#f59e0b', 'd', 4, 1),
  ('sven',    'Sven',    'product-owner',   'frametrain',
   'Pragmatisch, sagt oft Nein. Maximal drei Aufgaben pro Lauf, sortiert nach Aufwand und Wirkung.',
   'personal/sven.md',    '#ef4444', 'e', 5, 1);

-- =============================================
-- MARKETING: Kampagnen, Ergebnisse, Wissenspool
-- =============================================
-- Marketing hängt nicht in der Kette, sondern plant selbst. Dafür braucht
-- es drei Dinge, die Aufgaben und Einträge nicht leisten: eine Kampagne als
-- eigenes Objekt, Ergebnisse mit Herkunft, und Wissen, das einzelne Läufe
-- überlebt.

CREATE TABLE IF NOT EXISTS ag_kampagnen (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  abteilung_id    TEXT NOT NULL,
  titel           TEXT NOT NULL,
  ziel            TEXT,                     -- was erreicht werden soll
  hypothese       TEXT,                     -- warum das funktionieren sollte
  kanal           TEXT,                     -- reddit | instagram | changelog | blog | …
  produkt         TEXT,                     -- sites.id, falls produktbezogen
  status          TEXT DEFAULT 'geplant',   -- geplant | laeuft | beendet | ausgewertet | verworfen
  verantwortlich  TEXT,                     -- ag_mitarbeiter.id
  start_am        TEXT,
  ende_am         TEXT,
  fazit           TEXT,                     -- Rückblick, entsteht beim Auswerten
  erstellt_am     DATETIME DEFAULT CURRENT_TIMESTAMP,
  aktualisiert_am DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Ergebnisse mit Herkunft. 'gemessen' kommt aus eigenen Daten,
-- 'berichtet' trägt ein Mensch nach. Der Unterschied muss sichtbar
-- bleiben, sonst wird aus einer Schätzung im nächsten Rückblick ein Fakt.
CREATE TABLE IF NOT EXISTS ag_kampagnen_ergebnisse (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  kampagne_id   INTEGER NOT NULL,
  herkunft      TEXT NOT NULL DEFAULT 'berichtet',  -- gemessen | berichtet
  quelle        TEXT,                     -- analytics | revenue | reddit | umfrage | …
  name          TEXT NOT NULL,            -- upvotes | kommentare | klicks | anmeldungen | …
  wert          REAL NOT NULL,
  einheit       TEXT,
  datum         TEXT,
  notiz         TEXT,
  erfasst_von   TEXT,                     -- mitarbeiter_id oder 'mensch'
  erstellt_am   DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Wissenspool: was gelernt wurde, unabhängig von einzelnen Aufgaben.
-- Ohne das beginnt jede Kampagne wieder bei null.
CREATE TABLE IF NOT EXISTS ag_wissen (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  abteilung_id  TEXT NOT NULL,
  thema         TEXT NOT NULL,
  kanal         TEXT,
  text          TEXT NOT NULL,
  beleg         TEXT,                     -- woran es sich zeigte
  kampagne_id   INTEGER,                  -- woraus es stammt
  verlaesslich  TEXT DEFAULT 'beobachtung', -- gemessen | beobachtung | vermutung
  veraltet      INTEGER DEFAULT 0,
  erstellt_von  TEXT,
  erstellt_am   DATETIME DEFAULT CURRENT_TIMESTAMP,
  aktualisiert_am DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS ix_ag_kampagnen_abt ON ag_kampagnen(abteilung_id, status);
CREATE INDEX IF NOT EXISTS ix_ag_kerg_kampagne ON ag_kampagnen_ergebnisse(kampagne_id);
CREATE INDEX IF NOT EXISTS ix_ag_wissen_abt    ON ag_wissen(abteilung_id, veraltet);

-- ── Marketing als eigene Abteilung ───────────────────────────────
INSERT OR IGNORE INTO ag_abteilungen (id, name, projekt, kontext_datei, beschreibung, farbe, sortierung) VALUES
  ('marketing', 'Marketing', NULL, 'abteilungen/marketing.md',
   'Plant und fährt eigene Kampagnen über alle Produkte', '#a855f7', 2);

INSERT OR IGNORE INTO ag_funktionen (id, name, skill, beschreibung, icon, liefert) VALUES
  ('marketing-leitung', 'Marketing-Leitung', 'marketing-leitung',
   'Plant Kampagnen, terminiert die Arbeit der Abteilung, wertet Abgeschlossenes aus und pflegt den Wissenspool.',
   'clipboard-list', 'kampagne'),
  ('texter', 'Texter', 'texter',
   'Schreibt Texte für Web, Blog und Newsletter nach Auftrag der Leitung.',
   'pen-tool', 'entwurf'),
  ('reddit-texter', 'Reddit-Spezialist', 'reddit-texter',
   'Schreibt für Reddit: Communityton, kein Werbesprech, kennt die Regeln der jeweiligen Subreddits.',
   'message-circle', 'entwurf'),
  ('changelog-texter', 'Changelog-Spezialist', 'changelog-texter',
   'Macht aus Commits und Releases verständliche Änderungshinweise, zweisprachig.',
   'file-clock', 'entwurf');

INSERT OR IGNORE INTO ag_mitarbeiter
  (id, name, funktion_id, abteilung_id, charakter, charakter_datei, farbe, avatar, schreibtisch, aktiv) VALUES
  ('nina', 'Nina', 'marketing-leitung', 'marketing',
   'Plant in Wochen, nicht in Posts. Fragt bei jeder Idee zuerst, woran man merken würde, dass sie funktioniert hat.',
   'personal/nina.md', '#a855f7', 'c', 1, 1),
  ('tom', 'Tom', 'texter', 'marketing',
   'Handwerker am Satz. Schreibt lieber kurz und konkret als klug. Hasst Füllwörter.',
   'personal/tom.md', '#60a5fa', 'a', 3, 1),
  ('ben', 'Ben', 'reddit-texter', 'marketing',
   'Liest mehr als er schreibt. Erkennt Werbesprech auf hundert Meter und würde selbst nie so posten.',
   'personal/ben.md', '#f97316', 'd', 4, 1),
  ('lena', 'Lena', 'changelog-texter', 'marketing',
   'Übersetzt Technik in Klartext. Nennt beim Namen, was sich für den Nutzer ändert, und lässt weg, was ihn nicht betrifft.',
   'personal/lena.md', '#22d3ee', 'b', 5, 1);

-- Florian zieht ins Marketing um: dort ist er Allrounder, in der
-- FrameTrain-Kette war er ein Anhängsel ohne Auftraggeber.
UPDATE ag_mitarbeiter SET abteilung_id='marketing', schreibtisch=2 WHERE id='florian';

-- =============================================
-- ENTWICKLUNG, LEITUNG UND DER RÜCKKANAL ZU KAROL
-- =============================================

-- Fragen an den Menschen. Ohne diesen Kanal blockiert jede Rolle, die etwas
-- nicht entscheiden kann – oder schlimmer: sie rät und schreibt es hin.
CREATE TABLE IF NOT EXISTS ag_fragen (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  abteilung_id   TEXT NOT NULL,
  mitarbeiter_id TEXT,
  aufgabe_id     INTEGER,
  frage          TEXT NOT NULL,
  kontext        TEXT,                     -- warum es ohne Antwort nicht weitergeht
  dringlichkeit  TEXT DEFAULT 'normal',    -- blockiert | normal | irgendwann
  status         TEXT DEFAULT 'offen',     -- offen | beantwortet | verworfen
  antwort        TEXT,
  beantwortet_am DATETIME,
  erstellt_am    DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS ix_ag_fragen_status ON ag_fragen(status, dringlichkeit);
CREATE INDEX IF NOT EXISTS ix_ag_fragen_abt    ON ag_fragen(abteilung_id, status);

-- ── Entwicklung und Leitung ──────────────────────────────────────
INSERT OR IGNORE INTO ag_abteilungen (id, name, projekt, kontext_datei, beschreibung, farbe, sortierung) VALUES
  ('entwicklung', 'Entwicklung', NULL, 'abteilungen/entwicklung.md',
   'Nimmt Aufträge aller Abteilungen an und erarbeitet Lösungen', '#22c55e', 3),
  ('leitung', 'Leitung', NULL, 'abteilungen/leitung.md',
   'Behält das Ganze im Blick, priorisiert zwischen Abteilungen, berichtet an Karol', '#ef4444', 0);

INSERT OR IGNORE INTO ag_funktionen (id, name, skill, beschreibung, icon, liefert) VALUES
  ('code-analyst', 'Code-Analyst', 'code-analyst',
   'Nimmt eingehende Aufträge und Fehler an, findet die Ursache und leitet an den richtigen Spezialisten weiter.',
   'search-code', 'befund'),
  ('desktop-entwickler', 'Desktop-Entwickler', 'desktop-entwickler',
   'Tauri, React, TypeScript und Rust in der Desktop-App. Erarbeitet Lösungsvorschläge mit Datei und Zeile.',
   'monitor', 'vorschlag'),
  ('web-entwickler', 'Web-Entwickler', 'web-entwickler',
   'Next.js, Vercel, Tailwind auf den Webseiten. Setzt Anforderungen von Marketing und SEO in konkrete Änderungen um.',
   'globe', 'vorschlag'),
  ('datenbank-entwickler', 'Datenbank-Entwickler', 'datenbank-entwickler',
   'D1, Supabase, Worker-APIs. Schema, Migrationen, Abfragen – und die Frage, was Daten überhaupt hergeben.',
   'database', 'vorschlag'),
  ('agentur-leitung', 'Leitung', 'agentur-leitung',
   'Sieht alle Abteilungen, priorisiert zwischen ihnen, erkennt Hänger und schreibt Karol die Lage.',
   'crown', 'lagebericht');

INSERT OR IGNORE INTO ag_mitarbeiter
  (id, name, funktion_id, abteilung_id, charakter, charakter_datei, farbe, avatar, schreibtisch, aktiv) VALUES
  ('viktor', 'Viktor', 'agentur-leitung', 'leitung',
   'Fragt bei allem zuerst, was liegen bleibt, wenn man es macht. Schreibt kurz, weil Karol wenig Zeit hat.',
   'personal/viktor.md', '#ef4444', 'e', 1, 1),
  ('anna', 'Anna', 'code-analyst', 'entwicklung',
   'Sucht die Ursache, nicht den Schuldigen. Gibt nichts weiter, was sie nicht selbst nachvollzogen hat.',
   'personal/anna.md', '#22c55e', 'b', 1, 1),
  ('dominik', 'Dominik', 'desktop-entwickler', 'entwicklung',
   'Kennt die App von innen. Misstraut Änderungen, die er nicht lokal nachstellen kann.',
   'personal/dominik.md', '#3b82f6', 'a', 2, 1),
  ('sarah', 'Sarah', 'web-entwickler', 'entwicklung',
   'Denkt vom Besucher her. Fragt bei jeder Anforderung, was der Nutzer davon hat.',
   'personal/sarah.md', '#f59e0b', 'c', 3, 1),
  ('elias', 'Elias', 'datenbank-entwickler', 'entwicklung',
   'Vorsichtig bei allem, was Daten verändert. Schreibt Migrationen so, dass sie zweimal laufen können.',
   'personal/elias.md', '#06b6d4', 'd', 4, 1);

-- =============================================
-- TAKT: wie viel darf die Agentur wann verbrauchen
-- =============================================
-- Eine Zeile, von Karol über Regler im Manager gepflegt.
--
-- kontingent_tokens ist ein ANGENOMMENER Bezugswert für ein volles
-- 5-Stunden-Fenster – Anthropic gibt keinen Tokenwert für Abo-Limits heraus.
-- Die Prozentwerte je Tagesblock sagen, welchen Anteil davon die Agentur in
-- diesem Block nutzen darf. Karols eigene Arbeit ist darin NICHT enthalten;
-- deshalb ist der Anteil bewusst kleiner als das, was er selbst spürt.
CREATE TABLE IF NOT EXISTS ag_takt (
  id                 INTEGER PRIMARY KEY CHECK (id = 1),
  kontingent_tokens  INTEGER NOT NULL DEFAULT 12000000,
  block_morgen       INTEGER NOT NULL DEFAULT 25,   -- 06–12 Uhr
  block_nachmittag   INTEGER NOT NULL DEFAULT 60,   -- 12–18 Uhr
  block_abend        INTEGER NOT NULL DEFAULT 25,   -- 18–23 Uhr
  block_nacht        INTEGER NOT NULL DEFAULT 90,   -- 23–06 Uhr
  zeitzone           TEXT NOT NULL DEFAULT 'Europe/Berlin',
  fenster_stunden    INTEGER NOT NULL DEFAULT 5,
  aktiv              INTEGER NOT NULL DEFAULT 1,   -- Drosselung an/aus, NICHT der Ausschalter
  -- Pause: der Ausschalter. Getrennt von `aktiv`, weil das zwei Fragen sind –
  -- „wie stark bremsen wir" und „läuft überhaupt etwas". `pause_bis` leer heißt
  -- unbefristet; steht ein Zeitpunkt drin, hebt sich die Pause von selbst auf.
  pausiert           INTEGER NOT NULL DEFAULT 0,
  pause_bis          TEXT,
  pause_seit         TEXT,
  aktualisiert_am    DATETIME DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO ag_takt (id) VALUES (1);

-- =============================================
-- BÖRSE: Depot, Beobachtung, Kursverlauf
-- =============================================
-- Dieser Bereich liefert Faktenlage, keine Anlageberatung. Die Rollen
-- tragen Zahlen, Termine und Meldungen zusammen; entschieden wird von Karol.

-- Was Karol hält. Reine Buchführung.
CREATE TABLE IF NOT EXISTS ag_depot (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol        TEXT NOT NULL,
  name          TEXT,
  stueck        REAL NOT NULL DEFAULT 0,
  kaufkurs      REAL,                     -- je Stück, in Währung des Werts
  waehrung      TEXT DEFAULT 'USD',
  kaufdatum     TEXT,
  notiz         TEXT,
  aktiv         INTEGER DEFAULT 1,        -- 0 = verkauft, bleibt für die Historie
  erstellt_am   DATETIME DEFAULT CURRENT_TIMESTAMP,
  aktualisiert_am DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Beobachtungsliste: Werte ohne Bestand, die trotzdem verfolgt werden.
CREATE TABLE IF NOT EXISTS ag_watchlist (
  symbol       TEXT PRIMARY KEY,
  name         TEXT,
  grund        TEXT,                      -- warum beobachtet
  erstellt_am  DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Kursverlauf, den wir selbst aufbauen. Unabhängig davon, wie weit die
-- Historie des Anbieters auf der kostenlosen Stufe zurückreicht.
CREATE TABLE IF NOT EXISTS ag_kurse (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol         TEXT NOT NULL,
  datum          TEXT NOT NULL,           -- YYYY-MM-DD
  kurs           REAL NOT NULL,
  eroeffnung     REAL,
  hoch           REAL,
  tief           REAL,
  vortag         REAL,
  veraenderung_prozent REAL,
  quelle         TEXT DEFAULT 'finnhub',
  erstellt_am    DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(symbol, datum)
);

-- Kennzahlen und Termine je Wert, als Momentaufnahme.
CREATE TABLE IF NOT EXISTS ag_werte (
  symbol          TEXT PRIMARY KEY,
  name            TEXT,
  branche         TEXT,
  waehrung        TEXT,
  boerse          TEXT,
  marktwert       REAL,
  kgv             REAL,
  hoch_52w        REAL,
  tief_52w        REAL,
  naechste_zahlen TEXT,                   -- Datum der nächsten Quartalszahlen
  webseite        TEXT,
  aktualisiert_am DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS ix_ag_kurse_symbol ON ag_kurse(symbol, datum);
CREATE INDEX IF NOT EXISTS ix_ag_depot_aktiv  ON ag_depot(aktiv, symbol);

-- ── Abteilung Börse ──────────────────────────────────────────────
INSERT OR IGNORE INTO ag_abteilungen (id, name, projekt, kontext_datei, beschreibung, farbe, sortierung) VALUES
  ('boerse', 'Börse', NULL, 'abteilungen/boerse.md',
   'Research-Desk: trägt Zahlen, Termine und Meldungen zusammen. Entschieden wird von Karol.', '#eab308', 4);

INSERT OR IGNORE INTO ag_funktionen (id, name, skill, beschreibung, icon, liefert) VALUES
  ('markt-analyst', 'Marktanalyst', 'markt-analyst',
   'Verdichtet Kurse, Kennzahlen und Quartalszahlen zu einem Faktenbericht. Keine Empfehlungen.',
   'candlestick-chart', 'bericht'),
  ('nachrichten-analyst', 'Nachrichten-Analyst', 'nachrichten-analyst',
   'Sammelt Meldungen zu beobachteten Werten, mit Quelle und Datum, ohne Deutung.',
   'newspaper', 'bericht'),
  ('depot-beobachter', 'Depot-Beobachter', 'depot-beobachter',
   'Meldet Veränderungen an gehaltenen Werten: Kurssprünge, anstehende Termine, Dividenden.',
   'eye', 'befund');

INSERT OR IGNORE INTO ag_mitarbeiter
  (id, name, funktion_id, abteilung_id, charakter, charakter_datei, farbe, avatar, schreibtisch, aktiv) VALUES
  ('robert', 'Robert', 'markt-analyst', 'boerse',
   'Rechnet nach, bevor er etwas hinschreibt. Sagt "die Zahl sagt", nie "ich glaube".',
   'personal/robert.md', '#eab308', 'd', 1, 1),
  ('ines', 'Ines', 'nachrichten-analyst', 'boerse',
   'Unterscheidet zwischen Meldung und Meinung. Nennt bei allem die Quelle und das Datum.',
   'personal/ines.md', '#f97316', 'c', 2, 1),
  ('malte', 'Malte', 'depot-beobachter', 'boerse',
   'Aufmerksam, nicht nervös. Meldet, was sich geändert hat, und schweigt, wenn nichts war.',
   'personal/malte.md', '#06b6d4', 'a', 3, 1);

-- ADRs bilden die Heimataktie selten 1:1 ab. Ohne Faktor ergäbe
-- "ADR-Kurs × Stückzahl der Heimataktien" einen falschen Depotwert.
-- 1 = Kurs gilt unverändert je Stück.

-- Schwellen: was Karol gemeldet bekommen will. Malte prüft sie bei jedem
-- Lauf, das Terminal zeigt ausgelöste sofort. Ohne solche Vorgaben müsste
-- die Rolle raten, was wichtig ist – und würde entweder zu viel oder zu
-- wenig melden.
CREATE TABLE IF NOT EXISTS ag_schwellen (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol       TEXT,                     -- NULL = gilt für alle Werte
  art          TEXT NOT NULL,            -- kurs_unter | kurs_ueber | tag_bewegung
                                         -- | rsi_ueber | rsi_unter | ergebnis_unter
                                         -- | ergebnis_ueber | zahlen_in_tagen
  wert         REAL NOT NULL,
  notiz        TEXT,
  aktiv        INTEGER DEFAULT 1,
  zuletzt_aus  TEXT,                     -- wann zuletzt ausgelöst
  erstellt_am  DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS ix_ag_schwellen ON ag_schwellen(aktiv, symbol);

-- Hinweis: nachträgliche Spalten (gsc_property, kosten_usd, kampagne_id,
-- angefragt_von*, kurs_faktor) legt der Worker beim Start selbst an.
-- Als ALTER TABLE hier würden sie den zweiten Lauf dieser Datei abbrechen,
-- weil SQLite kein IF NOT EXISTS für Spalten kennt.

-- =============================================
-- HANDELSBUCH UND THESEN
-- =============================================
-- Das Journal ist die Voraussetzung für alles, was die Analysten über
-- Karols eigene Entscheidungen sagen können. Ohne festgehaltene Absicht
-- lässt sich hinterher nicht unterscheiden, was Können war und was Glück.
CREATE TABLE IF NOT EXISTS ag_trades (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol        TEXT NOT NULL,
  richtung      TEXT NOT NULL DEFAULT 'kauf',   -- kauf | verkauf
  stueck        REAL NOT NULL,
  kurs          REAL NOT NULL,
  waehrung      TEXT DEFAULT 'EUR',
  datum         TEXT NOT NULL,
  gebuehren     REAL DEFAULT 0,
  these         TEXT,                   -- warum, in eigenen Worten
  stopp         REAL,                   -- geplanter Ausstieg bei Fehlschlag
  ziel          REAL,
  risiko_euro   REAL,                   -- was bewusst eingesetzt wurde
  gefuehl       TEXT,                   -- ruhig | unsicher | gierig | Angst | ...
  ausstieg_grund TEXT,                  -- nur bei Verkäufen
  notiz         TEXT,
  erstellt_am   DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS ix_ag_trades ON ag_trades(symbol, datum);

-- Thesen: warum ein Wert gehalten wird, in prüfbare Annahmen zerlegt.
-- Die Analysten vergleichen neue Fakten dagegen – sie bewerten nicht,
-- sie melden Widerspruch.
CREATE TABLE IF NOT EXISTS ag_thesen (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol        TEXT NOT NULL,
  kern          TEXT NOT NULL,          -- die These in einem Satz
  annahmen      TEXT,                   -- JSON-Array prüfbarer Annahmen
  bricht_wenn   TEXT,                   -- woran Karol sie für widerlegt hält
  zeithorizont  TEXT,
  status        TEXT DEFAULT 'offen',   -- offen | bestaetigt | gebrochen | verworfen
  erstellt_am   DATETIME DEFAULT CURRENT_TIMESTAMP,
  aktualisiert_am DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS ix_ag_thesen ON ag_thesen(symbol, status);

-- Prüfungen einer These gegen neue Fakten. Eine Zeile je Befund.
CREATE TABLE IF NOT EXISTS ag_thesen_pruefung (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  these_id      INTEGER NOT NULL,
  richtung      TEXT NOT NULL,          -- stuetzt | widerspricht | offen
  fakt          TEXT NOT NULL,
  quelle        TEXT,
  datum         TEXT,
  mitarbeiter_id TEXT,
  lauf_id       INTEGER,
  erstellt_am   DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS ix_ag_thesen_pruef ON ag_thesen_pruefung(these_id, id);

-- ── Marktumfeld ────────────────────────────────────────────────────
-- Indizes, Devisen und Zinsen als Hintergrund für die Einzelwerte.
-- Bewusst eine eigene Tabelle statt Einträge in der Beobachtungsliste:
-- ein Zinssatz ist kein Wert, den man hält, und würde jede Depot-
-- Auswertung verfälschen.
CREATE TABLE IF NOT EXISTS ag_markt (
  schluessel    TEXT PRIMARY KEY,       -- z. B. eur_usd, de_10j, us_10j, spx
  art           TEXT NOT NULL,          -- index | devisen | zins
  name          TEXT NOT NULL,
  einheit       TEXT,                   -- % | Punkte | Kurs
  wert          REAL,
  vortag        REAL,
  stand         TEXT,                   -- Datum der Beobachtung
  quelle        TEXT,
  sortierung    INTEGER DEFAULT 0,
  aktualisiert_am DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ag_markt_verlauf (
  schluessel    TEXT NOT NULL,
  datum         TEXT NOT NULL,
  wert          REAL NOT NULL,
  PRIMARY KEY (schluessel, datum)
);

-- ── Bewertungsannahmen ─────────────────────────────────────────────
-- Die Zahlen eines Ertragswertverfahrens sind Annahmen, keine Daten.
-- Deshalb werden sie hier festgehalten, mit Datum und Urheber, damit
-- später nachvollziehbar ist, womit gerechnet wurde.
CREATE TABLE IF NOT EXISTS ag_bewertungen (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol        TEXT NOT NULL,
  verfahren     TEXT NOT NULL DEFAULT 'dcf',
  basis_cashflow REAL,                  -- freier Cashflow im Ausgangsjahr
  wachstum      REAL,                   -- % p. a. in der Detailphase
  jahre         INTEGER DEFAULT 5,
  ewiges_wachstum REAL,                 -- % nach der Detailphase
  kapitalkosten REAL,                   -- % WACC
  nettoschulden REAL DEFAULT 0,
  anteile       REAL,                   -- Anzahl Aktien
  waehrung      TEXT DEFAULT 'USD',
  notiz         TEXT,
  urheber       TEXT,
  erstellt_am   DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS ix_ag_bewertungen ON ag_bewertungen(symbol, id);
