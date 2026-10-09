/* A part's picture.

   A picture is the one thing in a profile that is bulky, that ends up inside
   an src attribute, and that has to survive being merged, renamed, synced and
   restored without ever being written into the text the AI sees. Each group
   below is a way that could go wrong:

   - what counts as a picture at all (a backup is hand-editable JSON)
   - merges: a model's rewrite, a markdown import and a duplicate fold may not
     lose it, and may not invent one
   - the picture's own clock, so that taking it away travels between devices
     and cannot come back from an older copy
   - sync: pictures ride their own endpoint, so they can never be the reason
     the profiles stop syncing */
"use strict";
var H = require("./harness.js");

var JPEG = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT=";
var JPEG2 = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEBLAEsAAD/2wBDAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH=";
var PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

var T1 = "2026-10-01T10:00:00.000Z";
var T2 = "2026-10-02T10:00:00.000Z";
var T3 = "2026-10-03T10:00:00.000Z";

function flush() { return new Promise(function (r) { setImmediate(r); }); }

module.exports = async function (t) {
  var base0 = H.load(["schema", "markdown"]);
  var S = base0.IFS.schema;
  var MD = base0.IFS.md;

  function part(name, over) {
    var p = S.blankPart(name);
    Object.keys(over || {}).forEach(function (k) { p[k] = over[k]; });
    return p;
  }

  /* ---------- what counts as a picture ---------- */
  t.eq(S.cleanImage(JPEG), JPEG, "a base64 JPEG is a picture");
  t.eq(S.cleanImage(PNG), PNG, "so is a PNG");
  t.eq(S.cleanImage("data:image/webp;base64,UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA=="),
    "data:image/webp;base64,UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==", "and a WebP");
  [
    ["svg", "data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9YWxlcnQoMSk+"],
    ["gif", "data:image/gif;base64,R0lGODlhAQABAAAAACw="],
    ["html", "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg=="],
    ["a web address", "https://example.com/me.jpg"],
    ["a script url", "javascript:alert(1)"],
    ["not base64", "data:image/png,hello"],
    ["an attribute breakout", JPEG + '" onerror="alert(1)'],
    ["a newline in the middle", JPEG.slice(0, 40) + "\n" + JPEG.slice(40)],
    ["a space in the middle", JPEG.slice(0, 40) + " " + JPEG.slice(40)],
    ["empty", ""],
    ["a number", 7],
    ["null", null],
    ["an object", { image: JPEG }]
  ].forEach(function (c) {
    t.eq(S.cleanImage(c[1]), "", c[0] + " is not a picture");
  });
  t.eq(S.cleanImage("data:image/jpeg;base64," + "A".repeat(S.IMAGE_MAX_CHARS)), "",
    "one over the ceiling is refused - a pasted photo cannot swell the store");
  t.eq(S.cleanImage("data:image/jpeg;base64," + "A".repeat(S.IMAGE_MAX_CHARS - 30)).length > 0, true,
    "and one under it is kept");

  /* ---------- setImage: both setting and removing are writes, with a clock ---------- */
  var p = part("The Critic");
  t.ok(S.setImage(p, JPEG, T1), "setting a picture succeeds");
  t.eq([p.image, p.image_at], [JPEG, T1], "it is stored with its stamp");

  t.ok(S.setImage(p, "", T2), "taking it away succeeds");
  t.eq([p.image, p.image_at], ["", T2], "a removal is a write too, and carries its own stamp");

  t.ok(!S.setImage(p, "javascript:alert(1)", T3), "something that is not a picture is refused");
  t.eq([p.image, p.image_at], ["", T2], "and the part is untouched by the refusal");

  var q = part("The Dreamer");
  S.setImage(q, JPEG);
  var first = q.image_at;
  S.setImage(q, "");
  S.setImage(q, JPEG2);
  t.ok(first < q.image_at, "later writes always carry later stamps, even inside one millisecond");
  q.image_at = "2099-01-01T00:00:00.000Z";    // a clock that has since stepped back
  S.setImage(q, "");
  t.ok(q.image_at > "2099-01-01T00:00:00.000Z", "a removal steps past a stamp from the future rather than tie with it");

  /* ---------- a profile may arrive without any of this ---------- */
  var old = { name: "The Old One", slug: "the-old-one" };   // saved by a build before pictures
  var merged = S.mergeParts(S.blankPart("The Old One"), S.normalizePart(old));
  t.eq([merged.image, merged.image_at], ["", ""], "a part from before pictures has none, and merges cleanly");

  var n = S.normalizePart({ name: "N", image: JPEG, image_at: T1 });
  t.eq([n.image, n.image_at], [JPEG, T1], "normalizePart keeps a good picture and its stamp");
  n = S.normalizePart({ name: "N", image: "https://evil.example/x.png", image_at: "yesterday" });
  t.eq([n.image, n.image_at], ["", ""], "and drops a bad one and a stamp that does not sort");
  t.eq(["2026-10-01T10:00:00+05:00", "2026-10-01", "Oct 1 2026", "2026-13-45T99:00:00.000Z", 12345, null].map(S.cleanStamp),
    ["", "", "", "", "", ""], "only the UTC form that sorts as time does counts as a stamp");
  n = S.normalizePart({ name: "N", image: JPEG });
  t.eq([n.image, n.image_at], [JPEG, ""], "a picture with no stamp is kept - it is just the oldest thing there is");

  /* ---------- merging ---------- */
  var base = part("The Critic");
  S.setImage(base, JPEG, T1);
  var rewrite = part("The Critic", { positive_intent: "keep us safe" });     // what a model hands back
  var m = S.mergeParts(base, rewrite);
  t.eq([m.image, m.image_at], [JPEG, T1], "a model's rewrite cannot carry a picture, so the stored one stays");
  t.eq(m.positive_intent, "keep us safe", "and the rest of the merge is unchanged");

  var theirs = part("The Critic");
  S.setImage(theirs, JPEG2, T2);
  m = S.mergeParts(base, theirs);
  t.eq([m.image, m.image_at], [JPEG2, T2], "an incoming picture wins, like every other field");

  var none = part("The Critic");
  m = S.mergeParts(none, rewrite);
  t.eq(m.image, "", "two parts with no picture still have none");

  var removed = part("The Critic");
  S.setImage(removed, "", T3);
  m = S.mergeParts(base, removed);
  t.eq(m.image, JPEG, "an empty incoming side never deletes - removal is an edit, not a merge");

  /* a duplicate fold */
  var keep = part("The Critic"), absorb = part("Critic (dup)");
  absorb.slug = "critic-dup";
  S.setImage(absorb, JPEG2, T1);
  var d = S.mergeDuplicate(keep, absorb);
  t.eq(d.image, JPEG2, "the survivor takes the other half's picture when it has none");
  t.ok(d.image_at > T1, "and that is stamped as new, not left on the old half's clock");
  S.setImage(keep, JPEG, T2);
  d = S.mergeDuplicate(keep, absorb);
  t.eq([d.image, d.image_at], [JPEG, T2], "the survivor's own picture stands");

  /* ---------- pictures are for the person, not for the model ---------- */
  var withPic = part("The Critic", { positive_intent: "keep us safe", age: "40", location: "behind the eyes", appearance: "a grey suit" });
  var withoutPic = JSON.parse(JSON.stringify(withPic));
  S.setImage(withPic, JPEG, T1);
  t.eq(S.coverageScore(withPic), S.coverageScore(withoutPic), "a picture does not make a part look more developed");
  t.eq(S.readiness(withPic).ready, S.readiness(withoutPic).ready, "or readier to speak - the model cannot see it");
  var md = MD.serialize(withPic);
  t.ok(md.indexOf("data:image") < 0 && md.indexOf("image_at") < 0, "the markdown profile has no picture in it");
  t.eq(MD.parse(md).image, "", "and a profile read back from markdown has none");

  /* ================= the store ================= */
  var env = H.load(["schema", "markdown", "store"]);
  var ST = env.IFS.store;
  ST.load();
  function add(name, img, at) {
    var x = env.IFS.schema.blankPart(name);
    if (img !== undefined) env.IFS.schema.setImage(x, img, at);
    ST.upsertPart(x);
    return x;
  }
  add("The Critic", JPEG, T1);
  add("The Dreamer");

  /* backups keep pictures; the syncing blob leaves them out */
  var full = JSON.parse(ST.exportAll());
  t.eq(full.parts["the-critic"].image, JPEG, "a backup file carries the picture");
  var lean = JSON.parse(ST.exportAll({ images: false }));
  t.ok(!("image" in lean.parts["the-critic"]) && !("image_at" in lean.parts["the-critic"]),
    "the blob that syncs does not");
  t.eq(lean.parts["the-critic"].name, "The Critic", "but is otherwise the same profile");
  t.eq(ST.getPart("the-critic").image, JPEG, "and leaving them out does not take them off the part");

  /* a restore */
  var env2 = H.load(["schema", "markdown", "store"]);
  env2.IFS.store.load();
  env2.IFS.store.importAll(ST.exportAll());
  t.eq(env2.IFS.store.getPart("the-critic").image, JPEG, "restoring a backup brings the picture back");

  /* a hand-edited backup */
  var hostile = JSON.parse(ST.exportAll());
  hostile.parts["the-critic"].image = "https://tracker.example/pixel.png";
  hostile.parts["the-dreamer"].image = "data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9YWxlcnQoMSk+";
  var env3 = H.load(["schema", "markdown", "store"]);
  env3.IFS.store.load();
  t.eq(env3.IFS.store.importAll(JSON.stringify(hostile)), 2, "a backup with bad pictures still imports its parts");
  t.eq([env3.IFS.store.getPart("the-critic").image, env3.IFS.store.getPart("the-dreamer").image], ["", ""],
    "and nothing that is not a picture is kept as one");

  /* a picture follows its part */
  var crit = ST.getPart("the-critic");
  crit.name = "The Watchman";
  ST.renamePart("the-critic", crit);
  t.eq(ST.getPart("the-watchman").image, JPEG, "a rename carries the picture");

  add("The Planner", JPEG2, T2);
  ST.absorbPart("the-watchman", "the-planner");
  t.eq([ST.getPart("the-watchman").image, ST.getPart("the-planner")], [JPEG, null],
    "absorbing a duplicate keeps the survivor's picture");
  add("Plain One");
  ST.absorbPart("plain-one", "the-watchman");
  t.eq(ST.getPart("plain-one").image, JPEG, "and a survivor without one takes the absorbed part's");

  ST.deletePart("plain-one");
  t.ok(ST.exportImages().indexOf("data:image") < 0, "a deleted part leaves no picture behind");

  /* ---------- the pictures blob: last writer wins, by the picture's own clock ---------- */
  function fresh() {
    var e = H.load(["schema", "markdown", "store"]);
    e.IFS.store.load();
    e.add = function (slug, img, at) {
      var x = e.IFS.schema.blankPart(slug);
      x.slug = slug;
      e.IFS.store.upsertPart(x);
      if (img !== undefined) { e.IFS.schema.setImage(e.IFS.store.getPart(slug), img, at); e.IFS.store.save(); }
      return e.IFS.store.getPart(slug);
    };
    return e;
  }
  function blob(entries) { return JSON.stringify({ app: "inner-table", kind: "images", version: 1, images: entries }); }

  var a = fresh();
  a.add("critic", JPEG, T1);
  var stampBefore = a.IFS.store.getPart("critic").updated;

  t.eq(a.IFS.store.importImages(blob({ critic: { image: JPEG2, at: T2 } })), 1, "a newer picture replaces an older one");
  t.eq([a.IFS.store.getPart("critic").image, a.IFS.store.getPart("critic").image_at], [JPEG2, T2], "with its stamp");
  t.eq(a.IFS.store.getPart("critic").updated, stampBefore, "travelling is not an edit - the part is no newer for it");

  t.eq(a.IFS.store.importImages(blob({ critic: { image: JPEG, at: T1 } })), 0, "an older one is ignored");
  t.eq(a.IFS.store.getPart("critic").image, JPEG2, "and changes nothing");

  t.eq(a.IFS.store.importImages(blob({ critic: { image: "", at: T3 } })), 1, "a later removal beats the picture");
  t.eq(a.IFS.store.getPart("critic").image, "", "so it is gone");
  t.eq(a.IFS.store.importImages(blob({ critic: { image: JPEG2, at: T2 } })), 0, "and the older copy cannot bring it back");
  t.eq(a.IFS.store.getPart("critic").image, "", "still gone");
  t.eq(a.IFS.store.importImages(blob({ critic: { image: JPEG, at: "2026-10-04T10:00:00.000Z" } })), 1,
    "a picture chosen after the removal is a new picture");

  var never = fresh();
  never.add("critic", undefined);
  never.IFS.store.importImages(blob({ critic: { image: JPEG, at: T1 } }));
  t.eq(never.IFS.store.getPart("critic").image, JPEG, "a part that has never had one takes the first it is offered");

  var skip = fresh();
  skip.add("critic", JPEG, T1);
  t.eq(skip.IFS.store.importImages(blob({ ghost: { image: JPEG2, at: T3 } })), 0,
    "a picture for a part this device does not have is skipped");
  t.eq(skip.IFS.store.getPart("ghost"), null, "and does not conjure the part");

  var bad = fresh();
  bad.add("critic", JPEG, T1);
  bad.IFS.store.importImages(blob({
    critic: { image: "javascript:alert(1)", at: T3 },
    other: "not even an object"
  }));
  t.eq(bad.IFS.store.getPart("critic").image, JPEG,
    "an entry that claims a picture and is not one is ignored - it is not a removal either");
  t.throws(function () { bad.IFS.store.importImages("{not json"); }, "garbage throws, so the sync caller can leave it alone");
  t.eq(bad.IFS.store.importImages(JSON.stringify({ images: null })), 0, "and a blob with no pictures is just empty");

  /* what two stores hold, compared without sending either */
  var one = fresh(), two = fresh();
  one.add("critic", JPEG, T1);
  two.add("critic");
  t.ok(one.IFS.store.imageFingerprint() !== two.IFS.store.imageFingerprint(), "a store with a picture differs from one without");
  two.IFS.store.importImages(one.IFS.store.exportImages());
  t.eq(two.IFS.store.imageFingerprint(), one.IFS.store.imageFingerprint(), "and agrees once it has been given it");
  t.eq(two.IFS.store.imageFingerprint(one.IFS.store.exportImages()), one.IFS.store.imageFingerprint(),
    "a blob and the store it came from have the same fingerprint");
  var edit = one.IFS.store.getPart("critic");
  edit.age = "forty";
  one.IFS.store.upsertPart(edit);
  t.eq(one.IFS.store.imageFingerprint(), two.IFS.store.imageFingerprint(), "editing the profile's text does not change it");

  /* ================= syncing them ================= */
  /* A fake of both endpoints. Each account has its own slot for each, as the
     real ones do, and either can be made to fail. */
  function cloud() {
    var c = { state: {}, images: {}, calls: [], failImages: false, failImagesGet: false, who: null };
    c.fetch = function (url, opts) {
      url = String(url);
      var post = !!(opts && opts.method === "POST");
      c.calls.push({ url: url, post: post, body: post ? opts.body : null, who: c.who });
      var res = function (obj, ok) { return Promise.resolve({ ok: ok !== false, json: function () { return Promise.resolve(obj); } }); };
      if (url.indexOf("/api/sync-images") === 0) {
        if (post ? c.failImages : c.failImagesGet) return res({}, false);
        if (post) { c.images[c.who] = JSON.parse(opts.body).images; return res({ ok: true }); }
        return res({ images: c.images[c.who] || null });
      }
      if (post) { c.state[c.who] = JSON.parse(opts.body).state; return res({ ok: true }); }
      return res({ state: c.state[c.who] || null });
    };
    c.device = function (who) {
      var e = H.load(["schema", "markdown", "store", "auth", "sync"], { fetch: c.fetch });
      e.storage.setItem("innertable.session", JSON.stringify({ token: "t", username: who, exp: Date.now() + 60000 }));
      e.IFS.store.load(who);
      var dev = { env: e, ST: e.IFS.store, SY: e.IFS.sync, S: e.IFS.schema };
      dev.on = function () { c.who = who; return dev; };
      dev.settle = async function () { c.who = who; e.clock.tick(5000); await flush(); await flush(); return dev; };
      dev.pull = async function () { c.who = who; await dev.SY.pull(); return dev.settle(); };
      dev.add = function (slug, img, at) {
        var x = e.IFS.schema.blankPart(slug); x.slug = slug;
        if (img !== undefined) e.IFS.schema.setImage(x, img, at);
        e.IFS.store.upsertPart(x);
        return x;
      };
      // what has been sent to `what` (an endpoint) since call number `since`
      dev.posts = function (what, since) {
        return c.calls.slice(since || 0).filter(function (k) {
          return k.post && k.who === who && (what === "/api/sync" ? k.url === "/api/sync" : k.url === what);
        });
      };
      return dev;
    };
    return c;
  }

  var cl = cloud();
  var phone = cl.device("john");
  phone.on();
  phone.add("critic", JPEG, T1);
  await phone.pull();                       // an empty server: seeded from here
  var statePosts = phone.posts("/api/sync");
  var imagePosts = phone.posts("/api/sync-images");
  t.ok(statePosts.length >= 1, "the profiles are sent");
  t.ok(statePosts.every(function (k) { return k.body.indexOf("data:image") < 0; }),
    "and not one of those requests has a picture in it");
  t.eq(imagePosts.length, 1, "the pictures go on their own endpoint, once");
  t.ok(JSON.parse(JSON.parse(imagePosts[0].body).images).images.critic.image === JPEG, "carrying the picture");

  /* a profile edit does not resend them */
  var e1 = phone.ST.getPart("critic");
  e1.age = "forty";
  phone.ST.upsertPart(e1);
  await phone.settle();
  t.eq(phone.posts("/api/sync-images").length, 1, "editing text does not upload the photos again");
  t.ok(phone.posts("/api/sync").length > statePosts.length, "though the edit itself is sent");

  /* a second device */
  var laptop = cl.device("john");
  var mark = cl.calls.length;
  laptop.on();
  await laptop.pull();
  t.eq(laptop.ST.getPart("critic").image, JPEG, "another device gets the picture on its first pull");
  t.eq(laptop.posts("/api/sync-images", mark).length, 0, "and has nothing of its own to send back");

  /* taking it away on one device reaches the other, and stays gone */
  phone.on();
  var r1 = phone.ST.getPart("critic");
  phone.S.setImage(r1, "");
  phone.ST.upsertPart(r1);
  await phone.settle();
  t.eq(JSON.parse(cl.images.john).images.critic.image, "", "the removal is on the server as an entry of its own");
  await laptop.pull();
  t.eq(laptop.ST.getPart("critic").image, "", "the other device loses it too");
  laptop.on();
  var e2 = laptop.ST.getPart("critic");
  e2.age = "forty-one";
  laptop.ST.upsertPart(e2);
  await laptop.settle();
  await phone.pull();
  t.eq(phone.ST.getPart("critic").image, "", "and an unrelated edit from there does not bring it back");

  /* the server's pictures cannot be asked: the profiles carry on */
  var cl2 = cloud();
  cl2.failImagesGet = true;
  var tab = cl2.device("mary");
  tab.on();
  tab.add("critic", JPEG, T1);
  await tab.pull();
  t.eq(tab.posts("/api/sync-images").length, 0, "if the server's pictures cannot be read, none are written over them");
  t.ok(tab.posts("/api/sync").length >= 1, "and the profiles sync regardless");

  var cl3 = cloud();
  cl3.failImages = true;
  var desk = cl3.device("ann");
  desk.on();
  desk.add("critic", JPEG, T1);
  await desk.pull();
  var before = desk.posts("/api/sync").length;
  var ed = desk.ST.getPart("critic");
  ed.age = "forty";
  desk.ST.upsertPart(ed);
  await desk.settle();
  t.ok(desk.posts("/api/sync").length > before, "pictures that will not upload do not stop an edit syncing");
  cl3.failImages = false;
  await desk.settle();
  var ed2 = desk.ST.getPart("critic");
  ed2.age = "forty-two";
  desk.ST.upsertPart(ed2);
  await desk.settle();
  t.ok(cl3.images.ann && cl3.images.ann.indexOf("data:image") > 0,
    "and they are tried again at the next push, once the server will take them");

  /* an older client's state - no pictures at all - cannot wipe what a newer one holds */
  var cl4 = cloud();
  var newer = cl4.device("kim");
  newer.on();
  newer.add("critic", JPEG, T1);
  await newer.pull();
  var st = JSON.parse(cl4.state.kim);
  Object.keys(st.parts).forEach(function (k) {
    delete st.parts[k].image; delete st.parts[k].image_at;
    st.parts[k].updated = "2099-01-01T00:00:00.000Z";
  });
  cl4.state.kim = JSON.stringify(st);
  await newer.pull();
  t.eq(newer.ST.getPart("critic").image, JPEG, "state pushed by a build that knows nothing of pictures leaves them alone");

  /* One browser, two accounts, one after the other: the first account's
     pictures must not be on screen, or in any request, once the second signs
     in. (Sign-out leaves the first account's data on the device on purpose;
     what keeps it from the next person is that stores and server slots are
     keyed by account.) */
  var cl5 = cloud();
  var shared = H.load(["schema", "markdown", "store", "auth", "sync"], { fetch: cl5.fetch });
  function signIn(who) {
    shared.storage.setItem("innertable.session", JSON.stringify({ token: "t." + who, username: who, exp: Date.now() + 60000 }));
    cl5.who = who;
    shared.IFS.store.switchOwner(who);
  }
  async function settle() { shared.clock.tick(5000); await flush(); await flush(); }
  shared.IFS.store.load(null);
  signIn("alice");
  var ap = shared.IFS.schema.blankPart("The Critic");
  shared.IFS.schema.setImage(ap, JPEG, T1);
  shared.IFS.store.upsertPart(ap);
  await shared.IFS.sync.pull();
  await settle();
  t.ok(cl5.images.alice && cl5.images.alice.indexOf("data:image") > 0, "the first account's picture is on its own slot");

  shared.IFS.auth.logout();
  shared.IFS.sync.reset();
  shared.IFS.store.switchOwner(null);
  cl5.calls.length = 0;
  signIn("bob");
  await shared.IFS.sync.pull();
  await settle();
  t.eq(shared.IFS.store.listParts().length, 0, "the second account opens onto none of the first's parts");
  t.ok(cl5.calls.every(function (k) { return !k.post || (k.body || "").indexOf("data:image") < 0; }),
    "and nothing it sends carries the first account's picture");
  t.ok(!cl5.images.bob, "so the second account's picture slot stays empty");

  /* ================= the meeting room's photo ================= */
  /* The room is one thing, so it has one photo, kept on the table object under
     the same two fields a part uses and travelling in the same pictures blob -
     as a field of its own, so no part can collide with it. */
  var rm = H.load(["schema", "markdown", "store"]);
  var RS = rm.IFS.schema, RST = rm.IFS.store;
  RST.load();
  RST.saveTable({ built: true, name: "The Round Room", room: "A circular room with one low window." });
  t.eq([RST.state.table.image, RST.state.table.image_at], ["", ""], "a room starts with no photo");
  t.eq(JSON.parse(RST.exportImages()).room, undefined, "and says nothing about one in the pictures blob");

  t.ok(RS.setImage(RST.state.table, JPEG, T1), "the same setter takes the room's photo");
  RST.saveTable({});
  t.eq(JSON.parse(RST.exportAll()).table.image, JPEG, "a backup carries it");
  var bare = JSON.parse(RST.exportAll({ images: false })).table;
  t.ok(!("image" in bare) && !("image_at" in bare), "the blob that syncs does not");
  t.eq(bare.name, "The Round Room", "but is otherwise the same room");
  t.eq(RST.state.table.image, JPEG, "and leaving it out takes nothing off the room");
  t.eq(JSON.parse(RST.exportImages()).room, { image: JPEG, at: T1 }, "the pictures blob carries it as a field of its own");

  /* last writer wins, by its own clock - and removal is a write */
  function roomBlob(entry, parts) { return JSON.stringify({ app: "inner-table", kind: "images", version: 1, images: parts || {}, room: entry }); }
  t.eq(RST.importImages(roomBlob({ image: JPEG2, at: T2 })), 1, "a newer room photo replaces an older one");
  t.eq([RST.state.table.image, RST.state.table.image_at], [JPEG2, T2], "with its stamp");
  t.eq(RST.importImages(roomBlob({ image: JPEG, at: T1 })), 0, "an older one is ignored");
  t.eq(RST.importImages(roomBlob({ image: "", at: T3 })), 1, "a later removal beats the photo");
  t.eq(RST.state.table.image, "", "so it is gone");
  t.eq(RST.importImages(roomBlob({ image: JPEG2, at: T2 })), 0, "and the older copy cannot bring it back");
  t.eq(RST.importImages(roomBlob({ image: "javascript:alert(1)", at: "2026-10-05T10:00:00.000Z" })), 0,
    "an entry that claims a photo and is not one is ignored - it is not a removal either");
  t.eq(RST.importImages(roomBlob(null)), 0, "a blob with no room entry leaves the room alone");

  var plain = H.load(["schema", "markdown", "store"]);
  plain.IFS.store.load();
  plain.IFS.store.saveTable({ built: true, room: "A room." });
  t.eq(plain.IFS.store.importImages(roomBlob({ image: JPEG, at: T1 })), 1, "a room that never had a photo takes the first it is offered");

  /* nothing about the room's photo disturbs a part's, whatever the part is called */
  var both = H.load(["schema", "markdown", "store"]);
  both.IFS.store.load();
  both.IFS.store.saveTable({ built: true, room: "A room." });
  var namedRoom = both.IFS.schema.blankPart("Room");
  both.IFS.schema.setImage(namedRoom, JPEG, T1);
  both.IFS.store.upsertPart(namedRoom);
  both.IFS.schema.setImage(both.IFS.store.state.table, JPEG2, T2);
  both.IFS.store.saveTable({});
  var blobBoth = JSON.parse(both.IFS.store.exportImages());
  t.eq([blobBoth.images.room.image, blobBoth.room.image], [JPEG, JPEG2], "a part called Room and the room each keep their own photo");

  /* the fingerprint covers it, so a change is worth sending and a text edit is not */
  var fa = H.load(["schema", "markdown", "store"]), fb = H.load(["schema", "markdown", "store"]);
  [fa, fb].forEach(function (e) { e.IFS.store.load(); e.IFS.store.saveTable({ built: true, room: "A room." }); });
  fa.IFS.schema.setImage(fa.IFS.store.state.table, JPEG, T1);
  fa.IFS.store.saveTable({});
  t.ok(fa.IFS.store.imageFingerprint() !== fb.IFS.store.imageFingerprint(), "a store with a room photo differs from one without");
  fb.IFS.store.importImages(fa.IFS.store.exportImages());
  t.eq(fb.IFS.store.imageFingerprint(), fa.IFS.store.imageFingerprint(), "and agrees once it has been given it");
  t.eq(fb.IFS.store.imageFingerprint(fa.IFS.store.exportImages()), fa.IFS.store.imageFingerprint(),
    "a blob and the store it came from have the same fingerprint");
  fa.IFS.store.saveTable({ agreements: ["only the part holding the stick speaks"] });
  t.eq(fa.IFS.store.imageFingerprint(), fb.IFS.store.imageFingerprint(), "editing the room's words does not change it");

  /* restoring: a file that has a photo brings it back, one that has none never takes ours away */
  var restored = H.load(["schema", "markdown", "store"]);
  restored.IFS.store.load();
  restored.IFS.store.importAll(RST.exportAll());
  var withPhoto = H.load(["schema", "markdown", "store"]);
  withPhoto.IFS.store.load();
  withPhoto.IFS.store.saveTable({ built: true, room: "A room." });
  withPhoto.IFS.schema.setImage(withPhoto.IFS.store.state.table, JPEG, T1);
  withPhoto.IFS.store.saveTable({});
  var restoreFrom = H.load(["schema", "markdown", "store"]);
  restoreFrom.IFS.store.load();
  restoreFrom.IFS.store.saveTable({ built: true, room: "A room." });
  restoreFrom.IFS.schema.setImage(restoreFrom.IFS.store.state.table, JPEG2, T2);
  restoreFrom.IFS.store.saveTable({});
  withPhoto.IFS.store.importAll(restoreFrom.IFS.store.exportAll());
  t.eq(withPhoto.IFS.store.state.table.image, JPEG2, "restoring a backup brings its room photo back");
  var noPhotoFile = H.load(["schema", "markdown", "store"]);
  noPhotoFile.IFS.store.load();
  noPhotoFile.IFS.store.saveTable({ built: true, room: "A room." });
  withPhoto.IFS.store.importAll(noPhotoFile.IFS.store.exportAll());
  t.eq(withPhoto.IFS.store.state.table.image, JPEG2, "and a backup with none does not take it away");

  var viaTable = H.load(["schema", "markdown", "store"]);
  viaTable.IFS.store.load();
  viaTable.IFS.store.importTable(restoreFrom.IFS.store.exportTable());
  t.eq(viaTable.IFS.store.state.table.image, JPEG2, "an exported table file carries the photo too");

  var hostileRoom = JSON.parse(restoreFrom.IFS.store.exportAll());
  hostileRoom.table.image = "https://tracker.example/pixel.png";
  var hr = H.load(["schema", "markdown", "store"]);
  hr.IFS.store.load();
  hr.IFS.store.importAll(JSON.stringify(hostileRoom));
  t.eq([hr.IFS.store.state.table.image, hr.IFS.store.state.table.room], ["", "A room."],
    "a hand-edited backup's bad room photo is dropped and the rest of the room still comes in");

  /* the AI never sees it: the prompts name the room's fields, they do not dump it */
  var pr = H.load(["schema", "markdown", "questions", "reference", "templates"]);
  var seated = pr.IFS.schema.blankPart("The Critic");
  seated.positive_intent = "keep us safe";
  var tbl = { built: true, name: "The Round Room", room: "A circular room.", details: "", seats: { "the-critic": "table" },
    tools: [], agreements: [], image: JPEG, image_at: T1 };
  var promptText = pr.IFS.templates.meeting([seated, pr.IFS.schema.blankPart("The Dreamer")], "Should I go?", tbl) +
    pr.IFS.templates.portable("meeting", [seated], "Should I go?", tbl);
  t.ok(promptText.indexOf("data:image") < 0 && promptText.indexOf(JPEG.slice(30, 60)) < 0, "a meeting prompt has no photo in it");
  t.ok(promptText.indexOf("A circular room.") >= 0, "though it still describes the room in words");

  /* syncing it: the pictures endpoint, never the profile blob */
  var cl6 = cloud();
  var rdev = cl6.device("rae");
  rdev.on();
  rdev.ST.saveTable({ built: true, name: "The Round Room", room: "A circular room." });
  rdev.S.setImage(rdev.ST.state.table, JPEG, T1);
  rdev.ST.saveTable({});
  await rdev.pull();
  var rState = rdev.posts("/api/sync"), rImgs = rdev.posts("/api/sync-images");
  t.ok(rState.length >= 1 && rState.every(function (k) { return k.body.indexOf("data:image") < 0; }),
    "the room's photo is in none of the profile pushes");
  t.eq(rImgs.length, 1, "it goes up once, on the pictures endpoint");
  t.eq(JSON.parse(JSON.parse(rImgs[0].body).images).room.image, JPEG, "as the room entry");

  var rdev2 = cl6.device("rae");
  rdev2.on();
  await rdev2.pull();
  t.eq(rdev2.ST.state.table.image, JPEG, "another device gets the room's photo on its first pull");

  rdev.on();
  rdev.S.setImage(rdev.ST.state.table, "");
  rdev.ST.saveTable({});
  await rdev.settle();
  await rdev2.pull();
  t.eq(rdev2.ST.state.table.image, "", "taking it away reaches the other device");
  rdev2.on();
  rdev2.ST.saveTable({ agreements: ["anyone can call a break"] });
  await rdev2.settle();
  await rdev.pull();
  t.eq(rdev.ST.state.table.image, "", "and an edit to the room's words from there does not bring it back");
};
