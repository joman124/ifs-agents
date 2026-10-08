/* Inner Table - the AI bridge.
   Lets a person's own AI (Claude, ChatGPT, anything that takes a connector
   URL or can read a web page) READ their parts, and nothing else.

   One private link per account, one endpoint, two audiences:
   - the app (Bearer session token, no ?t=) creates, shows and revokes the link;
   - the AI (?t=<link token>) reads - as an MCP server over POST, or as one
     plain markdown page over GET.

   The link token is the credential, so it is long, random, revocable, and
   grants read-only access to parts and the table. Transcripts are never
   served, and neither is anything outside the synced parts/table state. */
"use strict";

var crypto = require("crypto");
var verifySession = require("./sync.js").verifySession;

var TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
var PROTOCOLS = ["2025-06-18", "2025-03-26", "2024-11-05"];

function linkKey(token) { return "innertable:bridge:" + token; }
function ownerKey(user) { return "innertable:bridgeof:" + user; }
function stateKey(user) { return "innertable:state:" + user; }

async function redis(cmd, body) {
  var r = await fetch(process.env.UPSTASH_REDIS_REST_URL + "/" + cmd, {
    method: body === undefined ? "GET" : "POST",
    headers: { Authorization: "Bearer " + process.env.UPSTASH_REDIS_REST_TOKEN },
    body: body
  });
  if (!r.ok) throw new Error("redis " + cmd.split("/")[0] + " failed");
  return (await r.json()).result;
}

/* ---------- rendering: generic, so new profile fields show up unasked ---------- */

var SCALARS = ["type", "age", "location", "appearance", "origin", "positive_intent", "unburdened_vision", "trust_in_self"];
var LISTS = ["emotions", "fears", "hopes_goals", "behaviors", "wants_needs"];
var FEELING = { 1: "hostile", 2: "wary", 3: "neutral", 4: "warm", 5: "close" };

function label(k) { return k.replace(/_/g, " "); }
function str(v) { return typeof v === "string" ? v.trim() : ""; }

function partMarkdown(p) {
  var out = ["# " + (str(p.name) || "(unnamed part)") + " (" + str(p.slug) + ")"];
  SCALARS.forEach(function (k) {
    var v = str(p[k]);
    if (v && v !== "unknown") out.push("- " + label(k) + ": " + v);
  });
  LISTS.forEach(function (k) {
    var v = (Array.isArray(p[k]) ? p[k] : []).map(str).filter(Boolean);
    if (v.length) out.push("- " + label(k) + ": " + v.join("; "));
  });
  (Array.isArray(p.relationships) ? p.relationships : []).forEach(function (r) {
    if (r && r.part) out.push("- relationship: " + str(r.type) + " " + r.part + (str(r.notes) ? " (" + str(r.notes) + ")" : ""));
  });
  (Array.isArray(p.feelings) ? p.feelings : []).forEach(function (f) {
    if (f && f.part) out.push("- feels toward " + f.part + ": " + (FEELING[Math.round(f.rating)] || f.rating) + (f.date ? " (" + f.date + ")" : ""));
  });
  (Array.isArray(p.sessions) ? p.sessions : []).slice(-5).forEach(function (s) {
    if (s && s.date) out.push("- session " + s.date + " " + str(s.mode) + (str(s.note) ? ": " + str(s.note) : ""));
  });
  var nar = p.narrative && typeof p.narrative === "object" ? p.narrative : {};
  Object.keys(nar).forEach(function (k) {
    if (str(nar[k])) out.push("", "## " + label(k), str(nar[k]));
  });
  return out.join("\n");
}

