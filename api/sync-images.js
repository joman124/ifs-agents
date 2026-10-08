/* Inner Table - picture sync relay.
   Parts' pictures travel on their own endpoint and their own key, apart from
   the profiles in api/sync.js. They are the one bulky thing in an account, and
   Upstash caps the size of a single write: kept in the main blob, a handful of
   photos would push it over the line and every edit to every part would stop
   syncing. Here the worst a too-large set of pictures can do is fail to sync
   itself.

   A separate path rather than a flag on /api/sync is deliberate: a client that
   is newer than the server it reaches gets a 404 here and sends nothing, where
   a flag an older server ignores would have it write a pictures blob over the
   profiles. Same gate as sync: a session token this server signed, and the
   storage key comes from that token, never from the request. */
"use strict";

var crypto = require("crypto");

function imagesKey(username) { return "innertable:images:" + username; }

// well under Upstash's request cap, so the refusal is ours and says why
var MAX_CHARS = 900000;

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
  var key = imagesKey(session.u);

  if (req.method === "GET") {
    var getRes = await fetch(base + "/get/" + key, {
      headers: { Authorization: "Bearer " + token }
    });
    if (!getRes.ok) { res.status(502).json({ error: "Upstash read failed" }); return; }
    var data = await getRes.json();
    res.status(200).json({ images: data.result || null });
    return;
  }

  if (req.method === "POST") {
    var images = req.body && req.body.images;
    if (!images || typeof images !== "string") {
      res.status(400).json({ error: "Missing images" });
      return;
    }
    if (images.length > MAX_CHARS) {
      res.status(413).json({ error: "Pictures are too large to sync." });
      return;
    }
    var setRes = await fetch(base + "/set/" + key, {
      method: "POST",
      headers: { Authorization: "Bearer " + token },
      body: images
    });
    if (!setRes.ok) { res.status(502).json({ error: "Upstash write failed" }); return; }
    res.status(200).json({ ok: true });
    return;
  }

  res.status(405).json({ error: "Method not allowed" });
};
