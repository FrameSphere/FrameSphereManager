// =============================================
// Börse – Kurse, Kennzahlen, Termine, Meldungen
// =============================================
// Der Anbieterschlüssel liegt als Cloudflare-Secret FINNHUB_KEY und
// verlässt den Worker nie. Rollen und Oberfläche fragen hier an.
//
// Dieser Bereich liefert Faktenlage: Zahlen, Termine, Meldungen. Er gibt
// keine Kauf-, Verkaufs- oder Halteempfehlungen ab – das wäre personalisierte
// Anlageberatung. Entschieden wird von Karol.
// =============================================

const BASIS = 'https://finnhub.io/api/v1';

// Kostenlose Stufen sind knapp bemessen. Ein Abruf je Wert und Aufruf,
// nicht mehr – und Kurse werden in ag_kurse mitgeschrieben, damit der
// Verlauf uns gehört und nicht der Reichweite des Anbieters.
async function holen(env, pfad, params = {}) {
  const key = (env.FINNHUB_KEY || '').trim();
  if (!key) throw new Error('FINNHUB_KEY ist nicht gesetzt');
  const u = new URL(BASIS + pfad);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') u.searchParams.set(k, String(v));
  }
  u.searchParams.set('token', key);

  const r = await fetch(u.toString(), { headers: { 'User-Agent': 'webcontrol-hq-boerse' } });
  if (!r.ok) {
    // Auch hier den Originaltext mitgeben – "403" allein sagt nicht, ob es
    // am Schlüssel, an der Stufe oder am Symbol liegt.
    const roh = await r.text().catch(() => '');
    const text = ohneSchluessel(roh.replace(/\s+/g, ' '), env).slice(0, 160);
    if (r.status === 401 || r.status === 403) {
      throw new Error(`Zugriff verweigert (${r.status})${text ? ': ' + text : ''}`);
    }
    if (r.status === 429) throw new Error('Abruflimit erreicht (429)');
    throw new Error(`Antwort ${r.status}${text ? ': ' + text : ''}`);
  }
  return r.json();
}

// Anbieter schreiben den Schlüssel gern in ihre Fehlermeldungen. Bevor eine
// solche Meldung irgendwo angezeigt oder protokolliert wird, fliegt alles
// raus, was nach Schlüssel aussieht.
function ohneSchluessel(text, env) {
  let s = String(text || '');
  for (const k of [env?.ALPHAVANTAGE_KEY, env?.FINNHUB_KEY]) {
    const wert = (k || '').trim();
    if (wert.length >= 8) s = s.split(wert).join('«Schlüssel»');
  }
  // Auch unbekannte Schlüssel abfangen: lange Blöcke aus Großbuchstaben
  // und Ziffern, wie sie diese Anbieter vergeben.
  return s.replace(/\b[A-Z0-9]{12,}\b/g, '«Schlüssel»');
}

const heute = () => new Date().toISOString().slice(0, 10);
const tagVor = n => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
const zahl = v => (Number.isFinite(Number(v)) ? Number(v) : null);

// Kurs holen und im eigenen Verlauf ablegen. Der Hauptanbieter deckt nur
// US-Werte ab und liefert bei allem anderen stillschweigend Nullen – dann
// wird die zweite Quelle gefragt, statt den Wert kurslos zu lassen.
async function kursHolen(env, db, symbol) {
  let q = null;
  try { q = await holen(env, '/quote', { symbol }); } catch (e) { q = null; }

  if (!q || !zahl(q.c)) {
    try {
      const z = await kursVonTwelveData(env, symbol);
      q = z;
      // Bei der Gelegenheit Stammdaten mitnehmen, die von dort kommen.
      if (z.waehrung || z.name) {
        await db.prepare(
          `INSERT INTO ag_werte (symbol, name, waehrung, boerse, aktualisiert_am)
           VALUES (?,?,?,?,?)
           ON CONFLICT(symbol) DO UPDATE SET
             name=COALESCE(ag_werte.name, excluded.name),
             waehrung=COALESCE(excluded.waehrung, ag_werte.waehrung),
             boerse=COALESCE(ag_werte.boerse, excluded.boerse),
             aktualisiert_am=excluded.aktualisiert_am`
        ).bind(symbol, z.name, z.waehrung, z.boerse, new Date().toISOString()).run().catch(() => {});
      }
    } catch (e) { /* auch die zweite Quelle kann den Wert nicht kennen */ }
  }
  if (!q || !zahl(q.c)) return null;

  const satz = {
    symbol,
    datum: heute(),
    kurs: zahl(q.c),
    eroeffnung: zahl(q.o),
    hoch: zahl(q.h),
    tief: zahl(q.l),
    vortag: zahl(q.pc),
    veraenderung_prozent: zahl(q.dp),
  };

  await db.prepare(
    `INSERT INTO ag_kurse (symbol, datum, kurs, eroeffnung, hoch, tief, vortag, veraenderung_prozent)
     VALUES (?,?,?,?,?,?,?,?)
     ON CONFLICT(symbol, datum) DO UPDATE SET
       kurs=excluded.kurs, hoch=excluded.hoch, tief=excluded.tief,
       veraenderung_prozent=excluded.veraenderung_prozent`
  ).bind(satz.symbol, satz.datum, satz.kurs, satz.eroeffnung, satz.hoch,
         satz.tief, satz.vortag, satz.veraenderung_prozent).run().catch(() => {});

  return satz;
}

