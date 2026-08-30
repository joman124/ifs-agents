/* Read .env.local (what `vercel env pull` writes) so the Upstash token never
   has to be pasted into a shell. Real env vars still win. Shared by the
   admin scripts in this folder. */
"use strict";
var fs = require("fs");
var path = require("path");

module.exports = function loadEnvFile() {
  var file = path.join(__dirname, "..", ".env.local");
  if (!fs.existsSync(file)) return;
  fs.readFileSync(file, "utf8").split("\n").forEach(function (line) {
    var m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m || process.env[m[1]]) return;
    process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  });
};
