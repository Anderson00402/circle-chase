#!/usr/bin/env node
// Headless screenshot helper for checking pages while developing.
//   node scripts/shot.mjs <path> [out.png] [--w 1440] [--h 900] [--wait 1500] [--keys "Enter,ArrowLeft"] [--full]
// Prints page errors and console errors. The dev server must be running on :5173.
import { chromium } from 'playwright';
const [path = '/', out = '.shots/shot.png', ...rest] = process.argv.slice(2);
const opt = (name, def) => { const i = rest.indexOf('--' + name); return i >= 0 ? rest[i + 1] : def; };
const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: +opt('w', 1440), height: +opt('h', 900) }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE ERROR:', m.text().slice(0, 300)); });
await page.goto('http://localhost:5173' + path, { waitUntil: 'networkidle' }).catch((e) => console.log('NAV:', e.message));
for (const key of (opt('keys', '') || '').split(',').filter(Boolean)) { await page.keyboard.press(key); await page.waitForTimeout(250); }
await page.waitForTimeout(+opt('wait', 1500));
await page.screenshot({ path: out, fullPage: rest.includes('--full') });
console.log('saved', out);
await browser.close();
