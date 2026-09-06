import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import { execFileSync } from 'child_process';

const DIR = 'c:/!Ahn/Corporation/##. 기획/05. 매출가능사업구상/01. SNS 채널운영(AI 제작)/00. 콘텐츠 제작 자동화/02. A Creative Studio/11. 스튜디오 로고';
const HTML = path.join(DIR, '여리로고_애니메이션_3D.html');
const OUT = 'C:/Users/user/AppData/Local/Temp/claude/C--yubi-director-app-api-claude/5843a2bf-7e08-4aa3-acac-46ce951dde7c/scratchpad';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const FFMPEG = 'C:/Users/user/AppData/Local/Microsoft/WinGet/Packages/Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe/ffmpeg-8.1.1-full_build/bin/ffmpeg.exe';
const FPS = 30, DUR = 12.4, N = Math.round(FPS * DUR);
const mode = process.argv[2] || 'full';

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  args: ['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--enable-webgl','--ignore-gpu-blocklist','--force-color-profile=srgb'],
});
const page = await browser.newPage();
page.on('pageerror', e => console.log('ERR:', e.message));
page.on('console', m => { if (m.type()==='error') console.log('CERR:', m.text()); });
await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
await page.goto(pathToFileURL(HTML).href, { waitUntil: 'networkidle0' });
await page.waitForFunction('window.__ready === true', { timeout: 30000 });
await new Promise(r => setTimeout(r, 500));

async function shot(t, p){ await page.evaluate(x=>window.renderFrame(x), t); await page.screenshot({ path:p, clip:{x:0,y:0,width:1920,height:1080} }); }

if (mode === 'strip') {
  const times = JSON.parse(process.argv[3]); const tag = process.argv[4]||'s3d';
  const d = OUT+'/_s'; fs.rmSync(d,{recursive:true,force:true}); fs.mkdirSync(d);
  for (let i=0;i<times.length;i++) await shot(times[i], path.join(d,`s${String(i).padStart(2,'0')}.png`));
  await browser.close();
  execFileSync(FFMPEG,['-y','-i',path.join(d,'s%02d.png'),'-vf',`scale=470:-1,tile=${times.length}x1`,'-frames:v','1','-update','1',`${OUT}/_${tag}.png`],{stdio:'inherit'});
  console.log('strip', tag);
} else {
  const d = OUT+'/_f3'; fs.rmSync(d,{recursive:true,force:true}); fs.mkdirSync(d);
  const t0=Date.now();
  for (let i=0;i<N;i++){ await shot(i/FPS, path.join(d,`f${String(i).padStart(5,'0')}.png`));
    if(i%40===0) console.log(`  ${i}/${N}  ${((Date.now()-t0)/1000).toFixed(0)}s`); }
  await browser.close();
  const O = path.join(DIR, '여리로고_오프닝_리빌_3D.mp4');
  execFileSync(FFMPEG,['-y','-framerate',String(FPS),'-i',path.join(d,'f%05d.png'),'-c:v','libx264','-pix_fmt','yuv420p','-crf','16','-preset','slow','-movflags','+faststart',O],{stdio:'inherit'});
  console.log('wrote', O);
  const secs=[0.8,2.0,3.0,3.6,4.4,5.1,5.9,6.8,7.7,8.1,8.7,9.5,10.6,11.6,12.2];
  const md=d+'_m'; fs.rmSync(md,{recursive:true,force:true}); fs.mkdirSync(md);
  secs.forEach((s,i)=>{const fr=Math.min(Math.round(s*FPS),N-1);fs.copyFileSync(path.join(d,`f${String(fr).padStart(5,'0')}.png`),path.join(md,`m${String(i).padStart(2,'0')}.png`));});
  execFileSync(FFMPEG,['-y','-i',path.join(md,'m%02d.png'),'-vf','scale=490:-1,tile=5x3','-frames:v','1','-update','1',`${OUT}/_r3d_montage.png`],{stdio:'inherit'});
  console.log('montage done');
}
