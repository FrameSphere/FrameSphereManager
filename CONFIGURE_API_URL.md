# 📝 API_URL konfigurieren

Nach dem Worker-Deploy: Öffne `public/index.html` und suche nach:

```javascript
const API_URL = ...
  : 'https://webcontrol-hq-api.YOUR_SUBDOMAIN.workers.dev';
```

Ersetze `YOUR_SUBDOMAIN` mit deinem Cloudflare-Subdomainnamen.
Den genauen Namen siehst du nach `npm run deploy:worker` in der Ausgabe.
