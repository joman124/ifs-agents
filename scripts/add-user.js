#!/usr/bin/env node
/* Admin-only: creates or resets one Inner Table login. There is no signup
   page on purpose - run this once for each person who gets an account.

     vercel env pull .env.local        (once - fetches the Upstash creds)
     node scripts/add-user.js <username>

   then type the password at the prompt. The password is deliberately not a
   command-line argument: PowerShell records every command line in a
   plaintext history file that would keep it forever. */
"use strict";
var crypto = require("crypto");
var fs = require("fs");
var path = require("path");
var readline = require("readline");

/* Read .env.local (what `vercel env pull` writes) so the Upstash token never
   has to be pasted into a shell. Real env vars still win. */
function loadEnvFile() {
  var file = path.join(__dirname, "..", ".env.local");
  if (!fs.existsSync(file)) return;
  fs.readFileSync(file, "utf8").split("\n").forEach(function (line) {
    var m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m || process.env[m[1]]) return;
    process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  });
}
loadEnvFile();

var REDIS_URL = process.env.UPSTASH_REDIS_REST_URL;
var REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
var username = String(process.argv[2] || "").trim().toLowerCase();

if (!REDIS_URL || !REDIS_TOKEN) {
  console.error("Missing Upstash credentials. From the project root run:");
  console.error("  vercel env pull .env.local");
  process.exit(1);
}
if (!/^[a-z0-9_-]{2,32}$/.test(username)) {
  console.error("Usage: node scripts/add-user.js <username>");
  console.error("Username: 2-32 characters, lowercase letters, digits, - or _.");
  process.exit(1);
}

function askPassword(cb) {
  if (!process.stdin.isTTY) {          // piped in
    var buf = "";
    process.stdin.on("data", function (d) { buf += d; });
    process.stdin.on("end", function () { cb(buf.trim()); });
    return;
  }
  var rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  var prompt = "Password for " + username + ": ";
  rl._writeToOutput = function (s) { rl.output.write(s.indexOf(prompt) === 0 ? prompt : "*"); };
  rl.question(prompt, function (answer) {
    rl.close();
    process.stdout.write("\n");
    cb(answer);
  });
}

askPassword(function (password) {
  if (!password || password.length < 8) {
    console.error("Password must be at least 8 characters.");
    process.exit(1);
  }
  var salt = crypto.randomBytes(16).toString("hex");
  var hash = crypto.scryptSync(password, salt, 64).toString("hex");
  fetch(REDIS_URL + "/set/innertable:user:" + username, {
    method: "POST",
    headers: { Authorization: "Bearer " + REDIS_TOKEN },
    body: JSON.stringify({ salt: salt, hash: hash })
  }).then(function (r) {
    if (!r.ok) { console.error("Upstash write failed: HTTP " + r.status); process.exit(1); }
    console.log('User "' + username + '" is ready. Sign in with that name on any device.');
  }).catch(function (e) { console.error("Could not reach Upstash: " + e.message); process.exit(1); });
});
