// 레퍼런스 영상 자동 정리 — 링크를 넣으면 영상·썸네일·메타를 받아 장면 요약 시트까지 만든다.
// 토큰 0(LLM 호출 없음): 분석이 필요하면 만들어진 시트(sheet_*.png)를 Claude 에게 보여주면 된다.
//
// 사용:
//   node scripts/ref-grab.mjs <링크> [<링크> ...] [--usage="오프닝 훅·티저"] [--note="메모"] [--force] [--scene=0.2]
//   node scripts/ref-grab.mjs --rebuild        갤러리 화면만 다시 생성
//   node scripts/ref-grab.mjs --classify       용도·기법 분류 안 된 항목 자동 분류(Haiku, 검색 없음 — 링크 추가 뒤엔 자동으로도 돔)
//   node scripts/ref-grab.mjs --sites          출처 사이트·계정 랭킹 → library/sites-report.md
//   node scripts/ref-grab.mjs --from-collect=<수집함 id>   수집함 항목을 레퍼런스로 등록(레퍼런스 보드 버튼이 호출)
//   (또는 C:\yeori-studio\ref-grab.bat 더블클릭 → 링크 붙여넣기)
// 분류(2026-11-06): 예전 teaser 고정 폴더 → library 한 폴더 + 용도×기법 두 축(server/lib/refTaxonomy.js).
//   --cat 은 따로 분리된 보드가 꼭 필요할 때만(기본 library).
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
import { spawnSync, spawn } from 'child_process'
import readline from 'readline'
import { DOWNLOADS } from '../server/lib/mediaPaths.js'
import { apiKey, parseArray } from '../server/lib/seedDiscovery.js'
import { USAGES, TECHNIQUES, taxonomyPrompt, cleanClass } from '../server/lib/refTaxonomy.js'

const args = process.argv.slice(2)
const opt = Object.fromEntries(args.filter(a => a.startsWith('--')).map(a => { const [k, ...v] = a.slice(2).split('='); return [k, v.length ? v.join('=') : true] }))
let links = args.filter(a => !a.startsWith('--'))
const CAT = String(opt.cat || 'library').replace(/[^\w-]/g, '')
const ROOT = path.join(DOWNLOADS, '_shared', 'references', CAT)
const FONT_DIR = 'C:/Windows/Fonts'   // drawtext 의 fontfile 경로에 드라이브 콜론을 안 쓰려고 cwd 로 지정
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128 Safari/537.36'
const SNS_HOST = /(^|\.)(instagram\.com|youtube\.com|youtu\.be|tiktok\.com|pinterest\.[a-z.]+|facebook\.com|x\.com|twitter\.com|threads\.net)$/
// Node 24 + fetch 소켓이 닫히는 도중 바로 exit 하면 libuv assertion 이 나서(2026-11-04 실측) 잠깐 기다렸다 종료
const exit = async (code = 0) => { await new Promise(r => setTimeout(r, 100)); process.exit(code) }

fs.mkdirSync(ROOT, { recursive: true })
// (모드 분기는 파일 맨 아래 — 위에서 바로 실행하면 아래쪽 const(run·decode 등)가 아직 초기화 전이라 TDZ 에러)

