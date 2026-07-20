# CREATE mode

Standard procedure for writing, testing, and fixing one extension end to end. Follow phases in order.

## Phase 0 — scope the site

1. Fetch the target URL (WebFetch or `curl`).
2. Determine `type`: `novel` / `comic` / `video` / `tts` / `translate`.
3. Collect real sample pages: one real **detail** page URL, one real **chapter/episode** page URL reachable from it. `tts`/`translate` need none.
4. If only given a homepage, ask for a detail-page URL, or fetch the homepage and click through to one yourself.

## Phase 1 — scaffold

1. Copy `templates/<type>/` into the extension's target folder.
2. Fill `plugin.json.metadata`: `name`, `source`, `regexp` (must match the real detail-page URL), `locale`, `type`, `nsfw`.
3. Set `config.DOMAIN.default` to the **exact same URL** as `metadata.source` (`BASE_URL` in `config.js` traces back to this value) — the two must never diverge.
4. Cross-check `reference/extension-api.md`'s "Required scripts per type" table. Drop any `plugin.json.script` key (and file) the site genuinely can't support. Keep everything else, including optional ones.
   - `comic` only: the per-chapter image list is **required** — `page.js` and `chap.js` are its two alternative implementations (both ship in the template). Check whether the site has a separate page-list endpoint or the chapter page itself lists all images, pick the matching one, delete the other file and its `plugin.json.script` key. Exactly one must remain — never both, never neither.
5. `icon.png`: real site logo/favicon, not a placeholder. Prefer apple-touch-icon/og:image/logo asset over favicon.ico. Resize to exactly **200x200**, compress (tinypng or equivalent) before embedding as base64.

## Phase 2 — write → test → fix, one script at a time

Order:

1. `detail.js` (or the type's primary script)
2. `toc.js`
3. per-chapter content: `chap.js` / `page.js` / `track.js`
   - **video/audio is a `chap`→`track` chain** (see `reference/extension-api.md`). `chap.js(episodeUrl)` returns the episode's server list `[{title, data}]` (one entry per source button; single-server sites return a one-element list). `track.js(data)` then resolves the chosen `data` to the playback object. Test both: `chap` first (get a real server `data`), then `track` with that `data`.
   - `track.js`: **always try to resolve the real direct stream first** (`.m3u8`/`.mp4`) and return `type: "native"`. If `data` is a 3rd-party embed URL, fetch it and grab the stream from the page (regex the `.m3u8`/`.mp4`, or the `file:`/`sources:` key). When direct resolution is genuinely too hard (obfuscated/JS-built links, DRM, per-request tokens), fall back to **`type: "auto"`** (pass the embed URL as `data`, let the app sniff the stream) — prefer `auto` over `webview`. Only use `type: "webview"` (resolve in a headless page) if `auto` also can't play it. Order: `native` → `auto` → `webview`.
4. `search.js`
5. `home.js`, `genre.js`, `explore.js`
6. `similar.js`, `comments.js` (if `detail.js` references them)
7. `tts`: `voice.js` then `tts.js`. `translate`: `language.js` then `translate.js`.

For each script:

1. **Write** selectors from the real fetched HTML — never guess a class/id. Apply every constraint in `SKILL.md`. Save the file before testing (the CLI reads from disk).
2. **Run** `node .claude/skills/vbook-extensions/scripts/vbook.js test <ext-dir> <script>.js <arg1> <arg2> ...` (args in documented order, all strings). It calls `/connect` first (prints the target device), then logs the input and the `{code,log,data}` output. See the CLI section in `SKILL.md`.
4. **Verify `data` against the shared standard in `reference/verify-checklist.md`** — `code:0` alone is not a pass. All checks hold → script done, move to the next. Any fail → read `log`, fix precisely, re-run step 2.
5. **Escalate after ~3 fix/retest cycles without progress**:
   - For a `url`-receiving script: check for the trailing-`/`-stripped case (constraint 7 in `SKILL.md`).
   - Re-fetch the live page, re-diff selectors.
   - Check if content is JS-rendered — switch to `Engine.newBrowser()`.
   - Check if the site needs a Cloudflare-style bypass — see `bypass.js` pattern in `truyenqq/src/bypass.js` at repo root.

Do not move to the next script while the current one fails.

## Phase 3 — package

Once every mandatory and kept-optional script passes:

1. Strip the template's teaching comments from every script (see the Templates section in `SKILL.md`) — keep only comments documenting non-obvious site-specific logic you added.
2. Summarize what was built and what was dropped as unsupported.
3. Ask before running `vbook.js build` and/or `vbook.js install`.

## Done criteria

Every script in the final `plugin.json.script` passes `vbook.js test` with correctly-shaped, verified data. No script violates a `SKILL.md` constraint.
