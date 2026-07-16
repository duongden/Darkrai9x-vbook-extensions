#!/usr/bin/env node
// vbook extension CLI — build payload from disk, call the vBook local REST API directly
// (see extension_docs.md). No MCP. Lives in the skill dir but operates on the repo it's
// invoked from; run from the repo root:
//   node .claude/skills/vbook-extensions/scripts/vbook.js connect
//   node .claude/skills/vbook-extensions/scripts/vbook.js install <ext-dir> [--no-icon]
//   node .claude/skills/vbook-extensions/scripts/vbook.js build   <ext-dir> [outfile.zip]
//   node .claude/skills/vbook-extensions/scripts/vbook.js test    <ext-dir> <script.js> [arg1 arg2 ...]
//
// Server URL: --server <url> or env VBOOK_SERVER, default http://127.0.0.1:8080.
// Every command first calls GET /connect and prints which device is connected —
// so you always know what you're testing/installing against. Icon is included for
// install/build if <ext-dir>/icon.png exists; omit with --no-icon.

const fs = require("fs");
const path = require("path");
const http = require("http");
const https = require("https");
const { URL } = require("url");

const DEFAULT_SERVER = "http://192.168.10.77:8080";

function die(msg) { console.error("ERROR: " + msg); process.exit(1); }

// The script lives under .claude/skills/vbook-extensions/scripts/ but operates on
// the repo it is invoked from — resolve everything against the current working dir.
function repoRoot() { return process.cwd(); }

// One HTTP request returning the raw response body as text (+ status).
function request(method, urlStr, bodyObj) {
  return new Promise(function (resolve, reject) {
    const u = new URL(urlStr);
    const lib = u.protocol === "https:" ? https : http;
    const body = bodyObj != null ? JSON.stringify(bodyObj) : null;
    const headers = { "Accept": "application/json" };
    if (body != null) {
      headers["Content-Type"] = "application/json";
      headers["Content-Length"] = Buffer.byteLength(body);
    }
    const req = lib.request({
      hostname: u.hostname,
      port: u.port || (u.protocol === "https:" ? 443 : 80),
      path: u.pathname + u.search,
      method: method,
      headers: headers,
    }, function (res) {
      let data = "";
      res.setEncoding("utf8");
      res.on("data", function (c) { data += c; });
      res.on("end", function () { resolve({ status: res.statusCode, text: data }); });
    });
    req.on("error", reject);
    if (body != null) req.write(body);
    req.end();
  });
}

function parseJson(text) {
  try { return JSON.parse(text); } catch (e) { return null; }
}

// GET /connect — prints the connected device name, fails loudly if unreachable.
// Returns the device name string.
async function checkConnection(server) {
  let res;
  try {
    res = await request("GET", new URL("/connect", server).toString());
  } catch (e) {
    die("cannot reach vBook server at " + server + " (" + e.message + ").\n" +
        "  → On the phone, open the vBook app and turn ON debug/dev mode (this starts the local server),\n" +
        "    then read the IP:port it shows and re-run with --server http://<ip>:<port> (or set VBOOK_SERVER).");
  }
  const j = parseJson(res.text);
  const device = j && j.data != null ? String(j.data) : res.text.trim();
  if (res.status !== 200) {
    die("/connect returned " + res.status + " " + (device || ""));
  }
  console.log("[connect] device: " + (device || "(unknown)") + "  @ " + server);
  return device;
}

// Build { plugin, src, icon? } from an extension directory on disk.
function buildPayload(extDir, wantIcon) {
  const dir = path.resolve(repoRoot(), extDir);
  const pluginPath = path.join(dir, "plugin.json");
  const srcDir = path.join(dir, "src");
  if (!fs.existsSync(pluginPath)) die("plugin.json not found in " + dir);
  if (!fs.existsSync(srcDir)) die("src/ not found in " + dir);

  const src = {};
  for (const f of fs.readdirSync(srcDir)) {
    if (f.endsWith(".js")) src[f] = fs.readFileSync(path.join(srcDir, f), "utf8");
  }
  const payload = {
    plugin: fs.readFileSync(pluginPath, "utf8"),
    src: JSON.stringify(src),
  };
  if (wantIcon) {
    const iconPath = path.join(dir, "icon.png");
    if (fs.existsSync(iconPath)) payload.icon = fs.readFileSync(iconPath).toString("base64");
  }
  return payload;
}

// Pull --server <url> out of argv; fall back to env then default.
function extractServer(args) {
  let server = process.env.VBOOK_SERVER || DEFAULT_SERVER;
  const i = args.indexOf("--server");
  if (i !== -1) {
    server = args[i + 1] || die("--server needs a URL");
    args.splice(i, 2);
  }
  return server;
}

async function main() {
  const argv = process.argv.slice(2);
  const noIcon = argv.indexOf("--no-icon") !== -1;
  let args = argv.filter(function (a) { return a !== "--no-icon"; });
  const server = extractServer(args);
  const cmd = args[0];

  if (cmd === "connect") {
    await checkConnection(server);
    return;
  }

  const extDir = args[1];
  if (!cmd || !extDir) {
    console.error("usage: node .claude/skills/vbook-extensions/scripts/vbook.js <connect|install|build|test> <ext-dir> [...] [--server <url>] [--no-icon]");
    process.exit(2);
  }

  // Always confirm the target device first.
  await checkConnection(server);

  if (cmd === "install") {
    const p = buildPayload(extDir, !noIcon);
    const res = await request("POST", new URL("/extension/install", server).toString(), p);
    const j = parseJson(res.text);
    if (res.status !== 200 || (j && j.code && j.code !== 200)) {
      die("install failed (" + res.status + "): " + res.text);
    }
    console.log("[install] OK  code=" + (j && j.code != null ? j.code : res.status));
  } else if (cmd === "build") {
    const outFile = args[2] || path.join(path.resolve(repoRoot(), extDir), "plugin.zip");
    const p = buildPayload(extDir, !noIcon);
    const res = await request("POST", new URL("/extension/build", server).toString(), p);
    const j = parseJson(res.text);
    if (res.status !== 200 || !j || j.code !== 200 || !j.data) {
      die("build failed (" + res.status + "): " + res.text);
    }
    fs.writeFileSync(outFile, Buffer.from(j.data, "base64"));
    console.log("[build] wrote " + outFile + " (" + fs.statSync(outFile).size + " bytes)");
  } else if (cmd === "test") {
    const script = args[2];
    if (!script) die("test needs a script name, e.g. detail.js");
    const vararg = args.slice(3);
    const p = buildPayload(extDir, false);
    p.input = JSON.stringify({ script: script, vararg: vararg });

    // Log exactly what we send so runs are reproducible.
    console.log("[test] script=" + script);
    console.log("[test] input=" + p.input);

    const res = await request("POST", new URL("/extension/test", server).toString(), p);
    const j = parseJson(res.text);
    if (res.status !== 200) {
      die("test HTTP " + res.status + ": " + res.text);
    }
    // Server shape: { code, log, data } on success; { code, log, message } on error.
    if (j) {
      if (j.log) console.log("[test] log:\n" + j.log);
      const out = j.data != null ? j.data : (j.message != null ? j.message : j);
      console.log("[test] output:\n" + (typeof out === "string" ? out : JSON.stringify(out, null, 2)));
      console.log("[test] code=" + j.code);
    } else {
      console.log("[test] raw:\n" + res.text);
    }
  } else {
    die("unknown command: " + cmd);
  }
}

main().catch(function (e) { die(e.message); });