// 용도·기법 분류 안 된(technique 없는) 항목을 Haiku 로 분류 + 적용 아이디어 한 줄.
// 넘기는 건 이미 저장된 텍스트(성준님 메모·보드 이름·제목·소개글·태그·출처 소개)뿐이라 웹 검색은 안 쓴다.
// 성준님 메모를 맨 앞에 둔다 — 핀터레스트 제목은 검색용 문구라 엉뚱한 경우가 많음(11/6 리뷰: "Motivational quotes…
// Learn javascript" 제목 때문에 "빛 불꽃 타이핑" 메모가 무시되고 "시험 공부" 아이디어가 나왔던 문제).
async function classify() {
  const index = readIndex()
  const todo = index.filter(e => !e.technique)
  if (!todo.length) { console.log('분류할 새 항목이 없습니다(모두 분류됨)'); return }
  if (!apiKey()) { console.log('❌ Anthropic API 키가 없어 분류를 건너뜁니다'); return }
  console.log(`분류 대상 ${todo.length}개`)
  for (let i = 0; i < todo.length; i += 6) {
    const batch = todo.slice(i, i + 6)
    const prompt = `서여리(20~40대 일상 공감 AI 버추얼 인플루언서 — 인스타 릴스·인스타툰, 유튜브 쇼츠) 채널의 연출 레퍼런스들을 분류해줘.\n\n${taxonomyPrompt()}\n\n` +
      batch.map((e, k) => `[${k}] 운영자 메모(가장 정확함, 최우선): ${e.note || '-'}\n저장 보드: ${e.board || '-'} · 지정 용도: ${e.usage || '-'}\n제목: ${e.title || '-'}\n소개: ${(e.summary || e.description || '-').slice(0, 400)}\n태그: ${(e.tags || []).join(', ') || '-'}\n` +
        `영상: ${e.duration ? e.duration.toFixed(1) + '초, 컷 ' + e.sceneCount + '개' : '없음(이미지/링크)'}`).join('\n\n') +
      `\n\n지정 용도가 있으면 그대로 쓸 것. 제목이 내용과 무관한 검색용 문구로 보이면 무시하고 메모·소개 기준으로. detail 은 2~8자 짧은 이름만(설명 문장 금지).\n` +
      `설명 없이 JSON 배열만: [{"i":0,"usage":"","technique":"","detail":"","idea":"서여리에 적용할 아이디어 한국어 한 줄"}]`
    try {
      for (const r of parseArray(await askHaiku(prompt))) {
        const e = batch[r.i]; if (!e) continue
        const c = cleanClass(r)
        e.usage = e.usage || c.usage; e.technique = c.technique || '기타'; e.techDetail = c.techDetail
        e.ideaNote = String(r.idea || '').slice(0, 160)
        delete e.category   // 11/4 의 단일 분류 필드는 새 두 축으로 대체
      }
      console.log(`  ${i + 1}~${i + batch.length}: 완료`)
    } catch (err) { console.log(`  ❌ 배치 실패: ${err.message}`) }
  }
  writeIndex(index)
  console.log('✅ 분류 완료 — 갤러리 용도·기법 필터에 반영됨')
}

async function askHaiku(prompt) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST', headers: { 'x-api-key': apiKey(), 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 1500, messages: [{ role: 'user', content: prompt }] }),
  })
  const j = await r.json(); if (j.error) throw new Error(j.error.message)
  return (j.content || []).filter(c => c.type === 'text').map(c => c.text).join('')
}

// 출처 랭킹 — SNS 는 도메인만 세면 "instagram.com 40건"이 돼서 쓸모없으므로 계정(올린 사람) 단위,
// 그 밖의 사이트(블로그·프롬프트 사이트)는 사이트 단위 + 그 사이트 소개글(sourceIntro). AI 호출 없음.
function sitesReport(quiet = false) {
  const index = readIndex()
  const counts = new Map()
  for (const e of index) {
    const src = e.source || e.url
    let host; try { host = new URL(src).hostname.replace(/^www\.|^kr\./, '') } catch { continue }
    const sns = SNS_HOST.test(host)
    const snsName = (host.match(/instagram|youtu|tiktok|pinterest|facebook|threads|twitter|x\.com/) || [host])[0].replace('youtu', 'youtube').replace('x.com', 'x')
    const key = sns ? `${snsName} · ${e.author || '계정 미상'}` : host
    const row = counts.get(key) || { key, sns, count: 0, examples: [], intro: '' }
    row.count++
    if (row.examples.length < 3) row.examples.push(e.title?.slice(0, 40) || e.id)
    if (!row.intro && e.sourceIntro) row.intro = e.sourceIntro
    counts.set(key, row)
  }
  const ranked = [...counts.values()].sort((a, b) => b.count - a.count)
  const line = (r, i) => `${i + 1}. **${r.key}** — ${r.count}건 (예: ${r.examples.join(', ')})${r.intro ? `\n   > ${r.intro}` : ''}`
  const out = `# 레퍼런스 출처 랭킹\n\n수집 ${index.length}건\n\n## 사이트(블로그·프롬프트 사이트 등)\n${ranked.filter(r => !r.sns).map(line).join('\n') || '(없음)'}\n\n## SNS 계정\n${ranked.filter(r => r.sns).map(line).join('\n') || '(없음)'}\n`
  fs.writeFileSync(path.join(ROOT, 'sites-report.md'), out)
  if (!quiet) { console.log(out); console.log(`✅ 저장: ${path.join(ROOT, 'sites-report.md')}`) }
}

// 출처가 SNS 가 아닌 사이트면 그 페이지의 소개글(og:description)을 같이 받아 둔다(성준님 11/4 요청 "소개 내용 스크랩")
async function sourceIntro(src) {
  try {
    const host = new URL(src).hostname.replace(/^www\./, '')
    if (SNS_HOST.test(host)) return ''
    const { html } = await fetchText(src)
    const m = k => decode(html.match(new RegExp(`<meta[^>]*(?:property|name)="${k}"[^>]*content="([^"]*)"`, 'i'))?.[1] || '')
    return (m('og:description') || m('description') || m('og:title') || (html.match(/<title>([^<]*)/i) || [])[1] || '').trim().slice(0, 300)
  } catch { return '' }
}

