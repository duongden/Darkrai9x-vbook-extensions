// BASE_URL aliases the DOMAIN config key (injected as a const from plugin.json.config).
// Scripts use BASE_URL, not DOMAIN directly, so the alias can be repointed later
// without touching every script.
let BASE_URL = DOMAIN;
// Back-compat with the old app: it may inject a CONFIG_URL global instead of DOMAIN.
// Undefined on the current engine — the ReferenceError is caught and ignored, BASE_URL
// stays DOMAIN.
try {
    if (CONFIG_URL) {
        BASE_URL = CONFIG_URL;
    }
} catch (error) {
}

// Rewrite an incoming url's host (old/mirror/www-prefixed) to BASE_URL, keeping
// path/query. Call this first thing in every url-receiving execute(url).
function normalizeUrl(url) {
    return url.replace(/^(?:https?:\/\/)?(?:[^@\n]+@)?(?:www\.)?([^:\/\n?]+)/img, BASE_URL);
}