// Stammdaten und Kennzahlen auffrischen. Selten nötig, deshalb getrennt.
async function wertHolen(env, db, symbol) {
  const [profil, kennzahlen] = await Promise.all([
    holen(env, '/stock/profile2', { symbol }).catch(() => ({})),
    holen(env, '/stock/metric', { symbol, metric: 'all' }).catch(() => ({})),
  ]);
  const m = kennzahlen?.metric || {};

  let naechsteZahlen = null;
  try {
    const kal = await holen(env, '/calendar/earnings', { from: heute(), to: tagVor(-120), symbol });
    naechsteZahlen = kal?.earningsCalendar?.[0]?.date || null;
  } catch (e) { /* Termine sind nicht überall verfügbar */ }

  const satz = {
    symbol,
    name: profil?.name || null,
    branche: profil?.finnhubIndustry || null,
    waehrung: profil?.currency || null,
    boerse: profil?.exchange || null,
    marktwert: zahl(profil?.marketCapitalization),
    kgv: zahl(m.peBasicExclExtraTTM ?? m.peTTM),
    hoch_52w: zahl(m['52WeekHigh']),
    tief_52w: zahl(m['52WeekLow']),
    naechste_zahlen: naechsteZahlen,
    webseite: profil?.weburl || null,
  };

  await db.prepare(
    `INSERT INTO ag_werte (symbol, name, branche, waehrung, boerse, marktwert, kgv,
                           hoch_52w, tief_52w, naechste_zahlen, webseite, aktualisiert_am)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(symbol) DO UPDATE SET
       name=COALESCE(excluded.name, ag_werte.name),
       branche=COALESCE(excluded.branche, ag_werte.branche),
       waehrung=COALESCE(excluded.waehrung, ag_werte.waehrung),
       boerse=COALESCE(excluded.boerse, ag_werte.boerse),
       marktwert=excluded.marktwert, kgv=excluded.kgv,
       hoch_52w=excluded.hoch_52w, tief_52w=excluded.tief_52w,
       naechste_zahlen=COALESCE(excluded.naechste_zahlen, ag_werte.naechste_zahlen),
       webseite=COALESCE(excluded.webseite, ag_werte.webseite),
       aktualisiert_am=excluded.aktualisiert_am`
  ).bind(satz.symbol, satz.name, satz.branche, satz.waehrung, satz.boerse,
         satz.marktwert, satz.kgv, satz.hoch_52w, satz.tief_52w,
         satz.naechste_zahlen, satz.webseite, new Date().toISOString()).run().catch(() => {});

  return satz;
}

// ── Historie ─────────────────────────────────────────────────────
// Eine Kette aus Quellen, jede einzeln verzichtbar. Welche Angaben zur
// kostenlosen Stufe eines Anbieters gehören, ändert sich – deshalb wird
// nicht geraten, sondern der Reihe nach versucht.
//
//   1. Finnhub-Kerzen        (falls die Stufe sie hergibt)
//   2. Alpha Vantage         (ein Abruf liefert die volle Tageshistorie)
//   3. gar nichts            → der Verlauf wächst weiter aus Tagesabrufen
async function historieSchreiben(db, symbol, punkte, quelle) {
  let n = 0;
  for (const p of punkte) {
    if (!p.datum || !Number.isFinite(p.kurs)) continue;
    await db.prepare(
      `INSERT INTO ag_kurse (symbol, datum, kurs, eroeffnung, hoch, tief, quelle)
       VALUES (?,?,?,?,?,?,?)
       ON CONFLICT(symbol, datum) DO UPDATE SET
         kurs=excluded.kurs, eroeffnung=COALESCE(excluded.eroeffnung, ag_kurse.eroeffnung),
         hoch=COALESCE(excluded.hoch, ag_kurse.hoch), tief=COALESCE(excluded.tief, ag_kurse.tief)`
    ).bind(symbol, p.datum, p.kurs, p.eroeffnung ?? null, p.hoch ?? null, p.tief ?? null, quelle)
      .run().catch(() => {});
    n++;
  }
  return n;
}

async function vonFinnhubKerzen(env, symbol, tage) {
  const bis = Math.floor(Date.now() / 1000);
  const von = bis - tage * 86400;
  const d = await holen(env, '/stock/candle', { symbol, resolution: 'D', from: von, to: bis });
  if (!d || d.s !== 'ok' || !Array.isArray(d.c)) throw new Error('keine Kerzen');
  return d.c.map((kurs, i) => ({
    datum: new Date(d.t[i] * 1000).toISOString().slice(0, 10),
    kurs: zahl(kurs), eroeffnung: zahl(d.o?.[i]), hoch: zahl(d.h?.[i]), tief: zahl(d.l?.[i]),
  }));
}

// Twelve Data: 800 Abrufe am Tag statt 25, und deutlich bessere Abdeckung
// europäischer Börsen. Für dieses Werkzeug die passendste Quelle.
async function vonTwelveData(env, symbol, tage) {
  const key = (env.TWELVEDATA_KEY || '').trim();
  if (!key) throw new Error('TWELVEDATA_KEY ist nicht gesetzt');
  const u = new URL('https://api.twelvedata.com/time_series');
  u.searchParams.set('symbol', symbol);
  u.searchParams.set('interval', '1day');
  u.searchParams.set('outputsize', String(Math.min(Math.max(tage, 30), 5000)));
  u.searchParams.set('apikey', key);
  const r = await fetch(u.toString());
  const d = await r.json().catch(() => ({}));
  if (d.status === 'error' || d.code) {
    throw new Error(ohneSchluessel(String(d.message || `Fehler ${d.code}`), env).slice(0, 200));
  }
  if (!Array.isArray(d.values)) throw new Error('keine Zeitreihe erhalten');
  return d.values.map(v => ({
    datum: String(v.datetime).slice(0, 10),
    kurs: zahl(v.close), eroeffnung: zahl(v.open),
    hoch: zahl(v.high), tief: zahl(v.low),
  })).filter(p => p.kurs !== null);
}

