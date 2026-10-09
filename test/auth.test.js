/* The sync gate. These profiles are intimate, so the two properties worth
   proving are: only a token this server signed opens /api/sync, and the
   storage key comes from that token rather than from anything the caller
   sent - so one person's session can never address another's parts.
   The handlers are exercised for real; only Upstash is faked. */
"use strict";
var crypto = require("crypto");

process.env.UPSTASH_REDIS_REST_URL = "https://fake.upstash.io";
process.env.UPSTASH_REDIS_REST_TOKEN = "fake-redis-token";
process.env.SESSION_SECRET = "test-session-secret";

var login = require("../api/login.js");
var sync = require("../api/sync.js");
var syncImages = require("../api/sync-images.js");
var signup = require("../api/signup.js");

var calls = [];
var nextResult = null;   // what the fake Upstash returns for the next GET

function fakeFetch(url, opts) {
  calls.push({ url: String(url), opts: opts });
  return Promise.resolve({
    ok: true,
    json: function () { return Promise.resolve({ result: nextResult }); }
  });
}

function res() {
  return {
    code: 0,
    body: null,
    status: function (c) { this.code = c; return this; },
    json: function (b) { this.body = b; return this; }
  };
}

function record(password) {
  var salt = crypto.randomBytes(16).toString("hex");
  return JSON.stringify({ salt: salt, hash: crypto.scryptSync(password, salt, 64).toString("hex") });
}

function signWith(secret, payload) {
  var body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return body + "." + crypto.createHmac("sha256", secret).update(body).digest("base64url");
}

