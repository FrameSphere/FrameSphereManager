// =============================================
// SEO Pipeline – Cloudflare Worker
// =============================================
//
// word-weights.json ablegen unter worker/word-weights.json
// Format: { "brawlmystery": { "wort": 0.95, ... }, "traitora": {...}, "wordify": {...} }
// Datei aus KeywordSystem/output/<site>/word-weights.json kopieren und zusammenführen.
// Wenn die Datei leer ist ({}) läuft das System ohne Gewichte (reines TF-Scoring).
// =============================================

import WEIGHTS_RAW from './word-weights.json';

// Gewichte beim Laden filtern: nur Wörter mit Score >= 0.05 behalten
// → reduziert Arbeitsspeicher, entfernt irrelevante Einträge
const WEIGHTS = {};
for (const [site, words] of Object.entries(WEIGHTS_RAW)) {
  if (words && typeof words === 'object') {
    WEIGHTS[site] = Object.fromEntries(
      Object.entries(words).filter(([, v]) => typeof v === 'number' && v >= 0.05)
    );
  }
}

/**
 * Gibt das Gewicht eines Wortes für eine bestimmte Site zurück.
 * Sucht zuerst in site-spezifischen Gewichten.
 * Gibt null zurück wenn das Wort unbekannt ist → kein Bonus, kein Malus.
 */
function getWeight(word, siteId) {
  const sw = WEIGHTS[siteId];
  if (sw && sw[word] !== undefined) return sw[word];
  return null;
}

// ── Stopword Lists (DE / EN / FR / ES / IT) ──────────────────────────────────

