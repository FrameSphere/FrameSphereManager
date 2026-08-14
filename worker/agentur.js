// =============================================
// FrameSphere Agency – Board-API
// =============================================
// Alle Routen unter /api/agentur/*.
//
// Zwei Zugänge:
//   • Dashboard  – X-Auth-Token (verifyAuth aus index.js)
//   • Runner     – Authorization: Bearer <AGENTUR_TOKEN>
//
// Grundsatz aus dem Umsetzungsplan: Rollen reden nicht miteinander.
// Eine "Übergabe" ist ein Wechsel von ag_aufgaben.zustaendig plus ein
// Eintrag der Art 'uebergabe'. Der Verlauf ist ag_eintraege nach Zeit.
// =============================================

import { gscSync, gscQueries, gscReport, gscInspect } from './gsc.js';

// Ein Lauf ohne Ende gilt nach zwei Stunden als abgestürzt.
const LAUF_TIMEOUT_MS = 2 * 60 * 60 * 1000;

const AUFGABE_STATUS = [
  'offen', 'in_arbeit', 'zur_pruefung', 'zur_freigabe',
  'erledigt', 'fehlgeschlagen', 'verworfen',
];
const EINTRAG_ART = [
  'bericht', 'uebergabe', 'befund', 'beitrag', 'pruefung', 'fehler', 'notiz',
];
const BEFUND_ART    = ['veraltet', 'kaputt', 'fehlt', 'seo', 'inhalt'];
const KAMPAGNE_STATUS = ['geplant', 'laeuft', 'beendet', 'ausgewertet', 'verworfen'];
const HERKUNFT      = ['gemessen', 'berichtet'];
const VERLAESSLICH  = ['gemessen', 'beobachtung', 'vermutung'];
// Wie lange nach einem Lauf derselbe Mitarbeiter vom Verteiler in Ruhe
// gelassen wird. Verhindert, dass eine hängende Aufgabe stündlich neue
// Läufe auslöst.
const VERTEILER_RUHE_STUNDEN = 3;
const BEFUND_STATUS = ['offen', 'aufgabe', 'erledigt', 'verworfen'];
const LAUF_STATUS   = ['laeuft', 'erfolgreich', 'leerlauf', 'fehlgeschlagen'];
const SCHWERE       = ['hoch', 'mittel', 'niedrig'];
const PRIORITAET    = ['niedrig', 'normal', 'hoch'];

// ── Tabellen sicherstellen (einmal je Isolate) ───────────────────
let tabellenBereit = false;

