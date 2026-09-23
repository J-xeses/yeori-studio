// 레퍼런스 영상 자동 정리 — 링크를 넣으면 영상·썸네일·메타를 받아 장면 요약 시트까지 만든다.
// 토큰 0(LLM 호출 없음): 분석이 필요하면 만들어진 시트(sheet_*.png)를 Claude 에게 보여주면 된다.
//
// 사용:
//   node scripts/ref-grab.mjs <링크> [<링크> ...] [--cat=teaser] [--note="메모"] [--force] [--scene=0.2]
//   (또는 C:\yeori-studio\ref-grab.bat 더블클릭 → 링크 붙여넣기)
// 지원: 핀터레스트 핀(kr./www.pinterest.com/pin/…, pin.it 단축링크), mp4 직링크.
//   인스타·유튜브는 로그인/차단 때문에 미지원 — 핀터레스트에 저장된 핀 링크를 쓰면 원본 출처도 같이 기록됨.
//
// 결과: downloads/_shared/references/<cat>/<id>/
//   video.mp4 · thumb.jpg · meta.json · README.md
//   sheet_overview.png  전체를 24등분한 프레임(시각 표시)
//   sheet_intro.png     첫 6초를 0.25초 간격으로(티저는 도입부가 핵심)
//   sheet_scenes.png    장면 전환(컷)마다 첫 프레임
// 그리고 <cat>/index.html(갤러리) · index.json 을 갱신한다.
import fs from 'fs'
import path from 'path'
import { spawnSync } from 'child_process'
import { DOWNLOADS } from '../server/lib/mediaPaths.js'

const args = process.argv.slice(2)
const opt = Object.fromEntries(args.filter(a => a.startsWith('--')).map(a => { const [k, ...v] = a.slice(2).split('='); return [k, v.length ? v.join('=') : true] }))
const links = args.filter(a => !a.startsWith('--'))
const CAT = String(opt.cat || 'teaser').replace(/[^\w-]/g, '')
const ROOT = path.join(DOWNLOADS, '_shared', 'references', CAT)
const FONT_DIR = 'C:/Windows/Fonts'   // drawtext 의 fontfile 경로에 드라이브 콜론을 안 쓰려고 cwd 로 지정
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128 Safari/537.36'

if (!links.length) {
  console.log('사용: node scripts/ref-grab.mjs <링크> [<링크> ...] [--cat=teaser] [--note="메모"] [--force]')
  process.exit(1)
}
fs.mkdirSync(ROOT, { recursive: true })

const run = (cmd, a, o = {}) => spawnSync(cmd, a, { encoding: 'utf-8', windowsHide: true, maxBuffer: 64 << 20, ...o })
const decode = s => String(s || '').replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
const fmt = t => `${t.toFixed(2)}s`

async function fetchText(url) {
  const r = await fetch(url, { headers: { 'user-agent': UA, 'accept-language': 'ko,en;q=0.8' }, redirect: 'follow' })
  if (!r.ok) throw new Error(`페이지 요청 실패 ${r.status}`)
  return { html: await r.text(), finalUrl: r.url }
}
async function download(url, dest) {
  const r = await fetch(url, { headers: { 'user-agent': UA } })
  if (!r.ok) throw new Error(`다운로드 실패 ${r.status}: ${url}`)
  fs.writeFileSync(dest, Buffer.from(await r.arrayBuffer()))
}

