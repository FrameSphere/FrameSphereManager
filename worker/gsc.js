// =============================================
// Google Search Console – Datenabruf für die Agentur
// =============================================
// Der Dienstkonto-Schlüssel liegt als Cloudflare-Secret GOOGLE_SA_KEY und
// verlässt den Worker nie. Rollen holen ihre Zahlen über diese Routen,
// nicht direkt bei Google.
//
// Zwei Wege, bewusst getrennt:
//   • sync    → Tageswerte in ag_kennzahlen (das ist der Verlauf im Dashboard)
//   • queries → Keyword-Ebene, live abgefragt, nicht gespeichert
//
// Search-Console-Daten hinken zwei bis drei Tage hinterher. Alle Zeiträume
// enden deshalb bei heute minus drei Tagen.
// =============================================

const GSC_VERZUG_TAGE = 3;
const SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';

function tagVor(n) {
  return new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
}

function b64url(bytes) {
  let s = '';
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlText(str) {
  return b64url(new TextEncoder().encode(str));
}

// PEM (PKCS#8) → ArrayBuffer
function pemZuBytes(pem) {
  const roh = pem
    .replace(/-----BEGIN [^-]+-----/, '')
    .replace(/-----END [^-]+-----/, '')
    .replace(/\s+/g, '');
  const bin = atob(roh);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}

// Schlüssel einlesen. Akzeptiert den JSON-Inhalt der Datei direkt oder
// denselben Inhalt base64-kodiert – letzteres, weil die interaktive Eingabe
// von `wrangler secret put` an Zeilenumbrüchen abschneidet und mehrzeiliges
// JSON dabei kaputtgeht.
function schluesselLesen(env) {
  const roh = (env.GOOGLE_SA_KEY || '').trim();
  if (!roh) throw new Error('GOOGLE_SA_KEY ist nicht gesetzt');

  let key = null;
  if (roh.startsWith('{')) {
    try { key = JSON.parse(roh); } catch (e) { key = null; }
  }
  if (!key) {
    try { key = JSON.parse(atob(roh.replace(/\s+/g, ''))); } catch (e) { key = null; }
  }
  if (!key) {
    // Diagnose ohne Schlüsselmaterial: nur Länge und Form.
    throw new Error(
      `GOOGLE_SA_KEY lässt sich nicht lesen – ${roh.length} Zeichen, ` +
      `${roh.startsWith('{') ? 'beginnt mit {, ist aber kein gültiges JSON' : 'beginnt nicht mit { und ist auch kein base64'}. ` +
      'Erwartet wird der komplette Inhalt der Schlüsseldatei. Setzen mit: ' +
      'npx wrangler secret put GOOGLE_SA_KEY < schluessel.json'
    );
  }
  if (!key.client_email || !key.private_key) {
    throw new Error('GOOGLE_SA_KEY enthält client_email oder private_key nicht – ist das wirklich die Schlüsseldatei des Dienstkontos?');
  }
  return key;
}

// Dienstkonto → Zugriffstoken (JWT-Bearer-Flow)
async function zugriffstoken(env) {
  const key = schluesselLesen(env);

  const jetzt = Math.floor(Date.now() / 1000);
  const kopf = b64urlText(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const inhalt = b64urlText(JSON.stringify({
    iss: key.client_email,
    scope: SCOPE,
    aud: 'https://oauth2.googleapis.com/token',
    iat: jetzt,
    exp: jetzt + 3600,
  }));

  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    pemZuBytes(key.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signatur = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    new TextEncoder().encode(`${kopf}.${inhalt}`),
  );
  const jwt = `${kopf}.${inhalt}.${b64url(signatur)}`;

  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });
  const daten = await r.json().catch(() => ({}));
  if (!r.ok || !daten.access_token) {
    throw new Error(`Google verweigert das Token: ${daten.error_description || daten.error || r.status}`);
  }
  return daten.access_token;
}

// Search-Analytics-Abfrage
async function abfrage(env, property, koerper) {
  const token = await zugriffstoken(env);
  const url = `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(property)}/searchAnalytics/query`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(koerper),
  });
  const daten = await r.json().catch(() => ({}));
  if (!r.ok) {
    const m = daten?.error?.message || `HTTP ${r.status}`;
    // Der häufigste Fehler ist kein Auth-Fehler, sondern eine Property, auf
    // die das Dienstkonto keinen Zugriff hat. Das sagen wir deutlich.
    if (r.status === 403) {
      throw new Error(`Kein Zugriff auf "${property}". Ist das Dienstkonto in der Search Console als Nutzer eingetragen? (${m})`);
    }
    if (r.status === 404) {
      throw new Error(`Property "${property}" gibt es so nicht. URL-Property braucht den Schrägstrich am Ende, Domain-Property die Form sc-domain:beispiel.de. (${m})`);
    }
    throw new Error(m);
  }
  return daten.rows || [];
}

