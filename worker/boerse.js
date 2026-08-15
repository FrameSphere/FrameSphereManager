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
    const text = roh.replace(/\s+/g, ' ').slice(0, 160);
    if (r.status === 401 || r.status === 403) {
      throw new Error(`Zugriff verweigert (${r.status})${text ? ': ' + text : ''}`);
    }
    if (r.status === 429) throw new Error('Abruflimit erreicht (429)');
    throw new Error(`Antwort ${r.status}${text ? ': ' + text : ''}`);
  }
  return r.json();
}

const heute = () => new Date().toISOString().slice(0, 10);
const tagVor = n => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
const zahl = v => (Number.isFinite(Number(v)) ? Number(v) : null);

// Kurs holen und im eigenen Verlauf ablegen.
async function kursHolen(env, db, symbol) {
  const q = await holen(env, '/quote', { symbol });
  // Finnhub liefert bei unbekannten Symbolen Nullen statt eines Fehlers.
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
  if (meldung) throw new Error(String(meldung).replace(/\s+/g, ' ').slice(0, 220));
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

  // Reihenfolge nach Verfügbarkeit: liegt ein Alpha-Vantage-Schlüssel vor,
  // wird der zuerst gefragt. Finnhub-Kerzen gehören nicht zu jeder Stufe –
  // sie zuerst zu versuchen hieße, jedes Mal einen Abruf zu verschenken.
  const quellen = [];
  if ((env.ALPHAVANTAGE_KEY || '').trim()) {
    quellen.push(['alphavantage', s => vonAlphaVantage(env, s)]);
  }
  quellen.push(['finnhub', s => vonFinnhubKerzen(env, s, tage)]);

  const ergebnis = [], hinweise = [];
  for (const s of liste) {
    let punkte = null, quelle = null;
    const versuche = [];
    for (const [name, fn] of quellen) {
      try { punkte = await fn(s); quelle = name; break; }
      catch (e) { versuche.push(`${name}: ${e.message}`); }
    }
    if (!punkte) { hinweise.push(`${s} — ${versuche.join(' · ')}`); continue; }
    const n = await historieSchreiben(db, s, punkte, quelle);
    ergebnis.push({ symbol: s, punkte: n, quelle });
  }

  return json({
    success: ergebnis.length > 0,
    geladen: ergebnis,
    hinweise: hinweise.length ? hinweise : null,
    erklaerung: ergebnis.length ? null
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
    const l = letzter(p.symbol);
    const kurs = l?.kurs ?? null;
    const wert = kurs !== null ? kurs * p.stueck : null;
    const einsatz = p.kaufkurs !== null ? p.kaufkurs * p.stueck : null;
    return {
      ...p,
      stammdaten: wertNach.get(p.symbol) || null,
      kurs, kurs_datum: l?.datum ?? null,
      veraenderung_prozent: l?.veraenderung_prozent ?? null,
      wert,
      einsatz,
      ergebnis: (wert !== null && einsatz !== null) ? Math.round((wert - einsatz) * 100) / 100 : null,
      ergebnis_prozent: (wert !== null && einsatz) ? Math.round(((wert - einsatz) / einsatz) * 10000) / 100 : null,
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
  const bewertbar = positionen.filter(p => p.wert !== null && p.einsatz !== null);
  const ohneKurs = positionen.filter(p => p.wert === null).map(p => p.symbol);
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
