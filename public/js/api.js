// ── API Config & Helper ───────────────────────────────────────────

const API_URL = (
  window.location.hostname === 'localhost' ||
  window.location.hostname === '127.0.0.1'
)
  ? 'http://localhost:8787'
  : 'https://webcontrol-hq-api.karol-paschek.workers.dev';

async function api(path, opts = {}) {
  try {
    const r = await fetch(API_URL + path, {
      headers: {
        'Content-Type': 'application/json',
        'X-Auth-Token': getToken() || '',
        ...opts.headers,
      },
      ...opts,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    if (r.status === 401) {
      clearToken();
      location.reload();
      return null;
    }
    return await r.json();
  } catch (e) {
    console.error('API error:', e);
    return null;
  }
}
