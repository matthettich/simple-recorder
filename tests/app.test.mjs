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
const server = http.createServer((req, res) => {
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
    navigator.canShare = d => !!(d && d.files);
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
  await page.click("#recBtn");
  await page.waitForFunction(() => document.body.classList.contains("recording"));
  // the fake mic beeps once a second, so watch for the meter to move at any point
  const moved = await page.waitForFunction(() => parseFloat(document.getElementById("lvl").style.width) > 0, null, { timeout: 4000 }).then(() => true, () => false);
  assert(moved, "meter never moved");
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
    const t = takes[0], b = new DataView(await t.blob.slice(0, 44).arrayBuffer());
    const tag = String.fromCharCode(...new Uint8Array(await t.blob.slice(0, 4).arrayBuffer()));
    return { tag, type: t.type, ch: b.getUint16(22, true), sr: b.getUint32(24, true), bits: b.getUint16(34, true), data: b.getUint32(40, true), size: t.blob.size, dur: t.dur };
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
  const bits = await page.evaluate(async () => new DataView(await takes[0].blob.slice(0, 44).arrayBuffer()).getUint16(34, true));
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

await test("no page errors", async () => { assert(!errors.length, errors.join("; ")); });

await page.screenshot({ path: process.env.SHOT || path.join(ROOT, "tests", "shot.png"), fullPage: false });
await browser.close(); server.close();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
