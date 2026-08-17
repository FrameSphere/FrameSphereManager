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

// ── Wechselkurse ─────────────────────────────────────────────────
// Von der EZB über frankfurter.dev, ohne Schlüssel. Nötig, weil die
// kostenlosen Kursquellen deutsche Börsen nicht abdecken: gehandelt wird
// dann die US-Notierung in Dollar, während der Kaufpreis in Euro vorliegt.
// Ohne Umrechnung wäre kein Vergleich möglich – mit ihr ist es derselbe
// Rechenweg, den auch die Depotbank nimmt.
const FX_ZWISCHENSPEICHER = { stand: 0, basis: null, kurse: null };

async function wechselkurse(basis = 'EUR') {
  const jetztMs = Date.now();
  if (FX_ZWISCHENSPEICHER.kurse && FX_ZWISCHENSPEICHER.basis === basis
      && jetztMs - FX_ZWISCHENSPEICHER.stand < 3600000) {
    return FX_ZWISCHENSPEICHER.kurse;
  }
  const r = await fetch(`https://api.frankfurter.dev/v1/latest?base=${encodeURIComponent(basis)}`);
  if (!r.ok) throw new Error(`Wechselkurse nicht erreichbar (${r.status})`);
  const d = await r.json().catch(() => ({}));
  if (!d.rates) throw new Error('Wechselkurse: unerwartete Antwort');
  const kurse = { ...d.rates, [basis]: 1, _datum: d.date };
  Object.assign(FX_ZWISCHENSPEICHER, { stand: jetztMs, basis, kurse });
  return kurse;
}

// Betrag von einer Währung in eine andere. Gibt null zurück, wenn eine der
// beiden unbekannt ist – lieber keine Zahl als eine erfundene.
function umrechnen(betrag, von, nach, kurse) {
  if (betrag === null || betrag === undefined) return null;
  if (!von || !nach || von === nach) return betrag;
  const kVon = kurse?.[von], kNach = kurse?.[nach];
  if (!kVon || !kNach) return null;
  return (betrag / kVon) * kNach;
}

const heute = () => new Date().toISOString().slice(0, 10);
const tagVor = n => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
const zahl = v => (Number.isFinite(Number(v)) ? Number(v) : null);

