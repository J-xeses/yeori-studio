// 인스타 계정 세팅 미리보기 — 프로필 사진·계정명·표시이름·Bio 후보를 바꿔 가며 프로필 화면처럼 확인.
// 토큰 0. 사진은 downloads/seoyeori/IG/_account/profile/ 에 넣으면 자동으로 후보에 추가된다
// (정사각형 1080px 이상 권장, 파일명 = 후보 이름). 격자 썸네일은 _account/grid/ 의 파일을 계획 순서대로 사용.
// 사용: node scripts/account-preview.mjs   → _account/preview.html 생성 (또는 C:\yeori-studio\account-preview.bat)
import fs from 'fs'
import path from 'path'
import { DOWNLOADS } from '../server/lib/mediaPaths.js'

const ROOT = path.join(DOWNLOADS, 'seoyeori', 'IG', '_account')
const photos = fs.readdirSync(path.join(ROOT, 'profile')).filter(f => /\.(jpe?g|png|webp)$/i.test(f)).sort()

// 첫 9개 게시물 계획(인스타 격자는 최신이 왼쪽 위 → 아래 배열은 "공개 순서", 화면에선 뒤집어 표시)
const PLAN = [
  { d: '9/25', t: '티저① Seoyeori', img: 't1.jpg' },
  { d: '9/26', t: '티저② 텍스트 소개', img: null },
  { d: '9/27', t: 'P01 웹툰 자기소개', img: 'p01.jpg' },
  { d: '9/28', t: 'P02 제작과정툰', img: null },
  { d: '9/29', t: 'R04 실사 소개', img: 'r04.jpg' },
  { d: '9/30', t: 'R02 DM 보낸 사람들', img: 'r02.jpg' },
  { d: '10/2', t: 'R03 비용 0원', img: 'r03.jpg' },
  { d: '10/4', t: '일상 Reel ①', img: null },
  { d: '10/6', t: '일상 Reel ②', img: null },
].map(p => ({ ...p, img: p.img && fs.existsSync(path.join(ROOT, 'grid', p.img)) ? 'grid/' + p.img : null }))

const HANDLES = ['seoyeori.ai', 'seoyeori', 'itsyeori', 'seo.yeori', 'ai.seoyeori', 'seoyeori_ai', 'yeori.ai', 'yeori.seo',
  'hey.yeori', 'seoyeori.kr', 'yeori.made.by.ai', 'yeori.log', 'yeori.daily', 'dear.yeori', 'yeori.in.seoul', 'yeori_dream',
  'yeori.after6', 'yeori.diary', 'offwork.yeori', 'yeori.worklife']
const NAMES = ['서여리 | AI 크리에이터', '서여리 Seoyeori · AI', '서여리 🤍 AI', 'Seoyeori 서여리']
// 니치 = "20~40대 누구나 공감하는 서여리의 일상"(2026-09-24 성준님 확정, 직장인 공감은 하위 요소)
const BIOS = [
  '저 사실… AI예요.\n나만 그런 거 아니었네, 싶은 일상을 그려요\n👇 새 에피소드',
  'AI로 태어난 서여리 🤍\n20·30·40 누구나 "어, 나도 그래" 하는 일상\n새 에피소드 매주 ↓',
  '저 사실… AI예요.\n그래도 공감만큼은 진짜입니다\n📩 협업 문의 DM',
  'AI 크리에이터 서여리 | 웹툰에서 현실로 넘어오는 중 🎬\n우리 모두의 평범한 하루\n유튜브 ↓',
  '꿈만큼은 진짜인 AI 크리에이터\n당신의 하루를 조금 가볍게\n릴스 매주 업로드 ✨',
  '사람은 아니지만, 당신 편입니다 🤍\nAI 서여리의 공감 일기\n새 글 알림 설정 ✨',
  'AI · 서울 · 매일 조금씩 사람이 되는 중\n엉뚱한데 이상하게 공감되는 일상\n👇 유튜브에서 더 길게',
  '만들어진 얼굴, 진짜 이야기\nAI 크리에이터 서여리\n📩 collab DM · 유튜브 ↓',
  'AI 서여리 | 공감 한 스푼, 반전 한 스푼\n퇴근길·주말·새벽 3시의 우리 이야기\n다음 화 ↓',
  "Hi, I'm Yeori — an AI creator from Seoul 🇰🇷\n누구나 공감하는 K-daily\n📩 DM for collab",
]
const data = JSON.stringify({ photos, plan: PLAN, handles: HANDLES, names: NAMES, bios: BIOS }).replace(/</g, '\\u003c')