// 수집함(collectHub) 항목 → 레퍼런스. 숫자형 핀터레스트 핀은 기존 grab(영상·장면시트), 나머지는 링크 레퍼런스(썸네일+메타).
async function fromCollect(id) {
  const { loadInbox, setItem } = await import('../server/lib/collectHub.js')
  const it = loadInbox().find(e => e.id === id)
  if (!it) throw new Error(`수집함에 없는 항목: ${id}`)
  const extra = { board: it.list || '', usage: it.usage || '', technique: it.technique || '', techDetail: it.techDetail || '', ideaNote: it.idea || '', summary: it.summary || '', platform: it.platform, collectId: it.id }
  let refId
  if (it.platform === 'pinterest' && /\/pin\/\d+\//.test(it.url)) {
    refId = await grab(it.url, extra)
  } else {
    refId = await linkOnly(it, extra)
  }
  setItem(id, { registered: true, refId, registeredAt: new Date().toISOString() })
  console.log(`✅ 레퍼런스 등록: ${refId}`)
}

function linkOnly(it, extra) {
  const refId = (it.platform || 'web') + '_' + Buffer.from(it.url).toString('base64url').slice(-14)
  const dir = path.join(ROOT, refId); fs.mkdirSync(dir, { recursive: true })
  const entry = { id: refId, dir: refId, url: it.url, finalUrl: it.url, title: it.title, description: it.text?.slice(0, 600) || '', author: it.author || '',
    source: it.source || it.url, tags: [], duration: null, sceneCount: null, scenes: [], note: '', addedAt: new Date().toISOString(), linkOnly: true, ...extra }
  const save = () => {
    fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(entry, null, 2))
    writeIndex([entry, ...readIndex().filter(x => x.id !== refId)])
  }
  if (it.thumb) return download(it.thumb, path.join(dir, 'thumb.jpg')).catch(() => {}).then(() => { save(); return refId })
  save(); return refId
}

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
  const cats = fs.readdirSync(path.dirname(ROOT), { withFileTypes: true })
    .filter(d => d.isDirectory() && fs.existsSync(path.join(path.dirname(ROOT), d.name, 'index.json'))).map(d => d.name)
  if (!cats.includes(CAT)) cats.push(CAT)
  const data = JSON.stringify({ cat: CAT, cats, items: list, usages: USAGES, techs: Object.keys(TECHNIQUES) }).replace(/</g, '\\u003c')
  fs.writeFileSync(path.join(ROOT, 'index.html'), `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>레퍼런스 · ${CAT}</title>
<style>
  :root{--bg:#121214;--panel:#1a1a1e;--panel2:#202026;--line:#2c2c33;--tx:#e4e4e7;--tx2:#9a9aa3;--acc:#e9c46a;--link:#8ab4ff}
  *{box-sizing:border-box}
  html,body{margin:0;height:100%;background:var(--bg);color:var(--tx);font:14px/1.45 system-ui,'Malgun Gothic',sans-serif}
  .app{display:grid;grid-template-rows:48px 1fr;grid-template-columns:300px 1fr;height:100vh}
  /* 상단 타이틀 바 */
  .top{grid-column:1/3;display:flex;align-items:center;gap:14px;padding:0 16px;background:var(--panel);border-bottom:1px solid var(--line)}
  .top b{font-size:15px}.top .cnt{color:var(--tx2);font-size:12px}
  .top .sp{flex:1}.top .hint{color:var(--tx2);font-size:12px}
  @media (max-width:1200px){.top .hint{display:none}}
  /* 좌측 사이드바 */
  .side{display:flex;flex-direction:column;min-height:0;background:var(--panel);border-right:1px solid var(--line)}
  .set{padding:12px;border-bottom:1px solid var(--line);display:grid;gap:8px}
  .set label{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--tx2)}
  .set select,.set input[type=search]{flex:1;min-width:0;background:var(--panel2);color:var(--tx);border:1px solid var(--line);border-radius:6px;padding:6px 8px;font:inherit;font-size:13px}
  .set .row{display:flex;gap:14px}
  .list{flex:1;overflow-y:auto;min-height:0}
  .it{display:flex;gap:10px;padding:10px 12px;border-bottom:1px solid var(--line);cursor:pointer}
  .it:hover{background:var(--panel2)}.it.on{background:#2a2a33;box-shadow:inset 3px 0 0 var(--acc)}
  .it img{width:48px;height:85px;object-fit:cover;border-radius:4px;background:#000;flex:none}
  .it .t{font-size:13px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
  .it .m{font-size:11px;color:var(--tx2);margin-top:3px}
  .it .n{font-size:11px;color:var(--acc);margin-top:3px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
  .empty{padding:20px;color:var(--tx2);font-size:13px}
  /* 메인: 재생 화면 + 부가기능 예약 영역 */
  .main{display:grid;grid-template-columns:minmax(300px,440px) 1fr;gap:16px;padding:16px;min-height:0;overflow:auto}
  .player{display:flex;flex-direction:column;gap:10px;min-height:0}
  .player video{height:min(calc(100vh - 230px),782px);width:auto;max-width:100%;aspect-ratio:9/16;object-fit:contain;background:#000;border-radius:10px;align-self:flex-start}
  .info h1{font-size:15px;margin:0 0 4px}.info p{margin:2px 0;font-size:12px;color:var(--tx2)}
  .info .n{color:var(--acc)}.info a{color:var(--link);margin-right:10px;text-decoration:none;font-size:12px}
  /* 부가기능 영역 — 세로로 2분할(2026-11-06): 왼쪽 수집함 리스트, 오른쪽은 미정 */
  .extra{display:grid;grid-template-columns:1fr 1fr;gap:12px;min-height:0}
  .reserve{border:1px dashed var(--line);border-radius:10px;display:flex;align-items:center;justify-content:center;color:#55555e;font-size:13px;min-height:240px}
  .collect{display:flex;flex-direction:column;min-height:0;max-height:calc(100vh - 80px);background:var(--panel);border:1px solid var(--line);border-radius:10px}
  .collect .hd{padding:10px 12px;border-bottom:1px solid var(--line);display:grid;gap:6px}
  .collect .hd b{font-size:13px}.collect .hd .st{font-size:11px;color:var(--tx2)}
  .collect .hd .row{display:flex;gap:6px;align-items:center}
  .collect select,.btn{background:var(--panel2);color:var(--tx);border:1px solid var(--line);border-radius:6px;padding:4px 8px;font:inherit;font-size:12px;cursor:pointer}
  .btn.pri{background:#3b3420;border-color:#6b5a2a;color:var(--acc)}.btn:disabled{opacity:.5;cursor:wait}
  .clist{flex:1;overflow-y:auto;min-height:0}
  .ci{display:flex;gap:8px;padding:9px 10px;border-bottom:1px solid var(--line)}
  .ci img{width:44px;height:60px;object-fit:cover;border-radius:4px;background:#000;flex:none}
  .ci .t{font-size:12.5px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
  .ci .s{font-size:11px;color:var(--tx2);margin-top:2px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
  .chip{display:inline-block;font-size:10.5px;padding:1px 6px;border-radius:999px;background:#2a2a33;color:#c4b5fd;margin:3px 3px 0 0}
  .chip.u{color:var(--acc)}
  .ci .acts{display:flex;gap:4px;margin-top:5px}
  .bm{color:var(--acc);text-decoration:none;border:1px dashed #6b5a2a;border-radius:6px;padding:4px 10px;font-size:12px;cursor:grab}
  @media (max-width:1400px){.extra{grid-template-columns:1fr}}
  @media (max-width:900px){.app{grid-template-columns:1fr;grid-template-rows:48px auto 1fr}.side{max-height:45vh}.main{grid-template-columns:1fr}.reserve{min-height:120px}}
</style></head><body>
<div class="app">
  <header class="top"><b>레퍼런스 보드</b><span class="cnt" id="cnt"></span><span class="sp"></span>
    <input type="search" id="pq" placeholder="핀터레스트 검색어 (예: text reveal teaser)" style="width:260px;background:var(--panel2);color:var(--tx);border:1px solid var(--line);border-radius:6px;padding:6px 8px">
    <button id="pgo" style="background:var(--panel2);color:var(--tx);border:1px solid var(--line);border-radius:6px;padding:6px 12px;cursor:pointer">📌 핀터레스트 열기</button>
    <a class="bm" id="bm" href="#" title="이 버튼을 크롬 북마크바로 끌어다 놓으세요. 인스타 저장 컬렉션·유튜브 재생목록·핀터레스트 보드 화면에서 누르면 보이는 목록이 수집함에 담깁니다">📥 담기 (북마크바로 끌어 놓기)</a>
    <span class="hint">↑↓ 이동 · Space 재생/정지 · M 소리 · 추가: ref-grab.bat</span></header>
  <aside class="side">
    <div class="set">
      <label id="catRow">보드 <select id="cat"></select></label>
      <label>용도 <select id="use"><option value="">전체</option></select></label>
      <label>기법 <select id="tech"><option value="">전체</option></select></label>
      <label>정렬 <select id="sort"><option value="new">최근 추가순</option><option value="old">오래된순</option><option value="dur">짧은 영상순</option><option value="views">조회수순</option></select></label>
      <label><input type="search" id="q" placeholder="제목·메모·태그·기법 검색"></label>
      <div class="row"><label><input type="checkbox" id="auto" checked> 선택하면 바로 재생</label><label><input type="checkbox" id="snd"> 소리</label></div>
    </div>
    <div class="list" id="list"></div>
  </aside>
  <main class="main">
    <section class="player">
      <video id="vid" controls loop playsinline></video>
      <div class="info" id="info"></div>
    </section>
    <div class="extra">
      <section class="collect">
        <div class="hd">
          <b>📥 수집함 <span class="st" id="cst"></span></b>
          <div class="row">
            <select id="cplat"><option value="">전체 플랫폼</option><option value="pinterest">📌 핀터레스트</option><option value="instagram">📸 인스타</option><option value="youtube">▶️ 유튜브</option><option value="web">🌐 기타</option></select>
            <select id="cuse"><option value="">전체 용도</option></select>
            <span style="flex:1"></span>
            <button class="btn" id="crun" title="핀터레스트 보드·유튜브 재생목록에서 새 항목을 가져오고 자동 정리">🔄 새로 가져오기</button>
          </div>
        </div>
        <div class="clist" id="clist"><div class="empty">불러오는 중…</div></div>
      </section>
      <section class="reserve" id="reserve">부가기능 영역 (미정)</section>
    </div>
  </main>
</div>
<script>
const D = ${data}
const $ = id => document.getElementById(id)
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))
const store = { get(k, d) { try { const v = localStorage.getItem('refboard.' + k); return v == null ? d : JSON.parse(v) } catch (e) { return d } },
                set(k, v) { try { localStorage.setItem('refboard.' + k, JSON.stringify(v)) } catch (e) {} } }
let view = [], cur = store.get('sel.' + D.cat, null)

$('cat').innerHTML = D.cats.map(c => '<option' + (c === D.cat ? ' selected' : '') + '>' + esc(c) + '</option>').join('')
$('cat').onchange = e => { location.href = '../' + e.target.value + '/index.html' }
if (D.cats.length < 2) $('catRow').style.display = 'none'   // 보드 폴더가 하나뿐이면(기본 library) 숨김
const opts = (arr, all) => '<option value="">' + all + '</option>' + arr.map(t => '<option>' + esc(t) + '</option>').join('')
const uniq = k => [...new Set(D.items.map(e => e[k]).filter(Boolean))]
const useList = [...D.usages, ...uniq('usage').filter(u => !D.usages.includes(u))]
$('use').innerHTML = opts(useList, '전체'); $('use').value = store.get('use', '')
$('use').onchange = () => { store.set('use', $('use').value); render() }
$('tech').innerHTML = opts([...D.techs, ...uniq('technique').filter(t => !D.techs.includes(t))], '전체')
$('tech').value = store.get('tech', '')
$('tech').onchange = () => { store.set('tech', $('tech').value); render() }
const cls = e => [e.usage, e.technique && (e.technique + (e.techDetail ? ' › ' + e.techDetail : ''))].filter(Boolean)
const PI = { pinterest: '📌', instagram: '📸', youtube: '▶️', web: '🌐' }
$('sort').value = store.get('sort', 'new'); $('auto').checked = store.get('auto', true); $('snd').checked = store.get('snd', false)
$('sort').onchange = () => { store.set('sort', $('sort').value); render() }
$('q').oninput = render
$('auto').onchange = () => store.set('auto', $('auto').checked)
$('snd').onchange = () => { store.set('snd', $('snd').checked); $('vid').muted = !$('snd').checked }

function render() {
  const q = $('q').value.trim().toLowerCase(), s = $('sort').value, tech = $('tech').value, use = $('use').value
  view = D.items.filter(e => (!tech || e.technique === tech) && (!use || e.usage === use)
    && (!q || [e.title, e.note, e.author, e.usage, e.technique, e.techDetail, e.ideaNote, e.summary, e.board, (e.tags || []).join(' '), e.description].join(' ').toLowerCase().includes(q)))
  const by = { new: (a, b) => (b.addedAt || '').localeCompare(a.addedAt || ''), old: (a, b) => (a.addedAt || '').localeCompare(b.addedAt || ''),
               dur: (a, b) => (a.duration || 1e9) - (b.duration || 1e9), views: (a, b) => (b.views || 0) - (a.views || 0) }[s]
  view.sort(by)
  $('cnt').textContent = view.length + (view.length !== D.items.length ? ' / ' + D.items.length : '') + '개'
  $('list').innerHTML = view.length ? view.map(e => '<div class="it' + (e.id === cur ? ' on' : '') + '" data-id="' + esc(e.id) + '">'
      + '<img src="' + esc(e.dir) + '/thumb.jpg" loading="lazy" alt="">'
      + '<div><div class="t">' + esc(e.title || e.id) + '</div>'
      + '<div class="m">' + (PI[e.platform] || '📌') + ' ' + (e.linkOnly ? '링크' : (e.duration ? e.duration.toFixed(1) + '초 · ' : '') + '컷 ' + (e.sceneCount ?? '-')) + (e.views != null ? ' · 조회 ' + e.views : '') + '</div>'
      + '<div>' + cls(e).map((c, i) => '<span class="chip' + (i === 0 && e.usage ? ' u' : '') + '">' + esc(c) + '</span>').join('') + '</div>'
      + (e.note ? '<div class="n">📝 ' + esc(e.note) + '</div>' : '') + '</div></div>').join('')
    : '<div class="empty">' + (D.items.length ? '검색 결과가 없습니다' : '아직 레퍼런스가 없습니다 — ref-grab.bat 으로 링크를 추가하세요') + '</div>'
  document.querySelectorAll('.it').forEach(el => el.onclick = () => select(el.dataset.id))
  if (!view.some(e => e.id === cur)) { if (view[0]) select(view[0].id, false) }
  else if (!$('vid').getAttribute('src')) select(cur, false)
}

function select(id, play = true) {
  const e = D.items.find(x => x.id === id); if (!e) return
  cur = id; store.set('sel.' + D.cat, id)
  document.querySelectorAll('.it').forEach(el => el.classList.toggle('on', el.dataset.id === id))
  const on = document.querySelector('.it.on'); if (on) on.scrollIntoView({ block: 'nearest' })
  const v = $('vid')
  v.poster = e.dir + '/thumb.jpg'
  if (e.duration) v.src = e.dir + '/video.mp4'; else v.removeAttribute('src')
  v.muted = !$('snd').checked
  if (play && $('auto').checked && e.duration) v.play().catch(() => {})
  $('info').innerHTML = '<h1>' + esc(e.title || e.id) + '</h1>'
    + '<p>' + esc(e.author || '') + (e.published ? ' · 게시 ' + esc(e.published.slice(0, 10)) : '') + (e.duration ? ' · ' + e.duration.toFixed(1) + '초' : '') + (e.size ? ' · ' + esc(e.size) : '') + ' · 컷 ' + (e.sceneCount ?? '-') + '</p>'
    + (cls(e).length ? '<p>🏷 ' + esc(cls(e).join(' · ')) + (e.ideaNote ? ' — ' + esc(e.ideaNote) : '') + '</p>' : '')
    + (e.summary ? '<p>📄 ' + esc(e.summary) + '</p>' : '')
    + (e.board ? '<p>🗂 보드: ' + esc(e.board) + '</p>' : '')
    + (e.sourceIntro ? '<p>🌐 출처 소개: ' + esc(e.sourceIntro) + '</p>' : '')
    + (e.note ? '<p class="n">📝 ' + esc(e.note) + '</p>' : '')
    + '<p>' + (e.linkOnly ? '' : '<a href="' + esc(e.dir) + '/sheet_intro.png" target="_blank">도입 6초</a><a href="' + esc(e.dir) + '/sheet_scenes.png" target="_blank">컷별</a>'
    + '<a href="' + esc(e.dir) + '/sheet_overview.png" target="_blank">전체</a><a href="' + esc(e.dir) + '/README.md" target="_blank">메모</a>')
    + '<a href="#" data-open="' + esc(e.url) + '">' + (e.linkOnly ? '원본 새 창' : '핀 새 창') + '</a>' + (e.source && e.source !== e.url ? '<a href="' + esc(e.source) + '" target="_blank">원본</a>' : '') + '</p>'
}

// 브라우저 열기 — 스튜디오 서버(/api/open-browser)가 별도 Chrome 창으로. 서버가 꺼져 있으면 새 탭.
function openB(body) {
  fetch('http://localhost:3001/api/open-browser', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    .then(r => { if (!r.ok) throw new Error() })
    .catch(() => window.open(body.url || ('https://kr.pinterest.com/search/pins/?q=' + encodeURIComponent(body.query || '')), '_blank'))
}
$('pgo').onclick = () => openB({ target: 'pinterest', query: $('pq').value })
$('pq').onkeydown = ev => { if (ev.key === 'Enter') openB({ target: 'pinterest', query: $('pq').value }) }
$('info').onclick = ev => { const a = ev.target.closest('[data-open]'); if (a) { ev.preventDefault(); openB({ target: 'url', url: a.dataset.open }) } }

document.addEventListener('keydown', ev => {
  if (ev.target.tagName === 'INPUT' || ev.target.tagName === 'SELECT') return
  const i = view.findIndex(e => e.id === cur), v = $('vid')
  if (ev.key === 'ArrowDown' && view[i + 1]) { ev.preventDefault(); select(view[i + 1].id) }
  else if (ev.key === 'ArrowUp' && view[i - 1]) { ev.preventDefault(); select(view[i - 1].id) }
  else if (ev.key === ' ') { ev.preventDefault(); v.paused ? v.play() : v.pause() }
  else if (ev.key === 'm' || ev.key === 'M') { $('snd').checked = !$('snd').checked; $('snd').onchange() }
})
render()

// ── 📥 수집함 리스트(부가기능 영역 왼쪽) — 서버 /api/collect 를 읽는다. 등록하면 ref-grab 이 이 갤러리를 다시 만든다 ──
const API = 'http://localhost:3001'
let C = []
$('cuse').innerHTML = opts(D.usages, '전체 용도')
$('cplat').value = store.get('cplat', ''); $('cuse').value = store.get('cuse', '')
$('cplat').onchange = () => { store.set('cplat', $('cplat').value); crender() }
$('cuse').onchange = () => { store.set('cuse', $('cuse').value); crender() }
function cload() {
  return fetch(API + '/api/collect?board=1').then(r => r.json()).then(d => {
    C = d.items || []
    const st = d.status || {}, cn = st.counts || {}
    $('cst').textContent = '· 대기 ' + C.length + '개' + (cn.new ? ' · 정리 중 ' + cn.new : '') + (st.last ? ' · 마지막 ' + st.last.at.slice(5, 16).replace('T', ' ') : '')
    crender()
  }).catch(() => { $('clist').innerHTML = '<div class="empty">스튜디오 서버(:3001)가 꺼져 있어 수집함을 못 불러왔습니다</div>' })
}
function crender() {
  const p = $('cplat').value, u = $('cuse').value
  const v = C.filter(e => (!p || e.platform === p) && (!u || e.usage === u))
  $('clist').innerHTML = v.length ? v.map(e => '<div class="ci" data-cid="' + esc(e.id) + '">'
      + (e.thumb ? '<img src="' + esc(e.thumb) + '" loading="lazy" referrerpolicy="no-referrer" alt="">' : '<img alt="">')
      + '<div style="min-width:0;flex:1"><div class="t">' + (PI[e.platform] || '🌐') + ' ' + esc(e.title || e.summary || e.url) + '</div>'
      + '<div class="s">' + esc(e.list ? '🗂 ' + e.list + ' · ' : '') + esc(e.status === 'new' ? '정리 대기 중…' : (e.summary || '')) + '</div>'
      + '<div>' + cls(e).map((c, i) => '<span class="chip' + (i === 0 && e.usage ? ' u' : '') + '">' + esc(c) + '</span>').join('') + '</div>'
      + '<div class="acts"><button class="btn pri" data-reg="' + esc(e.id) + '">레퍼런스 등록</button><button class="btn" data-hide="' + esc(e.id) + '">숨김</button><a class="btn" style="text-decoration:none" href="' + esc(e.url) + '" target="_blank">원본</a></div>'
      + '</div></div>').join('')
    : '<div class="empty">' + (C.length ? '조건에 맞는 항목이 없습니다' : '수집함이 비어 있습니다 — 핀터레스트 보드에 저장하면 3시간마다 자동으로 들어오고, 📥 담기 버튼으로 바로 담을 수도 있습니다') + '</div>'
}
$('clist').onclick = async ev => {
  const reg = ev.target.closest('[data-reg]'), hide = ev.target.closest('[data-hide]')
  if (reg) {
    reg.disabled = true; reg.textContent = '등록 중…(영상이면 수십 초)'
    const r = await fetch(API + '/api/collect/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: reg.dataset.reg }) }).then(r => r.json()).catch(e => ({ error: e.message }))
    if (r.ok) location.reload(); else { reg.disabled = false; reg.textContent = '레퍼런스 등록'; reg.title = r.error; reg.insertAdjacentHTML('afterend', '<span style="color:#f87171;font-size:11px">' + esc(r.error) + '</span>') }
  } else if (hide) {
    await fetch(API + '/api/collect/hide', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: hide.dataset.hide }) })
    C = C.filter(e => e.id !== hide.dataset.hide); crender()
  }
}
$('crun').onclick = async () => {
  $('crun').disabled = true; $('crun').textContent = '가져오는 중…'
  await fetch(API + '/api/collect/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).catch(() => {})
  $('crun').disabled = false; $('crun').textContent = '🔄 새로 가져오기'; cload()
}
fetch(API + '/api/collect/bookmarklet').then(r => r.json()).then(d => { $('bm').href = d.href }).catch(() => { $('bm').style.display = 'none' })
$('bm').onclick = ev => { ev.preventDefault(); alert('이 버튼은 클릭이 아니라 크롬 북마크바로 끌어다 놓아 설치합니다.') }
cload(); setInterval(() => { if (C.some(e => e.status === 'new')) cload() }, 15000)
</script></body></html>`)
}

