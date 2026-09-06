import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import { execFileSync } from 'child_process';

const DIR = 'c:/!Ahn/Corporation/##. 기획/05. 매출가능사업구상/01. SNS 채널운영(AI 제작)/00. 콘텐츠 제작 자동화/02. A Creative Studio/11. 스튜디오 로고';
const HTML = path.join(DIR, '여리로고_애니메이션_교차.html');
const FRAMES = 'C:/Users/user/AppData/Local/Temp/claude/C--yubi-director-app-api-claude/5843a2bf-7e08-4aa3-acac-46ce951dde7c/scratchpad/_gf';
const FPS = 30, DUR = 12.6;
const N = Math.round(FPS * DUR);
const CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  process.env.LOCALAPPDATA + '/Google/Chrome/Application/chrome.exe',
];
const CHROME = CANDIDATES.find(p => { try { return fs.existsSync(p); } catch { return false; } });
const FFMPEG = 'C:/Users/user/AppData/Local/Microsoft/WinGet/Packages/Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe/ffmpeg-8.1.1-full_build/bin/ffmpeg.exe';
if (!CHROME) throw new Error('chrome not found');
console.log('chrome:', CHROME);

fs.rmSync(FRAMES, { recursive: true, force: true });
fs.mkdirSync(FRAMES, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  args: ['--no-sandbox', '--force-color-profile=srgb', '--font-render-hinting=none'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
await page.goto(pathToFileURL(HTML).href, { waitUntil: 'networkidle0' });
await page.waitForFunction('window.__ready === true');
await new Promise(r => setTimeout(r, 500));

for (let i = 0; i < N; i++) {
  await page.evaluate(t => window.renderFrame(t), i / FPS);
  await page.screenshot({ path: path.join(FRAMES, `f${String(i).padStart(5, '0')}.png`), clip: { x: 0, y: 0, width: 1920, height: 1080 } });
}
await browser.close();

const OUT = path.join(DIR, '여리로고_오프닝_리빌_교차.mp4');
execFileSync(FFMPEG, ['-y', '-framerate', String(FPS), '-i', path.join(FRAMES, 'f%05d.png'),
  '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '16', '-preset', 'slow', '-movflags', '+faststart', OUT],
  { stdio: 'inherit' });
console.log('wrote', OUT);

// montage 검증용 12장
const pick = [0.7,2.2,3.3,4.5,5.4,6.4,7.3,8.2,9.2,9.8,11.0,12.2].map(s=>Math.round(s*FPS));
const MDIR = FRAMES + '_m';
fs.rmSync(MDIR, { recursive: true, force: true }); fs.mkdirSync(MDIR);
pick.forEach((fr,i)=> fs.copyFileSync(path.join(FRAMES,`f${String(Math.min(fr,N-1)).padStart(5,'0')}.png`), path.join(MDIR,`m${i}.png`)));
execFileSync(FFMPEG, ['-y','-i',path.join(MDIR,'m%d.png'),'-vf','scale=440:-1,tile=4x3','-frames:v','1',
  path.join(FRAMES+'_montage.png')], { stdio: 'inherit' });
console.log('montage', FRAMES+'_montage.png');