// Kurs holen und im eigenen Verlauf ablegen. Der Hauptanbieter deckt nur
// US-Werte ab und liefert bei allem anderen stillschweigend Nullen – dann
// wird die zweite Quelle gefragt, statt den Wert kurslos zu lassen.
async function kursHolen(env, db, symbol) {
  let q = null;
  try { q = await holen(env, '/quote', { symbol: symbolTeilen(symbol).sym }); } catch (e) { q = null; }

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
    holen(env, '/stock/profile2', { symbol: symbolTeilen(symbol).sym }).catch(() => ({})),
    holen(env, '/stock/metric', { symbol: symbolTeilen(symbol).sym, metric: 'all' }).catch(() => ({})),
  ]);
  const m = kennzahlen?.metric || {};

  let naechsteZahlen = null;
  try {
    const kal = await holen(env, '/calendar/earnings', { from: heute(), to: tagVor(-120), symbol: symbolTeilen(symbol).sym });
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
// In Blöcken schreiben, nicht Zeile für Zeile. Einzelanweisungen laufen
// nach rund tausend Stück ins Limit einer Worker-Ausführung – bei 250 Tagen
// je Wert ist das nach vier Werten erreicht. Fehler werden gemeldet statt
// verschluckt: vorher meldete die Oberfläche Erfolg für Daten, die nie
// ankamen.
async function historieSchreiben(db, symbol, punkte, quelle) {
  const gueltig = punkte.filter(p => p.datum && Number.isFinite(p.kurs));
  if (!gueltig.length) return { geschrieben: 0, fehler: null };

  const anweisung = p => db.prepare(
    `INSERT INTO ag_kurse (symbol, datum, kurs, eroeffnung, hoch, tief, quelle)
     VALUES (?,?,?,?,?,?,?)
     ON CONFLICT(symbol, datum) DO UPDATE SET
       kurs=excluded.kurs, eroeffnung=COALESCE(excluded.eroeffnung, ag_kurse.eroeffnung),
       hoch=COALESCE(excluded.hoch, ag_kurse.hoch), tief=COALESCE(excluded.tief, ag_kurse.tief)`
  ).bind(symbol, p.datum, p.kurs, p.eroeffnung ?? null, p.hoch ?? null, p.tief ?? null, quelle);

  let geschrieben = 0, fehler = null;
  const blockGroesse = 50;
  for (let i = 0; i < gueltig.length; i += blockGroesse) {
    const block = gueltig.slice(i, i + blockGroesse);
    try {
      await db.batch(block.map(anweisung));
      geschrieben += block.length;
    } catch (e) {
      fehler = String(e.message || e).slice(0, 160);
      break;   // weitere Blöcke scheitern genauso
    }
  }
  return { geschrieben, fehler };
}

async function vonFinnhubKerzen(env, symbol, tage) {
  const bis = Math.floor(Date.now() / 1000);
  const von = bis - tage * 86400;
  const d = await holen(env, '/stock/candle',
    { symbol: symbolTeilen(symbol).sym, resolution: 'D', from: von, to: bis });
  if (!d || d.s !== 'ok' || !Array.isArray(d.c)) throw new Error('keine Kerzen');
  return d.c.map((kurs, i) => ({
    datum: new Date(d.t[i] * 1000).toISOString().slice(0, 10),
    kurs: zahl(kurs), eroeffnung: zahl(d.o?.[i]), hoch: zahl(d.h?.[i]), tief: zahl(d.l?.[i]),
  }));
}

// Viele Kürzel gibt es an mehreren Börsen mit verschiedenen Währungen –
// "BAS" ist in Xetra etwas anderes als anderswo. Deshalb darf ein Symbol
// die Börse mitführen: "BAS:XETR". Anbieter, die das nicht kennen,
// bekommen nur den vorderen Teil.
function symbolTeilen(symbol) {
  const [sym, boerse] = String(symbol).split(':');
  return { sym: sym.trim(), boerse: (boerse || '').trim() || null };
}

// Twelve Data: 800 Abrufe am Tag statt 25, und deutlich bessere Abdeckung
// europäischer Börsen. Für dieses Werkzeug die passendste Quelle.
async function vonTwelveData(env, symbol, tage) {
  const key = (env.TWELVEDATA_KEY || '').trim();
  if (!key) throw new Error('TWELVEDATA_KEY ist nicht gesetzt');
  const { sym, boerse } = symbolTeilen(symbol);
  const u = new URL('https://api.twelvedata.com/time_series');
  u.searchParams.set('symbol', sym);
  if (boerse) u.searchParams.set('mic_code', boerse);
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
  const { sym, boerse } = symbolTeilen(symbol);
  const u = new URL('https://api.twelvedata.com/quote');
  u.searchParams.set('symbol', sym);
  if (boerse) u.searchParams.set('mic_code', boerse);
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

  // Sagt eine Quelle "Kontingent erschöpft" oder "nur im bezahlten Tarif",
  // gilt das für alle weiteren Werte dieses Laufs. Sie danach noch dreizehn
  // Mal zu fragen, verbrennt nur Abrufe – genau das ist zuvor passiert.
  const erschoepft = new Set();
  // Kontobezogen (Quelle aussetzen) von symbolbezogen (nur dieser Wert)
  // unterscheiden: "dieses Symbol gibt es erst im bezahlten Tarif" heißt
  // nicht, dass die Quelle für andere Werte nichts mehr liefert.
  const istKontoweit = m =>
    /credit|rate limit|quota|429|403|access|zugriff verweigert/i.test(m)
    && !/this symbol is available/i.test(m);

  const SCHREIB_BUDGET = 800;      // Zeilen je Lauf, mit Sicherheitsabstand
  let geschriebenGesamt = 0, offen = [];

  const ergebnis = [], hinweise = [], uebersprungen = [];
  for (const s of liste) {
    const v = vorhanden.get(s);
    if (v && v.n >= 60 && v.neuestes >= frischGenug) {
      uebersprungen.push(`${s}: ${v.n} Tage bis ${v.neuestes} liegen vor`);
      continue;
    }
    // Was kein handelbares Kürzel ist, wird gar nicht erst gefragt.
    if (!/^[A-Z0-9.\-]{1,12}(:[A-Z0-9]{2,6})?$/.test(s) || /^[A-Z]\d/.test(s)) {
      uebersprungen.push(`${s}: kein handelbares Kürzel, wird nicht abgefragt`);
      continue;
    }

    let punkte = null, quelle = null;
    const versuche = [];
    for (const [name, fn] of quellen) {
      if (erschoepft.has(name)) continue;
      try { punkte = await fn(s); quelle = name; break; }
      catch (e) {
        versuche.push(`${name}: ${e.message}`);
        if (istKontoweit(e.message)) erschoepft.add(name);
      }
      // Twelve Data lässt auf der freien Stufe acht Abrufe je Minute zu,
      // Alpha Vantage einen je Sekunde. Ohne Pause sperrt man sich selbst aus.
      await new Promise(r => setTimeout(r, name === 'twelvedata' ? 8000 : 1300));
    }
    if (!punkte) {
      hinweise.push(`${s} — ${versuche.length ? versuche.join(' · ') : 'alle Quellen für diesen Lauf ausgesetzt'}`);
      continue;
    }
    const { geschrieben, fehler } = await historieSchreiben(db, s, punkte, quelle);
    geschriebenGesamt += geschrieben;
    if (fehler) {
      hinweise.push(`${s}: ${geschrieben} von ${punkte.length} Tagen gespeichert, dann abgebrochen — ${fehler}`);
      break;   // Schreibgrenze erreicht, weitere Werte bringen nichts
    }
    ergebnis.push({ symbol: s, punkte: geschrieben, quelle });

    // Eine Worker-Ausführung darf nur begrenzt viele Schreibvorgänge
    // absetzen. Statt am Limit abzubrechen und Halbfertiges zu hinterlassen,
    // wird hier planmäßig Schluss gemacht – der nächste Klick macht weiter,
    // denn fertige Werte werden ohnehin übersprungen.
    if (geschriebenGesamt >= SCHREIB_BUDGET) {
      offen = liste.slice(liste.indexOf(s) + 1);
      break;
    }

    if (erschoepft.size >= quellen.length) {
      hinweise.push('Alle Quellen für diesen Lauf erschöpft – Rest später erneut versuchen.');
      break;
    }
  }
  if (erschoepft.size && erschoepft.size >= quellen.length) {
    // nichts weiter – der Hinweis steht schon
  }

  return json({
    success: ergebnis.length > 0 || uebersprungen.length > 0,
    geladen: ergebnis,
    zeilen_geschrieben: geschriebenGesamt,
    offen: offen.length ? offen : null,
    weiter_klicken: offen.length
      ? `${offen.length} Werte stehen noch aus — noch einmal „Historie laden“ drücken. Fertige werden übersprungen.`
      : null,
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

// ── Technische Indikatoren ───────────────────────────────────────
// Alles aus dem eigenen Kursspeicher gerechnet. Kein externer Abruf, keine
// Bibliothek – und was mangels Datenpunkten nicht berechenbar ist, bleibt
// null statt geschätzt zu werden.
function ema(werte, fenster) {
  if (werte.length < fenster) return null;
  const k = 2 / (fenster + 1);
  let e = werte.slice(0, fenster).reduce((s, w) => s + w, 0) / fenster;
  for (let i = fenster; i < werte.length; i++) e = werte[i] * k + e * (1 - k);
  return e;
}

function emaReihe(werte, fenster) {
  if (werte.length < fenster) return [];
  const k = 2 / (fenster + 1);
  let e = werte.slice(0, fenster).reduce((s, w) => s + w, 0) / fenster;
  const aus = new Array(fenster - 1).fill(null);
  aus.push(e);
  for (let i = fenster; i < werte.length; i++) { e = werte[i] * k + e * (1 - k); aus.push(e); }
  return aus;
}

// Relative Stärke nach Wilder, 14 Tage.
function rsi(werte, fenster = 14) {
  if (werte.length < fenster + 1) return null;
  let gewinn = 0, verlust = 0;
  for (let i = 1; i <= fenster; i++) {
    const d = werte[i] - werte[i - 1];
    if (d >= 0) gewinn += d; else verlust -= d;
  }
  let dg = gewinn / fenster, dv = verlust / fenster;
  for (let i = fenster + 1; i < werte.length; i++) {
    const d = werte[i] - werte[i - 1];
    dg = (dg * (fenster - 1) + (d > 0 ? d : 0)) / fenster;
    dv = (dv * (fenster - 1) + (d < 0 ? -d : 0)) / fenster;
  }
  if (dv === 0) return 100;
  const rs = dg / dv;
  return Math.round((100 - 100 / (1 + rs)) * 10) / 10;
}

function macd(werte) {
  if (werte.length < 35) return null;
  const e12 = emaReihe(werte, 12), e26 = emaReihe(werte, 26);
  const linie = werte.map((_, i) => (e12[i] != null && e26[i] != null) ? e12[i] - e26[i] : null);
  const gefiltert = linie.filter(x => x !== null);
  const signal = ema(gefiltert, 9);
  const aktuell = linie[linie.length - 1];
  if (aktuell === null || signal === null) return null;
  return {
    linie: Math.round(aktuell * 10000) / 10000,
    signal: Math.round(signal * 10000) / 10000,
    histogramm: Math.round((aktuell - signal) * 10000) / 10000,
  };
}

function bollinger(werte, fenster = 20, faktor = 2) {
  if (werte.length < fenster) return null;
  const teil = werte.slice(-fenster);
  const mitte = teil.reduce((s, w) => s + w, 0) / fenster;
  const abw = Math.sqrt(teil.reduce((s, w) => s + (w - mitte) ** 2, 0) / fenster);
  const letzt = werte[werte.length - 1];
  const oben = mitte + faktor * abw, unten = mitte - faktor * abw;
  return {
    mitte: Math.round(mitte * 100) / 100,
    oben: Math.round(oben * 100) / 100,
    unten: Math.round(unten * 100) / 100,
    // Wo im Band steht der Kurs? 0 = unteres Band, 100 = oberes.
    lage: oben > unten ? Math.round(((letzt - unten) / (oben - unten)) * 1000) / 10 : null,
    breite: mitte ? Math.round(((oben - unten) / mitte) * 1000) / 10 : null,
  };
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
    // Abstand zum höchsten bisher gesehenen Kurs der Reihe
    unter_hoch: Math.round(((letzterKurs - Math.max(...werte)) / Math.max(...werte)) * 10000) / 100,
    rsi: rsi(werte),
    macd: macd(werte),
    bollinger: bollinger(werte),
    // Trendlage aus dem Verhältnis der Durchschnitte – eine Feststellung,
    // keine Empfehlung: "Kurs über/unter SMA" ist ablesbar, nicht gedeutet.
    lage_sma: (() => {
      const s50 = gleitend(werte, 50), s200 = gleitend(werte, 200);
      if (!s50 || !s200) return null;
      return {
        ueber_sma50: letzterKurs > s50,
        ueber_sma200: letzterKurs > s200,
        sma50_ueber_sma200: s50 > s200,
      };
    })(),
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
    ['kennzahlen', () => holen(env, '/stock/metric', { symbol: symbolTeilen(symbol).sym, metric: 'all' })],
    ['nachrichten', () => holen(env, '/company-news', { symbol: symbolTeilen(symbol).sym, from: tagVor(14), to: heute() })],
    ['konsens', () => holen(env, '/stock/recommendation', { symbol: symbolTeilen(symbol).sym })],
    ['kursziel', () => holen(env, '/stock/price-target', { symbol: symbolTeilen(symbol).sym })],
    ['vergleichbare', () => holen(env, '/stock/peers', { symbol: symbolTeilen(symbol).sym })],
    ['quartalszahlen', () => holen(env, '/stock/earnings', { symbol: symbolTeilen(symbol).sym })],
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

// ── GET /api/agentur/boerse/monitor ──────────────────────────────
// Eine Zeile je verfolgtem Wert, mit allem, was sich aus dem eigenen
// Speicher rechnen lässt. Kein externer Abruf – deshalb beliebig oft
// aufrufbar und sofort da.
export async function boerseMonitor(env, db, url, json, err) {
  const [depot, watch, werte, kurse] = await Promise.all([
    db.prepare('SELECT * FROM ag_depot WHERE aktiv=1').all().catch(() => ({ results: [] })),
    db.prepare('SELECT * FROM ag_watchlist').all().catch(() => ({ results: [] })),
    db.prepare('SELECT * FROM ag_werte').all().catch(() => ({ results: [] })),
    db.prepare('SELECT symbol, datum, kurs, veraenderung_prozent FROM ag_kurse WHERE datum >= ? ORDER BY symbol, datum')
      .bind(tagVor(400)).all().catch(() => ({ results: [] })),
  ]);

  const wertNach = new Map((werte.results || []).map(w => [w.symbol, w]));
  const reihen = new Map();
  for (const k of (kurse.results || [])) {
    if (!reihen.has(k.symbol)) reihen.set(k.symbol, []);
    reihen.get(k.symbol).push({ datum: k.datum, kurs: k.kurs, veraenderung_prozent: k.veraenderung_prozent });
  }

  let fx = null;
  try { fx = await wechselkurse('EUR'); } catch (e) { fx = null; }

  const depotNach = new Map((depot.results || []).map(p => [p.symbol, p]));
  const alle = [...new Set([
    ...(depot.results || []).map(p => p.symbol),
    ...(watch.results || []).map(w => w.symbol),
  ])];

  const zeilen = alle.map(sym => {
    const st = wertNach.get(sym) || null;
    const p = depotNach.get(sym) || null;
    const r = reihen.get(sym) || [];
    const a = analytik(r);
    const letzt = r.length ? r[r.length - 1] : null;
    const faktor = p && Number(p.kurs_faktor) > 0 ? Number(p.kurs_faktor) : 1;

    const kurs = letzt?.kurs ?? null;
    const kursW = st?.waehrung || null;
    let wertEur = null, ergebnisProzent = null;
    if (p && kurs !== null && kursW) {
      const roh = kurs * p.stueck * faktor;
      wertEur = kursW === (p.waehrung || 'EUR') ? roh : umrechnen(roh, kursW, p.waehrung || 'EUR', fx);
      const einsatz = p.kaufkurs != null ? p.kaufkurs * p.stueck : null;
      if (wertEur !== null && einsatz) ergebnisProzent = Math.round(((wertEur - einsatz) / einsatz) * 10000) / 100;
    }

    return {
      symbol: sym,
      name: p?.name || st?.name || sym,
      branche: st?.branche || null,
      gehalten: !!p,
      waehrung: kursW,
      kurs, kurs_datum: letzt?.datum ?? null,
      tag: letzt?.veraenderung_prozent ?? null,
      w1: a.ertrag?.w1 ?? null, m1: a.ertrag?.m1 ?? null,
      m3: a.ertrag?.m3 ?? null, m6: a.ertrag?.m6 ?? null, j1: a.ertrag?.j1 ?? null,
      rsi: a.rsi ?? null,
      vola: a.volatilitaet_jahr ?? null,
      unter_hoch: a.unter_hoch ?? null,
      lage_sma: a.lage_sma ?? null,
      bollinger_lage: a.bollinger?.lage ?? null,
      kgv: st?.kgv ?? null,
      naechste_zahlen: st?.naechste_zahlen ?? null,
      punkte: a.punkte ?? 0,
      wert_eur: wertEur !== null ? Math.round(wertEur * 100) / 100 : null,
      ergebnis_prozent: ergebnisProzent,
      stueck: p?.stueck ?? null,
      // Sparkline-Daten, stark ausgedünnt: die Tabelle braucht Form, keine Details.
      spur: r.length > 2 ? r.filter((_, i) => i % Math.max(1, Math.floor(r.length / 40)) === 0).map(x => x.kurs) : [],
    };
  });

  return json({ stand: new Date().toISOString(), fx_stand: fx?._datum || null, zeilen });
}

// ── Schwellen ────────────────────────────────────────────────────
// Was Karol gemeldet bekommen will. Die Prüfung läuft vollständig auf
// gespeicherten Daten – kein Abruf, deshalb beliebig oft möglich, auch
// von Malte in jedem Lauf.
const SCHWELLEN_ARTEN = {
  kurs_unter:      'Kurs unter',
  kurs_ueber:      'Kurs über',
  tag_bewegung:    'Tagesbewegung stärker als ±',
  rsi_ueber:       'RSI über',
  rsi_unter:       'RSI unter',
  ergebnis_unter:  'Ergebnis unter',
  ergebnis_ueber:  'Ergebnis über',
  zahlen_in_tagen: 'Quartalszahlen in weniger als',
};

export async function schwellenLesen(env, db, url, json, err) {
  const r = await db.prepare('SELECT * FROM ag_schwellen ORDER BY aktiv DESC, symbol, art')
    .all().catch(() => ({ results: [] }));
  return json({ arten: SCHWELLEN_ARTEN, schwellen: r.results || [] });
}

export async function schwellenSchreiben(env, db, body, method, id, json, err) {
  if (method === 'POST') {
    if (!body.art || !SCHWELLEN_ARTEN[body.art]) return err('Unbekannte Art');
    if (body.wert === undefined || !Number.isFinite(Number(body.wert))) return err('wert fehlt');
    const res = await db.prepare(
      'INSERT INTO ag_schwellen (symbol, art, wert, notiz) VALUES (?,?,?,?)'
    ).bind(
      body.symbol ? String(body.symbol).toUpperCase().slice(0, 24) : null,
      body.art, Number(body.wert),
      body.notiz ? String(body.notiz).slice(0, 300) : null,
    ).run();
    return json({ success: true, id: res.meta?.last_row_id });
  }
  if (method === 'DELETE' && id) {
    await db.prepare('DELETE FROM ag_schwellen WHERE id=?').bind(Number(id)).run();
    return json({ success: true });
  }
  if (method === 'PATCH' && id) {
    if (body.aktiv === undefined) return err('Nichts zu ändern');
    await db.prepare('UPDATE ag_schwellen SET aktiv=? WHERE id=?')
      .bind(body.aktiv ? 1 : 0, Number(id)).run();
    return json({ success: true });
  }
  return err('Nicht unterstützt', 405);
}

// Prüfung gegen den gespeicherten Stand. Liefert Auslöser mit Beleg, damit
// jede Meldung nachvollziehbar bleibt.
// Reine Prüfung ohne Antwortkanal – von der Route UND vom Lage-Überblick
// genutzt. Ein gefälschtes json/err durchzureichen wäre eine Falle für den
// Nächsten, der hier etwas ändert.
async function schwellenAuswerten(env, db) {
  const [regeln, depot, werte, kurse] = await Promise.all([
    db.prepare('SELECT * FROM ag_schwellen WHERE aktiv=1').all().catch(() => ({ results: [] })),
    db.prepare('SELECT * FROM ag_depot WHERE aktiv=1').all().catch(() => ({ results: [] })),
    db.prepare('SELECT * FROM ag_werte').all().catch(() => ({ results: [] })),
    db.prepare('SELECT symbol, datum, kurs, veraenderung_prozent FROM ag_kurse WHERE datum >= ? ORDER BY symbol, datum')
      .bind(tagVor(400)).all().catch(() => ({ results: [] })),
  ]);

  const wertNach = new Map((werte.results || []).map(w => [w.symbol, w]));
  const depotNach = new Map((depot.results || []).map(p => [p.symbol, p]));
  const reihen = new Map();
  for (const k of (kurse.results || [])) {
    if (!reihen.has(k.symbol)) reihen.set(k.symbol, []);
    reihen.get(k.symbol).push(k);
  }
  let fx = null;
  try { fx = await wechselkurse('EUR'); } catch (e) { fx = null; }

  const lage = sym => {
    const r = reihen.get(sym) || [];
    if (!r.length) return null;
    const letzt = r[r.length - 1];
    const a = analytik(r.map(x => ({ datum: x.datum, kurs: x.kurs })));
    const p = depotNach.get(sym), st = wertNach.get(sym);
    let ergebnis = null;
    if (p && st?.waehrung) {
      const faktor = Number(p.kurs_faktor) > 0 ? Number(p.kurs_faktor) : 1;
      const roh = letzt.kurs * p.stueck * faktor;
      const wert = st.waehrung === (p.waehrung || 'EUR') ? roh : umrechnen(roh, st.waehrung, p.waehrung || 'EUR', fx);
      const einsatz = p.kaufkurs != null ? p.kaufkurs * p.stueck : null;
      if (wert !== null && einsatz) ergebnis = ((wert - einsatz) / einsatz) * 100;
    }
    return { kurs: letzt.kurs, datum: letzt.datum, tag: letzt.veraenderung_prozent,
             rsi: a.rsi, ergebnis, zahlen: st?.naechste_zahlen || null, waehrung: st?.waehrung || null };
  };

  const alle = [...new Set([...depotNach.keys(), ...reihen.keys()])];
  const ausgeloest = [];
  for (const regel of (regeln.results || [])) {
    const ziele = regel.symbol ? [regel.symbol] : alle;
    for (const sym of ziele) {
      const l = lage(sym); if (!l) continue;
      let trifft = false, ist = null, einheit = '';
      switch (regel.art) {
        case 'kurs_unter':   ist = l.kurs; trifft = l.kurs !== null && l.kurs < regel.wert; einheit = l.waehrung || ''; break;
        case 'kurs_ueber':   ist = l.kurs; trifft = l.kurs !== null && l.kurs > regel.wert; einheit = l.waehrung || ''; break;
        case 'tag_bewegung': ist = l.tag;  trifft = l.tag !== null && Math.abs(l.tag) >= Math.abs(regel.wert); einheit = '%'; break;
        case 'rsi_ueber':    ist = l.rsi;  trifft = l.rsi !== null && l.rsi > regel.wert; break;
        case 'rsi_unter':    ist = l.rsi;  trifft = l.rsi !== null && l.rsi < regel.wert; break;
        case 'ergebnis_unter': ist = l.ergebnis; trifft = l.ergebnis !== null && l.ergebnis < regel.wert; einheit = '%'; break;
        case 'ergebnis_ueber': ist = l.ergebnis; trifft = l.ergebnis !== null && l.ergebnis > regel.wert; einheit = '%'; break;
        case 'zahlen_in_tagen': {
          if (!l.zahlen) break;
          const t = Math.round((Date.parse(l.zahlen) - Date.now()) / 86400000);
          ist = t; trifft = t >= 0 && t <= regel.wert; einheit = 'Tage';
          break;
        }
      }
      if (trifft) {
        ausgeloest.push({
          schwelle_id: regel.id, symbol: sym, art: regel.art,
          bezeichnung: SCHWELLEN_ARTEN[regel.art],
          grenze: regel.wert, ist: ist === null ? null : Math.round(ist * 100) / 100,
          einheit, stand: l.datum, notiz: regel.notiz,
          beleg: `${SCHWELLEN_ARTEN[regel.art]} ${regel.wert}${einheit ? ' ' + einheit : ''} — ist ${Math.round(ist * 100) / 100}${einheit ? ' ' + einheit : ''} (Stand ${l.datum})`,
        });
      }
    }
  }

  return {
    geprueft: (regeln.results || []).length,
    werte_geprueft: alle.length,
    ausgeloest,
    hinweis: (regeln.results || []).length ? null
      : 'Keine Schwellen hinterlegt. Ohne sie meldet der Depot-Beobachter nur seine festen Standardfälle.',
  };
}

export async function schwellenPruefen(env, db, url, json, err) {
  return json(await schwellenAuswerten(env, db));
}

// ── GET /api/agentur/boerse/lage ─────────────────────────────────
// Was ist passiert? Ein Überblick aus gespeicherten Daten: ausgelöste
// Schwellen, auffällige Bewegungen, anstehende Termine, neue Befunde und
// Berichte. Ohne externen Abruf, damit er jederzeit abrufbar ist.
export async function boerseLage(env, db, url, json, err) {
  const tage = Math.min(parseInt(url.searchParams.get('tage'), 10) || 7, 90);
  const seit = new Date(Date.now() - tage * 86400000).toISOString();

  const [schwellen, kalender, befunde, berichte, laeufe] = await Promise.all([
    schwellenAuswerten(env, db).catch(() => null),
    db.prepare(`SELECT symbol, name, naechste_zahlen FROM ag_werte
                 WHERE naechste_zahlen IS NOT NULL AND naechste_zahlen >= ? AND naechste_zahlen <= ?
                 ORDER BY naechste_zahlen`)
      .bind(heute(), new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10)).all().catch(() => ({ results: [] })),
    db.prepare(`SELECT b.*, m.name AS autor FROM ag_befunde b LEFT JOIN ag_mitarbeiter m ON m.id=b.mitarbeiter_id
                 WHERE b.abteilung_id='boerse' AND b.erstellt_am >= ? ORDER BY b.id DESC LIMIT 20`)
      .bind(seit).all().catch(() => ({ results: [] })),
    db.prepare(`SELECT e.id, e.titel, e.art, e.erstellt_am, m.name AS autor FROM ag_eintraege e
                 LEFT JOIN ag_mitarbeiter m ON m.id=e.mitarbeiter_id
                 WHERE e.abteilung_id='boerse' AND e.art='bericht' AND e.erstellt_am >= ?
                 ORDER BY e.id DESC LIMIT 10`).bind(seit).all().catch(() => ({ results: [] })),
    db.prepare(`SELECT status, COUNT(*) n FROM ag_laeufe WHERE abteilung_id='boerse' AND gestartet_am >= ? GROUP BY status`)
      .bind(seit).all().catch(() => ({ results: [] })),
  ]);

  // Auffällige Bewegungen aus dem Speicher
  const kurse = await db.prepare(
    'SELECT symbol, datum, kurs, veraenderung_prozent FROM ag_kurse WHERE datum >= ? ORDER BY symbol, datum'
  ).bind(tagVor(tage + 5)).all().catch(() => ({ results: [] }));
  const nach = new Map();
  for (const k of (kurse.results || [])) {
    if (!nach.has(k.symbol)) nach.set(k.symbol, []);
    nach.get(k.symbol).push(k);
  }
  const bewegungen = [];
  for (const [sym, r] of nach) {
    if (r.length < 2) continue;
    const erst = r[0].kurs, letzt = r[r.length - 1].kurs;
    if (!erst) continue;
    bewegungen.push({
      symbol: sym, von: r[0].datum, bis: r[r.length - 1].datum,
      veraenderung: Math.round(((letzt - erst) / erst) * 10000) / 100,
      tage: r.length,
    });
  }
  bewegungen.sort((a, b) => Math.abs(b.veraenderung) - Math.abs(a.veraenderung));

  return json({
    zeitraum_tage: tage, seit,
    schwellen: schwellen?.ausgeloest || [],
    schwellen_geprueft: schwellen?.geprueft ?? 0,
    bewegungen: bewegungen.slice(0, 10),
    termine: kalender.results || [],
    befunde: befunde.results || [],
    berichte: berichte.results || [],
    laeufe: (laeufe.results || []).reduce((a, x) => { a[x.status] = x.n; return a; }, {}),
  });
}

// ── GET /api/agentur/boerse/kennzahlen ───────────────────────────
// Risiko- und Güte-Maße des Depots, gewichtet nach tatsächlichem Wert.
// Alles aus gespeicherten Tagesrenditen – kein Abruf. Wo die Reihe zu kurz
// ist, bleibt der Wert leer statt hochgerechnet zu werden.
export async function boerseKennzahlen(env, db, url, json, err) {
  const tage = Math.min(parseInt(url.searchParams.get('tage'), 10) || 250, 500);
  const risikofrei = Number(url.searchParams.get('risikofrei') ?? 2) / 100;   // p.a.

  const [depot, werte, kurse] = await Promise.all([
    db.prepare('SELECT * FROM ag_depot WHERE aktiv=1').all().catch(() => ({ results: [] })),
    db.prepare('SELECT * FROM ag_werte').all().catch(() => ({ results: [] })),
    db.prepare('SELECT symbol, datum, kurs FROM ag_kurse WHERE datum >= ? ORDER BY symbol, datum')
      .bind(tagVor(tage)).all().catch(() => ({ results: [] })),
  ]);

  const wertNach = new Map((werte.results || []).map(w => [w.symbol, w]));
  const nach = new Map();
  for (const k of (kurse.results || [])) {
    if (!nach.has(k.symbol)) nach.set(k.symbol, new Map());
    nach.get(k.symbol).set(k.datum, k.kurs);
  }

  let fx = null;
  try { fx = await wechselkurse('EUR'); } catch (e) { fx = null; }

  // Gewichte aus dem aktuellen Wert je Position
  const positionen = [];
  for (const p of (depot.results || [])) {
    const st = wertNach.get(p.symbol);
    const reihe = nach.get(p.symbol);
    if (!reihe || !st?.waehrung) continue;
    const letzt = [...reihe.entries()].sort((a, b) => a[0].localeCompare(b[0])).pop();
    if (!letzt) continue;
    const faktor = Number(p.kurs_faktor) > 0 ? Number(p.kurs_faktor) : 1;
    const roh = letzt[1] * p.stueck * faktor;
    const wert = st.waehrung === (p.waehrung || 'EUR') ? roh : umrechnen(roh, st.waehrung, p.waehrung || 'EUR', fx);
    if (wert === null) continue;
    positionen.push({ symbol: p.symbol, wert, branche: st.branche || null, waehrung: st.waehrung });
  }
  const gesamt = positionen.reduce((s, p) => s + p.wert, 0);
  if (!gesamt || positionen.length === 0) {
    return json({ hinweis: 'Keine bewertbaren Positionen — ohne Kurse und Währung lässt sich nichts rechnen.' });
  }

  // Gemeinsame Handelstage aller gewichteten Positionen
  const symbole = positionen.map(p => p.symbol);
  const gemeinsam = [...nach.get(symbole[0]).keys()]
    .filter(d => symbole.every(s => nach.get(s).has(d))).sort();
  if (gemeinsam.length < 30) {
    return json({
      gewichte: positionen.map(p => ({ symbol: p.symbol, anteil: Math.round(p.wert / gesamt * 1000) / 10 })),
      gemeinsame_tage: gemeinsam.length,
      hinweis: 'Weniger als 30 gemeinsame Handelstage — Kennzahlen darauf wären nicht belastbar.',
    });
  }

  // Depotrendite je Tag: gewichtete Summe der Einzelrenditen
  const depotRenditen = [];
  for (let i = 1; i < gemeinsam.length; i++) {
    let r = 0;
    for (const p of positionen) {
      const v = nach.get(p.symbol).get(gemeinsam[i - 1]);
      const n = nach.get(p.symbol).get(gemeinsam[i]);
      if (v) r += (p.wert / gesamt) * ((n - v) / v);
    }
    depotRenditen.push(r);
  }

  const n = depotRenditen.length;
  const mittel = depotRenditen.reduce((s, x) => s + x, 0) / n;
  const varianz = depotRenditen.reduce((s, x) => s + (x - mittel) ** 2, 0) / n;
  const abw = Math.sqrt(varianz);
  const abwAbwaerts = Math.sqrt(
    depotRenditen.filter(x => x < 0).reduce((s, x) => s + x * x, 0) / n) || null;

  const jahr = 252;
  const renditeJahr = mittel * jahr;
  const volaJahr = abw * Math.sqrt(jahr);
  const sharpe = volaJahr ? (renditeJahr - risikofrei) / volaJahr : null;
  const sortino = abwAbwaerts ? (renditeJahr - risikofrei) / (abwAbwaerts * Math.sqrt(jahr)) : null;

  // Wertrisiko: historisches Quantil der Tagesrenditen, kein Normalverteilungs-
  // Modell – die Annahme wäre bei Kursreihen schlicht falsch.
  const sortiert = [...depotRenditen].sort((a, b) => a - b);
  const quantil = q => sortiert[Math.max(0, Math.min(sortiert.length - 1, Math.floor(q * sortiert.length)))];
  const var95 = quantil(0.05), var99 = quantil(0.01);
  const unterhalb = sortiert.filter(x => x <= var95);
  const cvar95 = unterhalb.length ? unterhalb.reduce((s, x) => s + x, 0) / unterhalb.length : null;

  // Wertverlauf und größter Rückgang des Depots
  let stand = 100, hoch = 100, maxRueck = 0;
  const verlauf = [{ datum: gemeinsam[0], wert: 100 }];
  depotRenditen.forEach((r, i) => {
    stand *= 1 + r;
    if (stand > hoch) hoch = stand;
    maxRueck = Math.max(maxRueck, (hoch - stand) / hoch);
    verlauf.push({ datum: gemeinsam[i + 1], wert: Math.round(stand * 100) / 100 });
  });

  const gewinnTage = depotRenditen.filter(x => x > 0).length;

  const nachBranche = {}, nachWaehrung = {};
  for (const p of positionen) {
    nachBranche[p.branche || 'ohne Angabe'] = (nachBranche[p.branche || 'ohne Angabe'] || 0) + p.wert / gesamt * 100;
    nachWaehrung[p.waehrung] = (nachWaehrung[p.waehrung] || 0) + p.wert / gesamt * 100;
  }
  const runde = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Math.round(v * 10) / 10]));

  return json({
    zeitraum: [gemeinsam[0], gemeinsam[gemeinsam.length - 1]],
    handelstage: n,
    risikofrei_prozent: risikofrei * 100,
    rendite_jahr: Math.round(renditeJahr * 1000) / 10,
    volatilitaet_jahr: Math.round(volaJahr * 1000) / 10,
    sharpe: sharpe === null ? null : Math.round(sharpe * 100) / 100,
    sortino: sortino === null ? null : Math.round(sortino * 100) / 100,
    var95_tag: Math.round(var95 * 10000) / 100,
    var99_tag: Math.round(var99 * 10000) / 100,
    cvar95_tag: cvar95 === null ? null : Math.round(cvar95 * 10000) / 100,
    var95_euro: Math.round(var95 * gesamt * 100) / 100,
    max_rueckgang: Math.round(maxRueck * 1000) / 10,
    gewinntage_prozent: Math.round((gewinnTage / n) * 1000) / 10,
    depotwert: Math.round(gesamt * 100) / 100,
    gewichte: positionen.map(p => ({ symbol: p.symbol, anteil: Math.round(p.wert / gesamt * 1000) / 10, wert: Math.round(p.wert * 100) / 100 }))
      .sort((a, b) => b.anteil - a.anteil),
    nach_branche: runde(nachBranche),
    nach_waehrung: runde(nachWaehrung),
    verlauf,
    hinweis_var: 'Wertrisiko als historisches Quantil der Tagesrenditen, nicht als Normalverteilung — '
      + 'Kursreihen sind nicht normalverteilt, und die Annahme würde das Risiko systematisch unterschätzen.',
  });
}

// ── GET /api/agentur/boerse/vergleich?symbole=A,B,C ──────────────
// Dieselben Kennzahlen nebeneinander. Stammdaten kommen aus dem Speicher,
// fehlende werden einzeln nachgeholt – mit Deckel, damit das Kontingent
// nicht draufgeht.
export async function boerseWertvergleich(env, db, url, json, err) {
  const roh = (url.searchParams.get('symbole') || '').split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
  if (!roh.length) return err('symbole fehlen');
  const liste = roh.slice(0, 8);

  const [werte, kurse] = await Promise.all([
    db.prepare('SELECT * FROM ag_werte').all().catch(() => ({ results: [] })),
    db.prepare('SELECT symbol, datum, kurs FROM ag_kurse WHERE datum >= ? ORDER BY symbol, datum')
      .bind(tagVor(400)).all().catch(() => ({ results: [] })),
  ]);
  const wertNach = new Map((werte.results || []).map(w => [w.symbol, w]));
  const reihen = new Map();
  for (const k of (kurse.results || [])) {
    if (!reihen.has(k.symbol)) reihen.set(k.symbol, []);
    reihen.get(k.symbol).push({ datum: k.datum, kurs: k.kurs });
  }

  const fehlend = liste.filter(s => !wertNach.has(s));
  const nachgeholt = [], fehler = [];
  for (const s of fehlend.slice(0, 5)) {
    try {
      const m = await holen(env, '/stock/metric', { symbol: symbolTeilen(s).sym, metric: 'all' });
      const p = await holen(env, '/stock/profile2', { symbol: symbolTeilen(s).sym }).catch(() => ({}));
      const mm = m?.metric || {};
      wertNach.set(s, {
        symbol: s, name: p?.name || null, branche: p?.finnhubIndustry || null,
        waehrung: p?.currency || null, marktwert: zahl(p?.marketCapitalization),
        kgv: zahl(mm.peBasicExclExtraTTM ?? mm.peTTM),
        hoch_52w: zahl(mm['52WeekHigh']), tief_52w: zahl(mm['52WeekLow']),
        _live: mm,
      });
      nachgeholt.push(s);
    } catch (e) {
      fehler.push(`${s}: ${ohneSchluessel(String(e.message), env)}`);
      if (/credit|rate limit|quota|429|403/i.test(String(e.message))) break;
    }
  }

  const zeilen = liste.map(s => {
    const st = wertNach.get(s) || {};
    const m = st._live || {};
    const a = analytik(reihen.get(s) || []);
    return {
      symbol: s, name: st.name || null, branche: st.branche || null, waehrung: st.waehrung || null,
      marktwert: st.marktwert ?? null,
      kgv: st.kgv ?? null,
      kurs_buchwert: zahl(m.pbQuarterly ?? m.pbAnnual),
      kurs_umsatz: zahl(m.psTTM),
      eigenkapitalrendite: zahl(m.roeTTM),
      marge: zahl(m.netProfitMarginTTM),
      verschuldung: zahl(m.totalDebtToEquityQuarterly),
      dividendenrendite: zahl(m.dividendYieldIndicatedAnnual),
      beta: zahl(m.beta),
      hoch_52w: st.hoch_52w ?? null, tief_52w: st.tief_52w ?? null,
      ertrag_1j: a.ertrag?.j1 ?? null, ertrag_3m: a.ertrag?.m3 ?? null,
      volatilitaet: a.volatilitaet_jahr ?? null, rsi: a.rsi ?? null,
      punkte: a.punkte ?? 0,
    };
  });

  return json({
    symbole: liste, zeilen, nachgeholt: nachgeholt.length ? nachgeholt : null,
    fehler: fehler.length ? fehler : null,
    hinweis: 'Kennzahlen ohne gespeicherte Stammdaten werden einmalig nachgeholt, höchstens fünf je Aufruf.',
  });
}

// ── Handelsbuch ──────────────────────────────────────────────────
// Was festgehalten wird, lässt sich später auswerten. Ohne notierte
// Absicht ist hinterher nicht unterscheidbar, was Können war und was Glück.
export async function tradesLesen(env, db, url, json, err) {
  const symbol = url.searchParams.get('symbol');
  const r = symbol
    ? await db.prepare('SELECT * FROM ag_trades WHERE symbol=? ORDER BY datum DESC, id DESC').bind(symbol.toUpperCase()).all().catch(() => ({ results: [] }))
    : await db.prepare('SELECT * FROM ag_trades ORDER BY datum DESC, id DESC LIMIT 300').all().catch(() => ({ results: [] }));
  return json({ trades: r.results || [], auswertung: tradesAuswerten(r.results || []) });
}

// Auswertung des eigenen Handelns. Reine Statistik über das Journal –
// keine Prognose, keine Bewertung der Werte selbst.
function tradesAuswerten(trades) {
  // Käufe und Verkäufe je Wert paaren, ältester Kauf zuerst.
  const nach = {};
  for (const t of [...trades].sort((a, b) => String(a.datum).localeCompare(String(b.datum)) || a.id - b.id)) {
    (nach[t.symbol] ||= []).push(t);
  }
  const geschlossen = [];
  for (const [sym, liste] of Object.entries(nach)) {
    const offen = [];
    for (const t of liste) {
      if (t.richtung === 'kauf') { offen.push({ ...t, rest: t.stueck }); continue; }
      let zuVerkaufen = t.stueck;
      while (zuVerkaufen > 0 && offen.length) {
        const k = offen[0];
        const menge = Math.min(k.rest, zuVerkaufen);
        const ein = k.kurs * menge, aus = t.kurs * menge;
        const gebuehr = ((k.gebuehren || 0) * (menge / k.stueck)) + ((t.gebuehren || 0) * (menge / t.stueck));
        const ergebnis = aus - ein - gebuehr;
        // R-Vielfaches: Ergebnis gemessen am bewusst eingegangenen Risiko.
        // Bei Teilverkäufen zählt nur der anteilige Risikobetrag – sonst
        // fiele das R-Vielfache allein deshalb kleiner aus, weil weniger
        // Stücke verkauft wurden.
        const risiko = k.risiko_euro ? k.risiko_euro * (menge / k.stueck)
          : (k.stopp ? Math.abs(k.kurs - k.stopp) * menge : null);
        geschlossen.push({
          symbol: sym, menge, kauf: k.kurs, verkauf: t.kurs,
          von: k.datum, bis: t.datum,
          haltedauer: Math.max(0, Math.round((Date.parse(t.datum) - Date.parse(k.datum)) / 86400000)),
          ergebnis: Math.round(ergebnis * 100) / 100,
          ergebnis_prozent: ein ? Math.round((ergebnis / ein) * 10000) / 100 : null,
          r_vielfaches: risiko ? Math.round((ergebnis / risiko) * 100) / 100 : null,
          these: k.these || null, gefuehl: k.gefuehl || null, ausstieg_grund: t.ausstieg_grund || null,
        });
        k.rest -= menge; zuVerkaufen -= menge;
        if (k.rest <= 0) offen.shift();
      }
    }
  }

  if (!geschlossen.length) {
    return { geschlossen: [], anzahl: 0,
      hinweis: 'Noch keine abgeschlossenen Positionen — Auswertung braucht mindestens einen Verkauf.' };
  }

  const gewinner = geschlossen.filter(g => g.ergebnis > 0);
  const verlierer = geschlossen.filter(g => g.ergebnis <= 0);
  const summe = a => a.reduce((s, g) => s + g.ergebnis, 0);
  const mittel = a => a.length ? summe(a) / a.length : null;
  const mitR = geschlossen.filter(g => g.r_vielfaches !== null);

  // Nach Gefühlslage aufschlüsseln – die interessanteste Frage überhaupt.
  const nachGefuehl = {};
  for (const g of geschlossen) {
    const k = g.gefuehl || 'nicht notiert';
    (nachGefuehl[k] ||= { anzahl: 0, summe: 0, gewinner: 0 });
    nachGefuehl[k].anzahl++; nachGefuehl[k].summe += g.ergebnis;
    if (g.ergebnis > 0) nachGefuehl[k].gewinner++;
  }
  for (const k of Object.keys(nachGefuehl)) {
    const x = nachGefuehl[k];
    x.summe = Math.round(x.summe * 100) / 100;
    x.trefferquote = Math.round((x.gewinner / x.anzahl) * 1000) / 10;
  }

  return {
    geschlossen: geschlossen.sort((a, b) => String(b.bis).localeCompare(String(a.bis))),
    anzahl: geschlossen.length,
    trefferquote: Math.round((gewinner.length / geschlossen.length) * 1000) / 10,
    summe: Math.round(summe(geschlossen) * 100) / 100,
    schnitt_gewinn: mittel(gewinner) === null ? null : Math.round(mittel(gewinner) * 100) / 100,
    schnitt_verlust: mittel(verlierer) === null ? null : Math.round(mittel(verlierer) * 100) / 100,
    // Erwartungswert je Trade – die Zahl, die zählt, nicht die Trefferquote.
    erwartungswert: Math.round((summe(geschlossen) / geschlossen.length) * 100) / 100,
    gewinn_verlust_verhaeltnis: (mittel(verlierer) && mittel(gewinner))
      ? Math.round(Math.abs(mittel(gewinner) / mittel(verlierer)) * 100) / 100 : null,
    r_schnitt: mitR.length ? Math.round((mitR.reduce((s, g) => s + g.r_vielfaches, 0) / mitR.length) * 100) / 100 : null,
    r_erfasst: mitR.length,
    haltedauer_schnitt: Math.round(geschlossen.reduce((s, g) => s + g.haltedauer, 0) / geschlossen.length),
    nach_gefuehl: nachGefuehl,
    hinweis_trefferquote: 'Eine hohe Trefferquote sagt für sich nichts — entscheidend ist der '
      + 'Erwartungswert je Trade und das Verhältnis von durchschnittlichem Gewinn zu Verlust.',
  };
}

export async function tradesSchreiben(env, db, body, method, id, json, err) {
  if (method === 'POST') {
    if (!body.symbol || !body.datum) return err('symbol und datum sind Pflicht');
    if (!Number.isFinite(Number(body.stueck)) || !Number.isFinite(Number(body.kurs)))
      return err('stueck und kurs müssen Zahlen sein');
    const res = await db.prepare(
      `INSERT INTO ag_trades (symbol, richtung, stueck, kurs, waehrung, datum, gebuehren,
                              these, stopp, ziel, risiko_euro, gefuehl, ausstieg_grund, notiz)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(
      String(body.symbol).toUpperCase().slice(0, 24),
      body.richtung === 'verkauf' ? 'verkauf' : 'kauf',
      Number(body.stueck), Number(body.kurs),
      (body.waehrung || 'EUR').slice(0, 8), String(body.datum).slice(0, 10),
      zahl(body.gebuehren) ?? 0,
      body.these ? String(body.these).slice(0, 2000) : null,
      zahl(body.stopp), zahl(body.ziel), zahl(body.risiko_euro),
      body.gefuehl ? String(body.gefuehl).slice(0, 40) : null,
      body.ausstieg_grund ? String(body.ausstieg_grund).slice(0, 500) : null,
      body.notiz ? String(body.notiz).slice(0, 2000) : null,
    ).run();
    return json({ success: true, id: res.meta?.last_row_id });
  }
  if (method === 'DELETE' && id) {
    await db.prepare('DELETE FROM ag_trades WHERE id=?').bind(Number(id)).run();
    return json({ success: true });
  }
  return err('Nicht unterstützt', 405);
}

// ── Thesen ───────────────────────────────────────────────────────
export async function thesenLesen(env, db, url, json, err) {
  const symbol = url.searchParams.get('symbol');
  const t = symbol
    ? await db.prepare('SELECT * FROM ag_thesen WHERE symbol=? ORDER BY id DESC').bind(symbol.toUpperCase()).all().catch(() => ({ results: [] }))
    : await db.prepare('SELECT * FROM ag_thesen ORDER BY status, id DESC').all().catch(() => ({ results: [] }));
  const ids = (t.results || []).map(x => x.id);
  let pruefungen = { results: [] };
  if (ids.length) {
    pruefungen = await db.prepare(
      `SELECT p.*, m.name AS autor FROM ag_thesen_pruefung p
         LEFT JOIN ag_mitarbeiter m ON m.id = p.mitarbeiter_id
        WHERE p.these_id IN (${ids.map(() => '?').join(',')}) ORDER BY p.id DESC`
    ).bind(...ids).all().catch(() => ({ results: [] }));
  }
  const nach = {};
  for (const p of (pruefungen.results || [])) (nach[p.these_id] ||= []).push(p);

  return json({
    thesen: (t.results || []).map(x => {
      let annahmen = [];
      try { annahmen = JSON.parse(x.annahmen || '[]'); } catch (e) { annahmen = []; }
      const pr = nach[x.id] || [];
      return {
        ...x, annahmen, pruefungen: pr,
        stuetzt: pr.filter(p => p.richtung === 'stuetzt').length,
        widerspricht: pr.filter(p => p.richtung === 'widerspricht').length,
      };
    }),
  });
}

export async function thesenSchreiben(env, db, body, method, id, teil, json, err, rolle) {
  if (method === 'POST' && !id) {
    if (!body.symbol || !body.kern) return err('symbol und kern sind Pflicht');
    const res = await db.prepare(
      'INSERT INTO ag_thesen (symbol, kern, annahmen, bricht_wenn, zeithorizont) VALUES (?,?,?,?,?)'
    ).bind(
      String(body.symbol).toUpperCase().slice(0, 24), String(body.kern).slice(0, 1000),
      Array.isArray(body.annahmen) ? JSON.stringify(body.annahmen).slice(0, 4000) : null,
      body.bricht_wenn ? String(body.bricht_wenn).slice(0, 1000) : null,
      body.zeithorizont ? String(body.zeithorizont).slice(0, 60) : null,
    ).run();
    return json({ success: true, id: res.meta?.last_row_id });
  }
  // Prüfung anhängen – das machen die Analysten
  if (method === 'POST' && id && teil === 'pruefung') {
    if (!body.fakt || !['stuetzt', 'widerspricht', 'offen'].includes(body.richtung))
      return err('fakt und richtung (stuetzt|widerspricht|offen) sind Pflicht');
    const res = await db.prepare(
      `INSERT INTO ag_thesen_pruefung (these_id, richtung, fakt, quelle, datum, mitarbeiter_id, lauf_id)
       VALUES (?,?,?,?,?,?,?)`
    ).bind(
      Number(id), body.richtung, String(body.fakt).slice(0, 2000),
      body.quelle ? String(body.quelle).slice(0, 500) : null,
      body.datum ? String(body.datum).slice(0, 10) : null,
      body.mitarbeiter_id ? String(body.mitarbeiter_id).slice(0, 40) : null,
      Number.isFinite(Number(body.lauf_id)) ? Number(body.lauf_id) : null,
    ).run();
    return json({ success: true, id: res.meta?.last_row_id });
  }
  if (method === 'PATCH' && id) {
    const erlaubt = ['offen', 'bestaetigt', 'gebrochen', 'verworfen'];
    if (!erlaubt.includes(body.status)) return err('Unbekannter Status');
    // Eine These für gebrochen zu erklären ist eine Entscheidung, keine
    // Feststellung – die trifft der Mensch.
    if (rolle !== 'dashboard') return err('Den Status einer These setzt nur der Mensch', 403);
    await db.prepare('UPDATE ag_thesen SET status=?, aktualisiert_am=? WHERE id=?')
      .bind(body.status, new Date().toISOString(), Number(id)).run();
    return json({ success: true });
  }
  if (method === 'DELETE' && id) {
    await db.prepare('DELETE FROM ag_thesen_pruefung WHERE these_id=?').bind(Number(id)).run().catch(() => {});
    await db.prepare('DELETE FROM ag_thesen WHERE id=?').bind(Number(id)).run();
    return json({ success: true });
  }
  return err('Nicht unterstützt', 405);
}

// ── GET /api/agentur/boerse/korrelation ──────────────────────────
// Wie stark laufen die Werte im Gleichschritt? Aus den Tagesrenditen des
// eigenen Speichers. Zeigt Klumpen, die in der Aufteilung nach Branche
// unsichtbar bleiben.
export async function boerseKorrelation(env, db, url, json, err) {
  const tage = Math.min(parseInt(url.searchParams.get('tage'), 10) || 180, 400);
  const kurse = await db.prepare(
    'SELECT symbol, datum, kurs FROM ag_kurse WHERE datum >= ? ORDER BY symbol, datum'
  ).bind(tagVor(tage)).all().catch(() => ({ results: [] }));

  const nachSymbol = new Map();
  for (const k of (kurse.results || [])) {
    if (!nachSymbol.has(k.symbol)) nachSymbol.set(k.symbol, new Map());
    nachSymbol.get(k.symbol).set(k.datum, k.kurs);
  }
  const symbole = [...nachSymbol.keys()].sort();
  if (symbole.length < 2) return json({ symbole, matrix: [], hinweis: 'Zu wenige Werte mit Verlauf.' });

  // Nur Tage verwenden, an denen alle Werte einen Kurs haben – sonst
  // vergleicht man Bewegungen, die zu verschiedenen Zeiten stattfanden.
  const gemeinsame = [...nachSymbol.get(symbole[0]).keys()]
    .filter(d => symbole.every(s => nachSymbol.get(s).has(d))).sort();
  if (gemeinsame.length < 30) {
    return json({ symbole, matrix: [], gemeinsame_tage: gemeinsame.length,
      hinweis: 'Weniger als 30 gemeinsame Handelstage – eine Korrelation daraus wäre nicht belastbar.' });
  }

  const renditen = new Map();
  for (const s of symbole) {
    const k = nachSymbol.get(s);
    const r = [];
    for (let i = 1; i < gemeinsame.length; i++) {
      const v = k.get(gemeinsame[i - 1]), n = k.get(gemeinsame[i]);
      r.push(v ? (n - v) / v : 0);
    }
    renditen.set(s, r);
  }

  const korr = (a, b) => {
    const n = a.length;
    const ma = a.reduce((s, x) => s + x, 0) / n, mb = b.reduce((s, x) => s + x, 0) / n;
    let za = 0, na = 0, nb = 0;
    for (let i = 0; i < n; i++) { const da = a[i] - ma, db2 = b[i] - mb; za += da * db2; na += da * da; nb += db2 * db2; }
    return (na && nb) ? Math.round((za / Math.sqrt(na * nb)) * 100) / 100 : null;
  };

  const matrix = symbole.map(a => symbole.map(b => a === b ? 1 : korr(renditen.get(a), renditen.get(b))));

  // Auffällige Paare herausheben – das ist die eigentliche Information.
  const paare = [];
  for (let i = 0; i < symbole.length; i++) {
    for (let j = i + 1; j < symbole.length; j++) {
      if (matrix[i][j] !== null) paare.push({ a: symbole[i], b: symbole[j], wert: matrix[i][j] });
    }
  }
  paare.sort((x, y) => y.wert - x.wert);

  return json({
    symbole, matrix, gemeinsame_tage: gemeinsame.length,
    zeitraum: [gemeinsame[0], gemeinsame[gemeinsame.length - 1]],
    engste: paare.slice(0, 6),
    loseste: paare.slice(-6).reverse(),
  });
}

// ── GET /api/agentur/boerse/kalender ─────────────────────────────
// Anstehende Termine aller verfolgten Werte, aus den gespeicherten
// Stammdaten. Ohne Abruf.
export async function boerseKalender(env, db, url, json, err) {
  const werte = await db.prepare(
    `SELECT w.symbol, w.name, w.naechste_zahlen, d.stueck
       FROM ag_werte w LEFT JOIN ag_depot d ON d.symbol = w.symbol AND d.aktiv = 1
      WHERE w.naechste_zahlen IS NOT NULL AND w.naechste_zahlen >= ?
      ORDER BY w.naechste_zahlen ASC`
  ).bind(heute()).all().catch(() => ({ results: [] }));

  const termine = (werte.results || []).map(t => {
    const tage = Math.round((Date.parse(t.naechste_zahlen) - Date.now()) / 86400000);
    return { ...t, gehalten: t.stueck !== null, in_tagen: tage };
  });
  return json({
    stand: heute(),
    termine,
    hinweis: termine.length ? null : 'Keine Termine hinterlegt. Sie kommen mit „Kurse holen“ aus den Stammdaten.',
  });
}

// ── GET /api/agentur/boerse/nachrichtenstrom ─────────────────────
// Meldungen über alle gehaltenen Werte hinweg. Kostet je Wert einen
// Abruf, deshalb begrenzt und mit klarer Ansage, wo abgeschnitten wurde.
export async function boerseNachrichtenstrom(env, db, url, json, err) {
  const grenze = Math.min(parseInt(url.searchParams.get('werte'), 10) || 6, 12);
  const tage = Math.min(parseInt(url.searchParams.get('tage'), 10) || 7, 30);
  const depot = await db.prepare('SELECT symbol, name FROM ag_depot WHERE aktiv=1 ORDER BY stueck*COALESCE(kaufkurs,0) DESC')
    .all().catch(() => ({ results: [] }));
  const liste = (depot.results || []).slice(0, grenze);

  const alle = [], fehlt = [];
  for (const p of liste) {
    try {
      const n = await holen(env, '/company-news', {
        symbol: symbolTeilen(p.symbol).sym, from: tagVor(tage), to: heute(),
      });
      for (const x of (n || []).slice(0, 8)) {
        alle.push({
          symbol: p.symbol, name: p.name,
          datum: new Date((x.datetime || 0) * 1000).toISOString().slice(0, 10),
          schlagzeile: x.headline, quelle: x.source, url: x.url,
        });
      }
    } catch (e) {
      fehlt.push(`${p.symbol}: ${ohneSchluessel(String(e.message), env)}`);
      if (/credit|rate limit|quota|429|403/i.test(String(e.message))) break;
    }
  }
  alle.sort((a, b) => b.datum.localeCompare(a.datum));
  return json({
    zeitraum: [tagVor(tage), heute()],
    abgefragt: liste.length, von: (depot.results || []).length,
    meldungen: alle.slice(0, 60),
    fehlt: fehlt.length ? fehlt : null,
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
  // Wechselkurse einmal holen. Schlägt es fehl, wird eben nicht
  // umgerechnet – dann bleibt der Vergleich gesperrt statt zu raten.
  let fx = null;
  try { fx = await wechselkurse('EUR'); } catch (e) { fx = null; }

  const positionen = (depot.results || []).map(p => {
    const st = wertNach.get(p.symbol) || null;
    const l = letzter(p.symbol);
    const kurs = l?.kurs ?? null;
    const kursWaehrung = st?.waehrung || null;
    const einsatz = p.kaufkurs !== null && p.kaufkurs !== undefined ? p.kaufkurs * p.stueck : null;

    // Notiert der Wert in einer anderen Währung als der Kaufpreis, wird der
    // aktuelle Wert zum heutigen Kurs umgerechnet – so rechnet auch die
    // Depotbank. Der Kaufpreis bleibt unangetastet: was damals gezahlt
    // wurde, steht fest und wird nicht rückwirkend umgerechnet.
    // Faktor für ADRs: ein Hinterlegungsschein bildet die Heimataktie
    // selten eins zu eins ab. Ohne ihn wäre der Depotwert um genau diesen
    // Faktor daneben – plausibel aussehend und trotzdem falsch.
    const faktor = Number.isFinite(Number(p.kurs_faktor)) && Number(p.kurs_faktor) > 0
      ? Number(p.kurs_faktor) : 1;

    const wertRoh = kurs !== null ? kurs * p.stueck * faktor : null;

    // Ist die Währung des Kurses unbekannt, wird NICHT verglichen. Vorher
    // galt sie stillschweigend als dieselbe – so wurden Dollar gegen Euro
    // gerechnet und ein Verlust ausgewiesen, den es nicht gibt.
    const waehrungUnklar = !!(wertRoh !== null && !kursWaehrung);
    const anders = !!(kursWaehrung && p.waehrung && kursWaehrung !== p.waehrung);
    const wert = waehrungUnklar ? null
      : anders ? umrechnen(wertRoh, kursWaehrung, p.waehrung, fx)
      : wertRoh;
    const umgerechnet = anders && wert !== null;
    // Ein Währungskonflikt setzt einen Kurs voraus. Ohne Kurs ist die
    // Position schlicht unbewertet – das ist etwas anderes und stand vorher
    // irreführend als "nicht vergleichbar" da.
    const gesperrt = wertRoh !== null && (waehrungUnklar || (anders && wert === null));

    const vergleichbar = wert !== null && einsatz !== null;

    return {
      ...p,
      stammdaten: st,
      kurs, kurs_datum: l?.datum ?? null,
      kurs_waehrung: kursWaehrung,
      veraenderung_prozent: l?.veraenderung_prozent ?? null,
      wert_original: wertRoh,
      wert, einsatz,
      kurs_faktor: faktor,
      umgerechnet,
      fx_datum: umgerechnet ? fx?._datum || null : null,
      waehrung_konflikt: gesperrt,
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
    .map(p => `${p.symbol}: Kurs in ${p.kurs_waehrung}, Kauf in ${p.waehrung} — Umrechnung nicht möglich`);
  const umgerechnet = positionen.filter(p => p.umgerechnet)
    .map(p => `${p.symbol}: ${p.kurs_waehrung}→${p.waehrung}`);
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
    umgerechnet: umgerechnet.length ? { werte: umgerechnet, stand: fx?._datum || null } : null,
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
      const n = await holen(env, '/company-news', { symbol: symbolTeilen(symbol).sym, from: tagVor(tage), to: heute() });
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
    for (const k of ['stueck', 'kaufkurs', 'kurs_faktor']) {
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