// Kurs über Twelve Data – für Werte, die der Hauptanbieter nicht abdeckt
// (etwa deutsche Börsenplätze).
async function kursVonTwelveData(env, symbol) {
  const key = (env.TWELVEDATA_KEY || '').trim();
  if (!key) throw new Error('TWELVEDATA_KEY ist nicht gesetzt');
  const u = new URL('https://api.twelvedata.com/quote');
  u.searchParams.set('symbol', symbol);
  u.searchParams.set('apikey', key);
  const r = await fetch(u.toString());
  const d = await r.json().catch(() => ({}));
  if (d.status === 'error' || d.code) {
    throw new Error(ohneSchluessel(String(d.message || `Fehler ${d.code}`), env).slice(0, 200));
  }
  if (!zahl(d.close)) throw new Error('kein Kurs in der Antwort');
  return {
    c: zahl(d.close), o: zahl(d.open), h: zahl(d.high), l: zahl(d.low),
    pc: zahl(d.previous_close),
    dp: zahl(d.percent_change),
    waehrung: d.currency || null, name: d.name || null, boerse: d.exchange || null,
  };
}

async function vonAlphaVantage(env, symbol) {
  const key = (env.ALPHAVANTAGE_KEY || '').trim();
  if (!key) throw new Error('ALPHAVANTAGE_KEY ist nicht gesetzt');
  const u = new URL('https://www.alphavantage.co/query');
  u.searchParams.set('function', 'TIME_SERIES_DAILY');
  u.searchParams.set('symbol', symbol);
  u.searchParams.set('outputsize', 'compact');   // die letzten 100 Handelstage
  u.searchParams.set('apikey', key);
  const r = await fetch(u.toString());
  const d = await r.json().catch(() => ({}));
  // Den Anbietertext durchreichen statt zu deuten. "Information" kann
  // Abruflimit heißen, aber genauso "Symbol nicht abgedeckt" oder
  // "kostenpflichtige Angabe" – das auseinanderzuhalten ist nicht meine
  // Aufgabe, sondern die des Lesers.
  const meldung = d.Note || d.Information || d['Error Message'];
  if (meldung) throw new Error(ohneSchluessel(String(meldung).replace(/\s+/g, ' '), env).slice(0, 220));
  const reihe = d['Time Series (Daily)'];
  if (!reihe) throw new Error('keine Zeitreihe erhalten (unerwartete Antwort)');
  return Object.entries(reihe).map(([datum, w]) => ({
    datum, kurs: zahl(w['4. close']), eroeffnung: zahl(w['1. open']),
    hoch: zahl(w['2. high']), tief: zahl(w['3. low']),
  }));
}

// ── POST /api/agentur/boerse/historie ────────────────────────────
export async function boerseHistorie(env, db, body, json, err) {
  const tage = Math.min(parseInt(body?.tage, 10) || 180, 800);
  const liste = body?.symbole?.length ? body.symbole.slice(0, 10) : await symbole(db);
  if (!liste.length) return json({ success: true, hinweis: 'Keine Werte hinterlegt.' });

  // Reihenfolge nach Ergiebigkeit: Twelve Data hat das großzügigste
  // Tageskontingent und die beste Abdeckung außerhalb der USA.
  const quellen = [];
  if ((env.TWELVEDATA_KEY || '').trim()) quellen.push(['twelvedata', s => vonTwelveData(env, s, tage)]);
  if ((env.ALPHAVANTAGE_KEY || '').trim()) quellen.push(['alphavantage', s => vonAlphaVantage(env, s)]);
  quellen.push(['finnhub', s => vonFinnhubKerzen(env, s, tage)]);

  // Was schon vollständig dasteht, wird nicht erneut geholt. Jeder
  // unnötige Abruf frisst ein knappes Tageskontingent – genau daran ist
  // es zuvor gescheitert.
  const erzwingen = body?.erzwingen === true;
  const vorhanden = new Map();
  if (!erzwingen) {
    const r = await db.prepare(
      `SELECT symbol, COUNT(*) n, MAX(datum) neuestes FROM ag_kurse GROUP BY symbol`
    ).all().catch(() => ({ results: [] }));
    for (const x of (r.results || [])) vorhanden.set(x.symbol, x);
  }
  const frischGenug = tagVor(5);

  const ergebnis = [], hinweise = [], uebersprungen = [];
  for (const s of liste) {
    const v = vorhanden.get(s);
    if (v && v.n >= 60 && v.neuestes >= frischGenug) {
      uebersprungen.push(`${s}: ${v.n} Tage bis ${v.neuestes} liegen vor`);
      continue;
    }
    let punkte = null, quelle = null;
    const versuche = [];
    for (const [name, fn] of quellen) {
      try { punkte = await fn(s); quelle = name; break; }
      catch (e) { versuche.push(`${name}: ${e.message}`); }
    }
    // Alpha Vantage verlangt ausdrücklich höchstens einen Abruf je Sekunde.
    // Ohne Pause holt sich das Werkzeug beim zweiten Wert selbst eine Absage.
    if (quellen.some(([n]) => n === 'alphavantage')) {
      await new Promise(r => setTimeout(r, 1200));
    }
    if (!punkte) { hinweise.push(`${s} — ${versuche.join(' · ')}`); continue; }
    const n = await historieSchreiben(db, s, punkte, quelle);
    ergebnis.push({ symbol: s, punkte: n, quelle });
  }

  return json({
    success: ergebnis.length > 0 || uebersprungen.length > 0,
    geladen: ergebnis,
    uebersprungen: uebersprungen.length ? uebersprungen : null,
    hinweise: hinweise.length ? hinweise : null,
    quellen_versucht: quellen.map(([n]) => n),
    erklaerung: (ergebnis.length || uebersprungen.length) ? null
      : 'Keine Quelle für Historie verfügbar. Der Verlauf wächst dann aus den täglichen Kursabrufen – ab dem zweiten Tag entsteht eine Linie.',
  });
}

