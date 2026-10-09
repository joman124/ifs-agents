/* Inner Table - cross-device sync relay.
   Proxies each signed-in user's state blob to their own key in Upstash
   Redis, so the Upstash token never reaches the browser and one user can
   never read another's. Session tokens (issued by api/login.js) are
   verified here, not trusted from the client. */
"use strict";

var crypto = require("crypto");

function stateKey(username) { return "innertable:state:" + username; }
// sessions the person's own AI saved through their link (api/bridge.js),
// waiting for the app to fold them in
function inboxKey(username) { return "innertable:inbox:" + username; }

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

/* Pending saves, oldest first. Best-effort: a failure here must never stop
   the parts themselves from syncing. */
async function readInbox(base, token, user) {
  try {
    var r = await fetch(base + "/hgetall/" + inboxKey(user), { headers: { Authorization: "Bearer " + token } });
    if (!r.ok) return [];
    var flat = (await r.json()).result;
    var out = [];
    for (var i = 0; Array.isArray(flat) && i + 1 < flat.length; i += 2) {
      try {
        var entry = JSON.parse(flat[i + 1]);
        if (entry && typeof entry === "object") {
          out.push({ id: flat[i], parts: Array.isArray(entry.parts) ? entry.parts : [],
            meetings: Array.isArray(entry.meetings) ? entry.meetings : [],
            journal: Array.isArray(entry.journal) ? entry.journal : [] });
        }
      } catch (e) {}
    }
    return out.sort(function (a, b) { return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; });
  } catch (e) { return []; }
}

module.exports = async function handler(req, res) {
  var base = process.env.UPSTASH_REDIS_REST_URL;
  var token = process.env.UPSTASH_REDIS_REST_TOKEN;
  var secret = process.env.SESSION_SECRET;

  if (!base || !token || !secret) {
    res.status(500).json({ error: "Sync is not configured on the server yet." });
    return;
  }

  var auth = req.headers.authorization || "";
  var sessionToken = auth.indexOf("Bearer ") === 0 ? auth.slice(7) : "";
  var session = verifySession(sessionToken, secret);
  if (!session) { res.status(401).json({ error: "Sign in again." }); return; }
  var key = stateKey(session.u);

  if (req.method === "GET") {
    var getRes = await fetch(base + "/get/" + key, {
      headers: { Authorization: "Bearer " + token }
    });
    if (!getRes.ok) { res.status(502).json({ error: "Upstash read failed" }); return; }
    var data = await getRes.json();
    res.status(200).json({ state: data.result || null, inbox: await readInbox(base, token, session.u) });
    return;
  }

  if (req.method === "POST") {
    var state = req.body && req.body.state;
    if (!state || typeof state !== "string") {
      res.status(400).json({ error: "Missing state" });
      return;
    }
    var setRes = await fetch(base + "/set/" + key, {
      method: "POST",
      headers: { Authorization: "Bearer " + token },
      body: state
    });
    if (!setRes.ok) { res.status(502).json({ error: "Upstash write failed" }); return; }
    /* The app acknowledges inbox saves it has folded in only on a push that
       carries them, so a save can never be dropped before it is in the state
       that was just written. */
    var ack = Array.isArray(req.body.ack) ? req.body.ack.filter(function (x) {
      return typeof x === "string" && x && x.length < 100;
    }).slice(0, 100) : [];
    if (ack.length) {
      try {
        await fetch(base + "/hdel/" + inboxKey(session.u) + "/" + ack.map(encodeURIComponent).join("/"), {
          headers: { Authorization: "Bearer " + token }
        });
      } catch (e) { /* left in the inbox; folding it in again is harmless */ }
    }
    res.status(200).json({ ok: true });
    return;
  }

  res.status(405).json({ error: "Method not allowed" });
};

module.exports.verifySession = verifySession;