// 핀 페이지 → 메타. 영상 주소는 페이지의 video-snippet(ld+json)에서만 가져온다
// (페이지 안엔 관련 핀 영상도 섞일 수 있어서 grep 으로 아무 mp4 나 집으면 안 됨).
function parsePin(html, finalUrl) {
  const ld = {}
  for (const m of html.matchAll(/<script data-test-id="([\w-]+)" type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    try { ld[m[1]] = JSON.parse(m[2]) } catch { /* noop */ }
  }
  const meta = k => decode(html.match(new RegExp(`<meta[^>]*(?:property|name)="${k}"[^>]*content="([^"]*)"`))?.[1]
    || html.match(new RegExp(`<meta[^>]*content="([^"]*)"[^>]*(?:property|name)="${k}"`))?.[1])
  const v = ld['video-snippet'] || {}, leaf = ld['leaf-snippet'] || {}
  const stat = (arr, type) => (arr || []).find(x => String(x?.interactionType?.['@type'] || x?.interactionType || '').includes(type))?.userInteractionCount
  const id = finalUrl.match(/\/pin\/(\d+)/)?.[1] || (meta('og:url') || '').match(/--(\d+)\/?$/)?.[1] || null
  return {
    id,
    title: v.name || meta('og:title') || leaf.headline || '',
    description: v.description || meta('og:description') || '',
    author: leaf.author?.name ? `${leaf.author.name} (@${leaf.author.alternateName || ''})` : '',
    source: leaf.sharedContent?.url || meta('og:see_also') || '',
    published: v.uploadDate || leaf.datePublished || '',
    views: stat(v.interactionStatistic, 'Watch') ?? null,
    saves: stat(leaf.interactionStatistic, 'Like') ?? null,
    videoUrl: v.contentUrl || '',
    thumbUrl: v.thumbnailUrl || leaf.image || meta('og:image') || '',
    tags: (leaf.isRelatedTo || []).map(x => x.name).filter(Boolean),
  }
}

function probe(file) {
  const r = run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,width,height,r_frame_rate', '-of', 'json', file])
  const j = JSON.parse(r.stdout || '{}')
  const vs = (j.streams || []).find(s => s.codec_type === 'video') || {}
  const [n, d] = String(vs.r_frame_rate || '0/1').split('/').map(Number)
  return { duration: parseFloat(j.format?.duration || 0), width: vs.width, height: vs.height, fps: d ? Math.round(n / d * 100) / 100 : null,
           audio: (j.streams || []).some(s => s.codec_type === 'audio') }
}

// 장면 전환 시각(컷). 작게 줄인 뒤 비교해야 블러·줌 전환도 잡힌다(원본 해상도 0.3 → 28초 몽타주에서 6개만
// 잡혔음, 180px·0.2 → 21개로 실제 컷 수와 근접, 2026-09-23 실측). 너무 붙은 건(0.3s 미만) 하나로 본다.
// --scene=0.15 처럼 낮추면 더 잘게, 높이면 뚜렷한 컷만.
function scenes(file, duration) {
  const th = parseFloat(opt.scene || '0.2')
  const r = run('ffmpeg', ['-hide_banner', '-i', file, '-an', '-vf', `scale=180:-2,select='gt(scene,${th})',metadata=print`, '-f', 'null', '-'])
  const ts = [...(r.stderr || '').matchAll(/pts_time:([\d.]+)/g)].map(m => parseFloat(m[1]))
  const out = [0]
  for (const t of ts) if (t - out[out.length - 1] >= 0.3 && t < duration - 0.05) out.push(t)
  return out
}

// 지정 시각 프레임들을 시각 라벨을 박아 한 장(8열 타일)으로
function sheet(file, times, dest, width = 240) {
  const tmp = fs.mkdtempSync(path.join(path.dirname(dest), '.tmp_'))
  try {
    times.forEach((t, i) => {
      const out = path.join(tmp, `f_${String(i).padStart(3, '0')}.png`)
      run('ffmpeg', ['-y', '-loglevel', 'error', '-ss', String(t), '-i', file, '-frames:v', '1', '-vf',
        `scale=${width}:-2,drawtext=fontfile=arialbd.ttf:text='${fmt(t)}':x=6:y=6:fontsize=${Math.round(width / 12)}:fontcolor=white:box=1:boxcolor=black@0.6:boxborderw=4`,
        out], { cwd: FONT_DIR })
    })
    const n = fs.readdirSync(tmp).length
    if (!n) return false
    const cols = Math.min(8, n), rows = Math.ceil(n / cols)
    run('ffmpeg', ['-y', '-loglevel', 'error', '-i', path.join(tmp, 'f_%03d.png'), '-vf', `tile=${cols}x${rows}:padding=4:color=0x222222`, '-frames:v', '1', dest])
    return fs.existsSync(dest)
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}

function readIndex() { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'index.json'), 'utf-8')) } catch { return [] } }
function writeIndex(list) {
  fs.writeFileSync(path.join(ROOT, 'index.json'), JSON.stringify(list, null, 2))
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
  const cards = list.map(e => `
  <article>
    <video src="${e.dir}/video.mp4" poster="${e.dir}/thumb.jpg" muted loop playsinline preload="none"
      onmouseenter="this.play()" onmouseleave="this.pause()" onclick="this.muted=!this.muted"></video>
    <div class="b">
      <h2 title="${esc(e.title)}">${esc(e.title || e.id)}</h2>
      <p class="m">${esc(e.author)} · ${e.duration ? e.duration.toFixed(1) + '초' : ''} · 컷 ${e.sceneCount ?? '-'}${e.views != null ? ' · 조회 ' + e.views : ''}</p>
      ${e.note ? `<p class="n">📝 ${esc(e.note)}</p>` : ''}
      <p class="l"><a href="${e.dir}/sheet_intro.png" target="_blank">도입 6초</a> <a href="${e.dir}/sheet_scenes.png" target="_blank">컷별</a>
        <a href="${e.dir}/sheet_overview.png" target="_blank">전체</a> <a href="${e.dir}/README.md" target="_blank">메모</a>
        <a href="${esc(e.url)}" target="_blank">핀</a>${e.source ? ` <a href="${esc(e.source)}" target="_blank">원본</a>` : ''}</p>
      <p class="d">${esc(e.id)} · ${esc((e.addedAt || '').slice(0, 10))}</p>
    </div>
  </article>`).join('')
  fs.writeFileSync(path.join(ROOT, 'index.html'), `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><title>레퍼런스 · ${CAT}</title>
<style>
  body{margin:0;background:#141416;color:#ddd;font:14px/1.45 system-ui,'Malgun Gothic',sans-serif}
  header{padding:16px 20px;font-weight:700}
  header small{font-weight:400;color:#888;margin-left:8px}
  main{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:16px;padding:0 20px 28px}
  article{background:#1d1d21;border-radius:10px;overflow:hidden}
  video{width:100%;aspect-ratio:9/16;object-fit:cover;background:#000;display:block;cursor:pointer}
  .b{padding:10px 12px}
  h2{font-size:13px;margin:0 0 4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .m,.d{color:#999;font-size:12px;margin:2px 0}.n{color:#e9c46a;font-size:12px;margin:4px 0}
  .l a{color:#8ab4ff;font-size:12px;margin-right:8px;text-decoration:none}
</style></head><body>
<header>레퍼런스 · ${CAT}<small>${list.length}개 · 마우스 올리면 재생, 클릭하면 소리 · node scripts/ref-grab.mjs 로 추가</small></header>
<main>${cards}</main></body></html>`)
}

