// Extra tests for the parts app.test.mjs doesn't reach: install card, player bar, 30-day bin cleanup,
// update banner, mic picker, record clock. Run: node tests/extra.test.mjs
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
  catch (e) { failed++; console.log("  FAIL " + name + "\n       " + e.message.split("\n")[0]); }
}

const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined,
  args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"] });
const errors = [];
async function fresh(ua = ANDROID) {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 800 }, hasTouch: true, permissions: ["microphone"], userAgent: ua });
  const page = await ctx.newPage();
  page.on("pageerror", e => errors.push(e.message));
  await page.goto(URL0);
  await page.click("#welOk");
  return { ctx, page };
}
async function record(page, ms) {
  await page.waitForTimeout(450);
  await page.click("#recBtn");
  await page.waitForFunction(() => document.body.classList.contains("recording"));
  await page.waitForTimeout(ms);
  await page.click("#recBtn");
  await page.waitForFunction(() => !document.body.classList.contains("recording"));
  await page.waitForSelector("#fresh:not([hidden])");
}

// ---------- install card ----------
await test("Android: install card appears when Chrome offers it, Install calls the prompt", async () => {
  const { ctx, page } = await fresh();
  assert(await page.isHidden("#inst"), "card shown before Chrome offered install");
  await page.evaluate(() => {
    window.__prompted = 0;
    const e = new Event("beforeinstallprompt");
    e.prompt = () => { window.__prompted++; }; e.userChoice = Promise.resolve({ outcome: "accepted" });
    window.dispatchEvent(e);
  });
  assert(await page.isVisible("#inst"), "card not shown");
  assert(await page.isVisible("#instAndroid") && await page.isHidden("#instIos"), "wrong card variant");
  await page.click("#instBtn");
  await page.waitForFunction(() => window.__prompted === 1);
  await page.waitForFunction(() => document.getElementById("inst").hidden);
  await ctx.close();
});

await test("Android: 'Later' hides the card and it stays hidden after a reload (7 days)", async () => {
  const { ctx, page } = await fresh();
  const offer = () => page.evaluate(() => { const e = new Event("beforeinstallprompt"); e.prompt = () => {}; e.userChoice = Promise.resolve({}); window.dispatchEvent(e); });
  await offer();
  await page.click("#instAndroid >> text=/later/i").catch(() => page.click("#instLater"));
  assert(await page.isHidden("#inst"), "still showing after Later");
  await page.reload(); await offer();
  assert(await page.isHidden("#inst"), "came back the same day");
  // 8 days later it may ask again
  await page.evaluate(() => localStorage.setItem("simple-recorder-inst-later", String(Date.now() - 8 * 864e5)));
  await page.reload(); await offer();
  assert(await page.isVisible("#inst"), "never asks again after 7 days");
  await ctx.close();
});

await test("iPhone: shows the Add to Home Screen card, not the Android button", async () => {
  const { ctx, page } = await fresh(IPHONE);
  assert(await page.isVisible("#inst"), "no card on iPhone");
  assert(await page.isVisible("#instIos") && await page.isHidden("#instAndroid"), "wrong card variant");
  await page.click("#instLater2");
  assert(await page.isHidden("#inst"), "Later didn't hide it");
  await ctx.close();
});

// ---------- recording clock, player bar ----------
const { ctx: main, page } = await fresh();
await test("the clock counts up while recording", async () => {
  await page.waitForTimeout(450);
  await page.click("#recBtn");
  await page.waitForFunction(() => document.body.classList.contains("recording"));
  const a = await page.textContent("#clock");
  await page.waitForTimeout(2200);
  const b = await page.textContent("#clock");
  await page.click("#recBtn");
  await page.waitForFunction(() => !document.body.classList.contains("recording"));
  assert(a !== b && /0:0[2-3]/.test(b), `clock ${a} → ${b}`);
});

await test("player bar: name, time and position move while playing", async () => {
  await record(page, 2500);
  await record(page, 3500);
  await page.click("#rows .row >> nth=0 >> .play");
  await page.waitForSelector("#player:not([hidden])");
  await page.waitForTimeout(1300);
  const name = await page.textContent("#pName"), t = await page.textContent("#pTime"), s = +(await page.inputValue("#pSeek"));
  assert(name.trim().length > 0, "no name in player");
  assert(t !== "0:00" && s > 0, `time ${t}, seek ${s}`);
});

await test("player bar: Next goes to the next take, Previous restarts then goes back", async () => {
  const id = () => page.evaluate(() => cur && cur.id);
  const L = await page.evaluate(() => live().map(t => t.id));
  assert(await id() === L[0], "not on first");
  await page.click("#pNext"); await page.waitForTimeout(300);
  assert(await id() === L[1], "Next didn't move on");
  await page.click("#pPrev"); await page.waitForTimeout(300);
  assert(await id() === L[0], "Previous didn't go back");
  await page.waitForTimeout(3200);   // past 3 s: Previous should restart this take, not change take
  await page.evaluate(() => { const a = document.getElementById("audio"); if (a.duration > 3.2) a.currentTime = 3.2; });
  if (await page.evaluate(() => document.getElementById("audio").currentTime > 3)) {
    await page.click("#pPrev"); await page.waitForTimeout(200);
    assert(await id() === L[0] && await page.evaluate(() => document.getElementById("audio").currentTime < 1), "Previous past 3 s didn't restart");
  }
});

await test("player bar: Next on the last take stops playback", async () => {
  await page.click("#rows .row >> nth=-1 >> .play");
  await page.waitForSelector("#player:not([hidden])");
  await page.click("#pNext");
  await page.waitForFunction(() => document.getElementById("player").hidden);
});

