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
const ctx = await browser.newContext({ viewport: { width: 375, height: 800 }, hasTouch: true, permissions: ["microphone"] });
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
    window.__shared = null;
    navigator.canShare = d => !!(d && d.files);
    navigator.share = async d => { window.__shared = { n: d.files.length, name: d.files[0].name, type: d.files[0].type, size: d.files[0].size, title: d.title }; };
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
  const s = await page.evaluate(() => window.__shared);
  assert(s && s.n === 1 && s.size > 1000, "shared " + JSON.stringify(s));
  assert(/\.(m4a|webm|ogg)$/.test(s.name), "file name " + s.name);
  console.log("       shared " + s.name + " (" + s.type + ", " + s.size + " bytes)");
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

await test("no page errors", async () => { assert(!errors.length, errors.join("; ")); });

await page.screenshot({ path: process.env.SHOT || path.join(ROOT, "tests", "shot.png"), fullPage: false });
await browser.close(); server.close();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