module.exports = async function (t) {
  var realFetch = globalThis.fetch;
  globalThis.fetch = fakeFetch;
  try {
    /* ---- login ---- */
    nextResult = record("correct horse");
    var ok = res();
    await login({ method: "POST", body: { username: "alice", password: "correct horse" } }, ok);
    t.eq(ok.code, 200, "right password signs in");
    t.ok(ok.body && ok.body.token, "a token comes back");
    var aliceToken = ok.body && ok.body.token;

    nextResult = record("correct horse");
    var bad = res();
    await login({ method: "POST", body: { username: "alice", password: "wrong" } }, bad);
    t.eq(bad.code, 401, "wrong password is refused");
    t.ok(!(bad.body && bad.body.token), "and hands out no token");

    nextResult = null;   // Upstash has no such user
    var nobody = res();
    await login({ method: "POST", body: { username: "ghost", password: "whatever" } }, nobody);
    t.eq(nobody.code, 401, "unknown user is refused");

    /* ---- signing yourself up ---- */
    nextResult = null;               // name is free
    calls.length = 0;
    var made = res();
    await signup({ method: "POST", body: { username: "newcomer", password: "eight-plus" } }, made);
    t.eq(made.code, 200, "a free name creates an account");
    t.ok(calls.length === 2 && calls[1].url.indexOf("innertable:user:newcomer") !== -1,
      "it checks the name is free, then writes it");
    t.ok(!(made.body && made.body.token), "sign-up mints no session of its own");

    /* the takeover case: signing up as someone who exists must not overwrite
       their record, or their parts would open with the new password */
    nextResult = record("their password");
    calls.length = 0;
    var taken = res();
    await signup({ method: "POST", body: { username: "alice", password: "my password" } }, taken);
    t.eq(taken.code, 409, "an existing name is refused");
    t.eq(calls.length, 1, "and nothing is written over them");

    nextResult = null;
    var weak = res();
    await signup({ method: "POST", body: { username: "newcomer", password: "short" } }, weak);
    t.eq(weak.code, 400, "a short password is refused");

    nextResult = null;
    var junk = res();
    await signup({ method: "POST", body: { username: "Not Valid!", password: "eight-plus" } }, junk);
    t.eq(junk.code, 400, "a malformed username is refused");

    /* ---- the gate ---- */
    var none = res();
    await sync({ method: "GET", headers: {} }, none);
    t.eq(none.code, 401, "no token is refused");

    var forged = res();
    await sync({ method: "GET", headers: { authorization: "Bearer " + signWith("not-the-secret", { u: "alice", exp: Date.now() + 60000 }) } }, forged);
    t.eq(forged.code, 401, "a token signed with the wrong secret is refused");

    var tampered = aliceToken.slice(0, aliceToken.indexOf(".")) + ".AAAA";
    var edited = res();
    await sync({ method: "GET", headers: { authorization: "Bearer " + tampered } }, edited);
    t.eq(edited.code, 401, "a token with a swapped signature is refused");

    var stale = res();
    await sync({ method: "GET", headers: { authorization: "Bearer " + signWith(process.env.SESSION_SECRET, { u: "alice", exp: Date.now() - 1000 }) } }, stale);
    t.eq(stale.code, 401, "an expired token is refused");

    /* ---- isolation: the key follows the token, not the request ---- */
    calls.length = 0;
    nextResult = '{"parts":{}}';
    var mine = res();
    await sync({ method: "GET", headers: { authorization: "Bearer " + aliceToken } }, mine);
    t.eq(mine.code, 200, "a valid token reads");
    t.ok(calls.length >= 1 && calls[0].url.indexOf("innertable:state:alice") !== -1,
      "alice's token reads alice's key");
    t.ok(calls.every(function (c) { return /innertable:(state|inbox):alice(\/|$)/.test(c.url); }),
      "...and nothing outside alice's own keys - her inbox of saved sessions included");

    calls.length = 0;
    var bobToken = signWith(process.env.SESSION_SECRET, { u: "bob", exp: Date.now() + 60000 });
    var bobRead = res();
    await sync({ method: "GET", headers: { authorization: "Bearer " + bobToken } }, bobRead);
    t.ok(calls[0].url.indexOf("innertable:state:bob") !== -1 &&
      calls[0].url.indexOf("alice") === -1, "bob's token cannot reach alice's key");

    /* a writer cannot aim at someone else's slot either */
    calls.length = 0;
    var write = res();
    await sync({ method: "POST", headers: { authorization: "Bearer " + bobToken }, body: { state: '{"parts":{}}', username: "alice" } }, write);
    t.eq(write.code, 200, "a valid token writes");
    t.ok(calls[0].url.indexOf("innertable:state:bob") !== -1 &&
      calls[0].url.indexOf("alice") === -1, "a username in the body cannot redirect the write");

    /* acknowledging saved sessions clears only the writer's own inbox */
    calls.length = 0;
    var acked = res();
    await sync({ method: "POST", headers: { authorization: "Bearer " + bobToken }, body: { state: '{"parts":{}}', ack: ["2026-10-09T05:00:00.000Z-ab12cd34"] } }, acked);
    t.eq(acked.code, 200, "a push can carry acknowledgements");
    t.ok(calls.some(function (c) { return /\/hdel\/innertable:inbox:bob\/2026-10-09T05/.test(c.url); }) &&
      calls.every(function (c) { return c.url.indexOf("alice") === -1; }), "...which clear bob's inbox, never anyone else's");

    /* ---- pictures: the same gate, on a key of their own ---- */
    var noToken = res();
    await syncImages({ method: "GET", headers: {} }, noToken);
    t.eq(noToken.code, 401, "pictures: no token is refused");

    var forgedImg = res();
    await syncImages({ method: "GET", headers: { authorization: "Bearer " + signWith("not-the-secret", { u: "alice", exp: Date.now() + 60000 }) } }, forgedImg);
    t.eq(forgedImg.code, 401, "pictures: a token signed with the wrong secret is refused");

    var staleImg = res();
    await syncImages({ method: "GET", headers: { authorization: "Bearer " + signWith(process.env.SESSION_SECRET, { u: "alice", exp: Date.now() - 1000 }) } }, staleImg);
    t.eq(staleImg.code, 401, "pictures: an expired token is refused");

    calls.length = 0;
    nextResult = '{"images":{}}';
    var readImg = res();
    await syncImages({ method: "GET", headers: { authorization: "Bearer " + aliceToken } }, readImg);
    t.eq(readImg.code, 200, "pictures: a valid token reads");
    t.eq(readImg.body, { images: '{"images":{}}' }, "and gets them back under `images`, not `state`");
    t.ok(calls.length === 1 && calls[0].url.indexOf("innertable:images:alice") !== -1 &&
      calls[0].url.indexOf("innertable:state:") === -1,
      "alice's token reads alice's pictures, not her profiles");

    nextResult = null;
    var emptyImg = res();
    await syncImages({ method: "GET", headers: { authorization: "Bearer " + aliceToken } }, emptyImg);
    t.eq(emptyImg.body, { images: null }, "an account with none gets null");

    calls.length = 0;
    var writeImg = res();
    await syncImages({ method: "POST", headers: { authorization: "Bearer " + bobToken }, body: { images: '{"images":{}}', username: "alice" } }, writeImg);
    t.eq(writeImg.code, 200, "pictures: a valid token writes");
    t.ok(calls[0].url.indexOf("innertable:images:bob") !== -1 && calls[0].url.indexOf("alice") === -1,
      "a username in the body cannot redirect the write");
    t.eq(calls[0].opts.body, '{"images":{}}', "and what was sent is what is stored");

    calls.length = 0;
    var missing = res();
    await syncImages({ method: "POST", headers: { authorization: "Bearer " + bobToken }, body: { state: "{}" } }, missing);
    t.eq(missing.code, 400, "pictures: a body with no `images` is refused - a profiles blob sent here by mistake is not stored");
    t.eq(calls.length, 0, "and nothing is written");

    var tooBig = res();
    await syncImages({ method: "POST", headers: { authorization: "Bearer " + bobToken }, body: { images: "x".repeat(900001) } }, tooBig);
    t.eq(tooBig.code, 413, "pictures: more than the server will take is refused with a reason");
    t.eq(calls.length, 0, "before it reaches the database");

    var wrongVerb = res();
    await syncImages({ method: "DELETE", headers: { authorization: "Bearer " + bobToken } }, wrongVerb);
    t.eq(wrongVerb.code, 405, "pictures: other methods are refused");
  } finally {
    globalThis.fetch = realFetch;
  }
};