await test("player bar: pause/play and dragging the seek bar", async () => {
  await page.click("#rows .row >> nth=1 >> .play");
  await page.waitForSelector("#player:not([hidden])");
  await page.waitForFunction(() => { const a = document.getElementById("audio"); return a.duration > 0 && a.currentTime > 0.2 && !a.paused; });
  await page.click("#pPlay");
  assert(await page.evaluate(() => document.getElementById("audio").paused), "didn't pause");
  await page.$eval("#pSeek", el => { el.value = 600; el.dispatchEvent(new Event("input")); el.dispatchEvent(new Event("change")); });
  const r = await page.evaluate(() => { const a = document.getElementById("audio"); return a.currentTime / a.duration; });
  assert(r > 0.5 && r < 0.7, "seek landed at " + r.toFixed(2));
  await page.click("#pPlay");
  assert(!(await page.evaluate(() => document.getElementById("audio").paused)), "didn't resume");
  await page.click("#pPlay");
});

// ---------- mic picker ----------
await test("Settings lists the mics and remembers the one picked", async () => {
  await page.click("#setBtn");
  await page.waitForSelector("#setDlg[open]");
  const opts = await page.$$eval("#inSel option", o => o.map(x => x.value));
  assert(opts[0] === "auto" && opts.length >= 2, "options: " + opts.join(","));
  const hint = await page.textContent("#inHint");
  assert(/USB/.test(hint), "hint still asks for permission: " + hint);
  await page.selectOption("#inSel", opts[1]);
  await page.click("#setDone");
  await page.reload(); await page.waitForSelector("#rows .row");
  await page.click("#setBtn");
  await page.waitForSelector("#setDlg[open]");
  assert(await page.inputValue("#inSel") === opts[1], "pick not remembered");
  await page.selectOption("#inSel", "auto");
  await page.click("#setDone");
});

await test("Settings can't be opened mid-take", async () => {
  await page.waitForTimeout(450);
  await page.click("#recBtn");
  await page.waitForFunction(() => document.body.classList.contains("recording"));
  await page.click("#setBtn", { force: true }).catch(() => {});
  const open = await page.evaluate(() => document.getElementById("setDlg").open);
  await page.waitForTimeout(1200);
  await page.click("#recBtn");
  await page.waitForFunction(() => !document.body.classList.contains("recording"));
  assert(!open, "settings opened while recording");
});

// ---------- bin cleanup ----------
await test("deleted takes older than 30 days are removed for good; newer ones stay", async () => {
  await page.click("#rows .row >> nth=0 >> [aria-label=Delete]");
  await page.click("#rows .row >> nth=0 >> [aria-label=Delete]");
  await page.waitForTimeout(300);
  const ids = await page.evaluate(() => binned().map(t => t.id));
  assert(ids.length >= 2, "bin has " + ids.length);
  // back-date one to 31 days ago, one to 29 days
  await page.evaluate(async ([a, b]) => {
    await updateMeta(a, { deleted: Date.now() - 31 * 864e5 });
    await updateMeta(b, { deleted: Date.now() - 29 * 864e5 });
  }, ids);
  await page.reload(); await page.waitForTimeout(800);
  const after = await page.evaluate(() => ({ bin: binned().map(t => t.id), blobs: [...blobs.keys()] }));
  assert(!after.bin.includes(ids[0]) && !after.blobs.includes(ids[0]), "31-day-old take still kept");
  assert(after.bin.includes(ids[1]), "29-day-old take was removed");
  const stored = await page.evaluate(id => new Promise(r => { const q = indexedDB.open("simple-recorder"); q.onsuccess = () => {
    const g = q.result.transaction("audio").objectStore("audio").get(id); g.onsuccess = () => r(!!g.result); }; }), ids[0]);
  assert(!stored, "sound of the 31-day-old take is still on the phone");
});

// ---------- update banner ----------
await test("update banner: tapping it mid-take refuses; after STOP it reloads", async () => {
  await page.evaluate(() => updBanner());
  assert(await page.isVisible("#updB"), "banner missing");
  await page.waitForTimeout(450);
  await page.click("#recBtn");
  await page.waitForFunction(() => document.body.classList.contains("recording"));
  await page.evaluate(() => { window.__mark = 1; document.getElementById("updB").click(); });
  await page.waitForTimeout(400);
  assert(await page.evaluate(() => window.__mark === 1 && document.body.classList.contains("recording")), "reloaded mid-take");
  assert(/Stop recording first/.test(await page.textContent("#askDlg")), "no 'stop first' message");
  await page.click("#askYes");
  await page.waitForTimeout(1200);
  await page.click("#recBtn");
  await page.waitForFunction(() => !document.body.classList.contains("recording") && session === null);
  await Promise.all([page.waitForEvent("load"), page.evaluate(() => document.getElementById("updB").click())]);
  assert(await page.evaluate(() => window.__mark === undefined), "didn't reload");
});

await test("manifest and service worker list files that exist", async () => {
  const sw = fs.readFileSync(path.join(ROOT, "sw.js"), "utf8");
  const shell = JSON.parse(sw.match(/SHELL = (\[.*?\]);/)[1].replace(/"/g, '"'));
  const missing = shell.filter(u => u !== "./" && !fs.existsSync(path.join(ROOT, u.split("?")[0])));
  const man = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.webmanifest"), "utf8"));
  missing.push(...man.icons.map(i => i.src.split("?")[0]).filter(f => !fs.existsSync(path.join(ROOT, f))));
  assert(!missing.length, "missing: " + missing.join(", "));
});

await test("no page errors", async () => { assert(!errors.length, errors.join("; ")); });

await main.close(); await browser.close(); server.close();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