// ── GET /api/agentur/boerse/suche ────────────────────────────────
// Sucht nach Name oder Kürzel und liefert Vorschläge samt Namen.
export async function boerseSuche(env, url, json, err) {
  const q = (url.searchParams.get('q') || '').trim();
  if (q.length < 1) return json({ treffer: [] });
  try {
    const d = await holen(env, '/search', { q });
    const treffer = (d?.result || [])
      // Vorrang für gewöhnliche Aktien; Optionen und Derivate stören nur.
      .filter(x => !x.symbol?.includes('.') || x.type === 'Common Stock')
      .slice(0, 12)
      .map(x => ({
        symbol: x.symbol, name: x.description,
        art: x.type || null, anzeige: x.displaySymbol || x.symbol,
      }));
    return json({ suche: q, treffer });
  } catch (e) {
    return json({ error: String(e.message || e), treffer: [] }, 502);
  }
}

// ── Berechnete Kennzahlen ────────────────────────────────────────
// Alles hier kommt aus dem eigenen Kursspeicher, ohne externen Abruf.
// Reine Rechnung: was dasteht, ist nachvollziehbar, und was mangels
// Datenpunkten nicht berechenbar ist, bleibt null statt geraten.
function gleitend(werte, fenster) {
  if (werte.length < fenster) return null;
  const teil = werte.slice(-fenster);
  return teil.reduce((s, w) => s + w, 0) / fenster;
}

function periodenErtrag(reihe, tage) {
  if (reihe.length < 2) return null;
  const letzterKurs = reihe[reihe.length - 1].kurs;
  const grenze = new Date(Date.now() - tage * 86400000).toISOString().slice(0, 10);
  // Ersten Punkt ab der Grenze nehmen; liegt die Reihe komplett danach,
  // wäre die Angabe irreführend.
  const start = reihe.find(p => p.datum >= grenze);
  if (!start || start === reihe[reihe.length - 1]) return null;
  if (reihe[0].datum > grenze) return null;   // Reihe reicht nicht weit genug
  return Math.round(((letzterKurs - start.kurs) / start.kurs) * 10000) / 100;
}

function analytik(reihe) {
  const werte = reihe.map(p => p.kurs).filter(Number.isFinite);
  if (werte.length < 2) {
    return { punkte: werte.length, ausreichend: false };
  }
  const letzterKurs = werte[werte.length - 1];

  // Tagesrenditen für Volatilität
  const renditen = [];
  for (let i = 1; i < werte.length; i++) {
    if (werte[i - 1]) renditen.push((werte[i] - werte[i - 1]) / werte[i - 1]);
  }
  const mittel = renditen.reduce((s, r) => s + r, 0) / (renditen.length || 1);
  const varianz = renditen.reduce((s, r) => s + (r - mittel) ** 2, 0) / (renditen.length || 1);
  const volaJahr = renditen.length >= 20 ? Math.sqrt(varianz) * Math.sqrt(252) * 100 : null;

  // Größter Rückgang von einem Hoch aus
  let hoch = werte[0], maxRueck = 0;
  for (const w of werte) {
    if (w > hoch) hoch = w;
    const r = (hoch - w) / hoch;
    if (r > maxRueck) maxRueck = r;
  }

  const sma = { s20: gleitend(werte, 20), s50: gleitend(werte, 50), s200: gleitend(werte, 200) };
  const abstand = w => (w ? Math.round(((letzterKurs - w) / w) * 10000) / 100 : null);

  return {
    punkte: werte.length,
    ausreichend: true,
    hoch_reihe: Math.max(...werte),
    tief_reihe: Math.min(...werte),
    sma20: sma.s20 ? Math.round(sma.s20 * 100) / 100 : null,
    sma50: sma.s50 ? Math.round(sma.s50 * 100) / 100 : null,
    sma200: sma.s200 ? Math.round(sma.s200 * 100) / 100 : null,
    abstand_sma20: abstand(sma.s20),
    abstand_sma50: abstand(sma.s50),
    abstand_sma200: abstand(sma.s200),
    volatilitaet_jahr: volaJahr !== null ? Math.round(volaJahr * 10) / 10 : null,
    max_rueckgang: Math.round(maxRueck * 10000) / 100,
    ertrag: {
      w1: periodenErtrag(reihe, 7),
      m1: periodenErtrag(reihe, 30),
      m3: periodenErtrag(reihe, 91),
      m6: periodenErtrag(reihe, 182),
      j1: periodenErtrag(reihe, 365),
    },
  };
}

// Mehrere Angaben nebeneinander holen. Jede darf einzeln ausfallen –
// welche Endpunkte zu welcher Stufe gehören, ändert sich.
async function nebeneinander(eintraege) {
  const ergebnis = {}, fehlt = [];
  await Promise.all(eintraege.map(async ([name, fn]) => {
    try { ergebnis[name] = await fn(); }
    catch (e) { ergebnis[name] = null; fehlt.push(`${name}: ${e.message}`); }
  }));
  return { ergebnis, fehlt };
}

