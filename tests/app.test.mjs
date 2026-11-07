// Simple recorder browser tests: a phone-sized Chromium with a fake microphone (a test tone).
// Run:  npm i -D playwright && npx playwright install chromium   (once)
//       node tests/app.test.mjs
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

let chromium;
try { ({ chromium } = await import("playwright")); }
catch { ({ chromium } = await import(process.env.PLAYWRIGHT_PATH || "/opt/npm-tools/node_modules/playwright/index.mjs")); }

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".webmanifest": "application/manifest+json", ".png": "image/png", ".svg": "image/svg+xml" };
let hang = false;   // when true the server never answers: a phone with one bar of signal
let broken = false; // when true the server answers every request with a 503: the host is having a bad day
const server = http.createServer((req, res) => {
  if (hang) return;
  if (broken) { res.writeHead(503); return res.end("down"); }
  const p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  const f = path.join(ROOT, p === "/" ? "index.html" : p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "content-type": TYPES[path.extname(f)] || "application/octet-stream" });
  fs.createReadStream(f).pipe(res);
});
await new Promise(r => server.listen(0, "127.0.0.1", r));
const URL0 = `http://127.0.0.1:${server.address().port}/`;

let passed = 0, failed = 0;
const assert = (c, m) => { if (!c) throw new Error(m); };
async function test(name, fn) {
  try { await fn(); passed++; console.log("  ok  " + name); }
  catch (e) { failed++; console.log("  FAIL " + name + "\n       " + e.message); }
}

