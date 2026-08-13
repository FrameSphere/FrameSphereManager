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
