// One-off check: can a real Chrome on GitHub's servers read atptour.com? A few requests, 3 s apart.
import { chromium } from 'playwright-core';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await browser.newContext({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36', locale: 'en-NZ' });
const page = await ctx.newPage();
const resp = await page.goto('https://www.atptour.com/en/-/tournaments/calendar/tour', { waitUntil: 'domcontentloaded', timeout: 60000 });
console.log('calendar', resp.status(), JSON.stringify(await page.title()), (await page.evaluate(() => document.body.innerText.slice(0, 80))));
await page.waitForTimeout(8000);
console.log('after wait', JSON.stringify(await page.title()), page.url());
for (const u of ['/en/rankings/singles?rankRange=1-200', '/en/scores/current/nitto-atp-finals/605/results']) {
  await page.waitForTimeout(3000);
  const r = await page.evaluate(async (u) => { const r = await fetch(u); const t = await r.text(); return { s: r.status, len: t.length, ch: /Just a moment/.test(t) }; }, u);
  console.log(u, JSON.stringify(r));
}
await browser.close();
