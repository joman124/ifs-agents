/* Inner Table - verifies a username/password against the record an admin
   created with scripts/add-user.js, and issues a signed session token.
   No public signup: accounts only exist if someone with the Upstash
   credentials ran that script. */
const crypto = require("crypto");

const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const SESSION_SECRET = process.env.SESSION_SECRET;
const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function userKey(username) { return "innertable:user:" + username; }

function sign(payload) {
  var body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  var sig = crypto.createHmac("sha256", SESSION_SECRET).update(body).digest("base64url");
  return body + "." + sig;
}

module.exports = async function handler(req, res) {
  if (!REDIS_URL || !REDIS_TOKEN || !SESSION_SECRET) {
    res.status(500).json({ error: "auth not configured" });
    return;
  }
  if (req.method !== "POST") { res.status(405).json({ error: "method not allowed" }); return; }

  var body = req.body || {};
  var uname = String(body.username || "").trim().toLowerCase();
  var password = body.password;
  if (!/^[a-z0-9_-]{2,32}$/.test(uname) || !password) {
    res.status(400).json({ error: "unknown user or wrong password" });
    return;
  }

  var r = await fetch(REDIS_URL + "/get/" + userKey(uname), {
    headers: { Authorization: "Bearer " + REDIS_TOKEN }
  });
  if (!r.ok) { res.status(502).json({ error: "redis get failed" }); return; }
  var data = await r.json();
  if (!data.result) { res.status(401).json({ error: "unknown user or wrong password" }); return; }

  var record;
  try { record = JSON.parse(data.result); } catch (e) { res.status(500).json({ error: "corrupt user record" }); return; }

  var hash = crypto.scryptSync(password, record.salt, 64);
  var stored = Buffer.from(record.hash, "hex");
  var ok = hash.length === stored.length && crypto.timingSafeEqual(hash, stored);
  if (!ok) { res.status(401).json({ error: "unknown user or wrong password" }); return; }

  var token = sign({ u: uname, exp: Date.now() + TOKEN_TTL_MS });
  res.status(200).json({ token: token, username: uname });
};