async function grab(link, extra = {}) {
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
    const e = index.find(x => x.id === info.id)
    if (e && (opt.note || Object.keys(extra).length)) {   // 메모·수집함 분류 정보만 추가로 붙이는 건 허용
      if (opt.note) e.note = String(opt.note)
      for (const [k, v] of Object.entries(extra)) if (v && !e[k]) e[k] = v
      writeIndex(index)
    }
    return info.id
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
    usage: opt.usage ? String(opt.usage) : '', sourceIntro: info.source ? await sourceIntro(info.source) : '',
    ...Object.fromEntries(Object.entries(extra).filter(([, v]) => v)),
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
  return entry.id
}

// ── 모드 분기 ──
if (opt.rebuild) {   // 링크 없이 갤러리(index.html)만 다시 생성 — 화면 레이아웃을 바꿨을 때
  writeIndex(readIndex()); console.log(`갤러리 재생성: ${path.join(ROOT, 'index.html')}`); await exit(0)
}
if (opt.classify) { await classify(); await exit(0) }
if (opt.sites) { sitesReport(); await exit(0) }
if (opt['from-collect']) {
  try { await fromCollect(String(opt['from-collect'])); await classify(); sitesReport(true); await exit(0) }
  catch (e) { console.log(`❌ ${e.message}`); await exit(1) }
}
if (!links.length && !opt.interactive) {
  console.log('사용: node scripts/ref-grab.mjs <링크> [<링크> ...] [--usage=용도] [--note="메모"] [--force] [--scene=0.2]  |  --rebuild  |  --classify  |  --sites  |  --from-collect=<id>')
  await exit(1)
}