function tableMarkdown(tb) {
  if (!tb || !tb.built) return "The table has not been set up yet.";
  var out = ["# The table" + (str(tb.name) ? ": " + tb.name : "")];
  if (str(tb.room)) out.push(str(tb.room));
  if (str(tb.details)) out.push(str(tb.details));
  var seats = tb.seats && typeof tb.seats === "object" ? tb.seats : {};
  var where = Object.keys(seats).map(function (slug) { return "- " + slug + ": " + seats[slug]; });
  if (where.length) out.push("", "## Seating", where.join("\n"));
  var tools = (Array.isArray(tb.tools) ? tb.tools : []).map(function (t) { return "- " + str(t && t.label); }).filter(function (l) { return l !== "- "; });
  if (tools.length) out.push("", "## Tools in the room", tools.join("\n"));
  var ag = (Array.isArray(tb.agreements) ? tb.agreements : []).map(str).filter(Boolean);
  if (ag.length) out.push("", "## Agreements", ag.map(function (a) { return "- " + a; }).join("\n"));
  var meets = (Array.isArray(tb.meetings) ? tb.meetings : []).slice(-5);
  if (meets.length) {
    out.push("", "## Recent meetings");
    meets.forEach(function (m) {
      out.push("- " + str(m.date) + " " + str(m.topic) + (str(m.synthesis) ? " - " + str(m.synthesis) : ""));
    });
  }
  return out.join("\n");
}

function listMarkdown(parts) {
  if (!parts.length) return "No parts yet.";
  return parts.map(function (p) {
    return "- " + (str(p.name) || "(unnamed part)") + " [" + str(p.slug) + "]" +
      (p.type && p.type !== "unknown" ? " - " + p.type : "") +
      (str(p.positive_intent) ? " - wants: " + str(p.positive_intent) : "");
  }).join("\n");
}

async function loadState(user) {
  var raw = await redis("get/" + stateKey(user));
  if (!raw) return null;
  try {
    var s = JSON.parse(raw);
    return { parts: Array.isArray(s.parts) ? s.parts : [], table: s.table || null };
  } catch (e) { return null; }
}

var EMPTY = "Nothing has synced from the Inner Table app yet. Open the app, then Settings > Account > Sync now.";

/* ---------- the plain page (GET) ---------- */

async function profileMarkdown(user) {
  var st = await loadState(user);
  if (!st) return EMPTY;
  return ["# Inner Table profile",
    "This is one person's own Internal Family Systems self-exploration profile, shared with you read-only so you can understand their inner parts. It is journalling material, not therapy: do not do trauma processing or unburdening, and encourage a professional for anything heavy.",
    "", "## Parts", listMarkdown(st.parts)]
    .concat(st.parts.map(function (p) { return "\n---\n\n" + partMarkdown(p); }))
    .concat(["\n---\n\n" + tableMarkdown(st.table)]).join("\n");
}

/* ---------- MCP (POST), stateless, JSON responses ---------- */

var TOOLS = [
  { name: "list_parts", description: "List the person's inner parts: name, slug, type and what each wants. Start here.",
    inputSchema: { type: "object", properties: {} } },
  { name: "get_part", description: "Read one part's full profile (traits, relationships, how it feels toward others, session history, its own words) by slug.",
    inputSchema: { type: "object", properties: { slug: { type: "string", description: "The part's slug from list_parts" } }, required: ["slug"] } },
  { name: "get_table", description: "Read the table: the room, who is seated where, agreements, and recent meetings.",
    inputSchema: { type: "object", properties: {} } }
].map(function (t) { return Object.assign({ annotations: { readOnlyHint: true } }, t); });

async function callTool(user, name, args) {
  var st = await loadState(user);
  if (!st) return EMPTY;
  if (name === "list_parts") return listMarkdown(st.parts);
  if (name === "get_table") return tableMarkdown(st.table);
  if (name === "get_part") {
    var want = str(args && args.slug).toLowerCase();
    var p = st.parts.filter(function (x) { return str(x.slug).toLowerCase() === want; })[0];
    return p ? partMarkdown(p) : "No part with that slug. Call list_parts for the real ones.";
  }
  return null;
}