async function ensureAgenturTables(db) {
  if (tabellenBereit) return;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS ag_abteilungen (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, projekt TEXT, kontext_datei TEXT,
      beschreibung TEXT, farbe TEXT DEFAULT '#3b82f6', aktiv INTEGER DEFAULT 1,
      sortierung INTEGER DEFAULT 0, erstellt_am DATETIME DEFAULT CURRENT_TIMESTAMP
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS ag_funktionen (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, skill TEXT NOT NULL, beschreibung TEXT,
      icon TEXT DEFAULT 'user', liefert TEXT, aktiv INTEGER DEFAULT 1,
      erstellt_am DATETIME DEFAULT CURRENT_TIMESTAMP
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS ag_mitarbeiter (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, funktion_id TEXT NOT NULL,
      abteilung_id TEXT NOT NULL, charakter TEXT, charakter_datei TEXT,
      farbe TEXT DEFAULT '#3b82f6', avatar TEXT DEFAULT 'a', schreibtisch INTEGER DEFAULT 0,
      aktiv INTEGER DEFAULT 1, eingestellt_am DATETIME DEFAULT CURRENT_TIMESTAMP
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS ag_aufgaben (
      id INTEGER PRIMARY KEY AUTOINCREMENT, abteilung_id TEXT NOT NULL, titel TEXT NOT NULL,
      beschreibung TEXT, status TEXT NOT NULL DEFAULT 'offen', zustaendig TEXT,
      uebergeben_von TEXT, prioritaet TEXT DEFAULT 'normal', modus TEXT DEFAULT 'einzeln',
      runde_teilnehmer TEXT, runde_index INTEGER DEFAULT 0, quelle_befund_id INTEGER,
      erstellt_von TEXT DEFAULT 'mensch', erstellt_am DATETIME DEFAULT CURRENT_TIMESTAMP,
      aktualisiert_am DATETIME DEFAULT CURRENT_TIMESTAMP, faellig_am TEXT, erledigt_am DATETIME
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS ag_laeufe (
      id INTEGER PRIMARY KEY AUTOINCREMENT, mitarbeiter_id TEXT NOT NULL,
      abteilung_id TEXT NOT NULL, ausloeser TEXT DEFAULT 'manuell',
      gestartet_am DATETIME DEFAULT CURRENT_TIMESTAMP, beendet_am DATETIME,
      status TEXT DEFAULT 'laeuft', zusammenfassung TEXT, fehler TEXT,
      aufgaben_beruehrt INTEGER DEFAULT 0, eintraege_anzahl INTEGER DEFAULT 0,
      dauer_ms INTEGER, kosten_tokens INTEGER
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS ag_eintraege (
      id INTEGER PRIMARY KEY AUTOINCREMENT, aufgabe_id INTEGER, lauf_id INTEGER,
      abteilung_id TEXT NOT NULL, mitarbeiter_id TEXT, art TEXT NOT NULL DEFAULT 'notiz',
      titel TEXT, text TEXT, artefakt_url TEXT, daten TEXT,
      erstellt_am DATETIME DEFAULT CURRENT_TIMESTAMP
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS ag_befunde (
      id INTEGER PRIMARY KEY AUTOINCREMENT, abteilung_id TEXT NOT NULL, lauf_id INTEGER,
      mitarbeiter_id TEXT, art TEXT NOT NULL DEFAULT 'veraltet', schwere TEXT DEFAULT 'mittel',
      titel TEXT NOT NULL, beschreibung TEXT, url TEXT, beleg TEXT, soll TEXT,
      status TEXT DEFAULT 'offen', aufgabe_id INTEGER, fingerprint TEXT,
      erstellt_am DATETIME DEFAULT CURRENT_TIMESTAMP,
      aktualisiert_am DATETIME DEFAULT CURRENT_TIMESTAMP
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS ag_kennzahlen (
      id INTEGER PRIMARY KEY AUTOINCREMENT, abteilung_id TEXT NOT NULL, datum TEXT NOT NULL,
      quelle TEXT NOT NULL DEFAULT 'gsc', name TEXT NOT NULL, wert REAL NOT NULL,
      dimension TEXT, erstellt_am DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(abteilung_id, datum, quelle, name, dimension)
    )`),
    db.prepare('CREATE INDEX IF NOT EXISTS ix_ag_aufgaben_abt ON ag_aufgaben(abteilung_id, status)'),
    db.prepare('CREATE INDEX IF NOT EXISTS ix_ag_aufgaben_zust ON ag_aufgaben(zustaendig, status)'),
    db.prepare('CREATE INDEX IF NOT EXISTS ix_ag_eintraege_auf ON ag_eintraege(aufgabe_id, id)'),
    db.prepare('CREATE INDEX IF NOT EXISTS ix_ag_eintraege_lauf ON ag_eintraege(lauf_id)'),
    db.prepare('CREATE INDEX IF NOT EXISTS ix_ag_eintraege_abt ON ag_eintraege(abteilung_id, id)'),
    db.prepare('CREATE INDEX IF NOT EXISTS ix_ag_laeufe_mit ON ag_laeufe(mitarbeiter_id, id)'),
    db.prepare('CREATE INDEX IF NOT EXISTS ix_ag_laeufe_offen ON ag_laeufe(status, beendet_am)'),
    db.prepare('CREATE INDEX IF NOT EXISTS ix_ag_befunde_abt ON ag_befunde(abteilung_id, status)'),
    db.prepare('CREATE INDEX IF NOT EXISTS ix_ag_befunde_fp ON ag_befunde(fingerprint)'),
    db.prepare('CREATE INDEX IF NOT EXISTS ix_ag_kennzahlen ON ag_kennzahlen(abteilung_id, name, datum)'),
  ]);
  // Marketing: Kampagnen, Ergebnisse, Wissenspool
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS ag_kampagnen (
      id INTEGER PRIMARY KEY AUTOINCREMENT, abteilung_id TEXT NOT NULL, titel TEXT NOT NULL,
      ziel TEXT, hypothese TEXT, kanal TEXT, produkt TEXT, status TEXT DEFAULT 'geplant',
      verantwortlich TEXT, start_am TEXT, ende_am TEXT, fazit TEXT,
      erstellt_am DATETIME DEFAULT CURRENT_TIMESTAMP,
      aktualisiert_am DATETIME DEFAULT CURRENT_TIMESTAMP
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS ag_kampagnen_ergebnisse (
      id INTEGER PRIMARY KEY AUTOINCREMENT, kampagne_id INTEGER NOT NULL,
      herkunft TEXT NOT NULL DEFAULT 'berichtet', quelle TEXT, name TEXT NOT NULL,
      wert REAL NOT NULL, einheit TEXT, datum TEXT, notiz TEXT, erfasst_von TEXT,
      erstellt_am DATETIME DEFAULT CURRENT_TIMESTAMP
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS ag_wissen (
      id INTEGER PRIMARY KEY AUTOINCREMENT, abteilung_id TEXT NOT NULL, thema TEXT NOT NULL,
      kanal TEXT, text TEXT NOT NULL, beleg TEXT, kampagne_id INTEGER,
      verlaesslich TEXT DEFAULT 'beobachtung', veraltet INTEGER DEFAULT 0, erstellt_von TEXT,
      erstellt_am DATETIME DEFAULT CURRENT_TIMESTAMP,
      aktualisiert_am DATETIME DEFAULT CURRENT_TIMESTAMP
    )`),
    db.prepare('CREATE INDEX IF NOT EXISTS ix_ag_kampagnen_abt ON ag_kampagnen(abteilung_id, status)'),
    db.prepare('CREATE INDEX IF NOT EXISTS ix_ag_kerg_kampagne ON ag_kampagnen_ergebnisse(kampagne_id)'),
    db.prepare('CREATE INDEX IF NOT EXISTS ix_ag_wissen_abt ON ag_wissen(abteilung_id, veraltet)'),
  ]);
  // Nachträgliche Spalten (schlagen fehl, wenn sie schon da sind – das ist ok)
  await db.prepare('ALTER TABLE ag_abteilungen ADD COLUMN gsc_property TEXT').run().catch(() => {});
  await db.prepare('ALTER TABLE ag_laeufe ADD COLUMN kosten_usd REAL').run().catch(() => {});
  await db.prepare('ALTER TABLE ag_aufgaben ADD COLUMN kampagne_id INTEGER').run().catch(() => {});
  tabellenBereit = true;
}

// ── Hilfen ───────────────────────────────────────────────────────
const txt = (v, max = 2000) => (v === undefined || v === null || v === '') ? null : String(v).slice(0, max);
const num = (v) => Number.isFinite(parseInt(v, 10)) ? parseInt(v, 10) : null;
const komma = (v) => Number.isFinite(parseFloat(v)) ? parseFloat(v) : null;
const einsAus = (v) => (v === 1 || v === true || v === '1') ? 1 : 0;
const jetzt = () => new Date().toISOString();

function einsVon(wert, erlaubt, fallback) {
  return erlaubt.includes(wert) ? wert : fallback;
}

function slugId(s) {
  return String(s || '').toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
}

async function fingerprintVon(...teile) {
  const roh = teile.filter(Boolean).join('|').toLowerCase();
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(roh));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

function istRunner(request, env) {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  const secret = env.AGENTUR_TOKEN;
  return !!secret && !!token && token === secret;
}

// Wer stellt die Anfrage? 'runner' | 'dashboard' | null
async function wer(request, env, verifyAuth) {
  if (istRunner(request, env)) return 'runner';
  if (await verifyAuth(request, env)) return 'dashboard';
  return null;
}

// Abgelaufene Läufe aufräumen: was länger als zwei Stunden ohne Ende
// dasteht, ist abgestürzt und wird als fehlgeschlagen markiert – statt
// still zu verschwinden oder den nächsten Lauf ewig zu blockieren.
async function laeufeAufraeumen(db) {
  const grenze = new Date(Date.now() - LAUF_TIMEOUT_MS).toISOString();
  await db.prepare(
    `UPDATE ag_laeufe
        SET status = 'fehlgeschlagen',
            beendet_am = ?,
            fehler = COALESCE(fehler, 'Zeitüberschreitung – Lauf hat sich nie zurückgemeldet')
      WHERE beendet_am IS NULL AND status = 'laeuft' AND gestartet_am < ?`
  ).bind(jetzt(), grenze).run().catch(() => {});
}

// ── Diskussionsrunde ─────────────────────────────────────────────
// Rollen laufen nacheinander, nie gleichzeitig. Eine "Diskussion" ist
// deshalb ein Staffellauf: jeder liest alle bisherigen Beiträge und hängt
// einen an. Das Weiterreichen macht der Server, damit es nicht daran
// scheitert, dass eine Rolle es vergisst.
async function rundeWeiter(db, aufgabeId, autorId) {
  const a = await db.prepare('SELECT * FROM ag_aufgaben WHERE id=?').bind(aufgabeId).first();
  if (!a || a.modus !== 'runde') return null;

  let teilnehmer = [];
  try { teilnehmer = JSON.parse(a.runde_teilnehmer || '[]'); } catch (e) { teilnehmer = []; }
  if (!Array.isArray(teilnehmer) || teilnehmer.length < 2) return null;

  const index = Number(a.runde_index) || 0;
  // Nur wer gerade dran ist, schiebt die Runde weiter. Sonst könnte ein
  // Nachzügler die Reihenfolge durcheinanderbringen.
  if (teilnehmer[index] !== autorId) {
    return { weitergereicht: false, grund: 'nicht an der Reihe', dran: teilnehmer[index] };
  }

  const naechsterIndex = index + 1;
  const jetztIso = jetzt();

  if (naechsterIndex < teilnehmer.length) {
    const naechster = teilnehmer[naechsterIndex];
    await db.prepare(
      `UPDATE ag_aufgaben SET runde_index=?, zustaendig=?, uebergeben_von=?,
              status='in_arbeit', faellig_am=?, aktualisiert_am=? WHERE id=?`
    ).bind(naechsterIndex, naechster, autorId, jetztIso, jetztIso, aufgabeId).run();
    await db.prepare(
      `INSERT INTO ag_eintraege (aufgabe_id, abteilung_id, mitarbeiter_id, art, titel, text)
       VALUES (?,?,?,'uebergabe',?,?)`
    ).bind(aufgabeId, a.abteilung_id, autorId,
           `Runde: weiter an ${naechster}`,
           `Beitrag ${naechsterIndex} von ${teilnehmer.length} liegt vor.`).run().catch(() => {});
    return { weitergereicht: true, dran: naechster, beitrag: naechsterIndex, von: teilnehmer.length };
  }

  // Runde durch: zurück an die Person, die sie einberufen hat.
  const moderator = a.erstellt_von && teilnehmer.includes(a.erstellt_von) === false && a.erstellt_von !== 'mensch'
    ? a.erstellt_von
    : teilnehmer[0];
  await db.prepare(
    `UPDATE ag_aufgaben SET zustaendig=?, uebergeben_von=?, status='in_arbeit',
            faellig_am=?, aktualisiert_am=? WHERE id=?`
  ).bind(moderator, autorId, jetztIso, jetztIso, aufgabeId).run();
  await db.prepare(
    `INSERT INTO ag_eintraege (aufgabe_id, abteilung_id, mitarbeiter_id, art, titel, text)
     VALUES (?,?,?,'uebergabe',?,?)`
  ).bind(aufgabeId, a.abteilung_id, autorId,
         `Runde vollständig – Zusammenfassung durch ${moderator}`,
         `Alle ${teilnehmer.length} Beiträge liegen vor.`).run().catch(() => {});
  return { weitergereicht: true, runde_vollstaendig: true, dran: moderator, beitraege: teilnehmer.length };
}

// ── Zustand eines Mitarbeiters fürs Büro ─────────────────────────
// Rein aus Board-Daten abgeleitet, nichts Dekoratives.
function zustandVon(m, offenerLauf, letzterLauf, aufgaben) {
  if (!m.aktiv) return 'beurlaubt';
  if (offenerLauf) return 'arbeitet';
  if (letzterLauf && letzterLauf.status === 'fehlgeschlagen') return 'haengt';
  if (aufgaben.some(a => a.status === 'zur_freigabe')) return 'wartet';
  if (aufgaben.some(a => a.status === 'in_arbeit' || a.status === 'zur_pruefung')) return 'offen';
  return 'am_platz';
}

// =============================================
// Router
// =============================================
export async function handleAgentur(request, env, helpers) {
  const { path, url, json, err, verifyAuth } = helpers;
  if (!path.startsWith('/api/agentur')) return null;

  const db = env.DB;
  await ensureAgenturTables(db);

  const rolle = await wer(request, env, verifyAuth);
  if (!rolle) return err('Unauthorized', 401);

  const nurDashboard = () => rolle === 'dashboard';
  const method = request.method;
  const seg = path.split('/').filter(Boolean);   // ['api','agentur',...]
  const teil = seg[2] || '';
  const id3 = seg[3] || '';
  const teil4 = seg[4] || '';
  const body = (method === 'POST' || method === 'PATCH' || method === 'PUT')
    ? await request.json().catch(() => ({}))
    : {};

  // ── Gesamtansicht fürs Büro ────────────────────────────────────
  if (method === 'GET' && teil === 'board') {
    await laeufeAufraeumen(db);
    const abtFilter = url.searchParams.get('abteilung');

    const [abteilungen, funktionen, mitarbeiter, aufgaben, laeufe, befunde, ticker] = await Promise.all([
      db.prepare('SELECT * FROM ag_abteilungen ORDER BY sortierung, name').all(),
      db.prepare('SELECT * FROM ag_funktionen ORDER BY name').all(),
      abtFilter
        ? db.prepare('SELECT * FROM ag_mitarbeiter WHERE abteilung_id=? ORDER BY schreibtisch, name').bind(abtFilter).all()
        : db.prepare('SELECT * FROM ag_mitarbeiter ORDER BY abteilung_id, schreibtisch, name').all(),
      abtFilter
        ? db.prepare(`SELECT * FROM ag_aufgaben WHERE abteilung_id=? AND status NOT IN ('erledigt','verworfen') ORDER BY id DESC LIMIT 200`).bind(abtFilter).all()
        : db.prepare(`SELECT * FROM ag_aufgaben WHERE status NOT IN ('erledigt','verworfen') ORDER BY id DESC LIMIT 200`).all(),
      abtFilter
        ? db.prepare('SELECT * FROM ag_laeufe WHERE abteilung_id=? ORDER BY id DESC LIMIT 60').bind(abtFilter).all()
        : db.prepare('SELECT * FROM ag_laeufe ORDER BY id DESC LIMIT 60').all(),
      abtFilter
        ? db.prepare(`SELECT * FROM ag_befunde WHERE abteilung_id=? AND status='offen' ORDER BY CASE schwere WHEN 'hoch' THEN 0 WHEN 'mittel' THEN 1 ELSE 2 END, id DESC LIMIT 100`).bind(abtFilter).all()
        : db.prepare(`SELECT * FROM ag_befunde WHERE status='offen' ORDER BY id DESC LIMIT 100`).all(),
      abtFilter
        ? db.prepare('SELECT id, aufgabe_id, lauf_id, mitarbeiter_id, art, titel, erstellt_am FROM ag_eintraege WHERE abteilung_id=? ORDER BY id DESC LIMIT 40').bind(abtFilter).all()
        : db.prepare('SELECT id, aufgabe_id, lauf_id, mitarbeiter_id, art, titel, erstellt_am FROM ag_eintraege ORDER BY id DESC LIMIT 40').all(),
    ]);

    const alleLaeufe = laeufe.results || [];
    const alleAufgaben = aufgaben.results || [];

    const team = (mitarbeiter.results || []).map(m => {
      const meine = alleAufgaben.filter(a => a.zustaendig === m.id);
      const meineLaeufe = alleLaeufe.filter(l => l.mitarbeiter_id === m.id);
      const offenerLauf = meineLaeufe.find(l => !l.beendet_am && l.status === 'laeuft') || null;
      const letzterLauf = meineLaeufe[0] || null;
      return {
        ...m,
        zustand: zustandVon(m, offenerLauf, letzterLauf, meine),
        offener_lauf: offenerLauf ? offenerLauf.id : null,
        letzter_lauf: letzterLauf,
        aufgaben_offen: meine.length,
        wartet_auf_freigabe: meine.filter(a => a.status === 'zur_freigabe').length,
      };
    });

    // Läuft gerade eine Diskussionsrunde?
    const runden = alleAufgaben.filter(a => a.modus === 'runde');

    return json({
      abteilungen: abteilungen.results || [],
      funktionen: funktionen.results || [],
      team,
      aufgaben: alleAufgaben,
      laeufe: alleLaeufe,
      befunde: befunde.results || [],
      ticker: ticker.results || [],
      runden,
      kennzahlen_stand: null,
      zaehler: {
        aufgaben_offen: alleAufgaben.length,
        zur_freigabe: alleAufgaben.filter(a => a.status === 'zur_freigabe').length,
        befunde_offen: (befunde.results || []).length,
        laeuft: team.filter(t => t.zustand === 'arbeitet').length,
        haengt: team.filter(t => t.zustand === 'haengt').length,
      },
    });
  }

  // ── Abteilungen ────────────────────────────────────────────────
  if (teil === 'abteilungen') {
    if (method === 'GET') {
      const r = await db.prepare('SELECT * FROM ag_abteilungen ORDER BY sortierung, name').all();
      return json({ abteilungen: r.results || [] });
    }
    if (method === 'POST') {
      if (!nurDashboard()) return err('Nur über das Dashboard', 403);
      const id = slugId(body.id || body.name);
      if (!id) return err('id oder name fehlt');
      if (!body.name) return err('name fehlt');
      await db.prepare(
        `INSERT OR REPLACE INTO ag_abteilungen
         (id, name, projekt, kontext_datei, beschreibung, farbe, aktiv, sortierung)
         VALUES (?,?,?,?,?,?,?,?)`
      ).bind(
        id, txt(body.name, 80), txt(body.projekt, 40),
        txt(body.kontext_datei, 200) || `abteilungen/${id}.md`,
        txt(body.beschreibung, 500), txt(body.farbe, 20) || '#3b82f6',
        body.aktiv === undefined ? 1 : einsAus(body.aktiv), num(body.sortierung) ?? 0,
      ).run();
      return json({ success: true, id });
    }
    if (method === 'PATCH' && id3) {
      if (!nurDashboard()) return err('Nur über das Dashboard', 403);
      const felder = [], werte = [];
      for (const [k, max] of [['name', 80], ['projekt', 40], ['kontext_datei', 200], ['beschreibung', 500], ['farbe', 20], ['gsc_property', 300]]) {
        if (body[k] !== undefined) { felder.push(`${k}=?`); werte.push(txt(body[k], max)); }
      }
      if (body.aktiv !== undefined) { felder.push('aktiv=?'); werte.push(einsAus(body.aktiv)); }
      if (body.sortierung !== undefined) { felder.push('sortierung=?'); werte.push(num(body.sortierung) ?? 0); }
      if (!felder.length) return err('Nichts zu ändern');
      werte.push(id3);
      await db.prepare(`UPDATE ag_abteilungen SET ${felder.join(', ')} WHERE id=?`).bind(...werte).run();
      return json({ success: true });
    }
  }

  // ── Funktionen (= Skills) ──────────────────────────────────────
  if (teil === 'funktionen') {
    if (method === 'GET') {
      const r = await db.prepare('SELECT * FROM ag_funktionen ORDER BY name').all();
      return json({ funktionen: r.results || [] });
    }
    if (method === 'POST') {
      if (!nurDashboard()) return err('Nur über das Dashboard', 403);
      const id = slugId(body.id || body.name);
      if (!id || !body.name) return err('id/name fehlt');
      await db.prepare(
        `INSERT OR REPLACE INTO ag_funktionen (id, name, skill, beschreibung, icon, liefert, aktiv)
         VALUES (?,?,?,?,?,?,?)`
      ).bind(
        id, txt(body.name, 80), txt(body.skill, 60) || id, txt(body.beschreibung, 500),
        txt(body.icon, 40) || 'user', txt(body.liefert, 40),
        body.aktiv === undefined ? 1 : einsAus(body.aktiv),
      ).run();
      return json({ success: true, id });
    }
  }

  // ── Mitarbeiter (einstellen, ändern, beurlauben) ───────────────
  if (teil === 'mitarbeiter') {
    if (method === 'GET' && !id3) {
      const abt = url.searchParams.get('abteilung');
      const r = abt
        ? await db.prepare(`SELECT m.*, f.name AS funktion_name, f.skill, f.icon
                              FROM ag_mitarbeiter m LEFT JOIN ag_funktionen f ON f.id = m.funktion_id
                             WHERE m.abteilung_id=? ORDER BY m.schreibtisch, m.name`).bind(abt).all()
        : await db.prepare(`SELECT m.*, f.name AS funktion_name, f.skill, f.icon
                              FROM ag_mitarbeiter m LEFT JOIN ag_funktionen f ON f.id = m.funktion_id
                             ORDER BY m.abteilung_id, m.schreibtisch, m.name`).all();
      return json({ mitarbeiter: r.results || [] });
    }

    // Personalakte: Person + Läufe + Berichte
    if (method === 'GET' && id3) {
      const person = await db.prepare(
        `SELECT m.*, f.name AS funktion_name, f.skill, f.icon, f.beschreibung AS funktion_beschreibung
           FROM ag_mitarbeiter m LEFT JOIN ag_funktionen f ON f.id = m.funktion_id
          WHERE m.id=?`
      ).bind(id3).first();
      if (!person) return err('Nicht gefunden', 404);
      const [laeufe, eintraege, aufgaben] = await Promise.all([
        db.prepare('SELECT * FROM ag_laeufe WHERE mitarbeiter_id=? ORDER BY id DESC LIMIT 25').bind(id3).all(),
        db.prepare('SELECT * FROM ag_eintraege WHERE mitarbeiter_id=? ORDER BY id DESC LIMIT 25').bind(id3).all(),
        db.prepare(`SELECT * FROM ag_aufgaben WHERE zustaendig=? AND status NOT IN ('erledigt','verworfen') ORDER BY id DESC`).bind(id3).all(),
      ]);
      return json({
        mitarbeiter: person,
        laeufe: laeufe.results || [],
        eintraege: eintraege.results || [],
        aufgaben: aufgaben.results || [],
      });
    }

    // Einstellen = eine Zeile. Kein neuer Skill, kein Deploy.
    if (method === 'POST') {
      if (!nurDashboard()) return err('Nur über das Dashboard', 403);
      const id = slugId(body.id || body.name);
      if (!id) return err('name fehlt');
      if (!body.funktion_id || !body.abteilung_id) return err('funktion_id und abteilung_id sind Pflicht');
      const f = await db.prepare('SELECT id FROM ag_funktionen WHERE id=?').bind(body.funktion_id).first();
      if (!f) return err('Unbekannte Funktion');
      const a = await db.prepare('SELECT id FROM ag_abteilungen WHERE id=?').bind(body.abteilung_id).first();
      if (!a) return err('Unbekannte Abteilung');
      const belegt = await db.prepare('SELECT id FROM ag_mitarbeiter WHERE id=?').bind(id).first();
      if (belegt) return err('Es gibt bereits jemanden mit dieser Kennung', 409);
      const platz = num(body.schreibtisch) ?? (
        (await db.prepare('SELECT COALESCE(MAX(schreibtisch),0) AS m FROM ag_mitarbeiter WHERE abteilung_id=?')
          .bind(body.abteilung_id).first())?.m ?? 0
      ) + 1;
      await db.prepare(
        `INSERT INTO ag_mitarbeiter
         (id, name, funktion_id, abteilung_id, charakter, charakter_datei, farbe, avatar, schreibtisch, aktiv)
         VALUES (?,?,?,?,?,?,?,?,?,?)`
      ).bind(
        id, txt(body.name, 60), body.funktion_id, body.abteilung_id,
        txt(body.charakter, 400), txt(body.charakter_datei, 200) || `personal/${id}.md`,
        txt(body.farbe, 20) || '#3b82f6', txt(body.avatar, 4) || 'a',
        platz, body.aktiv === undefined ? 1 : einsAus(body.aktiv),
      ).run();
      return json({ success: true, id });
    }

    if (method === 'PATCH' && id3) {
      if (!nurDashboard()) return err('Nur über das Dashboard', 403);
      const felder = [], werte = [];
      for (const [k, max] of [['name', 60], ['charakter', 400], ['charakter_datei', 200], ['farbe', 20], ['avatar', 4], ['funktion_id', 40], ['abteilung_id', 40]]) {
        if (body[k] !== undefined) { felder.push(`${k}=?`); werte.push(txt(body[k], max)); }
      }
      for (const k of ['schreibtisch']) {
        if (body[k] !== undefined) { felder.push(`${k}=?`); werte.push(num(body[k]) ?? 0); }
      }
      if (body.aktiv !== undefined) { felder.push('aktiv=?'); werte.push(einsAus(body.aktiv)); }
      if (!felder.length) return err('Nichts zu ändern');
      werte.push(id3);
      await db.prepare(`UPDATE ag_mitarbeiter SET ${felder.join(', ')} WHERE id=?`).bind(...werte).run();
      return json({ success: true });
    }

    // Entlassen nur, wenn keine Spuren im Board liegen – sonst beurlauben.
    if (method === 'DELETE' && id3) {
      if (!nurDashboard()) return err('Nur über das Dashboard', 403);
      const spuren = await db.prepare(
        'SELECT (SELECT COUNT(*) FROM ag_laeufe WHERE mitarbeiter_id=?) + (SELECT COUNT(*) FROM ag_eintraege WHERE mitarbeiter_id=?) AS n'
      ).bind(id3, id3).first();
      if ((spuren?.n || 0) > 0) {
        await db.prepare('UPDATE ag_mitarbeiter SET aktiv=0 WHERE id=?').bind(id3).run();
        return json({ success: true, aktion: 'beurlaubt', grund: 'Es liegen Läufe oder Einträge vor – der Verlauf bleibt erhalten.' });
      }
      await db.prepare('DELETE FROM ag_mitarbeiter WHERE id=?').bind(id3).run();
      return json({ success: true, aktion: 'entfernt' });
    }
  }

  // ── Aufgaben ───────────────────────────────────────────────────
  if (teil === 'aufgaben') {
    if (method === 'GET' && !id3) {
      const bed = [], w = [];
      const abt = url.searchParams.get('abteilung');
      const status = url.searchParams.get('status');
      const zust = url.searchParams.get('zustaendig');
      if (abt) { bed.push('abteilung_id=?'); w.push(abt); }
      if (status) { bed.push('status=?'); w.push(status); }
      if (zust) { bed.push('zustaendig=?'); w.push(zust); }
      const limit = Math.min(num(url.searchParams.get('limit')) || 100, 300);
      const sql = `SELECT * FROM ag_aufgaben${bed.length ? ' WHERE ' + bed.join(' AND ') : ''} ORDER BY id DESC LIMIT ?`;
      const r = await db.prepare(sql).bind(...w, limit).all();
      return json({ aufgaben: r.results || [] });
    }

    if (method === 'GET' && id3) {
      const aufgabe = await db.prepare('SELECT * FROM ag_aufgaben WHERE id=?').bind(num(id3)).first();
      if (!aufgabe) return err('Nicht gefunden', 404);
      const eintraege = await db.prepare('SELECT * FROM ag_eintraege WHERE aufgabe_id=? ORDER BY id ASC').bind(num(id3)).all();
      return json({ aufgabe, eintraege: eintraege.results || [] });
    }

    if (method === 'POST') {
      if (!body.titel || !body.abteilung_id) return err('titel und abteilung_id sind Pflicht');
      const res = await db.prepare(
        `INSERT INTO ag_aufgaben
         (abteilung_id, titel, beschreibung, status, zustaendig, uebergeben_von, prioritaet,
          modus, runde_teilnehmer, quelle_befund_id, erstellt_von, faellig_am, kampagne_id)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
      ).bind(
        txt(body.abteilung_id, 40), txt(body.titel, 200), txt(body.beschreibung, 8000),
        einsVon(body.status, AUFGABE_STATUS, 'offen'),
        txt(body.zustaendig, 40), txt(body.uebergeben_von, 40),
        einsVon(body.prioritaet, PRIORITAET, 'normal'),
        body.modus === 'runde' ? 'runde' : 'einzeln',
        Array.isArray(body.runde_teilnehmer) ? JSON.stringify(body.runde_teilnehmer).slice(0, 1000) : null,
        num(body.quelle_befund_id),
        rolle === 'runner' ? txt(body.erstellt_von, 40) || 'automation' : 'mensch',
        txt(body.faellig_am, 40),
        num(body.kampagne_id),
      ).run();
      return json({ success: true, id: res.meta?.last_row_id });
    }

    // Übergabe: zustaendig wechseln + Eintrag der Art 'uebergabe'.
    if (method === 'PATCH' && id3) {
      const aufgabeId = num(id3);
      const alt = await db.prepare('SELECT * FROM ag_aufgaben WHERE id=?').bind(aufgabeId).first();
      if (!alt) return err('Nicht gefunden', 404);

      // Freigeben ist eine menschliche Entscheidung.
      if (body.status && body.status === 'erledigt' && alt.status === 'zur_freigabe' && rolle !== 'dashboard') {
        return err('Freigabe nur über das Dashboard', 403);
      }

      const felder = [], werte = [];
      if (body.status !== undefined) {
        const s = einsVon(body.status, AUFGABE_STATUS, null);
        if (!s) return err('Unbekannter Status');
        felder.push('status=?'); werte.push(s);
        if (s === 'erledigt' || s === 'verworfen') { felder.push('erledigt_am=?'); werte.push(jetzt()); }
      }
      for (const [k, max] of [['titel', 200], ['beschreibung', 8000], ['zustaendig', 40], ['uebergeben_von', 40], ['faellig_am', 40]]) {
        if (body[k] !== undefined) { felder.push(`${k}=?`); werte.push(txt(body[k], max)); }
      }
      if (body.prioritaet !== undefined) { felder.push('prioritaet=?'); werte.push(einsVon(body.prioritaet, PRIORITAET, 'normal')); }
      if (body.kampagne_id !== undefined) { felder.push('kampagne_id=?'); werte.push(num(body.kampagne_id)); }
      if (body.runde_index !== undefined) { felder.push('runde_index=?'); werte.push(num(body.runde_index) ?? 0); }
      if (body.runde_teilnehmer !== undefined) {
        felder.push('runde_teilnehmer=?');
        werte.push(Array.isArray(body.runde_teilnehmer) ? JSON.stringify(body.runde_teilnehmer).slice(0, 1000) : null);
      }
      if (!felder.length) return err('Nichts zu ändern');
      felder.push('aktualisiert_am=?'); werte.push(jetzt());
      werte.push(aufgabeId);
      await db.prepare(`UPDATE ag_aufgaben SET ${felder.join(', ')} WHERE id=?`).bind(...werte).run();

      // Zuständigkeit gewechselt → Übergabe protokollieren.
      if (body.zustaendig !== undefined && body.zustaendig !== alt.zustaendig) {
        await db.prepare(
          `INSERT INTO ag_eintraege (aufgabe_id, lauf_id, abteilung_id, mitarbeiter_id, art, titel, text)
           VALUES (?,?,?,?,'uebergabe',?,?)`
        ).bind(
          aufgabeId, num(body.lauf_id), alt.abteilung_id,
          txt(body.uebergeben_von, 40) || alt.zustaendig,
          `Übergabe an ${body.zustaendig || '–'}`,
          txt(body.uebergabe_notiz, 2000),
        ).run().catch(() => {});
      }
      return json({ success: true });
    }
  }

  // ── Einträge (Berichte, Beiträge, Prüfungen, Notizen) ──────────
  if (teil === 'eintraege') {
    if (method === 'GET') {
      const bed = [], w = [];
      for (const [p, spalte] of [['aufgabe_id', 'aufgabe_id'], ['lauf_id', 'lauf_id'], ['abteilung', 'abteilung_id'], ['mitarbeiter', 'mitarbeiter_id'], ['art', 'art']]) {
        const v = url.searchParams.get(p);
        if (v) { bed.push(`${spalte}=?`); w.push(spalte.endsWith('_id') && spalte !== 'abteilung_id' && spalte !== 'mitarbeiter_id' ? num(v) : v); }
      }
      const limit = Math.min(num(url.searchParams.get('limit')) || 50, 200);
      const r = await db.prepare(
        `SELECT * FROM ag_eintraege${bed.length ? ' WHERE ' + bed.join(' AND ') : ''} ORDER BY id DESC LIMIT ?`
      ).bind(...w, limit).all();
      return json({ eintraege: r.results || [] });
    }
    if (method === 'POST') {
      if (!body.abteilung_id) return err('abteilung_id fehlt');
      const res = await db.prepare(
        `INSERT INTO ag_eintraege
         (aufgabe_id, lauf_id, abteilung_id, mitarbeiter_id, art, titel, text, artefakt_url, daten)
         VALUES (?,?,?,?,?,?,?,?,?)`
      ).bind(
        num(body.aufgabe_id), num(body.lauf_id), txt(body.abteilung_id, 40),
        txt(body.mitarbeiter_id, 40), einsVon(body.art, EINTRAG_ART, 'notiz'),
        txt(body.titel, 200), txt(body.text, 60000), txt(body.artefakt_url, 500),
        body.daten ? JSON.stringify(body.daten).slice(0, 20000) : null,
      ).run();
      if (body.lauf_id) {
        await db.prepare('UPDATE ag_laeufe SET eintraege_anzahl = eintraege_anzahl + 1 WHERE id=?')
          .bind(num(body.lauf_id)).run().catch(() => {});
      }
      if (body.aufgabe_id) {
        await db.prepare('UPDATE ag_aufgaben SET aktualisiert_am=? WHERE id=?')
          .bind(jetzt(), num(body.aufgabe_id)).run().catch(() => {});
      }

      // Diskussionsrunde weiterreichen. Bewusst hier und nicht in den
      // Skills: eine Rolle, die das Weiterreichen vergisst, würde die Runde
      // stillschweigend anhalten. Serverseitig kann das nicht passieren.
      let runde = null;
      if (body.aufgabe_id && einsVon(body.art, EINTRAG_ART, 'notiz') === 'beitrag') {
        runde = await rundeWeiter(db, num(body.aufgabe_id), txt(body.mitarbeiter_id, 40));
      }
      return json({ success: true, id: res.meta?.last_row_id, runde });
    }
  }

  // ── Berichte (Einträge mit Autor, fürs Dashboard) ──────────────
  if (method === 'GET' && teil === 'berichte') {
    const abt = url.searchParams.get('abteilung');
    const limit = Math.min(num(url.searchParams.get('limit')) || 30, 100);
    const sql = `SELECT e.*, m.name AS autor, m.farbe AS autor_farbe, f.name AS funktion_name
                   FROM ag_eintraege e
                   LEFT JOIN ag_mitarbeiter m ON m.id = e.mitarbeiter_id
                   LEFT JOIN ag_funktionen f ON f.id = m.funktion_id
                  WHERE e.art IN ('bericht','beitrag','pruefung')${abt ? ' AND e.abteilung_id=?' : ''}
                  ORDER BY e.id DESC LIMIT ?`;
    const r = abt ? await db.prepare(sql).bind(abt, limit).all() : await db.prepare(sql).bind(limit).all();
    return json({ berichte: r.results || [] });
  }

  // ── Läufe ──────────────────────────────────────────────────────
  if (teil === 'laeufe') {
    if (method === 'GET' && !id3) {
      await laeufeAufraeumen(db);
      const abt = url.searchParams.get('abteilung');
      const mit = url.searchParams.get('mitarbeiter');
      const bed = [], w = [];
      if (abt) { bed.push('l.abteilung_id=?'); w.push(abt); }
      if (mit) { bed.push('l.mitarbeiter_id=?'); w.push(mit); }
      const limit = Math.min(num(url.searchParams.get('limit')) || 40, 200);
      const r = await db.prepare(
        `SELECT l.*, m.name AS mitarbeiter_name, m.farbe AS mitarbeiter_farbe
           FROM ag_laeufe l LEFT JOIN ag_mitarbeiter m ON m.id = l.mitarbeiter_id
          ${bed.length ? 'WHERE ' + bed.join(' AND ') : ''}
          ORDER BY l.id DESC LIMIT ?`
      ).bind(...w, limit).all();
      return json({ laeufe: r.results || [] });
    }

    // Lauf-Lock: kein zweiter Lauf derselben Person, solange einer offen ist.
    if (method === 'POST' && id3 === 'start') {
      const mitarbeiterId = txt(body.mitarbeiter_id, 40);
      if (!mitarbeiterId) return err('mitarbeiter_id fehlt');
      const person = await db.prepare('SELECT * FROM ag_mitarbeiter WHERE id=?').bind(mitarbeiterId).first();
      if (!person) return err('Unbekannter Mitarbeiter', 404);
      if (!person.aktiv) return err('Mitarbeiter ist beurlaubt', 409);

      await laeufeAufraeumen(db);
      const offen = await db.prepare(
        `SELECT id, gestartet_am FROM ag_laeufe
          WHERE mitarbeiter_id=? AND abteilung_id=? AND beendet_am IS NULL AND status='laeuft'
          ORDER BY id DESC LIMIT 1`
      ).bind(mitarbeiterId, person.abteilung_id).first();
      if (offen) {
        return json({
          error: 'Lauf bereits aktiv',
          lauf_id: offen.id,
          gestartet_am: offen.gestartet_am,
        }, 409);
      }

      const res = await db.prepare(
        `INSERT INTO ag_laeufe (mitarbeiter_id, abteilung_id, ausloeser, gestartet_am, status)
         VALUES (?,?,?,?, 'laeuft')`
      ).bind(
        mitarbeiterId, person.abteilung_id,
        txt(body.ausloeser, 40) || (rolle === 'runner' ? 'actions' : 'manuell'),
        jetzt(),
      ).run();

      const [aufgaben, abteilung] = await Promise.all([
        db.prepare(`SELECT * FROM ag_aufgaben
                     WHERE zustaendig=? AND status NOT IN ('erledigt','verworfen','zur_freigabe')
                     ORDER BY CASE prioritaet WHEN 'hoch' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END, id ASC`)
          .bind(mitarbeiterId).all(),
        db.prepare('SELECT * FROM ag_abteilungen WHERE id=?').bind(person.abteilung_id).first(),
      ]);

      return json({
        lauf_id: res.meta?.last_row_id,
        mitarbeiter: person,
        abteilung,
        aufgaben: aufgaben.results || [],
      });
    }

    if (method === 'POST' && id3 && teil4 === 'ende') {
      const lauf = await db.prepare('SELECT * FROM ag_laeufe WHERE id=?').bind(num(id3)).first();
      if (!lauf) return err('Lauf nicht gefunden', 404);
      if (lauf.beendet_am) return err('Lauf ist bereits beendet', 409);
      const ende = jetzt();
      const dauer = Date.parse(ende) - Date.parse(lauf.gestartet_am + (lauf.gestartet_am.endsWith('Z') ? '' : 'Z'));
      await db.prepare(
        `UPDATE ag_laeufe
            SET beendet_am=?, status=?, zusammenfassung=?, fehler=?,
                aufgaben_beruehrt=?, dauer_ms=?, kosten_tokens=?, kosten_usd=?
          WHERE id=?`
      ).bind(
        ende,
        einsVon(body.status, LAUF_STATUS, 'erfolgreich'),
        txt(body.zusammenfassung, 2000),
        txt(body.fehler, 4000),
        num(body.aufgaben_beruehrt) ?? 0,
        Number.isFinite(dauer) && dauer >= 0 ? dauer : null,
        num(body.kosten_tokens),
        komma(body.kosten_usd),
        num(id3),
      ).run();
      return json({ success: true });
    }
  }

  // ── Befunde ────────────────────────────────────────────────────
  if (teil === 'befunde') {
    if (method === 'GET') {
      const bed = [], w = [];
      const abt = url.searchParams.get('abteilung');
      const status = url.searchParams.get('status');
      const art = url.searchParams.get('art');
      if (abt) { bed.push('b.abteilung_id=?'); w.push(abt); }
      if (status) { bed.push('b.status=?'); w.push(status); }
      if (art) { bed.push('b.art=?'); w.push(art); }
      const limit = Math.min(num(url.searchParams.get('limit')) || 100, 300);
      const r = await db.prepare(
        `SELECT b.*, m.name AS autor, m.farbe AS autor_farbe
           FROM ag_befunde b LEFT JOIN ag_mitarbeiter m ON m.id = b.mitarbeiter_id
          ${bed.length ? 'WHERE ' + bed.join(' AND ') : ''}
          ORDER BY CASE b.schwere WHEN 'hoch' THEN 0 WHEN 'mittel' THEN 1 ELSE 2 END, b.id DESC
          LIMIT ?`
      ).bind(...w, limit).all();
      return json({ befunde: r.results || [] });
    }

    // Dubletten-Schutz: derselbe Befund über mehrere Läufe zählt einmal.
    if (method === 'POST') {
      const liste = Array.isArray(body.befunde) ? body.befunde : [body];
      const angelegt = [], uebersprungen = [];
      for (const b of liste.slice(0, 50)) {
        if (!b.titel || !b.abteilung_id) { uebersprungen.push({ grund: 'titel/abteilung_id fehlt' }); continue; }
        const fp = await fingerprintVon(b.abteilung_id, b.art || 'veraltet', b.url || '', b.titel);
        const da = await db.prepare(
          `SELECT id FROM ag_befunde WHERE fingerprint=? AND status IN ('offen','aufgabe') LIMIT 1`
        ).bind(fp).first();
        if (da) { uebersprungen.push({ id: da.id, grund: 'bereits offen' }); continue; }
        const res = await db.prepare(
          `INSERT INTO ag_befunde
           (abteilung_id, lauf_id, mitarbeiter_id, art, schwere, titel, beschreibung, url, beleg, soll, fingerprint)
           VALUES (?,?,?,?,?,?,?,?,?,?,?)`
        ).bind(
          txt(b.abteilung_id, 40), num(b.lauf_id), txt(b.mitarbeiter_id, 40),
          einsVon(b.art, BEFUND_ART, 'veraltet'), einsVon(b.schwere, SCHWERE, 'mittel'),
          txt(b.titel, 200), txt(b.beschreibung, 4000), txt(b.url, 500),
          txt(b.beleg, 2000), txt(b.soll, 2000), fp,
        ).run();
        angelegt.push(res.meta?.last_row_id);
      }
      return json({ success: true, angelegt, uebersprungen });
    }

    if (method === 'PATCH' && id3) {
      const felder = [], werte = [];
      if (body.status !== undefined) {
        const s = einsVon(body.status, BEFUND_STATUS, null);
        if (!s) return err('Unbekannter Status');
        felder.push('status=?'); werte.push(s);
      }
      for (const [k, max] of [['titel', 200], ['beschreibung', 4000], ['url', 500], ['beleg', 2000], ['soll', 2000]]) {
        if (body[k] !== undefined) { felder.push(`${k}=?`); werte.push(txt(body[k], max)); }
      }
      if (body.schwere !== undefined) { felder.push('schwere=?'); werte.push(einsVon(body.schwere, SCHWERE, 'mittel')); }
      if (body.aufgabe_id !== undefined) { felder.push('aufgabe_id=?'); werte.push(num(body.aufgabe_id)); }
      if (!felder.length) return err('Nichts zu ändern');
      felder.push('aktualisiert_am=?'); werte.push(jetzt());
      werte.push(num(id3));
      await db.prepare(`UPDATE ag_befunde SET ${felder.join(', ')} WHERE id=?`).bind(...werte).run();
      return json({ success: true });
    }
  }

  // ── Kennzahlen (Zeitreihe für die Diagramme) ───────────────────
  if (teil === 'kennzahlen') {
    if (method === 'GET') {
      const abt = url.searchParams.get('abteilung') || 'frametrain';
      const name = url.searchParams.get('name');
      const tage = Math.min(num(url.searchParams.get('tage')) || 90, 500);
      const ab = new Date(Date.now() - tage * 86400000).toISOString().slice(0, 10);
      // dimension='' heißt "Gesamtwert". NULL nur noch aus Altbeständen:
      // SQLite behandelt NULLs in UNIQUE als verschieden, deshalb schreibt
      // die API seit jeher '' – gelesen wird beides.
      const ohneDim = "(dimension IS NULL OR dimension='')";
      const r = name
        ? await db.prepare(`SELECT * FROM ag_kennzahlen WHERE abteilung_id=? AND name=? AND datum>=? AND ${ohneDim} ORDER BY datum ASC`).bind(abt, name, ab).all()
        : await db.prepare(`SELECT * FROM ag_kennzahlen WHERE abteilung_id=? AND datum>=? AND ${ohneDim} ORDER BY datum ASC`).bind(abt, ab).all();
      return json({ kennzahlen: r.results || [] });
    }
    if (method === 'POST') {
      const liste = Array.isArray(body.werte) ? body.werte : [];
      if (!liste.length) return err('werte[] fehlt');
      let n = 0;
      for (const k of liste.slice(0, 2000)) {
        if (!k.datum || !k.name || k.wert === undefined) continue;
        await db.prepare(
          `INSERT INTO ag_kennzahlen (abteilung_id, datum, quelle, name, wert, dimension)
           VALUES (?,?,?,?,?,?)
           ON CONFLICT(abteilung_id, datum, quelle, name, dimension)
           DO UPDATE SET wert=excluded.wert`
        ).bind(
          txt(k.abteilung_id || body.abteilung_id, 40), txt(k.datum, 10),
          txt(k.quelle || body.quelle, 20) || 'gsc', txt(k.name, 40),
          Number(k.wert) || 0, txt(k.dimension, 300) || '',
        ).run().catch(() => {});
        n++;
      }
      return json({ success: true, gespeichert: n });
    }
  }

  // ── Kampagnen ──────────────────────────────────────────────────
  if (teil === 'kampagnen') {
    // Ergebnis nachtragen – von einer Rolle oder von Hand aus dem Manager.
    if (method === 'POST' && id3 && teil4 === 'ergebnisse') {
      const liste = Array.isArray(body.ergebnisse) ? body.ergebnisse : [body];
      let n = 0;
      for (const e of liste.slice(0, 50)) {
        if (!e.name || e.wert === undefined) continue;
        await db.prepare(
          `INSERT INTO ag_kampagnen_ergebnisse
           (kampagne_id, herkunft, quelle, name, wert, einheit, datum, notiz, erfasst_von)
           VALUES (?,?,?,?,?,?,?,?,?)`
        ).bind(
          num(id3), einsVon(e.herkunft, HERKUNFT, 'berichtet'), txt(e.quelle, 40),
          txt(e.name, 60), komma(e.wert) ?? 0, txt(e.einheit, 20),
          txt(e.datum, 10), txt(e.notiz, 1000),
          rolle === 'runner' ? txt(e.erfasst_von, 40) : 'mensch',
        ).run();
        n++;
      }
      return json({ success: true, gespeichert: n });
    }

    // Gemessene Zahlen aus dem, was der Manager ohnehin sammelt. Nur was
    // wirklich dasteht – lieber eine leere Liste als eine erfundene.
    if (method === 'GET' && id3 && teil4 === 'zahlen') {
      const k = await db.prepare('SELECT * FROM ag_kampagnen WHERE id=?').bind(num(id3)).first();
      if (!k) return err('Kampagne nicht gefunden', 404);
      if (!k.produkt || !k.start_am) {
        return json({ zahlen: [], hinweis: 'Ohne Produkt und Startdatum lässt sich nichts zuordnen.' });
      }
      const bis = k.ende_am || new Date().toISOString().slice(0, 10);
      const [stats, ereignisse] = await Promise.all([
        db.prepare(
          `SELECT COALESCE(SUM(visitors),0) AS besucher, COALESCE(SUM(pageviews),0) AS seitenaufrufe
             FROM site_stats WHERE site_id=? AND date BETWEEN ? AND ?`
        ).bind(k.produkt, k.start_am, bis).first().catch(() => null),
        db.prepare(
          `SELECT event_type AS art, COUNT(*) AS anzahl
             FROM analytics_events WHERE site_id=? AND created_at BETWEEN ? AND ?
            GROUP BY event_type ORDER BY anzahl DESC LIMIT 10`
        ).bind(k.produkt, k.start_am, bis + ' 23:59:59').all().catch(() => ({ results: [] })),
      ]);
      const zahlen = [];
      if (stats?.besucher) zahlen.push({ name: 'besucher', wert: stats.besucher, quelle: 'site_stats' });
      if (stats?.seitenaufrufe) zahlen.push({ name: 'seitenaufrufe', wert: stats.seitenaufrufe, quelle: 'site_stats' });
      for (const e of (ereignisse.results || [])) {
        zahlen.push({ name: e.art, wert: e.anzahl, quelle: 'analytics_events' });
      }
      return json({
        kampagne: k.titel, zeitraum: [k.start_am, bis], produkt: k.produkt,
        herkunft: 'gemessen', zahlen,
        hinweis: zahlen.length ? null : 'Für diesen Zeitraum liegen keine eigenen Messwerte vor.',
      });
    }

    if (method === 'GET' && id3) {
      const k = await db.prepare('SELECT * FROM ag_kampagnen WHERE id=?').bind(num(id3)).first();
      if (!k) return err('Nicht gefunden', 404);
      const [ergebnisse, aufgaben, wissen] = await Promise.all([
        db.prepare('SELECT * FROM ag_kampagnen_ergebnisse WHERE kampagne_id=? ORDER BY id DESC').bind(num(id3)).all(),
        db.prepare('SELECT * FROM ag_aufgaben WHERE kampagne_id=? ORDER BY id DESC').bind(num(id3)).all(),
        db.prepare('SELECT * FROM ag_wissen WHERE kampagne_id=? ORDER BY id DESC').bind(num(id3)).all(),
      ]);
      return json({
        kampagne: k,
        ergebnisse: ergebnisse.results || [],
        aufgaben: aufgaben.results || [],
        wissen: wissen.results || [],
      });
    }

    if (method === 'GET') {
      const abt = url.searchParams.get('abteilung');
      const status = url.searchParams.get('status');
      const bed = [], w = [];
      if (abt) { bed.push('abteilung_id=?'); w.push(abt); }
      if (status) { bed.push('status=?'); w.push(status); }
      const r = await db.prepare(
        `SELECT * FROM ag_kampagnen${bed.length ? ' WHERE ' + bed.join(' AND ') : ''} ORDER BY id DESC LIMIT 100`
      ).bind(...w).all();
      return json({ kampagnen: r.results || [] });
    }

    if (method === 'POST') {
      if (!body.titel || !body.abteilung_id) return err('titel und abteilung_id sind Pflicht');
      const res = await db.prepare(
        `INSERT INTO ag_kampagnen
         (abteilung_id, titel, ziel, hypothese, kanal, produkt, status, verantwortlich, start_am, ende_am)
         VALUES (?,?,?,?,?,?,?,?,?,?)`
      ).bind(
        txt(body.abteilung_id, 40), txt(body.titel, 200), txt(body.ziel, 2000),
        txt(body.hypothese, 2000), txt(body.kanal, 40), txt(body.produkt, 40),
        einsVon(body.status, KAMPAGNE_STATUS, 'geplant'), txt(body.verantwortlich, 40),
        txt(body.start_am, 10), txt(body.ende_am, 10),
      ).run();
      return json({ success: true, id: res.meta?.last_row_id });
    }

    if (method === 'PATCH' && id3) {
      const felder = [], werte = [];
      for (const [k, max] of [['titel', 200], ['ziel', 2000], ['hypothese', 2000], ['kanal', 40],
                              ['produkt', 40], ['verantwortlich', 40], ['start_am', 10],
                              ['ende_am', 10], ['fazit', 8000]]) {
        if (body[k] !== undefined) { felder.push(`${k}=?`); werte.push(txt(body[k], max)); }
      }
      if (body.status !== undefined) {
        const s = einsVon(body.status, KAMPAGNE_STATUS, null);
        if (!s) return err('Unbekannter Kampagnen-Status');
        felder.push('status=?'); werte.push(s);
      }
      if (!felder.length) return err('Nichts zu ändern');
      felder.push('aktualisiert_am=?'); werte.push(jetzt());
      werte.push(num(id3));
      await db.prepare(`UPDATE ag_kampagnen SET ${felder.join(', ')} WHERE id=?`).bind(...werte).run();
      return json({ success: true });
    }
  }

  // ── Wissenspool ────────────────────────────────────────────────
  // Was gelernt wurde, unabhängig von einzelnen Aufgaben. Ohne das
  // beginnt jede Kampagne wieder bei null.
  if (teil === 'wissen') {
    if (method === 'GET') {
      const abt = url.searchParams.get('abteilung');
      const kanal = url.searchParams.get('kanal');
      const bed = ['veraltet=0'], w = [];
      if (abt) { bed.push('abteilung_id=?'); w.push(abt); }
      if (kanal) { bed.push('kanal=?'); w.push(kanal); }
      const limit = Math.min(num(url.searchParams.get('limit')) || 100, 300);
      const r = await db.prepare(
        `SELECT * FROM ag_wissen WHERE ${bed.join(' AND ')}
          ORDER BY CASE verlaesslich WHEN 'gemessen' THEN 0 WHEN 'beobachtung' THEN 1 ELSE 2 END, id DESC
          LIMIT ?`
      ).bind(...w, limit).all();
      return json({ wissen: r.results || [] });
    }
    if (method === 'POST') {
      if (!body.thema || !body.text || !body.abteilung_id) return err('thema, text und abteilung_id sind Pflicht');
      const res = await db.prepare(
        `INSERT INTO ag_wissen (abteilung_id, thema, kanal, text, beleg, kampagne_id, verlaesslich, erstellt_von)
         VALUES (?,?,?,?,?,?,?,?)`
      ).bind(
        txt(body.abteilung_id, 40), txt(body.thema, 200), txt(body.kanal, 40),
        txt(body.text, 4000), txt(body.beleg, 2000), num(body.kampagne_id),
        einsVon(body.verlaesslich, VERLAESSLICH, 'beobachtung'),
        rolle === 'runner' ? txt(body.erstellt_von, 40) : 'mensch',
      ).run();
      return json({ success: true, id: res.meta?.last_row_id });
    }
    if (method === 'PATCH' && id3) {
      const felder = [], werte = [];
      for (const [k, max] of [['thema', 200], ['kanal', 40], ['text', 4000], ['beleg', 2000]]) {
        if (body[k] !== undefined) { felder.push(`${k}=?`); werte.push(txt(body[k], max)); }
      }
      if (body.verlaesslich !== undefined) { felder.push('verlaesslich=?'); werte.push(einsVon(body.verlaesslich, VERLAESSLICH, 'beobachtung')); }
      if (body.veraltet !== undefined) { felder.push('veraltet=?'); werte.push(einsAus(body.veraltet)); }
      if (!felder.length) return err('Nichts zu ändern');
      felder.push('aktualisiert_am=?'); werte.push(jetzt());
      werte.push(num(id3));
      await db.prepare(`UPDATE ag_wissen SET ${felder.join(', ')} WHERE id=?`).bind(...werte).run();
      return json({ success: true });
    }
  }

  // ── Verteiler ──────────────────────────────────────────────────
  // Wer hat jetzt etwas zu tun? Der Runner fragt das stündlich und startet
  // nur die Genannten. Damit hängt die Rechnung an der Arbeit, nicht am
  // Kalender – und ein "heute 16 Uhr" trifft auf die Stunde genau.
  //
  // Fällig ist eine Aufgabe nur mit gesetztem faellig_am in der
  // Vergangenheit. Aufgaben ohne Termin lösen nichts aus; die werden
  // mitgenommen, wenn die Person ohnehin läuft.
  if (method === 'GET' && teil === 'faellig') {
    await laeufeAufraeumen(db);
    const abt = url.searchParams.get('abteilung');
    const ruhe = Math.min(num(url.searchParams.get('ruhe_stunden')) ?? VERTEILER_RUHE_STUNDEN, 48);
    const grenze = new Date(Date.now() - ruhe * 3600000).toISOString();

    const bed = [
      `a.status NOT IN ('erledigt','verworfen','zur_freigabe')`,
      'a.zustaendig IS NOT NULL',
      'a.faellig_am IS NOT NULL',
      "a.faellig_am <= ?",
    ];
    const w = [jetzt()];
    if (abt) { bed.push('a.abteilung_id=?'); w.push(abt); }

    const faellige = await db.prepare(
      `SELECT a.id, a.titel, a.zustaendig, a.abteilung_id, a.faellig_am, a.prioritaet,
              m.name AS mitarbeiter_name, m.aktiv
         FROM ag_aufgaben a
         JOIN ag_mitarbeiter m ON m.id = a.zustaendig
        WHERE ${bed.join(' AND ')} AND m.aktiv = 1
        ORDER BY a.faellig_am ASC`
    ).bind(...w).all();

    // Wer gerade läuft oder eben erst gelaufen ist, wird übersprungen.
    const beschaeftigt = await db.prepare(
      `SELECT DISTINCT mitarbeiter_id FROM ag_laeufe
        WHERE beendet_am IS NULL OR gestartet_am > ?`
    ).bind(grenze).all();
    const sperre = new Set((beschaeftigt.results || []).map(r => r.mitarbeiter_id));

    const proPerson = new Map();
    for (const a of (faellige.results || [])) {
      if (sperre.has(a.zustaendig)) continue;
      if (!proPerson.has(a.zustaendig)) {
        proPerson.set(a.zustaendig, {
          mitarbeiter_id: a.zustaendig, name: a.mitarbeiter_name,
          abteilung_id: a.abteilung_id, aufgaben: [],
        });
      }
      proPerson.get(a.zustaendig).aufgaben.push({ id: a.id, titel: a.titel, faellig_am: a.faellig_am });
    }

    return json({
      zeitpunkt: jetzt(),
      ruhe_stunden: ruhe,
      dran: [...proPerson.values()],
      uebersprungen: [...sperre].filter(id => (faellige.results || []).some(a => a.zustaendig === id)),
    });
  }

  // ── Search Console ─────────────────────────────────────────────
  // Der Dienstkonto-Schlüssel bleibt im Worker. Rollen holen ihre Zahlen
  // hier, nicht bei Google.
  if (teil === 'gsc') {
    if (method === 'POST' && id3 === 'sync')    return gscSync(request, env, db, body, json, err);
    if (method === 'GET'  && id3 === 'queries') return gscQueries(env, db, url, json, err);
    if (method === 'GET'  && id3 === 'report')  return gscReport(env, db, url, json, err);
    if (method === 'POST' && id3 === 'inspect') return gscInspect(request, env, db, body, json, err);
  }

  return err('Unbekannte Agentur-Route', 404);
}