// ── GET /api/agentur/boerse/terminal?symbol=X ────────────────────
// Alles zu einem Wert in einem Aufruf. Die Oberfläche soll nicht
// sechsmal nachfragen müssen.
export async function boerseTerminal(env, db, url, json, err) {
  const symbol = (url.searchParams.get('symbol') || '').toUpperCase().trim();
  if (!symbol) return err('symbol fehlt');
  const tage = Math.min(parseInt(url.searchParams.get('tage'), 10) || 400, 1200);

  // Eigener Bestand zuerst – der geht immer, auch ohne Anbieter.
  const [kurse, stamm, position, beobachtet] = await Promise.all([
    db.prepare('SELECT datum, kurs, eroeffnung, hoch, tief, veraenderung_prozent FROM ag_kurse WHERE symbol=? AND datum >= ? ORDER BY datum ASC')
      .bind(symbol, tagVor(tage)).all().catch(() => ({ results: [] })),
    db.prepare('SELECT * FROM ag_werte WHERE symbol=?').bind(symbol).first().catch(() => null),
    db.prepare('SELECT * FROM ag_depot WHERE symbol=? AND aktiv=1').bind(symbol).first().catch(() => null),
    db.prepare('SELECT * FROM ag_watchlist WHERE symbol=?').bind(symbol).first().catch(() => null),
  ]);
  const reihe = kurse.results || [];

  // Was die Agentur zu diesem Wert geschrieben hat.
  const [berichte, befunde] = await Promise.all([
    db.prepare(`SELECT e.id, e.titel, e.text, e.art, e.erstellt_am, m.name AS autor, m.farbe AS autor_farbe
                  FROM ag_eintraege e LEFT JOIN ag_mitarbeiter m ON m.id = e.mitarbeiter_id
                 WHERE e.abteilung_id='boerse' AND (e.titel LIKE ? OR e.text LIKE ?)
                 ORDER BY e.id DESC LIMIT 10`)
      .bind(`%${symbol}%`, `%${symbol}%`).all().catch(() => ({ results: [] })),
    db.prepare(`SELECT b.*, m.name AS autor FROM ag_befunde b
                  LEFT JOIN ag_mitarbeiter m ON m.id = b.mitarbeiter_id
                 WHERE b.abteilung_id='boerse' AND (b.titel LIKE ? OR b.beleg LIKE ?)
                 ORDER BY b.id DESC LIMIT 10`)
      .bind(`%${symbol}%`, `%${symbol}%`).all().catch(() => ({ results: [] })),
  ]);

  // Live-Angaben. Fällt eine aus, fehlt sie – der Rest steht trotzdem.
  const { ergebnis, fehlt } = await nebeneinander([
    ['quote', async () => {
      let q = null;
      try { q = await holen(env, '/quote', { symbol }); } catch (e) { q = null; }
      if (q && zahl(q.c)) return q;
      return kursVonTwelveData(env, symbol);   // Zweitquelle für nicht abgedeckte Börsen
    }],
    ['kennzahlen', () => holen(env, '/stock/metric', { symbol, metric: 'all' })],
    ['nachrichten', () => holen(env, '/company-news', { symbol, from: tagVor(14), to: heute() })],
    ['konsens', () => holen(env, '/stock/recommendation', { symbol })],
    ['kursziel', () => holen(env, '/stock/price-target', { symbol })],
    ['vergleichbare', () => holen(env, '/stock/peers', { symbol })],
    ['quartalszahlen', () => holen(env, '/stock/earnings', { symbol })],
  ]);

  const q = ergebnis.quote;
  const m = ergebnis.kennzahlen?.metric || {};

  return json({
      symbol,
      stand: new Date().toISOString(),
      stammdaten: stamm,
      position, beobachtet: !!beobachtet,

      kurs: q && zahl(q.c) ? {
        aktuell: zahl(q.c), veraenderung: zahl(q.d), veraenderung_prozent: zahl(q.dp),
        eroeffnung: zahl(q.o), hoch: zahl(q.h), tief: zahl(q.l), vortag: zahl(q.pc),
      } : null,

      verlauf: reihe,
      analytik: analytik(reihe),

      kennzahlen: {
        kgv: zahl(m.peBasicExclExtraTTM ?? m.peTTM),
        kurs_buchwert: zahl(m.pbQuarterly ?? m.pbAnnual),
        kurs_umsatz: zahl(m.psTTM),
        dividendenrendite: zahl(m.dividendYieldIndicatedAnnual),
        eigenkapitalrendite: zahl(m.roeTTM),
        marge: zahl(m.netProfitMarginTTM),
        verschuldung: zahl(m.totalDebtToEquityQuarterly),
        beta: zahl(m.beta),
        hoch_52w: zahl(m['52WeekHigh']), tief_52w: zahl(m['52WeekLow']),
        ertrag_52w: zahl(m['52WeekPriceReturnDaily']),
      },

      // Fremde Einschätzungen: Tatsachen ÜBER Meinungen, ausdrücklich als
      // solche gekennzeichnet. Keine Bewertung von uns.
      analysten: {
        hinweis: 'Fremde Einschätzungen des Datenanbieters, keine Bewertung dieser Anwendung.',
        konsens: Array.isArray(ergebnis.konsens) ? ergebnis.konsens.slice(0, 4).map(k => ({
          periode: k.period, kaufen_stark: k.strongBuy, kaufen: k.buy,
          halten: k.hold, verkaufen: k.sell, verkaufen_stark: k.strongSell,
        })) : null,
        kursziel: ergebnis.kursziel?.targetMean ? {
          mittel: zahl(ergebnis.kursziel.targetMean),
          hoch: zahl(ergebnis.kursziel.targetHigh),
          tief: zahl(ergebnis.kursziel.targetLow),
          stand: ergebnis.kursziel.lastUpdated || null,
        } : null,
      },

      quartalszahlen: Array.isArray(ergebnis.quartalszahlen)
        ? ergebnis.quartalszahlen.slice(0, 8).map(e => ({
            periode: e.period, erwartet: zahl(e.estimate), tatsaechlich: zahl(e.actual),
            abweichung_prozent: zahl(e.surprisePercent),
          })) : null,

      vergleichbare: Array.isArray(ergebnis.vergleichbare)
        ? ergebnis.vergleichbare.filter(s => s !== symbol).slice(0, 8) : null,

      nachrichten: Array.isArray(ergebnis.nachrichten)
        ? ergebnis.nachrichten.slice(0, 25).map(n => ({
            datum: new Date((n.datetime || 0) * 1000).toISOString().slice(0, 10),
            schlagzeile: n.headline, quelle: n.source, url: n.url, zusammenfassung: n.summary,
          })) : null,

      agentur: {
        berichte: berichte.results || [],
        befunde: befunde.results || [],
      },

      nicht_verfuegbar: fehlt.length ? fehlt.map(f => ohneSchluessel(f, env)) : null,
  });
}