async function grab(link) {
  let info, finalUrl = link
  if (/\.mp4(\?|$)/i.test(link)) {
    info = { id: 'mp4_' + Buffer.from(link).toString('base64url').slice(-16), title: path.basename(new URL(link).pathname), videoUrl: link }
  } else {
    const page = await fetchText(link)
    finalUrl = page.finalUrl
    if (!/pinterest\./.test(finalUrl)) throw new Error(`지원하지 않는 링크(핀터레스트 핀 또는 mp4 직링크만 가능): ${finalUrl}`)
    info = parsePin(page.html, finalUrl)
    if (!info.id) throw new Error('핀 ID 를 찾지 못했습니다')
  }
  const dir = path.join(ROOT, info.id)
  const index = readIndex()
  if (fs.existsSync(path.join(dir, 'meta.json')) && !opt.force) {
    console.log(`⏭  이미 있음(덮어쓰려면 --force): ${dir}`)
    if (opt.note) {   // 메모만 추가로 붙이는 건 허용
      const e = index.find(x => x.id === info.id); if (e) { e.note = String(opt.note); writeIndex(index) }
    }
    return
  }
  fs.mkdirSync(dir, { recursive: true })
  console.log(`⬇  ${info.title || info.id}`)
  if (info.thumbUrl) await download(info.thumbUrl, path.join(dir, 'thumb.jpg')).catch(() => {})
  if (!info.videoUrl) {
    console.log('   (영상 없는 이미지 핀 — 썸네일·메타만 저장)')
  } else {
    await download(info.videoUrl, path.join(dir, 'video.mp4'))
  }
  const hasVideo = fs.existsSync(path.join(dir, 'video.mp4'))
  const p = hasVideo ? probe(path.join(dir, 'video.mp4')) : {}
  let cuts = []
  if (hasVideo) {
    const vf = path.join(dir, 'video.mp4'), D = p.duration
    cuts = scenes(vf, D)
    sheet(vf, Array.from({ length: 24 }, (_, i) => (D * (i + 0.5)) / 24), path.join(dir, 'sheet_overview.png'), 200)
    sheet(vf, Array.from({ length: 24 }, (_, i) => i * 0.25).filter(t => t < D), path.join(dir, 'sheet_intro.png'), 240)
    sheet(vf, cuts.slice(0, 32).map(t => Math.min(t + 0.05, D - 0.05)), path.join(dir, 'sheet_scenes.png'), 200)
    if (!fs.existsSync(path.join(dir, 'thumb.jpg'))) run('ffmpeg', ['-y', '-loglevel', 'error', '-ss', '0.5', '-i', vf, '-frames:v', '1', path.join(dir, 'thumb.jpg')])
  }
  const entry = {
    id: info.id, dir: info.id, url: link, finalUrl, title: info.title, description: info.description, author: info.author,
    source: info.source, published: info.published, views: info.views, saves: info.saves, tags: info.tags,
    duration: p.duration || null, size: p.width ? `${p.width}x${p.height}` : null, fps: p.fps || null, audio: p.audio ?? null,
    sceneCount: hasVideo ? cuts.length : null, scenes: cuts.map(t => +t.toFixed(2)),
    note: opt.note ? String(opt.note) : '', addedAt: new Date().toISOString(),
  }
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(entry, null, 2))
  const segs = cuts.map((t, i) => `| ${i + 1} | ${fmt(t)} | ${fmt((cuts[i + 1] ?? p.duration) - t)} |  |`).join('\n')
  fs.writeFileSync(path.join(dir, 'README.md'), `# ${entry.title || entry.id}

- 링크: ${link}
- 원본 출처: ${entry.source || '-'}
- 올린 사람: ${entry.author || '-'} · 게시 ${entry.published?.slice(0, 10) || '-'} · 조회 ${entry.views ?? '-'} · 저장 ${entry.saves ?? '-'}
- 영상: ${entry.duration ? entry.duration.toFixed(2) + '초' : '없음'} · ${entry.size || '-'} · ${entry.fps || '-'}fps · 소리 ${entry.audio ? '있음' : '없음'}
- 태그: ${entry.tags.join(', ') || '-'}
- 설명: ${entry.description || '-'}
${entry.note ? `- 메모: ${entry.note}\n` : ''}
## 시트
- 도입 6초(0.25초 간격): sheet_intro.png
- 컷별 첫 프레임: sheet_scenes.png
- 전체 24등분: sheet_overview.png

## 컷 목록 (자동 감지 ${cuts.length}개 — 연출 메모는 빈칸에)
| # | 시작 | 길이 | 연출 메모 |
|---|---|---|---|
${segs}

## 참고할 점 / 우리 적용 아이디어

`)
  const rest = index.filter(x => x.id !== entry.id)
  writeIndex([entry, ...rest])
  console.log(`✅ ${dir}\n   ${entry.duration ? entry.duration.toFixed(1) + '초' : '이미지'} · 컷 ${cuts.length}개 · ${entry.author || ''}`)
}

let failed = 0
for (const l of links) {
  try { await grab(l.trim()) } catch (e) { failed++; console.log(`❌ ${l}\n   ${e.message}`) }
}
console.log(`\n갤러리: ${path.join(ROOT, 'index.html')}`)
process.exit(failed ? 1 : 0)
