/* Inner Table - saves/drops one device's push subscription under the
   signed-in user's own key, the same way api/sync.js keeps their state
   blob: session tokens (issued by api/login.js) are verified here, not
   trusted from the client, so one user can never touch another's devices. */
"use strict";

var crypto = require("crypto");

function subsKey(username) { return "innertable:push:" + username; }
var MAX_DEVICES = 10; // oldest is dropped past this so one account can't grow unbounded

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

function validSubscription(s) {
  return !!(s && typeof s.endpoint === "string" && s.endpoint &&
    s.keys && typeof s.keys.p256dh === "string" && typeof s.keys.auth === "string");
}

module.exports = async function handler(req, res) {
  var base = process.env.UPSTASH_REDIS_REST_URL;
  var token = process.env.UPSTASH_REDIS_REST_TOKEN;
  var secret = process.env.SESSION_SECRET;

  if (!base || !token || !secret) {
    res.status(500).json({ error: "Push is not configured on the server yet." });
    return;
  }

  var auth = req.headers.authorization || "";
  var sessionToken = auth.indexOf("Bearer ") === 0 ? auth.slice(7) : "";
  var session = verifySession(sessionToken, secret);
  if (!session) { res.status(401).json({ error: "Sign in again." }); return; }
  var key = subsKey(session.u);

  var getRes = await fetch(base + "/get/" + key, { headers: { Authorization: "Bearer " + token } });
  if (!getRes.ok) { res.status(502).json({ error: "Upstash read failed" }); return; }
  var got = await getRes.json();
  var list = [];
  if (got.result) { try { list = JSON.parse(got.result); } catch (e) { list = []; } }
  if (!Array.isArray(list)) list = [];

  if (req.method === "POST") {
    var sub = req.body && req.body.subscription;
    if (!validSubscription(sub)) { res.status(400).json({ error: "Missing or malformed subscription" }); return; }
    list = list.filter(function (s) { return s.endpoint !== sub.endpoint; });
    list.push({ endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth }, savedAt: Date.now() });
    if (list.length > MAX_DEVICES) list = list.slice(list.length - MAX_DEVICES);
  } else if (req.method === "DELETE") {
    var endpoint = req.body && req.body.endpoint;
    if (!endpoint) { res.status(400).json({ error: "Missing endpoint" }); return; }
    list = list.filter(function (s) { return s.endpoint !== endpoint; });
  } else {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  var setRes = await fetch(base + "/set/" + key, {
    method: "POST",
    headers: { Authorization: "Bearer " + token },
    body: JSON.stringify(list)
  });
  if (!setRes.ok) { res.status(502).json({ error: "Upstash write failed" }); return; }
  res.status(200).json({ ok: true, devices: list.length });
};