// ── GET /api/agentur/boerse/portfolio ────────────────────────────
// Depotweite Sicht: Aufteilung, Entwicklung, Klumpen.
export async function boersePortfolio(env, db, url, json, err) {
  const [depot, werte, kurse] = await Promise.all([
    db.prepare('SELECT * FROM ag_depot WHERE aktiv=1').all().catch(() => ({ results: [] })),
    db.prepare('SELECT * FROM ag_werte').all().catch(() => ({ results: [] })),
    db.prepare('SELECT symbol, datum, kurs FROM ag_kurse WHERE datum >= ? ORDER BY symbol, datum')
      .bind(tagVor(400)).all().catch(() => ({ results: [] })),
  ]);

  const wertNach = new Map((werte.results || []).map(w => [w.symbol, w]));
  const reihen = new Map();
  for (const k of (kurse.results || [])) {
    if (!reihen.has(k.symbol)) reihen.set(k.symbol, []);
    reihen.get(k.symbol).push(k);
  }

  const positionen = (depot.results || []).map(p => {
    const st = wertNach.get(p.symbol);
    const r = reihen.get(p.symbol) || [];
    const kurs = r.length ? r[r.length - 1].kurs : null;
    const konflikt = !!(st?.waehrung && p.waehrung && st.waehrung !== p.waehrung);
    return {
      symbol: p.symbol, name: p.name || st?.name || p.symbol,
      branche: st?.branche || null, waehrung: st?.waehrung || p.waehrung,
      stueck: p.stueck, kaufkurs: p.kaufkurs, kurs,
      wert: kurs !== null ? Math.round(kurs * p.stueck * 100) / 100 : null,
      waehrung_konflikt: konflikt,
      analytik: analytik(r.map(x => ({ datum: x.datum, kurs: x.kurs }))),
    };
  });

  // Aufteilung nur über Positionen derselben Währung – sonst addiert man
  // Beträge, die nichts miteinander zu tun haben.
  const nachWaehrung = {};
  for (const p of positionen) {
    if (p.wert === null) continue;
    const w = p.waehrung || 'unbekannt';
    (nachWaehrung[w] ||= { summe: 0, positionen: [] });
    nachWaehrung[w].summe += p.wert;
    nachWaehrung[w].positionen.push(p.symbol);
  }
  for (const w of Object.keys(nachWaehrung)) {
    nachWaehrung[w].summe = Math.round(nachWaehrung[w].summe * 100) / 100;
  }

  const nachBranche = {};
  for (const p of positionen) {
    if (p.wert === null) continue;
    const b = p.branche || 'ohne Angabe';
    nachBranche[b] = Math.round(((nachBranche[b] || 0) + p.wert) * 100) / 100;
  }

  return json({
    stand: new Date().toISOString(),
    positionen,
    nach_waehrung: nachWaehrung,
    nach_branche: nachBranche,
    ohne_kurs: positionen.filter(p => p.wert === null).map(p => p.symbol),
    hinweis_waehrung: Object.keys(nachWaehrung).length > 1
      ? 'Mehrere Währungen im Depot. Beträge werden getrennt ausgewiesen und nicht umgerechnet.'
      : null,
  });
}

// Welche Symbole verfolgt werden: Depot plus Beobachtungsliste.
async function symbole(db) {
  const [d, w] = await Promise.all([
    db.prepare('SELECT DISTINCT symbol FROM ag_depot WHERE aktiv=1').all().catch(() => ({ results: [] })),
    db.prepare('SELECT symbol FROM ag_watchlist').all().catch(() => ({ results: [] })),
  ]);
  return [...new Set([
    ...(d.results || []).map(r => r.symbol),
    ...(w.results || []).map(r => r.symbol),
  ])];
}

