/* Inner Table - the person's own AI connection, kept with their account.

   Each person brings their own AI account and pays for their own sessions:
   this holds the one connection they chose - { provider, key, model, at } -
   so it follows them to every device they sign in on, instead of being typed
   in again on each one. The key is encrypted at rest (AES-256-GCM, with a key
   derived from SESSION_SECRET) and only ever handed back to its owner's own
   signed-in session. It never reaches the private link (api/bridge.js).

   It also runs the one-tap "Connect with OpenRouter" sign-in (OAuth PKCE):
     POST { action: "openrouter" }  -> { url } to send the person to
     GET  /connect/openrouter/<state>?code=...  <- OpenRouter sends them back
                                       here (rewritten to ?state=); the
                                       code is exchanged for a key made for
                                       them, saved, and they return to the app.
   The verifier and the account it belongs to wait server-side under a
   one-time state, so it works even when the sign-in comes back in a
   different browser from the installed app.

   GET  (signed in)          -> { ai } or { ai: null }
   POST { ai }   (signed in) -> saves it; an empty key is a disconnect, kept
                                with its time so every device learns of it. */
"use strict";

var crypto = require("crypto");

function aiKey(username) { return "innertable:ai:" + username; }
function stateKey(state) { return "innertable:oauth:" + state; }

var PROVIDERS = ["anthropic", "openrouter", "openai", "gemini"];
var OPENROUTER_FALLBACK_MODEL = "anthropic/claude-sonnet-5.5";

function verifySession(token, secret) {
  if (!token) return null;
  var parts = token.split(".");
  if (parts.length !== 2) return null;
  var body = parts[0], sig = parts[1];
  var expected = crypto.createHmac("sha256", secret).update(body).digest("base64url");
  var a = Buffer.from(sig), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    var payload = JSON.parse(Buffer.from(body, "base64url").toString());
    if (!payload.u || !payload.exp || payload.exp < Date.now()) return null;
    return payload;
  } catch (e) { return null; }
}

function cipherKey(secret) {
  return crypto.createHash("sha256").update("inner-table:ai-key:" + secret).digest();
}

function seal(obj, secret) {
  var iv = crypto.randomBytes(12);
  var c = crypto.createCipheriv("aes-256-gcm", cipherKey(secret), iv);
  var data = Buffer.concat([c.update(JSON.stringify(obj), "utf8"), c.final()]);
  return [iv.toString("base64url"), c.getAuthTag().toString("base64url"), data.toString("base64url")].join(".");
}

function open(sealed, secret) {
  try {
    var p = String(sealed).split(".");
    if (p.length !== 3) return null;
    var d = crypto.createDecipheriv("aes-256-gcm", cipherKey(secret), Buffer.from(p[0], "base64url"));
    d.setAuthTag(Buffer.from(p[1], "base64url"));
    var out = Buffer.concat([d.update(Buffer.from(p[2], "base64url")), d.final()]).toString("utf8");
    return JSON.parse(out);
  } catch (e) { return null; }
}

/* Only the four fields, each a short plain string. */
function clean(ai) {
  if (!ai || typeof ai !== "object") return null;
  var str = function (v, max) { return typeof v === "string" && v.length <= max ? v.trim() : ""; };
  var out = {
    provider: str(ai.provider, 20),
    key: str(ai.key, 400),
    model: str(ai.model, 120),
    at: str(ai.at, 40) || new Date().toISOString()
  };
  if (out.key && PROVIDERS.indexOf(out.provider) < 0) return null;
  if (!out.key) { out.provider = ""; out.model = ""; }
  return out;
}

/* Where this deployment is reachable, for the address OpenRouter sends the
   person back to. */
function originOf(req) {
  var host = req.headers["x-forwarded-host"] || req.headers.host || "";
  var proto = req.headers["x-forwarded-proto"] || (/^localhost|^127\./.test(host) ? "http" : "https");
  return proto.split(",")[0].trim() + "://" + host.split(",")[0].trim();
}

/* OpenRouter appends ?code= to the callback address; an address that already
   carries ?state= can come back as "?state=abc?code=xyz". Read both shapes. */
function callbackParams(req) {
  var q = req.query || {};
  var state = String(q.state || "");
  var code = String(q.code || "");
  var glued = state.indexOf("?code=");
  if (glued >= 0) { code = code || state.slice(glued + 6); state = state.slice(0, glued); }
  return { state: state, code: code };
}

/* The newest Claude Sonnet OpenRouter carries, so a person who connects
   today and one who connects next year both get the current one. */
