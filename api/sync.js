/* Inner Table - cross-device sync relay.
   Proxies each signed-in user's state blob to their own key in Upstash
   Redis, so the Upstash token never reaches the browser and one user can
   never read another's. Session tokens (issued by api/login.js) are
   verified here, not trusted from the client. */
"use strict";

var crypto = require("crypto");

function stateKey(username) { return "innertable:state:" + username; }

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
    res.status(200).json({ state: data.result || null });
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
    res.status(200).json({ ok: true });
    return;
  }

  res.status(405).json({ error: "Method not allowed" });
};