fs.writeFileSync(path.join(ROOT, 'preview.html'), `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>서여리 계정 세팅 미리보기</title>
<style>
  :root{--bg:#121214;--panel:#1a1a1e;--line:#2c2c33;--tx:#e4e4e7;--tx2:#9a9aa3;--acc:#e9c46a}
  *{box-sizing:border-box} html,body{margin:0;min-height:100%;background:var(--bg);color:var(--tx);font:14px/1.45 system-ui,'Malgun Gothic',sans-serif}
  .app{display:grid;grid-template-rows:48px 1fr;grid-template-columns:340px 1fr;min-height:100vh}
  .top{grid-column:1/3;display:flex;align-items:center;gap:12px;padding:0 16px;background:var(--panel);border-bottom:1px solid var(--line)}
  .top small{color:var(--tx2)}
  .side{background:var(--panel);border-right:1px solid var(--line);padding:14px;overflow-y:auto;max-height:calc(100vh - 48px)}
  .side h3{font-size:12px;color:var(--tx2);margin:14px 0 6px;font-weight:600}
  .ph{display:flex;flex-wrap:wrap;gap:8px}
  .ph button{border:2px solid transparent;border-radius:50%;padding:0;width:64px;height:64px;overflow:hidden;cursor:pointer;background:#000}
  .ph button.on{border-color:var(--acc)} .ph img{width:100%;height:100%;object-fit:cover}
  .ph .lb{font-size:10px;color:var(--tx2);text-align:center;width:64px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  select{width:100%;background:#202026;color:var(--tx);border:1px solid var(--line);border-radius:6px;padding:6px 8px;font:inherit}
  .bios label{display:block;padding:8px;border:1px solid var(--line);border-radius:8px;margin-bottom:6px;cursor:pointer;white-space:pre-line;font-size:12px}
  .bios input{display:none} .bios label.on{border-color:var(--acc);background:#24211a}
  .note{font-size:11px;color:var(--tx2);margin-top:12px;line-height:1.6}
  .main{display:flex;gap:28px;padding:24px;flex-wrap:wrap;align-items:flex-start}
  .phone{width:390px;background:#fff;color:#111;border-radius:28px;overflow:hidden;box-shadow:0 10px 40px #0008}
  .ph-top{padding:14px 16px 4px;font-weight:700;font-size:17px}
  .hdr{display:flex;align-items:center;gap:18px;padding:8px 16px}
  .av{width:86px;height:86px;border-radius:50%;overflow:hidden;flex:none;background:#eee}
  .av img{width:100%;height:100%;object-fit:cover}
  .stats{display:flex;gap:18px;font-size:13px;text-align:center}.stats b{display:block;font-size:15px}
  .bio{padding:6px 16px 10px;font-size:13px;white-space:pre-line}.bio .nm{font-weight:700}.bio .cat{color:#777}
  .ai{display:inline-block;font-size:11px;color:#555;background:#f1f1f1;border-radius:4px;padding:1px 6px;margin:2px 0}
  .grid{display:grid;grid-template-columns:repeat(3,1fr);gap:2px}
  .cell{aspect-ratio:3/4;background:#ddd center/cover no-repeat;position:relative}
  .cell span{position:absolute;left:4px;bottom:4px;right:4px;font-size:10px;color:#fff;background:#0009;border-radius:3px;padding:1px 4px}
  .cell.empty{background:#e9e9ee}.cell.empty span{background:#999}
  .small{display:flex;flex-direction:column;gap:14px;align-items:center}
  .small .c{border-radius:50%;overflow:hidden;background:#eee}.small img{width:100%;height:100%;object-fit:cover}
  .small p{margin:0;font-size:12px;color:var(--tx2)}
</style></head><body>
<div class="app">
  <header class="top"><b>서여리 계정 세팅 미리보기</b><small>사진 추가: _account/profile/ 에 넣고 account-preview.bat 실행</small></header>
  <aside class="side">
    <h3>프로필 사진</h3><div class="ph" id="ph"></div>
    <h3>계정명(핸들)</h3><select id="handle"></select>
    <h3>표시 이름</h3><select id="name"></select>
    <h3>Bio</h3><div class="bios" id="bios"></div>
    <p class="note">· 계정명 사용 가능 여부는 인스타 개설 화면에서 직접 입력해 확인(자동 조회는 인스타가 차단).<br>
      · 카테고리: 크리에이터 계정 → 디지털 크리에이터. 개설 직후 AI 라벨 + 2단계 인증.<br>
      · 격자는 공개 계획 순서(최신이 왼쪽 위). 회색 칸 = 아직 제작 전.</p>
  </aside>
  <main class="main">
    <div class="phone">
      <div class="ph-top" id="h1"></div>
      <div class="hdr"><div class="av"><img id="av" alt=""></div>
        <div class="stats"><div><b>9</b>게시물</div><div><b>0</b>팔로워</div><div><b>0</b>팔로잉</div></div></div>
      <div class="bio"><div class="nm" id="nm"></div><div class="cat">디지털 크리에이터</div><div class="ai">AI 생성 프로필</div><div id="bio"></div></div>
      <div class="grid" id="grid"></div>
    </div>
    <div class="small"><div class="c" style="width:32px;height:32px"><img id="s1"></div><p>피드·댓글 크기(32px)</p>
      <div class="c" style="width:56px;height:56px"><img id="s2"></div><p>스토리 크기(56px)</p>
      <div class="c" style="width:150px;height:150px"><img id="s3"></div><p>프로필 크게</p></div>
  </main>
</div>
<script>
const D = ${data}
const $ = id => document.getElementById(id)
const store = { get(k, d) { try { const v = localStorage.getItem('acct.' + k); return v == null ? d : JSON.parse(v) } catch (e) { return d } },
                set(k, v) { try { localStorage.setItem('acct.' + k, JSON.stringify(v)) } catch (e) {} } }
let st = { photo: store.get('photo', D.photos[0]), handle: store.get('handle', D.handles[0]), name: store.get('name', D.names[0]), bio: store.get('bio', 0) }
if (!D.photos.includes(st.photo)) st.photo = D.photos[0]
$('handle').innerHTML = D.handles.map(h => '<option>' + h + '</option>').join('')
$('name').innerHTML = D.names.map(h => '<option>' + h + '</option>').join('')
$('handle').onchange = e => { st.handle = e.target.value; store.set('handle', st.handle); draw() }
$('name').onchange = e => { st.name = e.target.value; store.set('name', st.name); draw() }
$('grid').innerHTML = D.plan.slice().reverse().map(p => '<div class="cell' + (p.img ? '' : ' empty') + '"' + (p.img ? ' style="background-image:url(' + p.img + ')"' : '') + '><span>' + p.d + ' ' + p.t + '</span></div>').join('')
function draw() {
  $('ph').innerHTML = D.photos.map(f => '<div><button class="' + (f === st.photo ? 'on' : '') + '" data-f="' + f + '"><img src="profile/' + f + '"></button><div class="lb">' + f.replace(/\\.[^.]+$/, '') + '</div></div>').join('')
  document.querySelectorAll('.ph button').forEach(b => b.onclick = () => { st.photo = b.dataset.f; store.set('photo', st.photo); draw() })
  $('bios').innerHTML = D.bios.map((b, i) => '<label class="' + (i === st.bio ? 'on' : '') + '" data-i="' + i + '">' + (i + 1) + '. ' + b.replace(/</g, '&lt;') + '</label>').join('')
  document.querySelectorAll('.bios label').forEach(l => l.onclick = () => { st.bio = +l.dataset.i; store.set('bio', st.bio); draw() })
  $('handle').value = st.handle; $('name').value = st.name
  $('h1').textContent = st.handle; $('nm').textContent = st.name; $('bio').textContent = D.bios[st.bio]
  ;['av', 's1', 's2', 's3'].forEach(id => $(id).src = 'profile/' + st.photo)
}
draw()
</script></body></html>`)
console.log(`미리보기 생성: ${path.join(ROOT, 'preview.html')} (사진 ${photos.length}장)`)