// --interactive: ref-grab.bat 더블클릭용. 한글 안내·입력을 배치 파일이 아니라 여기서 처리한다 —
// cmd.exe 는 UTF-8 한글이 섞인 .bat 를 읽다가 줄 위치가 어긋나 명령이 잘린다(2026-09-24 실측, chcp 65001 로도 안 고쳐짐).
if (opt.interactive) {
  // 줄 단위 큐 — 입력이 끊기면(창 닫힘·파이프 끝) 빈 줄로 보고 정상 종료(질문이 영원히 안 끝나는 것 방지)
  const rl = readline.createInterface({ input: process.stdin })
  const queue = []; let waiter = null, closed = false
  rl.on('line', l => { if (waiter) { const w = waiter; waiter = null; w(l.trim()) } else queue.push(l.trim()) })
  rl.on('close', () => { closed = true; if (waiter) { const w = waiter; waiter = null; w('') } })
  const ask = q => { process.stdout.write(q)
    if (queue.length) return Promise.resolve(queue.shift())
    if (closed) return Promise.resolve('')
    return new Promise(res => { waiter = res }) }
  console.log('================================================')
  console.log(' 레퍼런스 자동 정리 — 핀터레스트 핀 링크 / mp4 링크')
  console.log(' 여러 개는 띄어쓰기로 구분 · 빈 줄에서 Enter = 끝내고 갤러리 열기')
  console.log('================================================')
  console.log(' 용도: ' + USAGES.map((u, i) => `${i + 1}.${u}`).join('  '))
  for (;;) {
    const line = await ask('\n링크: ')
    if (!line) break
    const u = await ask('용도 번호(모르면 Enter = 자동 분류): ')
    if (USAGES[+u - 1]) opt.usage = USAGES[+u - 1]; else delete opt.usage
    const note = await ask('메모(없으면 Enter): ')
    if (note) opt.note = note; else delete opt.note
    for (const l of line.split(/\s+/).filter(Boolean)) {
      try { await grab(l) } catch (e) { console.log(`❌ ${l}\n   ${e.message}`) }
    }
  }
  rl.close()
  await classify(); sitesReport(true)   // 담은 뒤 분류·출처 랭킹까지 자동(11/6 — 따로 명령 안 쳐도 되게)
  const gallery = `http://localhost:3001/downloads/_shared/references/${CAT}/index.html`
  spawn('cmd', ['/c', 'start', '', gallery], { detached: true, stdio: 'ignore' }).unref()
  await exit(0)
}

let failed = 0
for (const l of links) {
  try { await grab(l.trim()) } catch (e) { failed++; console.log(`❌ ${l}\n   ${e.message}`) }
}
await classify(); sitesReport(true)
console.log(`\n갤러리: ${path.join(ROOT, 'index.html')}`)
await exit(failed ? 1 : 0)
