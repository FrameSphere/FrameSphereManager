// =============================================
// SEO Pipeline – Pure JS, no dependencies
// Runs in Cloudflare Workers (V8 Isolate)
// =============================================

// ── Stopword Lists (DE / EN / FR / ES / IT) ──────────────────────────────────

const STOPWORDS = {
  de: new Set([
    'der','die','das','den','dem','des','ein','eine','einen','einem','einer','eines',
    'und','oder','aber','doch','nicht','kein','keine','keinen','keinem','keiner','keines',
    'ist','sind','war','waren','wird','werden','wurde','wurden','hat','haben','hatte','hatten',
    'ich','du','er','sie','es','wir','ihr','mich','dich','sich','uns','euch',
    'mir','dir','ihm','ihnen',
    'in','an','auf','aus','bei','bis','durch','für','gegen','hinter','mit','nach','neben',
    'ohne','seit','über','um','unter','vor','von','während','wegen','zu','zwischen',
    'als','wie','wenn','ob','dass','weil','da','damit','obwohl',
    'auch','noch','schon','nur','immer','sehr','mehr','viel','viele','alle','alles',
    'man','jeder','jede','jedes','dieser','diese','dieses','diesen','diesem',
    'welcher','welche','welches','solcher','solche','solches',
    'hier','dort','so','dann','denn','nun','ja','nein',
    'kann','muss','soll','darf','mag','will','würde','könnte','müsste','sollte',
    'beim','ins','ans','zum','zur','vom',
    'ab','pro','je','per','via','laut','trotz','statt',
    'was','wer','wo','wann','warum','woher','wohin','womit','worüber',
    'jetzt','heute','morgen','gestern','mal','oft','selten','meist','ganz',
    'bereits','erst','wieder','bisher','bald','zuerst',
    'etwas','jemand','niemand',
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
  // Strip HTML tags
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
    if (w.length < 3)     return false;
    if (stops.has(w))     return false;
    if (/^\d+$/.test(w))  return false;
    return true;
  });
}

// ── Step 3: Score keywords ────────────────────────────────────────────────────
// Factors:
//   TF (Term Frequency) — base score
//   Title Bonus  +5     — word appears in title
//   Length Bonus +1     — word > 6 chars (more specific)
//   Position Bonus +2   — word in first 20% of text (leads matter)

function scoreKeywords(allTokens, filteredTokens, titleTokens, lang) {
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
    let score = (count / total) * 100;
    if (titleSet.has(word))  score += 5;
    if (word.length > 6)     score += 1;
    if (earlySet.has(word))  score += 2;
    scores[word] = score;
  }

  return scores;
}

// ── Step 4: Build N-Grams (bigrams & trigrams) ───────────────────────────────

function buildNgrams(tokens, n, lang) {
  const stops  = getStopwords(lang);
  const ngrams = {};

  for (let i = 0; i <= tokens.length - n; i++) {
    const gram = tokens.slice(i, i + n);
    if (stops.has(gram[0]) || stops.has(gram[gram.length - 1])) continue;
    if (gram.some(t => t.length < 3)) continue;
    const key = gram.join(' ');
    ngrams[key] = (ngrams[key] || 0) + 1;
  }

  return Object.entries(ngrams)
    .filter(([, count]) => count > 1)
    .sort((a, b) => b[1] - a[1])
    .map(([phrase]) => phrase);
}

// ── Step 5: Meta Description ─────────────────────────────────────────────────

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
 * generateSEO({ title, content, lang })
 * Returns: { keywords: string[], metaDescription: string, longtailKeywords: string[] }
 */
export function generateSEO({ title = '', content = '', lang = 'en' } = {}) {
  const normLang = lang.split('-')[0].toLowerCase();

  // Title repeated 3× for extra weight in scoring
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

  const scores = scoreKeywords(allTokens, filtered, titleTokens, normLang);

  const topKeywords = Object.entries(scores)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([word]) => word);

  const bigrams  = buildNgrams(filtered, 2, normLang);
  const trigrams = buildNgrams(filtered, 3, normLang);
  const longtail = [...trigrams.slice(0, 5), ...bigrams.slice(0, 8)].slice(0, 10);

  const metaDescription = generateMetaDescription(title, content, topKeywords);

  return {
    keywords:         topKeywords.slice(0, 10),
    metaDescription,
    longtailKeywords: longtail,
  };
}
