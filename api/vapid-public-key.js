/* Inner Table - hands out the VAPID public key so the client can subscribe
   to push. Not secret: it's the same key every subscribing browser embeds
   in its subscription, so serving it from an env var (instead of hardcoding
   it in the client bundle) only buys easy rotation. */
"use strict";

module.exports = async function handler(req, res) {
  if (req.method !== "GET") { res.status(405).json({ error: "Method not allowed" }); return; }
  var publicKey = process.env.VAPID_PUBLIC_KEY;
  if (!publicKey) { res.status(500).json({ error: "Push is not configured on the server yet." }); return; }
  res.status(200).json({ publicKey: publicKey });
};