const STOPWORDS = {
  de: new Set([
    'der','die','das','den','dem','des','ein','eine','einen','einem','einer','eines',
    'und','oder','aber','doch','nicht','kein','keine','keinen','keinem','keiner','keines',
    'ist','sind','war','waren','wird','werden','wurde','wurden','hat','haben','hatte','hatten',
    'ich','du','er','sie','es','wir','ihr','mich','dich','sich','uns','euch',
    'mir','dir','ihm','ihnen','ihn',
    'in','an','auf','aus','bei','bis','durch','für','gegen','hinter','mit','nach','neben',
    'ohne','seit','über','um','unter','vor','von','während','wegen','zu','zwischen',
    'als','wie','wenn','ob','dass','weil','da','damit','obwohl',
    'auch','noch','schon','nur','immer','sehr','mehr','viel','viele','alle','alles',
    'man','jeder','jede','jedes','dieser','diese','dieses','diesen','diesem',
    'welcher','welche','welches','solcher','solche','solches',
    'hier','dort','so','dann','denn','nun','ja','nein',
    'kann','muss','soll','darf','mag','will','würde','könnte','müsste','sollte',
    'beim','ins','ans','zum','zur','vom','im','am',
    'ab','pro','je','per','via','laut','trotz','statt',
    'was','wer','wo','wann','warum','woher','wohin','womit','worüber',
    'jetzt','heute','morgen','gestern','mal','oft','selten','meist','ganz',
    'bereits','erst','wieder','bisher','bald','zuerst',
    'etwas','jemand','niemand','irgendwie','irgendwann',
    'sein','seine','seinen','seinem','ihrer','ihrem','ihren',
    'dabei','davon','dazu','daher','danach','davor','darin','daraus',
    'jedoch','zwar','deshalb','deswegen','darum','also','somit','folglich',
    'gut','neue','neuen','neuer','neues','großen','kleine','kleinen','großer',
    'beim','vom','zum','zur','ins','aufs','ans','ums',
  ]),
  en: new Set([
    'the','a','an','and','or','but','not','no','nor','so','yet','for','of','in','on',
    'at','to','by','up','as','if','is','are','was','were','be','been','being',
    'have','has','had','do','does','did','will','would','could','should','may','might',
    'must','shall','can','need','ought','used',
    'i','you','he','she','it','we','they','me','him','her','us','them',
    'my','your','his','its','our','their','mine','yours','hers','ours','theirs',
    'this','that','these','those','which','who','whom','whose','what','where','when','why','how',
    'all','each','every','both','few','more','most','other','some','such',
    'into','from','with','about','against','between','through','during','before',
    'after','above','below','over','under','again','further','then','once',
    'here','there','than','too','very','just','also','well','any','only','own',
    'same','now','still','even','back','already','out','away','always','never','often',
    'get','got','go','went','come','came','make','made','know','think','say','take','see',
    'look','use','find','give','tell','work','call','try','ask','need','feel','become',
    'leave','put','mean','keep','let','begin','show','hear','play','run','move','live',
    'write','provide','sit','stand','lose','pay','meet','include','continue','set',
    'change','lead','understand','watch','follow','stop','create','read','spend','grow',
    'open','walk','win','offer','remember','consider','buy','wait','serve',
    'send','expect','build','stay','fall','cut','reach','decide','pull','break',
    'want','push','start','turn','help','talk',
  ]),
  fr: new Set([
    'le','la','les','un','une','des','du','de','au','aux','et','ou','mais','donc','or',
    'ni','car','ne','pas','plus','point','jamais','rien','que','qui','quoi','dont','où',
    'je','tu','il','elle','nous','vous','ils','elles','me','te','se','lui','leur','y','en',
    'mon','ton','son','ma','ta','sa','notre','votre','mes','tes','ses','nos','vos','leurs',
    'ce','cet','cette','ces','ceci','cela','celui','celle','ceux','celles',
    'est','sont','était','étaient','sera','seront','avoir','été','fait','faire',
    'dans','sur','sous','avec','sans','pour','par','vers','chez','entre','depuis',
    'avant','après','pendant','lors','dès','quand','si','comme','bien','très',
    'tout','tous','toutes','toute','aucun','aucune','chaque','même','autre','autres',
    'moins','aussi','encore','déjà','enfin','seulement','souvent',
    'ici','là','donc','alors','ainsi','puis','ensuite',
  ]),
  es: new Set([
    'el','la','los','las','un','una','unos','unas','de','del','al','a','en','con','por',
    'para','sin','sobre','entre','desde','hasta','ante','bajo','tras','durante','mediante',
    'y','o','u','pero','sino','mas','aunque','porque','pues','si','cuando','que','como',
    'ya','no','ni','más','menos','muy','bien','tan','tanto','mucho','poco','algo','nada',
    'yo','tú','él','ella','nosotros','vosotros','ellos','ellas','usted','ustedes',
    'me','te','se','le','lo','nos','os','les',
    'mi','tu','su','nuestro','vuestro','mío','tuyo','suyo',
    'este','esta','estos','estas','ese','esa','esos','esas','aquel','aquella',
    'que','quien','cual','cuales','cuyo','donde','cuando','como','cuanto',
    'es','son','era','eran','fue','fueron','ser','estar','hay','haber','tener','hacer',
    'así','también','todo','todos','toda','todas','cada','mismo','algún','alguna',
    'siempre','nunca','aquí','allí','ahí','entonces','después','antes','ahora',
  ]),
  it: new Set([
    'il','lo','la','i','gli','le','un','uno','una','del','della','dei','degli','delle',
    'al','alla','ai','agli','alle','dal','dalla','dai','dagli','dalle',
    'nel','nella','nei','negli','nelle','sul','sulla','sui','sugli','sulle',
    'di','da','in','con','su','per','tra','fra','a','e','o','ma','però','quindi',
    'non','né','se','come','che','quando','dove','perché','poiché','affinché',
    'io','tu','lui','lei','noi','voi','loro','mi','ti','si','ci','vi','li',
    'mio','mia','tuoi','tua','suo','sua','nostro','nostra','vostro','vostra',
    'questo','questa','questi','queste','quello','quella','quelli','quelle',
    'chi','che','cui','quale','quali','dove','quando','come','quanto',
    'è','sono','era','erano','sarà','saranno','essere','avere','fare','stare',
    'più','meno','molto','poco','tanto','troppo','già','ancora','sempre','mai',
    'qui','là','così','anche','poi','prima','dopo','ora','adesso','subito',
    'tutto','tutti','tutta','tutte','ogni','nessuno','qualcuno','qualcosa',
  ]),
};

function getStopwords(lang) {
  return STOPWORDS[lang] || STOPWORDS['en'];
}

// ── Step 1: Preprocess ────────────────────────────────────────────────────────

function preprocess(text) {
  const plain = text.replace(/<[^>]+>/g, ' ');
  return plain
    .toLowerCase()
    .replace(/[^\wäöüßàâéèêëîïôùûçáàóòúùñ\s]/gi, ' ')
    .split(/\s+/)
    .map(w => w.trim())
    .filter(w => w.length > 1);
}

// ── Step 2: Filter stopwords + noise ─────────────────────────────────────────

function filterWords(tokens, lang) {
  const stops = getStopwords(lang);
  return tokens.filter(w => {
    if (w.length < 3)    return false;
    if (stops.has(w))    return false;
    if (/^\d+$/.test(w)) return false;
    return true;
  });
}

