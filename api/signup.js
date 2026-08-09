/* Inner Table - creates an account from the app itself.
   Refuses a name that already exists rather than overwriting it: an
   overwrite here would be an account takeover, handing the new password
   to someone else's parts. No token is issued - the client signs in
   through api/login.js straight after, so there is one place that mints
   sessions. */
"use strict";

var crypto = require("crypto");

function userKey(username) { return "innertable:user:" + username; }

module.exports = async function handler(req, res) {
  var base = process.env.UPSTASH_REDIS_REST_URL;
  var token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!base || !token) {
    res.status(500).json({ error: "Sign-up is not configured on the server yet." });
    return;
  }
  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

  var body = req.body || {};
  var username = String(body.username || "").trim().toLowerCase();
  var password = String(body.password || "");

  if (!/^[a-z0-9_-]{2,32}$/.test(username)) {
    res.status(400).json({ error: "Username: 2-32 characters - letters, digits, - or _." });
    return;
  }
  if (password.length < 8) {
    res.status(400).json({ error: "Password must be at least 8 characters." });
    return;
  }

  var key = userKey(username);
  var existing = await fetch(base + "/get/" + key, { headers: { Authorization: "Bearer " + token } });
  if (!existing.ok) { res.status(502).json({ error: "Upstash read failed" }); return; }
  var found = await existing.json();
  if (found.result) { res.status(409).json({ error: "That name is taken - try another." }); return; }

  var salt = crypto.randomBytes(16).toString("hex");
  var hash = crypto.scryptSync(password, salt, 64).toString("hex");
  var written = await fetch(base + "/set/" + key, {
    method: "POST",
    headers: { Authorization: "Bearer " + token },
    body: JSON.stringify({ salt: salt, hash: hash })
  });
  if (!written.ok) { res.status(502).json({ error: "Upstash write failed" }); return; }

  res.status(200).json({ ok: true, username: username });
};
