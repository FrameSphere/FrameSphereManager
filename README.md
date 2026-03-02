# WebControl HQ

Zentrales Management-Dashboard für alle deine Webseiten.
**Stack:** Cloudflare Pages (Frontend) + Cloudflare Workers (API) + Cloudflare D1 (Datenbank)

---

## 🚀 Setup in 5 Schritten

### 1. Wrangler installieren & einloggen
```bash
npm install
npx wrangler login
```

### 2. D1 Datenbank erstellen
```bash
npm run db:create
```
→ Kopiere die angezeigte `database_id` und trage sie in `wrangler.toml` ein:
```toml
[[d1_databases]]
database_id = "DEINE_ID_HIER"
```

### 3. Datenbank-Schema ausführen
```bash
# Lokal
npm run db:init

# Auf Cloudflare (Remote)
npm run db:init:remote
```

### 4. Worker deployen
```bash
npm run deploy:worker
```
→ Kopiere die Worker-URL (z.B. `https://webcontrol-hq-api.DEIN_NAME.workers.dev`)
→ Trage sie in `public/index.html` ein – suche nach `API_URL` und ersetze `YOUR_SUBDOMAIN`

### 5. Frontend (Pages) deployen
```bash
npm run deploy:pages
```

---

## 💻 Lokale Entwicklung

Terminal 1 – Worker starten:
```bash
npm run dev:worker
```

Terminal 2 – Frontend starten:
```bash
npm run dev:frontend
```
→ Öffne http://localhost:3000

---

## 📡 API Endpoints

| Methode | Pfad | Beschreibung |
|---------|------|--------------|
| GET | `/api/overview` | Dashboard Übersicht |
| GET/POST | `/api/support` | Support Tickets |
| PATCH | `/api/support/:id` | Ticket updaten |
| GET/POST | `/api/changelog` | Changelog Einträge |
| DELETE | `/api/changelog/:id` | Eintrag löschen |
| GET/POST | `/api/blog` | Blog Posts |
| GET/POST/PATCH | `/api/words` | Wort-Anfragen (Wordify) |
| GET/PATCH | `/api/suggestions` | Vorschläge (SpinSelector) |
| GET/POST | `/api/errors` | Fehler-Logs |
| PATCH | `/api/errors/:id/resolve` | Fehler lösen |
| GET/POST | `/api/analytics` | Analytics Events |
| GET/POST | `/api/notifications` | Benachrichtigungen |
| POST | `/api/notifications/read-all` | Alle als gelesen markieren |
| GET | `/api/stats` | Globale Statistiken |

---

## 📊 Tracking-Integration

Auf deinen Webseiten kannst du Events direkt an die API senden:

```javascript
// Pageview tracken
fetch('https://webcontrol-hq-api.XXX.workers.dev/api/analytics', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    site_id: 'framesphere', // ID aus schema.sql
    event_type: 'pageview',
    path: window.location.pathname
  })
});

// Fehler reporten
fetch('https://webcontrol-hq-api.XXX.workers.dev/api/errors', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    site_id: 'framesphere',
    error_type: '500',
    message: 'Datenbankverbindung fehlgeschlagen',
    path: window.location.pathname
  })
});
```

---

## 🗂 Projektstruktur

```
Manager/
├── public/
│   └── index.html      ← Frontend SPA (Cloudflare Pages)
├── worker/
│   └── index.js        ← API Worker (Cloudflare Workers)
├── schema.sql          ← D1 Datenbankschema
├── wrangler.toml       ← Cloudflare Konfiguration
├── package.json
└── README.md
```

---

## 🌐 Verwaltete Seiten

| Name | URL | Features |
|------|-----|----------|
| Frame-Sphere | frame-sphere.vercel.app | Support, Blog, Daten |
| FrameTrain | frame-train.vercel.app | Support, Changelog, Daten |
| Wordify | wordify.pages.dev | Wort-Anfragen, Daten |
| Flaggues | flaggues.pages.dev | Daten |
| SpinSelector | spinselector.pages.dev | Vorschläge, Daten |
| BrawlMystery | brawlmystery.pages.dev | Changelog, Blog, Daten |
| Traitora | traitora.pages.dev | Daten |
| FileFlyr | fileflyr.pages.dev | Support, Daten |
| Ratelimit API | ratelimit-api.pages.dev | Analytics, Daten, Changelog |
| FrameSpell | framespell.pages.dev | Analytics, Daten, Changelog |