// ── GET /api/agentur/boerse/uebersicht ───────────────────────────
// Depot mit aktuellem Stand, Beobachtungsliste, Verlauf für die Diagramme.
// Holt nur, was fehlt – der gespeicherte Verlauf ist die Grundlage.
export async function boerseUebersicht(env, db, url, json, err) {
  const auffrischen = url.searchParams.get('auffrischen') === '1';
  const tage = Math.min(parseInt(url.searchParams.get('tage'), 10) || 90, 400);
  const ab = tagVor(tage);

  const liste = await symbole(db);
  const fehler = [];

  if (auffrischen && liste.length) {
    for (const s of liste.slice(0, 25)) {
      try { await kursHolen(env, db, s); } catch (e) { fehler.push(`${s}: ${e.message}`); break; }
    }
  }

  const [depot, watch, werte, verlauf] = await Promise.all([
    db.prepare('SELECT * FROM ag_depot WHERE aktiv=1 ORDER BY symbol').all().catch(() => ({ results: [] })),
    db.prepare('SELECT * FROM ag_watchlist ORDER BY symbol').all().catch(() => ({ results: [] })),
    db.prepare('SELECT * FROM ag_werte').all().catch(() => ({ results: [] })),
    db.prepare('SELECT symbol, datum, kurs, veraenderung_prozent FROM ag_kurse WHERE datum >= ? ORDER BY symbol, datum')
      .bind(ab).all().catch(() => ({ results: [] })),
  ]);

  const wertNach = new Map((werte.results || []).map(w => [w.symbol, w]));
  const reihen = new Map();
  for (const k of (verlauf.results || [])) {
    if (!reihen.has(k.symbol)) reihen.set(k.symbol, []);
    reihen.get(k.symbol).push({ datum: k.datum, kurs: k.kurs, veraenderung_prozent: k.veraenderung_prozent });
  }
  const letzter = s => { const r = reihen.get(s); return r?.length ? r[r.length - 1] : null; };

  // Bestand bewerten. Reine Rechnung, keine Beurteilung.
  const positionen = (depot.results || []).map(p => {
    const st = wertNach.get(p.symbol) || null;
    const l = letzter(p.symbol);
    const kurs = l?.kurs ?? null;
    const wert = kurs !== null ? kurs * p.stueck : null;
    const einsatz = p.kaufkurs !== null && p.kaufkurs !== undefined ? p.kaufkurs * p.stueck : null;

    // Kurs und Kaufkurs dürfen nur verglichen werden, wenn sie dieselbe
    // Währung haben. Ein Kurs in USD minus ein Kaufpreis in EUR ergibt eine
    // Zahl, die nach Gewinn aussieht und keine ist.
    const kursWaehrung = st?.waehrung || null;
    const konflikt = !!(kursWaehrung && p.waehrung && kursWaehrung !== p.waehrung);
    const vergleichbar = wert !== null && einsatz !== null && !konflikt;

    return {
      ...p,
      stammdaten: st,
      kurs, kurs_datum: l?.datum ?? null,
      kurs_waehrung: kursWaehrung,
      veraenderung_prozent: l?.veraenderung_prozent ?? null,
      wert, einsatz,
      waehrung_konflikt: konflikt,
      ergebnis: vergleichbar ? Math.round((wert - einsatz) * 100) / 100 : null,
      ergebnis_prozent: (vergleichbar && einsatz) ? Math.round(((wert - einsatz) / einsatz) * 10000) / 100 : null,
      verlauf: reihen.get(p.symbol) || [],
    };
  });

  const beobachtet = (watch.results || []).map(w => {
    const l = letzter(w.symbol);
    return {
      ...w,
      stammdaten: wertNach.get(w.symbol) || null,
      kurs: l?.kurs ?? null, kurs_datum: l?.datum ?? null,
      veraenderung_prozent: l?.veraenderung_prozent ?? null,
      verlauf: reihen.get(w.symbol) || [],
    };
  });

  // Nur bewerten, wofür ein Kurs vorliegt. Sonst läse sich ein fehlender
  // Kurs wie ein Totalverlust – die Zahl wäre nicht nur falsch, sondern
  // erschreckend falsch.
  const bewertbar = positionen.filter(p => p.ergebnis !== null);
  const ohneKurs = positionen.filter(p => p.wert === null).map(p => p.symbol);
  const konflikte = positionen.filter(p => p.waehrung_konflikt)
    .map(p => `${p.symbol}: Kurs in ${p.kurs_waehrung}, Kauf in ${p.waehrung}`);
  const gesamtwert = bewertbar.reduce((s, p) => s + p.wert, 0);
  const gesamteinsatz = bewertbar.reduce((s, p) => s + p.einsatz, 0);

  return json({
    stand: new Date().toISOString(),
    positionen, beobachtet,
    summe: bewertbar.length ? {
      wert: Math.round(gesamtwert * 100) / 100,
      einsatz: Math.round(gesamteinsatz * 100) / 100,
      ergebnis: Math.round((gesamtwert - gesamteinsatz) * 100) / 100,
      ergebnis_prozent: gesamteinsatz ? Math.round(((gesamtwert - gesamteinsatz) / gesamteinsatz) * 10000) / 100 : null,
      bewertet: bewertbar.length,
      von: positionen.length,
    } : { bewertet: 0, von: positionen.length, wert: null, einsatz: null, ergebnis: null, ergebnis_prozent: null },
    ohne_kurs: ohneKurs.length ? ohneKurs : null,
    waehrung_konflikte: konflikte.length ? konflikte : null,
    verlauf_tage: tage,
    fehler: fehler.length ? fehler : null,
    hinweis: (verlauf.results || []).length ? null
      : 'Noch kein Kursverlauf gespeichert. Der Verlauf baut sich mit jedem Abruf auf.',
  });
}

