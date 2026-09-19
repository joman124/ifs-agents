/* Inner Table - sends a notification to every device the signed-in user has
   subscribed on. For now this is only reached by the "Send test" button in
   Settings, so it always notifies the caller's own account - nothing here
   lets one user target another's devices. A subscription the push service
   reports as gone (410/404 - the user unsubscribed at the OS level, or
   uninstalled) is dropped so the list doesn't grow stale. */
"use strict";

var crypto = require("crypto");
var webpush = require("web-push");

function subsKey(username) { return "innertable:push:" + username; }

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
  var redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;
  var secret = process.env.SESSION_SECRET;
  var vapidPublic = process.env.VAPID_PUBLIC_KEY;
  var vapidPrivate = process.env.VAPID_PRIVATE_KEY;
  var vapidSubject = process.env.VAPID_SUBJECT;

  if (!base || !redisToken || !secret || !vapidPublic || !vapidPrivate || !vapidSubject) {
    res.status(500).json({ error: "Push is not configured on the server yet." });
    return;
  }
  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

  var auth = req.headers.authorization || "";
  var sessionToken = auth.indexOf("Bearer ") === 0 ? auth.slice(7) : "";
  var session = verifySession(sessionToken, secret);
  if (!session) { res.status(401).json({ error: "Sign in again." }); return; }
  var key = subsKey(session.u);

  var getRes = await fetch(base + "/get/" + key, { headers: { Authorization: "Bearer " + redisToken } });
  if (!getRes.ok) { res.status(502).json({ error: "Upstash read failed" }); return; }
  var got = await getRes.json();
  var list = [];
  if (got.result) { try { list = JSON.parse(got.result); } catch (e) { list = []; } }
  if (!Array.isArray(list) || !list.length) {
    res.status(404).json({ error: "No devices are subscribed yet - turn on notifications first." });
    return;
  }

  webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate);

  var body = req.body || {};
  var title = String(body.title || "Inner Table").slice(0, 80);
  var text = String(body.body || "Notifications are working - you'll hear from your parts here.").slice(0, 200);
  var payload = JSON.stringify({ title: title, body: text, url: "./" });

  var stillGood = [];
  var sent = 0;
  await Promise.all(list.map(async function (sub) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } },
        payload
      );
      sent++;
      stillGood.push(sub);
    } catch (e) {
      // 404/410 = the push service says this subscription is gone; anything
      // else (a network blip) keeps the subscription for next time
      if (e && (e.statusCode === 404 || e.statusCode === 410)) return;
      stillGood.push(sub);
    }
  }));

  if (stillGood.length !== list.length) {
    await fetch(base + "/set/" + key, {
      method: "POST",
      headers: { Authorization: "Bearer " + redisToken },
      body: JSON.stringify(stillGood)
    }).catch(function () {});
  }

  if (!sent) { res.status(502).json({ error: "Could not reach any of your subscribed devices." }); return; }
  res.status(200).json({ ok: true, sent: sent, devices: stillGood.length });
};
