import puppeteer from 'puppeteer-core';
import path from 'path';
import { pathToFileURL } from 'url';

const HTML = 'C:/Users/user/AppData/Local/Temp/claude/C--yubi-director-app-api-claude/5843a2bf-7e08-4aa3-acac-46ce951dde7c/scratchpad/webgl_test.html';
const OUT = 'C:/Users/user/AppData/Local/Temp/claude/C--yubi-director-app-api-claude/5843a2bf-7e08-4aa3-acac-46ce951dde7c/scratchpad/_wgltest.png';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  args: ['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--enable-webgl','--ignore-gpu-blocklist','--force-color-profile=srgb'],
});
const page = await browser.newPage();
page.on('console', m => console.log('PAGE:', m.text()));
page.on('pageerror', e => console.log('ERR:', e.message));
await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
await page.goto(pathToFileURL(HTML).href, { waitUntil: 'networkidle0' });
try { await page.waitForFunction('window.__ready === true', { timeout: 20000 }); }
catch(e){ console.log('TIMEOUT waiting __ready'); }
const info = await page.evaluate(() => window.__info || null);
console.log('INFO:', JSON.stringify(info));
await page.screenshot({ path: OUT });
await browser.close();
console.log('shot ->', OUT);