// ── Step 3: Score keywords ────────────────────────────────────────────────────
// Faktoren (in absteigender Wichtigkeit):
//
//   1. Bundle-Gewicht × Multiplikator
//      Wörter die im KeywordSystem als wichtig erkannt wurden bekommen einen
//      starken Boost. Score 1.0 → 4× TF, Score 0.5 → 2.5× TF.
//      Unbekannte Wörter (null) bleiben beim reinen TF-Score.
//
//   2. TF (Term Frequency) × 100
//      Grundscore: wie oft kommt das Wort im Text vor.
//
//   3. Titel-Bonus +6
//      Wörter im Titel sind für SEO besonders wichtig.
//
//   4. Positions-Bonus +2
//      Wörter im ersten 20% des Texts (Einleitung) werden von Suchmaschinen
//      stärker gewichtet.
//
//   5. Längen-Bonus +1
//      Wörter > 6 Zeichen sind spezifischer und wertvoller.

function scoreKeywords(allTokens, filteredTokens, titleTokens, lang, siteId) {
  const stops    = getStopwords(lang);
  const total    = filteredTokens.length || 1;
  const titleSet = new Set(titleTokens.filter(t => !stops.has(t) && t.length >= 3));
  const earlySet = new Set(allTokens.slice(0, Math.ceil(allTokens.length * 0.2)));

  const freq = {};
  for (const word of filteredTokens) {
    freq[word] = (freq[word] || 0) + 1;
  }

  const scores = {};
  for (const [word, count] of Object.entries(freq)) {
    const tf = (count / total) * 100;

    // Bundle-Gewicht als Multiplikator: bekannte wichtige Wörter werden verstärkt
    // Formel: tf × (1 + weight × 3) → bei weight=1.0 ist der Score 4× so groß
    const w = getWeight(word, siteId);
    let score = w !== null ? tf * (1 + w * 3) : tf;

    if (titleSet.has(word))  score += 6;
    if (earlySet.has(word))  score += 2;
    if (word.length > 6)     score += 1;

    scores[word] = score;
  }

  return scores;
}

// ── Step 4: Weighted N-Grams (Long-Tail Keywords) ────────────────────────────
//
// Verbesserung gegenüber reinem Co-Occurrence-Counting:
// Jede Phrase wird bewertet durch das Durchschnittsgewicht seiner Wörter.
// Dadurch entstehen Long-Tail Keywords auch wenn eine Phrase nur einmal
// im Text vorkommt — solange die Wörter themenrelevant sind.
//
// Score = avgWordWeight × (1 + log(count + 1))
//       → Häufigkeitsbonus, aber semantische Relevanz dominiert

function buildWeightedNgrams(tokens, n, lang, siteId) {
  const stops  = getStopwords(lang);
  const phrases = {};

  for (let i = 0; i <= tokens.length - n; i++) {
    const gram = tokens.slice(i, i + n);

    // Stopwords an den Rändern der Phrase ausschließen
    if (stops.has(gram[0]) || stops.has(gram[gram.length - 1])) continue;
    if (gram.some(t => t.length < 3)) continue;

    const key = gram.join(' ');
    if (!phrases[key]) {
      // Durchschnittsgewicht der Komponenten-Wörter berechnen
      // Unbekannte Wörter bekommen ein kleines Basis-Gewicht (0.05)
      // damit auch themennahe Phrasen ohne explizites Gewicht auftauchen
      const avgW = gram.reduce((s, w) => {
        const weight = getWeight(w, siteId);
        return s + (weight ?? 0.05);
      }, 0) / gram.length;
      phrases[key] = { count: 0, avgW };
    }
    phrases[key].count++;
  }

  return Object.entries(phrases)
    .map(([phrase, { count, avgW }]) => ({
      phrase,
      score: avgW * (1 + Math.log(count + 1)),
    }))
    .filter(x => x.score > 0.03)  // Mindestqualität
    .sort((a, b) => b.score - a.score)
    .map(x => x.phrase);
}

// ── Step 5: Meta Description ─────────────────────────────────────────────────
// Sucht den besten Satz aus dem Content als Meta-Description.
// Bevorzugt Sätze die Top-Keywords enthalten und 80–160 Zeichen lang sind.