async function newestSonnet() {
  try {
    var r = await fetch("https://openrouter.ai/api/v1/models");
    if (!r.ok) return OPENROUTER_FALLBACK_MODEL;
    var list = ((await r.json()).data || []).filter(function (m) {
      return m && /^anthropic\/claude-sonnet-[\d.]+$/.test(m.id || "");
    });
    list.sort(function (a, b) { return (b.created || 0) - (a.created || 0); });
    return list.length ? list[0].id : OPENROUTER_FALLBACK_MODEL;
  } catch (e) { return OPENROUTER_FALLBACK_MODEL; }
}

module.exports = async function handler(req, res) {
  var base = process.env.UPSTASH_REDIS_REST_URL;
  var token = process.env.UPSTASH_REDIS_REST_TOKEN;
  var secret = process.env.SESSION_SECRET;

  if (!base || !token || !secret) {
    res.status(500).json({ error: "Accounts are not configured on the server yet." });
    return;
  }

  var redis = async function (path, body) {
    var r = await fetch(base + path, body === undefined
      ? { headers: { Authorization: "Bearer " + token } }
      : { method: "POST", headers: { Authorization: "Bearer " + token }, body: body });
    if (!r.ok) throw new Error("Upstash request failed");
    return (await r.json()).result;
  };

  var save = async function (user, ai) {
    await redis("/set/" + aiKey(user), seal(ai, secret));
  };

  /* ---- OpenRouter sends the person back here ---- */
  var cb = callbackParams(req);
  if (req.method === "GET" && cb.state) {
    var back = function (q) {
      res.statusCode = 302;
      res.setHeader("Location", "/?" + q);
      res.setHeader("Cache-Control", "no-store");
      res.end();
    };
    if (!/^[A-Za-z0-9_-]{20,80}$/.test(cb.state) || !cb.code) { back("connect_error=cancelled"); return; }
    var pending = null;
    try {
      pending = await redis("/get/" + stateKey(cb.state));
      await redis("/del/" + stateKey(cb.state));   // one use only
    } catch (e) { back("connect_error=server"); return; }
    try { pending = pending ? JSON.parse(pending) : null; } catch (e) { pending = null; }
    if (!pending || !pending.u || !pending.v) { back("connect_error=expired"); return; }
    try {
      var ex = await fetch("https://openrouter.ai/api/v1/auths/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: cb.code, code_verifier: pending.v, code_challenge_method: "S256" })
      });
      var got = ex.ok ? await ex.json() : null;
      if (!got || typeof got.key !== "string" || !got.key) { back("connect_error=openrouter"); return; }
      await save(pending.u, { provider: "openrouter", key: got.key, model: await newestSonnet(), at: new Date().toISOString() });
    } catch (e) { back("connect_error=openrouter"); return; }
    back("connected=openrouter");
    return;
  }

  var auth = req.headers.authorization || "";
  var session = verifySession(auth.indexOf("Bearer ") === 0 ? auth.slice(7) : "", secret);
  if (!session) { res.status(401).json({ error: "Sign in again." }); return; }
  var user = session.u;

  try {
    if (req.method === "GET") {
      var stored = await redis("/get/" + aiKey(user));
      res.setHeader("Cache-Control", "no-store");
      res.status(200).json({ ai: stored ? open(stored, secret) : null });
      return;
    }

    if (req.method === "POST" && req.body && req.body.action === "openrouter") {
      var state = crypto.randomBytes(24).toString("base64url");
      var verifier = crypto.randomBytes(48).toString("base64url");
      var challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
      // a command array, so the expiry rides along: the sign-in has 15 minutes
      await redis("", JSON.stringify(["SET", stateKey(state), JSON.stringify({ u: user, v: verifier }), "EX", "900"]));
      // a plain path (vercel.json rewrites it to ?state=), so the ?code=
      // OpenRouter adds is the address's only query
      var callback = originOf(req) + "/connect/openrouter/" + state;
      res.status(200).json({
        url: "https://openrouter.ai/auth?callback_url=" + encodeURIComponent(callback) +
          "&code_challenge=" + challenge + "&code_challenge_method=S256"
      });
      return;
    }

    if (req.method === "POST") {
      var ai = clean(req.body && req.body.ai);
      if (!ai) { res.status(400).json({ error: "That connection could not be read." }); return; }
      await save(user, ai);
      res.status(200).json({ ok: true, at: ai.at });
      return;
    }
  } catch (e) {
    res.status(502).json({ error: "Could not reach your account just now." });
    return;
  }

  res.status(405).json({ error: "Method not allowed" });
};

module.exports._internal = { seal: seal, open: open, clean: clean, callbackParams: callbackParams };