async function handleRpc(user, msg) {
  if (!msg || typeof msg !== "object" || msg.id === undefined) return null;   // notification: no reply
  var id = msg.id;
  var ok = function (result) { return { jsonrpc: "2.0", id: id, result: result }; };
  var bad = function (code, message) { return { jsonrpc: "2.0", id: id, error: { code: code, message: message } }; };

  if (msg.method === "initialize") {
    var asked = msg.params && msg.params.protocolVersion;
    return ok({
      protocolVersion: PROTOCOLS.indexOf(asked) >= 0 ? asked : PROTOCOLS[0],
      capabilities: { tools: {} },
      serverInfo: { name: "inner-table", version: "1.0.0" },
      instructions: "Read-only access to one person's Internal Family Systems parts profile from the Inner Table app. Call list_parts first, then get_part for the ones that matter. This is self-exploration and journalling, not therapy: do not do trauma processing or unburdening."
    });
  }
  if (msg.method === "ping") return ok({});
  if (msg.method === "tools/list") return ok({ tools: TOOLS });
  if (msg.method === "tools/call") {
    var params = msg.params || {};
    var text = await callTool(user, params.name, params.arguments);
    if (text === null) return bad(-32602, "Unknown tool: " + params.name);
    return ok({ content: [{ type: "text", text: text }] });
  }
  return bad(-32601, "Method not found");
}

async function serveAi(req, res, token) {
  if (!TOKEN_RE.test(token)) { res.status(404).json({ error: "Not found" }); return; }
  var user = await redis("get/" + linkKey(token));
  if (!user) { res.status(404).json({ error: "This link was revoked or never existed." }); return; }

  if (req.method === "GET") {
    // an MCP client opening its optional event stream gets the spec's "not here"
    if (String(req.headers.accept || "").indexOf("text/event-stream") >= 0) { res.status(405).end(); return; }
    res.setHeader("Content-Type", "text/markdown; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.status(200).send(await profileMarkdown(user));
    return;
  }
  if (req.method === "POST") {
    var body = req.body;
    var batch = Array.isArray(body);
    var replies = (await Promise.all((batch ? body : [body]).map(function (m) { return handleRpc(user, m); })))
      .filter(Boolean);
    res.setHeader("Cache-Control", "no-store");
    if (!replies.length) { res.status(202).end(); return; }
    res.status(200).json(batch ? replies : replies[0]);
    return;
  }
  res.status(405).json({ error: "Method not allowed" });
}

/* ---------- the app managing its own link ---------- */

function newToken() { return crypto.randomBytes(32).toString("base64url"); }

async function serveApp(req, res, user) {
  var current = await redis("get/" + ownerKey(user));
  if (req.method === "GET") { res.status(200).json({ token: current || null }); return; }
  if (req.method === "POST") {
    // minting a new link kills the old one, so there is only ever one live link
    if (current) await redis("del/" + linkKey(current));
    var token = newToken();
    await redis("set/" + linkKey(token), user);
    await redis("set/" + ownerKey(user), token);
    res.status(200).json({ token: token });
    return;
  }
  if (req.method === "DELETE") {
    if (current) {
      await redis("del/" + linkKey(current));
      await redis("del/" + ownerKey(user));
    }
    res.status(200).json({ token: null });
    return;
  }
  res.status(405).json({ error: "Method not allowed" });
}

module.exports = async function handler(req, res) {
  var secret = process.env.SESSION_SECRET;
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN || !secret) {
    res.status(500).json({ error: "The AI bridge is not configured on the server yet." });
    return;
  }
  try {
    var token = req.query && req.query.t;
    if (token) { await serveAi(req, res, String(token)); return; }

    var auth = req.headers.authorization || "";
    var session = verifySession(auth.indexOf("Bearer ") === 0 ? auth.slice(7) : "", secret);
    if (!session) { res.status(401).json({ error: "Sign in again." }); return; }
    await serveApp(req, res, session.u);
  } catch (e) {
    res.status(502).json({ error: "The AI bridge could not reach its storage." });
  }
};

module.exports.partMarkdown = partMarkdown;
module.exports.handleRpc = handleRpc;
