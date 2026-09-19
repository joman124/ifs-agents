#!/usr/bin/env node
/* Inner Table - one-time setup: prints a VAPID key pair for Web Push.
   Run once, then set the three env vars it prints (in the Vercel dashboard,
   or `vercel env add`) - never commit them.

     node scripts/gen-vapid-keys.js
*/
"use strict";
var webpush = require("web-push");

var keys = webpush.generateVAPIDKeys();

console.log("Add these as environment variables (Vercel dashboard or `vercel env add`):\n");
console.log("VAPID_PUBLIC_KEY=" + keys.publicKey);
console.log("VAPID_PRIVATE_KEY=" + keys.privateKey);
console.log("VAPID_SUBJECT=mailto:you@example.com   (or https://ifs-agents.vercel.app)");
console.log("\nThe public key is not secret - it's handed to every browser that subscribes.");
console.log("The private key signs push messages; keep it out of git and the client bundle.");