function generateMetaDescription(title, content, topKeywords) {
  const plainText = content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const sentences = plainText.split(/(?<=[.!?])\s+/);
  const kws       = new Set(topKeywords.slice(0, 8));

  let best      = null;
  let bestScore = -1;

  for (const s of sentences) {
    const clean = s.trim();
    if (clean.length < 40 || clean.length > 300) continue;
    const words    = clean.toLowerCase().split(/\s+/);
    const kwHits   = words.filter(w => kws.has(w)).length;
    const lenBonus = clean.length >= 80 && clean.length <= 160 ? 3 : 0;
    const score    = kwHits * 2 + lenBonus;
    if (score > bestScore) { bestScore = score; best = clean; }
  }

  if (!best && sentences.length > 0) best = sentences[0].trim();
  if (best && best.length > 160) {
    best = best.slice(0, 157).replace(/\s+\S*$/, '') + '…';
  }

  return best || title;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * generateSEO({ title, content, lang, siteId })
 *
 * @param {string} title    - Titel des Blog-Posts
 * @param {string} content  - HTML oder Plaintext des Posts
 * @param {string} lang     - Sprache: 'de', 'en', 'fr', 'es', 'it'
 * @param {string} siteId   - Site-ID für site-spezifische Gewichte: 'brawlmystery' etc.
 *
 * @returns {{
 *   keywords: string[],          Top 10 Short-Keywords
 *   metaDescription: string,     Optimierte Meta-Description (≤160 Zeichen)
 *   longtailKeywords: string[]   Top 10 Long-Tail Keywords (Bigrams + Trigrams)
 * }}
 */
export function generateSEO({ title = '', content = '', lang = 'en', siteId = '' } = {}) {
  const normLang = lang.split('-')[0].toLowerCase();

  // Titel dreifach wiederholen für stärkeres Gewicht im Scoring
  const fullText    = `${title} ${title} ${title} ${content}`;
  const allTokens   = preprocess(fullText);
  const titleTokens = preprocess(title);
  const filtered    = filterWords(allTokens, normLang);

  if (filtered.length === 0) {
    return {
      keywords:         [],
      metaDescription:  title.slice(0, 160),
      longtailKeywords: [],
    };
  }

  // Short Keywords: gewichtetes TF-Scoring
  const scores = scoreKeywords(allTokens, filtered, titleTokens, normLang, siteId);
  const rawKeywords = Object.entries(scores)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 25)
    .map(([word]) => word);

  // Deduplication: echte Wortvarianten entfernen (Plural, Flexion)
  // Regel: nur filtern wenn Längenunterschied <= 3 Zeichen UND eines ist Prefix des anderen
  // Beispiele die gefiltert werden:  pause/pausen (diff=1), spiel/spiele (diff=1)
  // Beispiele die NICHT gefiltert werden: spiel/wortspiel (diff=4), pause/pausenhelfen (diff=6)
  const topKeywords = [];
  for (const word of rawKeywords) {
    const isDuplicate = topKeywords.some(existing => {
      const diff = Math.abs(word.length - existing.length);
      if (diff > 3) return false; // zu unterschiedlich lang → keine Variante
      return existing.startsWith(word) || word.startsWith(existing);
    });
    if (!isDuplicate) topKeywords.push(word);
    if (topKeywords.length >= 10) break;
  }

  // Long-Tail: gewichtete Bigrams + Trigrams
  const bigrams  = buildWeightedNgrams(filtered, 2, normLang, siteId);
  const trigrams = buildWeightedNgrams(filtered, 3, normLang, siteId);

  // Long-Tail Deduplication:
  // 1. Keine Phrase bei der alle Wörter schon in einer anderen (kürzeren) Phrase sind
  // 2. Keine Phrasen die nur Umkehrungen voneinander sind ("pausen helfen" + "helfen pausen")
  const allPhrases = [...trigrams.slice(0, 8), ...bigrams.slice(0, 10)];
  const longtailRaw = [];
  for (const phrase of allPhrases) {
    const words = phrase.split(' ');
    // Duplikat wenn bereits eine Phrase mit denselben Wörtern (andere Reihenfolge) drin ist
    const isDupe = longtailRaw.some(existing => {
      const exWords = existing.split(' ');
      return exWords.length === words.length &&
             words.every(w => exWords.includes(w));
    });
    // Auch überspringen wenn die Phrase nur aus Keywords besteht die schon einzeln top-ranked sind
    // und keine neue Kombination bringen
    if (!isDupe) longtailRaw.push(phrase);
    if (longtailRaw.length >= 10) break;
  }
  const longtail = longtailRaw;

  const metaDescription = generateMetaDescription(title, content, topKeywords);

  return {
    keywords:         topKeywords.slice(0, 10),
    metaDescription,
    longtailKeywords: longtail,
  };
}