const browser = await chromium.launch({ args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"] });
const ctx = await browser.newContext({ viewport: { width: 375, height: 800 }, hasTouch: true, permissions: ["microphone"],
  userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36" });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", e => errors.push(e.message));
await page.goto(URL0);

// Fake share sheet so "Email" can be checked
await page.evaluate(() => {
  window.__shared = null;
  navigator.canShare = d => !!(d && d.files);
  navigator.share = async d => { window.__shared = { n: d.files.length, name: d.files[0].name, type: d.files[0].type, size: d.files[0].size, title: d.title }; };
});

async function record(ms) {
  await page.waitForTimeout(450);   // REC is ignored for 0.4 s after STOP (double-tap guard)
  await page.click("#recBtn");
  await page.waitForFunction(() => document.body.classList.contains("recording"));
  await page.waitForTimeout(ms);
  await page.click("#recBtn");
  await page.waitForFunction(() => !document.body.classList.contains("recording"));
  await page.waitForSelector("#fresh:not([hidden])");
}

await test("welcome shows once", async () => {
  assert(await page.isVisible("#welcome"), "welcome open");
  await page.click("#welOk");
  await page.reload();
  assert(!(await page.isVisible("#welcome")), "not shown again");
  await page.evaluate(() => {
    window.__shared = null; window.__refuse = false;
    const OK = ["audio/x-m4a", "audio/webm", "audio/wav", "audio/ogg", "audio/mp3", "audio/mpeg", "audio/flac"];
    // Like Android Chrome: canShare() already says no to a file type it won't share
    const allowed = f => OK.includes(f.type) && !(window.__refuse && !/wav/.test(f.type));
    navigator.canShare = d => !!(d && d.files) && allowed(d.files[0]);
    navigator.share = async d => {
      const f = d.files[0];
      if (!OK.includes(f.type) || (window.__refuse && !/wav/.test(f.type))) throw new DOMException("Permission denied", "NotAllowedError");
      window.__shared = { n: d.files.length, name: f.name, type: f.type, size: f.size, title: d.title };
    };
  });
});

await test("starts empty", async () => {
  assert(await page.isVisible("text=No recordings yet"), "empty message");
});

await test("records and saves a take", async () => {
  await record(2200);
  const n = await page.locator("#rows .row").count();
  assert(n === 1, "one row, got " + n);
  const len = await page.textContent("#freshLen");
  assert(/^0:0[2-3]$/.test(len), "length " + len);
});

await test("level meter moved during recording", async () => {
  await page.waitForTimeout(450);
  await page.click("#recBtn");
  await page.waitForFunction(() => document.body.classList.contains("recording"));
  // the fake mic beeps once a second, so watch for the meter to move at any point
  const moved = await page.waitForFunction(() => parseFloat(document.getElementById("lvl").style.width) > 0, null, { timeout: 4000 }).then(() => true, () => false);
  assert(moved, "meter never moved");
  await page.waitForTimeout(800);   // taps within 0.7 s of REC are ignored (double-tap guard)
  await page.click("#recBtn");
  await page.waitForFunction(() => !document.body.classList.contains("recording"));
  await page.waitForSelector("#fresh:not([hidden])");
});

await test("newest take is first and plays", async () => {
  const names = await page.$$eval("#rows .t", e => e.map(x => x.textContent));
  assert(names.length === 2, "two takes");
  await page.click("#fPlay");
  await page.waitForSelector("#player:not([hidden])");
  await page.waitForFunction(() => !document.getElementById("audio").paused);
  assert(await page.$eval("#rows .row", r => r.classList.contains("on")), "first row marked playing");
});

await test("email hands the file to the share sheet", async () => {
  await page.click("#fMail");
  await page.waitForFunction(() => window.__shared);
  const s = await page.evaluate(() => window.__shared);
  assert(s && s.n === 1 && s.size > 1000, "shared " + JSON.stringify(s));
  assert(/\.(m4a|weba|ogg)$/.test(s.name), "file name " + s.name);
  console.log("       shared " + s.name + " (" + s.type + ", " + s.size + " bytes)");
});

await test("a phone that refuses the file gets a WAV after one more tap", async () => {
  await page.evaluate(() => { window.__shared = null; window.__refuse = true; });
  await page.click("#fMail");
  await page.waitForSelector("#askDlg[open]");
  assert((await page.textContent("#askMsg")).includes("ready to email"), "ready message");
  await page.click("#askYes");
  await page.waitForFunction(() => window.__shared);
  const s = await page.evaluate(() => window.__shared);
  assert(s.type === "audio/wav" && /\.wav$/.test(s.name) && s.size > 44, "wav " + JSON.stringify(s));
  await page.evaluate(() => { window.__shared = null; window.__refuse = false; localStorage.removeItem("simple-recorder-share-wav"); });
});

await test("waveforms are drawn", async () => {
  await page.waitForFunction(() => [...document.querySelectorAll("#rows .mini")].length === 2);
  const lit = await page.evaluate(() => {
    const cv = document.getElementById("freshWave"), c = cv.getContext("2d"), d = c.getImageData(0, 0, cv.width, cv.height).data;
    let ink = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) ink++;
    return ink;
  });
  assert(lit > 50, "big waveform drawn: " + lit);
  const peaks = await page.evaluate(async () => { const r = await new Promise(res => { const q = indexedDB.open("simple-recorder"); q.onsuccess = () => { const g = q.result.transaction("takes").objectStore("takes").getAll(); g.onsuccess = () => res(g.result); }; }); return r.map(t => t.peaks ? t.peaks.length : 0); });
  assert(peaks.every(n => n === 800), "peaks saved " + peaks);
});

await test("rename", async () => {
  page.once("dialog", () => {});
  await page.click("#rows .row >> nth=0 >> [aria-label=Rename]");
  await page.fill("#askInput", "Blues in E");
  await page.click("#askYes");
  await page.waitForFunction(() => document.querySelector("#rows .t").textContent === "Blues in E");
});

await test("delete then undo", async () => {
  await page.click("#rows .row >> nth=0 >> [aria-label=Delete]");
  await page.waitForFunction(() => document.querySelectorAll("#rows .row").length === 1);
  assert(await page.isVisible("#undo"), "undo bar");
  await page.click("#undoBtn");
  await page.waitForFunction(() => document.querySelectorAll("#rows .row").length === 2);
  assert((await page.textContent("#rows .t")) === "Blues in E", "same take back on top");
});

await test("deleted takes survive a reload and can be restored", async () => {
  await page.click("#rows .row >> nth=1 >> [aria-label=Delete]");
  await page.waitForFunction(() => document.querySelectorAll("#rows .row").length === 1);
  await page.reload();
  await page.waitForSelector("#rows .row");
  assert(await page.locator("#rows .row").count() === 1, "one after reload");
  await page.click("#binBtn");
  assert(await page.isVisible("#bin"), "bin open");
  await page.click("#binRows >> text=Restore");
  await page.waitForFunction(() => document.querySelectorAll("#rows .row").length === 2);
});

await test("recordings are stored as real audio", async () => {
  const d = await page.evaluate(async () => {
    const a = document.getElementById("audio");
    return new Promise(res => { a.onloadedmetadata = () => res(a.duration); document.querySelector("#rows .play").click(); });
  });
  assert(d > 0.3, "duration " + d);
});

await test("settings: WAV 24-bit records a real 24-bit WAV and emails it as WAV", async () => {
  await page.evaluate(() => {
    navigator.canShare = d => !!(d && d.files);
    navigator.share = async d => { const f = d.files[0]; window.__shared = { n: d.files.length, name: f.name, type: f.type, size: f.size }; };
  });
  await page.click("#setBtn");
  await page.waitForSelector("#setDlg[open]");
  assert(await page.locator("#fmtList .opt").count() === 3, "three formats");
  assert(await page.locator("#inSel option").count() >= 2, "Automatic plus the fake mic");
  await page.click("#fmtList .opt >> text=WAV · 24-bit");
  await page.click("#setDone");
  assert((await page.textContent("#src")).startsWith("WAV · 24-bit"), "source line " + await page.textContent("#src"));
  await record(2000);
  const h = await page.evaluate(async () => {
    const t = takes[0], blob = blobs.get(t.id), b = new DataView(await blob.slice(0, 44).arrayBuffer());
    const tag = String.fromCharCode(...new Uint8Array(await blob.slice(0, 4).arrayBuffer()));
    return { tag, type: t.type, ch: b.getUint16(22, true), sr: b.getUint32(24, true), bits: b.getUint16(34, true), data: b.getUint32(40, true), size: blob.size, dur: t.dur };
  });
  assert(h.tag === "RIFF" && h.type === "audio/wav" && h.bits === 24, "header " + JSON.stringify(h));
  assert(h.data === h.size - 44, "data length matches " + JSON.stringify(h));
  assert(h.data / (h.ch * 3 * h.sr) > 1.5, "about 2 seconds of audio " + JSON.stringify(h));
  console.log("       " + JSON.stringify(h));
  await page.evaluate(() => { window.__shared = null; });
  await page.click("#fMail");
  await page.waitForFunction(() => window.__shared);
  const s = await page.evaluate(() => window.__shared);
  assert(s.type === "audio/wav" && /\.wav$/.test(s.name), "shared " + JSON.stringify(s));
});

await test("settings are kept", async () => {
  await page.reload();
  assert((await page.textContent("#src")).startsWith("WAV · 24-bit"), "kept");
  await page.click("#setBtn");
  await page.click("#fmtList .opt >> text=WAV · 16-bit");
  await page.click("#setDone");
  await record(1200);
  const bits = await page.evaluate(async () => new DataView(await blobs.get(takes[0].id).slice(0, 44).arrayBuffer()).getUint16(34, true));
  assert(bits === 16, "16-bit " + bits);
});

await test("plays only the pressed recording unless Play the next is on", async () => {
  const ended = async () => page.evaluate(() => { const a = document.getElementById("audio"); a.dispatchEvent(new Event("ended")); return cur && cur.id; });
  const first = await page.evaluate(() => live()[0].id);
  await page.click("#rows .row >> nth=0 >> .play");
  await page.waitForFunction(() => !document.getElementById("audio").paused);
  let id = await ended();
  assert(id === first, "stayed on the same take");
  await page.click("#setBtn");
  assert(!(await page.isChecked("#autoNext")), "off by default");
  await page.check("#autoNext");
  await page.click("#setDone");
  id = await ended();
  const second = await page.evaluate(() => live()[1].id);
  assert(id === second, "moved to the next take");
  await page.evaluate(() => { const s = JSON.parse(localStorage.getItem("simple-recorder-settings")); if (!s.autoplay) throw 0; });
});

await test("Download shows only on a computer, and saves the file as recorded", async () => {
  assert(!(await page.isVisible("#fSave")), "no Download on a phone");
  assert(await page.locator("#rows .row >> nth=0 >> [aria-label=Download]").count() === 0, "no row Download on a phone");
  const desk = await browser.newContext({ viewport: { width: 1280, height: 900 }, permissions: ["microphone"], acceptDownloads: true });
  const dp = await desk.newPage();
  await dp.goto(URL0);
  await dp.evaluate(() => { localStorage.setItem("simple-recorder-welcomed", "1"); localStorage.setItem("simple-recorder-settings", JSON.stringify({ format: "wav24", input: "auto" })); });
  await dp.reload();
  await dp.click("#recBtn"); await dp.waitForFunction(() => document.body.classList.contains("recording"));
  await dp.waitForTimeout(1200); await dp.click("#recBtn");
  await dp.waitForSelector("#fresh:not([hidden])");
  assert(await dp.isVisible("#fSave"), "Download on a computer");
  const [dl] = await Promise.all([dp.waitForEvent("download"), dp.click("#fSave")]);
  assert(/\.wav$/.test(dl.suggestedFilename()), "file name " + dl.suggestedFilename());
  console.log("       downloaded " + dl.suggestedFilename());
  assert(await dp.locator("#rows .row >> nth=0 >> [aria-label=Download]").count() === 1, "row Download on a computer");
  await desk.close();
});

/* ---------- robustness: each of these was a real bug ---------- */
const waitIdle = () => page.waitForFunction(() => !session && !document.body.classList.contains("recording"), null, { timeout: 15000 });
const useFormat = f => page.evaluate(f => { stopPlay(); settings.format = f; saveSettings(); showSource(); }, f);
const noDialog = async () => { if (await page.isVisible("#askDlg")) throw new Error("unexpected dialog: " + await page.textContent("#askMsg")); };
const liveCount = () => page.evaluate(() => live().length);

await test("a double-tap on REC doesn't stop the take it just started", async () => {
  await useFormat("m4a");
  await page.waitForTimeout(450);
  await page.evaluate(async () => { $("recBtn").click(); await new Promise(r => setTimeout(r, 180)); $("recBtn").click(); });
  await page.waitForTimeout(1300);
  assert(await page.evaluate(() => recording()), "still recording after a double-tap");
  await page.click("#recBtn"); await waitIdle();
  await noDialog();
});

for (const f of ["wav24", "m4a"]) await test(`STOP then REC straight away: the next take still records (${f})`, async () => {
  await useFormat(f);
  const before = await liveCount();
  await page.waitForTimeout(450);
  await page.click("#recBtn"); await page.waitForFunction(() => recording());
  await page.waitForTimeout(1200);
  // STOP, then keep tapping REC every 100 ms until a new take starts (the old app killed it and blamed the format)
  await page.evaluate(async () => {
    $("recBtn").click();
    for (let i = 0; i < 60 && !recording(); i++) { await new Promise(r => setTimeout(r, 100)); if (!session || session.state !== "recording") $("recBtn").click(); }
  });
  assert(await page.evaluate(() => recording()), "second take recording");
  await page.waitForTimeout(1500);
  await noDialog();
  await page.click("#recBtn"); await waitIdle();
  await noDialog();
  assert(await liveCount() === before + 2, "two new takes, got " + (await liveCount() - before));
  const sizes = await page.evaluate(() => live().slice(0, 2).map(t => blobs.get(t.id).size));
  assert(sizes.every(s => s > 1000), "both have sound " + sizes);
});

await test("the screen lock is let go even when STOP comes before the phone grants it", async () => {
  await useFormat("m4a");
  await page.evaluate(() => {
    window.__lock = null;
    Object.defineProperty(navigator, "wakeLock", { configurable: true, value: { request: () => new Promise(r => setTimeout(() => {
      window.__lock = { released: false, release() { this.released = true; return Promise.resolve(); } }; r(window.__lock); }, 1500)) } });
  });
  await page.waitForTimeout(450);
  await page.click("#recBtn"); await page.waitForFunction(() => recording());
  await page.waitForTimeout(800);
  await page.click("#recBtn"); await waitIdle();
  await page.waitForFunction(() => window.__lock, null, { timeout: 4000 });
  assert(await page.evaluate(() => window.__lock.released), "lock released");
});

await test("a mic that goes away mid-take (unplugged, a call) finishes and keeps the take (WAV)", async () => {
  await useFormat("wav24");
  const before = await liveCount();
  await page.waitForTimeout(450);
  await page.click("#recBtn"); await page.waitForFunction(() => recording());
  await page.waitForTimeout(1500);
  await page.evaluate(() => session.stream.getAudioTracks()[0].dispatchEvent(new Event("ended")));
  await waitIdle();
  assert(await liveCount() === before + 1, "take kept");
  await noDialog();
});

for (const f of ["wav16", "m4a"]) await test(`a take cut off by the app dying is rescued next time (${f})`, async () => {
  await useFormat(f);
  const before = await liveCount();
  await page.waitForTimeout(450);
  await page.click("#recBtn"); await page.waitForFunction(() => recording());
  await page.waitForTimeout(3200);
  // Simulate a crash: nothing gets to run on the way out
  await page.evaluate(() => { session.stop = () => {}; });
  await page.reload();
  await page.waitForSelector("#askDlg[open]");
  assert((await page.textContent("#askMsg")).includes("rescued"), "rescue message");
  await page.click("#askYes");
  await page.waitForFunction(n => live().length === n + 1, before);
  const r = await page.evaluate(async () => {
    const t = live()[0], b = blobs.get(t.id), a = document.getElementById("audio");
    const d = await new Promise(res => { a.onloadedmetadata = () => res(a.duration); a.onerror = () => res(-1); playTake(t); });
    stopPlay();
    return { name: t.name, size: b.size, type: t.type, d, pending: (await getAll(PEND)).length, parts: (await getAll(PARTS)).length };
  });
  assert(/rescued/.test(r.name), "name " + r.name);
  assert(r.pending === 0 && r.parts === 0, "leftovers cleared " + JSON.stringify(r));
  assert(r.d === Infinity || r.d > 1.5, "playable with sound " + JSON.stringify(r));
  console.log("       " + JSON.stringify(r));
});

await test("a take the phone can't store goes to Downloads instead of being lost", async () => {
  await useFormat("m4a");
  await page.evaluate(() => {
    window.__put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (v, k) { if (this.name === "audio") throw new DOMException("Quota exceeded", "QuotaExceededError"); return window.__put.call(this, v, k); };
  });
  try {
    await page.waitForTimeout(450);
    await page.click("#recBtn"); await page.waitForFunction(() => recording());
    await page.waitForTimeout(1200);
    const [dl] = await Promise.all([page.waitForEvent("download"), page.click("#recBtn")]);
    await page.waitForSelector("#askDlg[open]");
    assert((await page.textContent("#askMsg")).includes("Downloads"), "says where it went");
    assert(/\.(weba|webm|m4a)$/.test(dl.suggestedFilename()), "file " + dl.suggestedFilename());
    await page.click("#askYes");
  } finally {
    // Put storage back even if a step above failed, so the later tests aren't broken by this one
    await page.evaluate(() => { if (window.__put) IDBObjectStore.prototype.put = window.__put; });
  }
});

await test("Bluetooth earbuds are never taken for a USB mic", async () => {
  const r = await page.evaluate(() => ["Bluetooth headset", "Galaxy Buds2 Pro (Bluetooth)", "Hands-Free BT", "USB-Audio - AT2020USB+", "Blue Yeti", "Scarlett 2i2 USB", "Headset earpiece"]
    .map(l => [l, isUsbMic({ label: l, deviceId: "x" })]));
  const want = [false, false, false, true, true, true, false];
  assert(r.every(([, v], i) => v === want[i]), JSON.stringify(r));
});

await test("deleting for good while its waveform is being made doesn't bring it back", async () => {
  const back = await page.evaluate(async () => {
    const t = live()[0];
    await setDeleted(t, Date.now()); render();
    await new Promise(r => setTimeout(r, 300));
    t.peaks = null; t.peakFail = false;
    const orig = decode; window.decode = async (b, r) => { await new Promise(x => setTimeout(x, 800)); return orig(b, r); };
    fillPeaks();
    await new Promise(r => setTimeout(r, 100));
    await killTake(t.id); takes = takes.filter(x => x !== t); blobs.delete(t.id);
    await new Promise(r => setTimeout(r, 1500));
    window.decode = orig;
    return (await getAll(META)).some(x => x.id === t.id) || (await getAll(AUDIO)).some(x => x.id === t.id);
  });
  assert(!back, "it came back");
});

await test("an expired tap gets one more tap and sends the same file, not a WAV", async () => {
  await page.evaluate(() => {
    window.__shared = null; let n = 0;
    navigator.canShare = d => !!(d && d.files);
    navigator.share = async d => { if (n++ === 0) throw new DOMException("Must be handling a user gesture", "NotAllowedError"); window.__shared = { type: d.files[0].type, name: d.files[0].name }; };
  });
  const t = await page.evaluate(() => { const t = live().find(t => !/wav/.test(t.type)); return t && t.id; });
  assert(t, "need a compressed take");
  await page.evaluate(id => { emailTake(takes.find(t => t.id === id)); }, t);
  await page.waitForSelector("#askDlg[open]");
  assert((await page.textContent("#askMsg")).includes("ready to email"), "asks for a tap");
  await page.click("#askYes");
  await page.waitForFunction(() => window.__shared);
  const s = await page.evaluate(() => window.__shared);
  assert(!/wav/.test(s.type), "same kind of file " + JSON.stringify(s));
  assert(await page.evaluate(() => localStorage.getItem("simple-recorder-share-wav") === null), "nothing sticks");
});

await test("emailing a take clears its 'not emailed yet' mark", async () => {
  const r = await page.evaluate(async () => {
    const t = live().find(t => !t.sent); if (!t) return "none";
    navigator.share = async () => {};
    const row = () => document.querySelector(`#rows .row[data-id="${t.id}"] .s`).textContent;
    const before = row(); await emailTake(t); const after = row();
    return { before, after, saved: (await getAll(META)).find(x => x.id === t.id).sent > 0 };
  });
  assert(r.before.includes("not emailed") && !r.after.includes("not emailed") && r.saved, JSON.stringify(r));
});

await test("dialogs wait their turn instead of breaking each other", async () => {
  await page.evaluate(() => { window.__d = []; tell("first").then(v => __d.push(["first", v])); tell("second").then(v => __d.push(["second", v])); });
  await page.waitForSelector("#askDlg[open]");
  assert((await page.textContent("#askMsg")) === "first", "first shows first");
  await page.click("#askYes");
  await page.waitForFunction(() => document.getElementById("askDlg").open && $("askMsg").textContent === "second");
  await page.click("#askYes");
  await page.waitForFunction(() => __d.length === 2);
  assert(JSON.stringify(await page.evaluate(() => __d)) === '[["first",true],["second",true]]', "both answered");
});

await test("undo brings back several deletes, and the just-recorded box", async () => {
  await useFormat("m4a");
  await record(1200);
  const n = await liveCount();
  await page.click("#fDel");
  await page.click("#rows .row >> nth=0 >> [aria-label=Delete]");
  await page.waitForFunction(k => live().length === k - 2, n);
  assert((await page.textContent("#undoMsg")).startsWith("2 "), "says two");
  await page.click("#undoBtn");
  await page.waitForFunction(k => live().length === k, n);
  assert(await page.isVisible("#fresh"), "just-recorded box back");
});

await test("tapping the big waveform plays from that point", async () => {
  await page.click("#freshWave", { position: { x: 200, y: 50 } });
  await page.waitForFunction(() => !document.getElementById("audio").paused && cur && cur.id === freshId);
  await page.evaluate(() => stopPlay());
});

await test("the compressed format is labelled with what the phone really makes", async () => {
  const r = await page.evaluate(() => ({ type: pickType(), label: FORMATS.m4a.label }));
  assert(/mp4a/.test(r.type) === /AAC/.test(r.label) && (/webm/.test(r.type) ? /WebM/.test(r.label) : true), JSON.stringify(r));
  console.log("       " + JSON.stringify(r));
});

await test("two takes with the same name get different file names", async () => {
  const names = await page.evaluate(async () => {
    const L = live().slice(0, 2);
    for (const t of L) { await updateMeta(t.id, { name: "Song" }); t.name = "Song"; }
    return L.map(t => shareName(t)).sort();
  });
  assert(names[0] === "Song" && names[1] === "Song (2)", JSON.stringify(names));
});

await test("recordings made before this update are moved over and still play", async () => {
  const c2 = await browser.newContext({ viewport: { width: 375, height: 800 }, permissions: ["microphone"] });
  const p2 = await c2.newPage();
  await p2.goto(URL0 + "manifest.webmanifest");
  await p2.evaluate(() => new Promise((res, rej) => {
    // the old layout: version 1, the sound inside each take
    const sr = 8000, n = sr, b = new DataView(new ArrayBuffer(44 + n * 2));
    const S = (o, s) => { for (let i = 0; i < s.length; i++) b.setUint8(o + i, s.charCodeAt(i)); };
    S(0, "RIFF"); b.setUint32(4, 36 + n * 2, true); S(8, "WAVE"); S(12, "fmt "); b.setUint32(16, 16, true); b.setUint16(20, 1, true); b.setUint16(22, 1, true);
    b.setUint32(24, sr, true); b.setUint32(28, sr * 2, true); b.setUint16(32, 2, true); b.setUint16(34, 16, true); S(36, "data"); b.setUint32(40, n * 2, true);
    for (let i = 0; i < n; i++) b.setInt16(44 + i * 2, Math.round(Math.sin(i / 8) * 8000), true);
    const r = indexedDB.open("simple-recorder", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("takes", { keyPath: "id" });
    r.onsuccess = () => { const t = r.result.transaction("takes", "readwrite");
      t.objectStore("takes").put({ id: "old1", created: Date.now() - 1000, name: "Old song", dur: 1, type: "audio/wav", blob: new Blob([b], { type: "audio/wav" }), deleted: 0, noPeaks: true });
      t.oncomplete = () => { r.result.close(); res(); }; t.onerror = () => rej(t.error); };
  }));
  await p2.goto(URL0);
  await p2.waitForSelector("#rows .row");
  const r = await p2.evaluate(async () => {
    const meta = (await getAll(META))[0];
    return { name: live()[0].name, hasBlob: blobs.get("old1") && blobs.get("old1").size, blobInMeta: "blob" in meta, peaks: !!(await new Promise(r => setTimeout(r, 800)), live()[0].peaks) };
  });
  assert(r.name === "Old song" && r.hasBlob > 44 && !r.blobInMeta, JSON.stringify(r));
  assert(r.peaks, "waveform made (old noPeaks flag dropped) " + JSON.stringify(r));
  await c2.close();
});

await test("renaming doesn't rewrite the sound", async () => {
  const r = await page.evaluate(async () => {
    let wrote = false; const orig = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (v, k) { if (this.name === "audio") wrote = true; return orig.call(this, v, k); };
    try { await updateMeta(live()[0].id, { name: "Renamed" }); }
    finally { IDBObjectStore.prototype.put = orig; }
    return wrote;
  });
  assert(!r, "audio store was written");
});

await test("with a dead connection the app still opens, from the copy on the phone", async () => {
  const c3 = await browser.newContext({ viewport: { width: 375, height: 800 }, permissions: ["microphone"] });
  const p3 = await c3.newPage();
  await p3.goto(URL0);
  await p3.waitForFunction(() => navigator.serviceWorker.controller, null, { timeout: 15000 });
  hang = true;
  const t0 = Date.now();
  try { await p3.reload({ timeout: 9000 }); await p3.waitForSelector("#recBtn", { timeout: 2000 }); }
  finally { hang = false; }
  const ms = Date.now() - t0;
  assert(ms < 5000, "opened in " + ms + " ms");
  console.log("       opened offline in " + ms + " ms");
  await c3.close();
});

await test("a server error opens the copy on the phone, not an error page", async () => {
  const c4 = await browser.newContext({ viewport: { width: 375, height: 800 }, permissions: ["microphone"] });
  const p4 = await c4.newPage();
  await p4.goto(URL0);
  await p4.waitForFunction(() => navigator.serviceWorker.controller, null, { timeout: 15000 });
  broken = true;
  try { await p4.reload({ timeout: 9000 }); await p4.waitForSelector("#recBtn", { timeout: 2000 }); }
  finally { broken = false; }
  await c4.close();
});

await test("updating clears only this app's old caches, never another app's", async () => {
  const c5 = await browser.newContext({ viewport: { width: 375, height: 800 }, permissions: ["microphone"] });
  const p5 = await c5.newPage();
  await p5.goto(URL0);
  await p5.waitForFunction(() => navigator.serviceWorker.controller, null, { timeout: 15000 });
  // An old version of this app's cache and another app's cache on the same site, then a fresh worker activates
  await p5.evaluate(async () => {
    await (await caches.open("simple-recorder-v1")).put("/old", new Response("old"));
    await (await caches.open("daily-meds-v7")).put("/x", new Response("keep me"));
    const reg = await navigator.serviceWorker.getRegistration();
    await reg.unregister();
    await navigator.serviceWorker.register("sw.js");
    await navigator.serviceWorker.ready;
  });
  await p5.waitForFunction(async () => !(await caches.keys()).includes("simple-recorder-v1"), null, { timeout: 10000, polling: 200 });
  const keys = await p5.evaluate(() => caches.keys());
  assert(keys.includes("daily-meds-v7"), "other app's cache kept " + keys);
  assert(keys.some(k => /^simple-recorder-v\d+$/.test(k)), "own cache present " + keys);
  await c5.close();
});

await test("storage reconnects after the browser closes the database", async () => {
  const r = await page.evaluate(async () => {
    const d = await db();
    d.close(); d.dispatchEvent(new Event("close"));   // what the browser does when it drops the connection
    const fresh = await db();
    const n = (await getAll(META)).length;
    return { reopened: fresh !== d, n };
  });
  assert(r.reopened && r.n >= 0, JSON.stringify(r));
});

await test("no page errors", async () => { assert(!errors.length, errors.join("; ")); });

await page.screenshot({ path: process.env.SHOT || path.join(ROOT, "tests", "shot.png"), fullPage: false });
await browser.close(); server.close();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
