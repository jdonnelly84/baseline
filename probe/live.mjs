import { chromium } from 'playwright-core';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await browser.newContext({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36' });
const page = await ctx.newPage();
const LIVE = 'https://app.atptour.com/api/v2/gateway/livematches/website?scoringTournamentLevel=tour';
for (let i = 0; i < 3; i++) {
  const r = await page.goto(LIVE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  const t = await page.evaluate(() => document.body ? document.body.innerText.slice(0, 70) : '');
  console.log('chrome goto', r.status(), JSON.stringify(t));
  await page.waitForTimeout(20000);
}
await page.goto('https://www.atptour.com/en/-/tournaments/calendar/tour', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3000);
console.log('fetch from atptour page', await page.evaluate(async (u) => { try { const r = await fetch(u, { credentials: 'omit' }); return r.status + ' ' + (await r.text()).slice(0, 50); } catch (e) { return 'err ' + e; } }, LIVE));
await browser.close();