// ── POST /api/agentur/boerse/auffrischen ─────────────────────────
// Kurse und Stammdaten aller verfolgten Werte nachziehen.
export async function boerseAuffrischen(env, db, body, json, err) {
  const nurStamm = body?.stammdaten === true;
  const liste = body?.symbole?.length ? body.symbole.slice(0, 25) : await symbole(db);
  if (!liste.length) return json({ success: true, aktualisiert: 0, hinweis: 'Keine Werte hinterlegt.' });

  const ergebnis = [], fehler = [];
  for (const s of liste) {
    try {
      const kurs = nurStamm ? null : await kursHolen(env, db, s);
      const stamm = await wertHolen(env, db, s);
      ergebnis.push({ symbol: s, kurs: kurs?.kurs ?? null, name: stamm?.name ?? null });
    } catch (e) {
      fehler.push(`${s}: ${e.message}`);
      break;   // bei Schlüssel- oder Limitfehlern nicht weiterprobieren
    }
  }
  return json({ success: fehler.length === 0, aktualisiert: ergebnis.length, ergebnis, fehler: fehler.length ? fehler : null });
}

// ── GET /api/agentur/boerse/nachrichten ──────────────────────────
export async function boerseNachrichten(env, db, url, json, err) {
  const symbol = url.searchParams.get('symbol');
  const tage = Math.min(parseInt(url.searchParams.get('tage'), 10) || 7, 30);
  try {
    if (symbol) {
      const n = await holen(env, '/company-news', { symbol, from: tagVor(tage), to: heute() });
      return json({
        symbol, zeitraum: [tagVor(tage), heute()],
        meldungen: (n || []).slice(0, 40).map(x => ({
          datum: new Date((x.datetime || 0) * 1000).toISOString().slice(0, 10),
          schlagzeile: x.headline, quelle: x.source, url: x.url, zusammenfassung: x.summary,
        })),
      });
    }
    const n = await holen(env, '/news', { category: 'general' });
    return json({
      bereich: 'allgemein',
      meldungen: (n || []).slice(0, 30).map(x => ({
        datum: new Date((x.datetime || 0) * 1000).toISOString().slice(0, 10),
        schlagzeile: x.headline, quelle: x.source, url: x.url, zusammenfassung: x.summary,
      })),
    });
  } catch (e) {
    return json({ error: String(e.message || e) }, 502);
  }
}

// ── Depot und Beobachtungsliste pflegen ──────────────────────────
export async function depotSchreiben(request, env, db, body, method, id, json, err) {
  if (method === 'POST') {
    if (!body.symbol) return err('symbol fehlt');
    const res = await db.prepare(
      `INSERT INTO ag_depot (symbol, name, stueck, kaufkurs, waehrung, kaufdatum, notiz)
       VALUES (?,?,?,?,?,?,?)`
    ).bind(
      String(body.symbol).toUpperCase().slice(0, 20), body.name ? String(body.name).slice(0, 120) : null,
      Number(body.stueck) || 0, zahl(body.kaufkurs),
      (body.waehrung || 'USD').slice(0, 8), body.kaufdatum ? String(body.kaufdatum).slice(0, 10) : null,
      body.notiz ? String(body.notiz).slice(0, 1000) : null,
    ).run();
    return json({ success: true, id: res.meta?.last_row_id });
  }
  if (method === 'PATCH' && id) {
    const felder = [], werte = [];
    for (const k of ['name', 'waehrung', 'kaufdatum', 'notiz']) {
      if (body[k] !== undefined) { felder.push(`${k}=?`); werte.push(body[k] === null ? null : String(body[k]).slice(0, 1000)); }
    }
    for (const k of ['stueck', 'kaufkurs']) {
      if (body[k] !== undefined) { felder.push(`${k}=?`); werte.push(zahl(body[k])); }
    }
    if (body.aktiv !== undefined) { felder.push('aktiv=?'); werte.push(body.aktiv ? 1 : 0); }
    if (!felder.length) return err('Nichts zu ändern');
    felder.push('aktualisiert_am=?'); werte.push(new Date().toISOString());
    werte.push(Number(id));
    await db.prepare(`UPDATE ag_depot SET ${felder.join(', ')} WHERE id=?`).bind(...werte).run();
    return json({ success: true });
  }
  if (method === 'DELETE' && id) {
    // Verkauftes bleibt für die Historie stehen, es wird nur inaktiv.
    await db.prepare('UPDATE ag_depot SET aktiv=0, aktualisiert_am=? WHERE id=?')
      .bind(new Date().toISOString(), Number(id)).run();
    return json({ success: true, aktion: 'auf verkauft gesetzt' });
  }
  return err('Nicht unterstützt', 405);
}

export async function watchlistSchreiben(env, db, body, method, id, json, err) {
  if (method === 'POST') {
    if (!body.symbol) return err('symbol fehlt');
    await db.prepare(
      `INSERT INTO ag_watchlist (symbol, name, grund) VALUES (?,?,?)
       ON CONFLICT(symbol) DO UPDATE SET name=COALESCE(excluded.name, ag_watchlist.name),
                                        grund=COALESCE(excluded.grund, ag_watchlist.grund)`
    ).bind(
      String(body.symbol).toUpperCase().slice(0, 20),
      body.name ? String(body.name).slice(0, 120) : null,
      body.grund ? String(body.grund).slice(0, 500) : null,
    ).run();
    return json({ success: true });
  }
  if (method === 'DELETE' && id) {
    await db.prepare('DELETE FROM ag_watchlist WHERE symbol=?').bind(String(id).toUpperCase()).run();
    return json({ success: true });
  }
  return err('Nicht unterstützt', 405);
}