async function propertyVon(db, abteilungId) {
  const a = await db.prepare('SELECT gsc_property FROM ag_abteilungen WHERE id=?')
    .bind(abteilungId).first().catch(() => null);
  return a?.gsc_property || null;
}

// ── POST /api/agentur/gsc/sync ───────────────────────────────────
// Tageswerte holen und in ag_kennzahlen ablegen. Idempotent.
export async function gscSync(request, env, db, body, json, err) {
  const abteilungId = String(body.abteilung_id || 'frametrain').slice(0, 40);
  const property = body.property || await propertyVon(db, abteilungId);
  if (!property) return err('Für diese Abteilung ist keine gsc_property hinterlegt', 400);

  const tage = Math.min(parseInt(body.tage, 10) || 90, 480);
  const ende = tagVor(GSC_VERZUG_TAGE);
  const start = tagVor(GSC_VERZUG_TAGE + tage);

  let zeilen;
  try {
    zeilen = await abfrage(env, property, {
      startDate: start, endDate: ende, dimensions: ['date'], rowLimit: 500,
    });
  } catch (e) {
    return json({ error: String(e.message || e), property, zeitraum: [start, ende] }, 502);
  }

  const felder = [['klicks', 'clicks'], ['impressionen', 'impressions'], ['ctr', 'ctr'], ['position', 'position']];
  let gespeichert = 0;
  for (const z of zeilen) {
    const datum = z.keys?.[0];
    if (!datum) continue;
    for (const [name, quelle] of felder) {
      await db.prepare(
        `INSERT INTO ag_kennzahlen (abteilung_id, datum, quelle, name, wert, dimension)
         VALUES (?,?,'gsc',?,?,'')
         ON CONFLICT(abteilung_id, datum, quelle, name, dimension)
         DO UPDATE SET wert=excluded.wert`
      ).bind(abteilungId, datum, name, Number(z[quelle]) || 0).run().catch(() => {});
      gespeichert++;
    }
  }

  return json({
    success: true, property, zeitraum: [start, ende],
    tage_geliefert: zeilen.length, werte_gespeichert: gespeichert,
    hinweis: zeilen.length ? null : 'Google liefert für diesen Zeitraum keine Zeilen – meist zu wenig Traffic oder die Property ist frisch.',
  });
}

// ── GET /api/agentur/gsc/queries ─────────────────────────────────
// Keyword-Ebene, live. Wird nicht gespeichert: das ist Arbeitsmaterial
// für den Analysten, kein Verlauf.
export async function gscQueries(env, db, url, json, err) {
  const abteilungId = url.searchParams.get('abteilung') || 'frametrain';
  const property = url.searchParams.get('property') || await propertyVon(db, abteilungId);
  if (!property) return err('Für diese Abteilung ist keine gsc_property hinterlegt', 400);

  const tage = Math.min(parseInt(url.searchParams.get('tage'), 10) || 28, 180);
  const limit = Math.min(parseInt(url.searchParams.get('limit'), 10) || 250, 1000);
  const ende = tagVor(GSC_VERZUG_TAGE);
  const start = tagVor(GSC_VERZUG_TAGE + tage);

  // Optionaler Vergleichszeitraum davor – für "Rankingverluste über vier Wochen"
  const vergleich = url.searchParams.get('vergleich') === '1';

  try {
    const dimension = url.searchParams.get('nach') === 'seite' ? 'page' : 'query';
    const jetzt = await abfrage(env, property, {
      startDate: start, endDate: ende, dimensions: [dimension], rowLimit: limit,
    });
    const abbilden = z => ({
      [dimension === 'page' ? 'seite' : 'suchanfrage']: z.keys?.[0],
      klicks: z.clicks, impressionen: z.impressions,
      ctr: Math.round((z.ctr || 0) * 10000) / 100,
      position: Math.round((z.position || 0) * 10) / 10,
    });

    const antwort = {
      property, zeitraum: [start, ende], anzahl: jetzt.length,
      zeilen: jetzt.map(abbilden),
    };

    if (vergleich) {
      const vEnde = tagVor(GSC_VERZUG_TAGE + tage + 1);
      const vStart = tagVor(GSC_VERZUG_TAGE + tage * 2 + 1);
      const davor = await abfrage(env, property, {
        startDate: vStart, endDate: vEnde, dimensions: [dimension], rowLimit: limit,
      });
      antwort.vergleich = { zeitraum: [vStart, vEnde], zeilen: davor.map(abbilden) };
    }

    return json(antwort);
  } catch (e) {
    return json({ error: String(e.message || e), property }, 502);
  }
}
