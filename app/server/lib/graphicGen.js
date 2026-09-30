// graphicGen.js — 서브라인 3-1 "HTML 생성"의 순수 로직.
// 대본 GTPL: 필드 해석 + 컷 데이터 → 템플릿 필드 자동 채움 + AI 생성 프롬프트/검증.
// LLM 호출 자체는 proxy.js(callClaudeText, API 키 보유)가 하고, 여기서는
// 프롬프트를 만들고 결과를 검증하는 순수 함수만 둔다(테스트 용이).
//
// GTPL 문법 (GRAPHIC / CAPCUT 컷에서 HTML: 대신 또는 함께):
//   GTPL: text-card/minimal      결정형 — 템플릿/스타일
//   GTPL: cards-3col/yeori       브랜드 프리셋
//   GTPL: ai                     Claude 가 연출 의도로 맞춤 HTML
//   GTPL: ai:relation/yeori      템플릿 골격 위에 AI 가 내용/카피 채움
// HTML: 로 실제 .html 파일이 지정돼 있으면 그게 우선 — GTPL 은 무시된다.

const KNOWN_MODES = new Set(['template', 'ai', 'ai-template'])

// "ai:relation/yeori" · "text-card/minimal" · "ai" → { mode, type, style }
export function parseGtpl(raw) {
  const s = String(raw || '').trim()
  if (!s) return null
  let body = s
  let ai = false
  if (/^ai\b/i.test(s)) {
    ai = true
    body = s.replace(/^ai\s*:?\s*/i, '').trim()
  }
  if (!body) return { mode: 'ai', type: '', style: '' }
  const [type, style] = body.split('/').map(x => x.trim())
  return {
    mode: ai ? 'ai-template' : 'template',
    type: type || '',
    style: style || '',
  }
}

export function isGtplValid(parsed) {
  return !!parsed && KNOWN_MODES.has(parsed.mode)
    && (parsed.mode === 'ai' || !!parsed.type)
}

// 컷 대본 데이터 → 템플릿 필드. 손으로 모달에 타이핑하던 걸 대체한다.
// 우선순위는 pickCutText 계열과 맞춘다: subtitle → "자막 오버레이:" → 인용구 → scene.
export function fieldsFromCut(cut = {}, templateType = 'text-card') {
  const ipvp = `${cut.videoPrompt || ''}\n${cut.imagePrompt || ''}`
  const overlay = ipvp.match(/자막\s*오버레이\s*[:：]\s*"?([^"\n]+?)"?\s*(?:\n|$)/)?.[1]
  const quoted = ipvp.match(/"([^"\n]{2,60})"/)?.[1]

  const title = firstLine(cut.cutTitle) || firstLine(cut.subtitle) || firstLine(cut.narration) || firstLine(cut.scene)
  const subtitle = overlay || firstLine(cut.subtitle) || quoted || ''
  const info = summarize(cut.scene || cut.action || '', 40)

  const base = { title: clip(title, 40), subtitle: clip(subtitle, 44), info }

  if (templateType === 'stat-card') {
    // "A vs B / 3년차·1년차" 류는 대본에서 못 뽑으니 title 만 채우고 나머지는 사람이.
    return { title: base.title }
  }
  if (templateType === 'cards-3col' || templateType === 'relation') {
    return { title: base.title, subtitle: base.subtitle }
  }
  if (templateType === 'info-source' || templateType === 'fiction-disclaimer') {
    return { title: base.title, subtitle: base.subtitle }
  }
  return base
}

function firstLine(s) {
  return String(s || '').split(/\n/)[0].replace(/^["'·\-\s]+|["'\s]+$/g, '').trim()
}
function clip(s, n) {
  s = String(s || '').trim()
  return s.length > n ? `${s.slice(0, n)}…` : s
}
function summarize(s, n) {
  const first = String(s || '').split(/(?<=[.!?…。])\s|\n/)[0].trim()
  return clip(first, n)
}

// ── AI 생성 프롬프트 ────────────────────────────────────────────────
// skeleton 이 있으면(ai-template) 그 골격의 구조/클래스를 지키며 내용만 바꾸게 한다.
export function buildGraphicPrompt(cut = {}, dims = { w: 1920, h: 1080 }, opts = {}) {
  const { w, h } = dims
  const dur = Number(cut.duration) || 8
  const entranceBudget = Math.max(1.2, Math.min(3, dur * 0.4)).toFixed(1)
  const L = []

  L.push(`너는 유튜브 리뷰 영상의 한 컷을 위한 풀스크린 모션그래픽 HTML을 만든다.`)
  L.push(`결과물은 헤드리스 브라우저로 프레임 캡처되어 ${dur}초짜리 ${w}×${h} 영상이 된다.`)
  L.push('')
  L.push(`[컷 정보]`)
  if (cut.cutTitle) L.push(`제목: ${cut.cutTitle}`)
  if (cut.scene) L.push(`장면(SC): ${String(cut.scene).slice(0, 300)}`)
  if (cut.action) L.push(`동작(AC): ${String(cut.action).slice(0, 200)}`)
  if (cut.narration) L.push(`나레이션: ${String(cut.narration).slice(0, 200)}`)
  if (cut.subtitle) L.push(`자막: ${cut.subtitle}`)
  const ov = `${cut.videoPrompt || ''}\n${cut.imagePrompt || ''}`.match(/자막\s*오버레이\s*[:：]\s*"?([^"\n]+)"?/)?.[1]
  if (ov) L.push(`화면 문구(자막 오버레이): ${ov}`)
  if (cut.masterCode?.md) L.push(`무드 코드: ${cut.masterCode.md}`)
  L.push('')

  L.push(`[규칙 — 반드시 지킴]`)
  L.push(`1. 출력은 순수 HTML 하나. 마크다운 코드펜스(\`\`\`) 절대 금지. <!DOCTYPE html> 로 시작.`)
  L.push(`2. 단일 파일: CSS 는 <style> 인라인만. 외부 리소스 전면 금지 — <link>, 웹폰트, 외부 이미지/URL, @import 모두 금지.`)
  L.push(`3. 자바스크립트 전면 금지: <script>, <canvas>, requestAnimationFrame 사용 금지. 애니메이션은 CSS @keyframes / transition 으로만.`)
  L.push(`   (프레임 캡처는 document.getAnimations() 을 스텝하므로 CSS 애니메이션만 캡처된다.)`)
  L.push(`4. html, body 를 정확히 width:${w}px; height:${h}px; overflow:hidden 으로. 루트에 배경색을 명시.`)
  L.push(`5. 등장 애니메이션은 ${entranceBudget}초 안에 끝나고 animation-fill-mode:forwards. 이후 잔잔한 무한 루프(글로우·호흡 등)는 허용.`)
  L.push(`6. 안전 여백: 콘텐츠는 가장자리에서 최소 6% 안쪽. 큰 타이포, 높은 명암비, 한 화면에 요점 하나.`)
  L.push(`7. 한글 텍스트는 주어진 그대로. 폰트는 시스템 스택: font-family:'Pretendard','Apple SD Gothic Neo',-apple-system,BlinkMacSystemFont,sans-serif`)
  L.push('')
  L.push(`[여리 스튜디오 팔레트 — 이 안에서만]`)
  L.push(`잉크(어두운 배경): #0C0A10 ~ #14121A / 크림(밝은 배경): #F5F1EC`)
  L.push(`포인트색: 블루 #5BB8FF · 핑크 #FF6B8A · 퍼플 #C87FFF · 웜 #FFB877 (2~3개만 골라 씀)`)
  L.push(`텍스트: 밝은 배경이면 #14121A, 어두운 배경이면 #F5F1EC. 보조 텍스트는 60% 불투명도.`)
  L.push('')

  if (opts.skeleton) {
    L.push(`[골격 — 이 구조/클래스/레이아웃을 지키고 텍스트·색·디테일만 이 컷에 맞게 바꿔라]`)
    L.push(String(opts.skeleton).slice(0, 4000))
    L.push('')
  }
  if (opts.retryNote) {
    L.push(`[직전 결과 반려 사유 — 이번엔 반드시 반영]`)
    L.push(String(opts.retryNote).slice(0, 400))
    L.push('')
  }

  L.push(`이제 이 컷의 HTML 만 출력해라.`)
  return L.join('\n')
}

// ── AI 결과 검증/정리 ──────────────────────────────────────────────
// 캡처 파이프라인을 깨거나 규칙을 어긴 부분을 잡아낸다. 치명적이지 않은 건 조용히
// 제거(strip)하고 issues 로 남긴다. ok:false 면 호출부가 재시도하거나 사람에게 넘긴다.
export function validateGraphicHtml(raw, dims = { w: 1920, h: 1080 }) {
  const issues = []
  let html = String(raw || '').trim()

  // 코드펜스 제거
  const fence = html.match(/```(?:html)?\s*([\s\S]*?)```/i)
  if (fence) { html = fence[1].trim(); issues.push('코드펜스 제거됨') }

  if (!/<\/html>/i.test(html)) {
    const hint = /<html[\s>]/i.test(html) ? 'HTML 이 </html> 없이 잘림(토큰 초과 가능)' : 'HTML 문서 형태 아님'
    return { ok: false, html, issues: [...issues, hint] }
  }

  // <script> 통째 제거
  if (/<script[\s>]/i.test(html)) {
    html = html.replace(/<script[\s\S]*?<\/script>/gi, '')
    issues.push('<script> 제거됨')
  }
  // canvas / rAF — 캡처 안 되므로 실패 처리
  if (/<canvas[\s>]/i.test(html)) return { ok: false, html, issues: [...issues, '<canvas> 사용 — 프레임 캡처 불가'] }
  if (/requestAnimationFrame/i.test(html)) return { ok: false, html, issues: [...issues, 'requestAnimationFrame 사용'] }

  // 외부 리소스
  if (/<link[\s>]/i.test(html)) { html = html.replace(/<link[^>]*>/gi, ''); issues.push('<link> 제거됨') }
  if (/@import\b/i.test(html)) { html = html.replace(/@import[^;]+;/gi, ''); issues.push('@import 제거됨') }
  if (/(?:src|href)\s*=\s*["']https?:\/\//i.test(html) || /url\(\s*["']?https?:\/\//i.test(html)) {
    return { ok: false, html, issues: [...issues, '외부 URL 리소스 참조'] }
  }

  // 크기 자기 지정 여부 — 없어도 캡처는 뷰포트 기준이라 경고만
  const { w, h } = dims
  if (!new RegExp(`${w}px`).test(html) || !new RegExp(`${h}px`).test(html)) {
    issues.push(`html/body 크기 ${w}×${h}px 명시 안 됨(뷰포트로 캡처됨)`)
  }

  if (html.length > 80_000) return { ok: false, html, issues: [...issues, `HTML 과대(${Math.round(html.length / 1024)}KB)`] }

  return { ok: true, html, issues }
}

// ── 이미지 시퀀스 컷 (크로스페이드 / 켄번즈 줌) ────────────────────────────
// 사진 1장은 "켄번즈"(천천히 확대), 2장 이상은 기본적으로 "크로스페이드+줌"으로
// 자연스럽게 이어붙인다. 순수 함수 — 이미지는 이미 data URI로 인코딩된 상태로 받는다
// (파일 읽기/base64 인코딩은 호출부인 scripts/make-image-sequence-cut.js 담당).
// motion:'self' 캡처 경로(proxy.js runGraphicCapture, ANIMATED_MOTIONS 'self')와
// 호환되도록, CSS 애니메이션 총 길이를 durationSec에 정확히 맞춘다.
export function buildImageSequenceHtml({ images, w = 1080, h = 1920, durationSec = 3, effect = 'auto', fit = 'cover' }) {
  const list = (images || []).filter(Boolean)
  const n = list.length
  if (!n) throw new Error('images 최소 1장 필요')
  const dur = Math.max(0.5, Number(durationSec) || 3)
  const mode = effect === 'auto' ? (n > 1 ? 'both' : 'kenburns') : effect
  const doFade = n > 1 && (mode === 'crossfade' || mode === 'both')
  const doZoom = mode === 'kenburns' || mode === 'both'

  const slotPct = 100 / n
  const overlapPct = doFade ? slotPct * 0.3 : 0

  const layers = list.map((dataUri, i) => {
    const p0 = Math.max(0, i * slotPct - overlapPct)
    const p1 = Math.min(100, i * slotPct + overlapPct)
    const p2 = Math.max(0, (i + 1) * slotPct - overlapPct)
    const p3 = Math.min(100, (i + 1) * slotPct + overlapPct)
    const fadeName = `fade${i}`
    const zoomName = `zoom${i}`
    const zoomDir = i % 2 === 0 ? [1.0, 1.08] : [1.08, 1.0] // 번갈아 확대/축소 — 단조로움 방지
    const opacityCss = !doFade
      ? '' // 단일 이미지 또는 켄번즈 단독: 불투명 고정
      : `animation: ${fadeName} ${dur}s linear forwards;`
    const zoomCss = doZoom
      ? `animation: ${zoomName} ${dur}s linear forwards;`
      : ''
    // CSS 키프레임은 명시 안 된 0%/100%를 "카스케이드 기본값"에서 합성한다(직전/직후
    // 키프레임 값으로 이어받지 않음) — 그래서 0%·100%를 항상 직접 박아둬야 함.
    // 안 그러면 화면 밖(불투명 0이어야 할) 구간에서 레이어가 되레 기본 불투명 1로
    // 튀어나와 순서가 뒤집히거나 유령처럼 겹쳐 보인다(실측: 2026-09-30).
    // 첫 레이어는 시작부터 바로 불투명(도입부 페이드인으로 첫 프레임이 어두워지는 것
    // 방지), 마지막 레이어는 끝까지 불투명 유지(영상 맨 끝이 검게 사라지는 것 방지).
    const isFirst = i === 0
    const isLast = i === n - 1
    const fadePoints = new Map([
      [0, isFirst ? 1 : 0], [p0, isFirst ? 1 : 0],
      [p1, 1], [p2, 1],
      [p3, isLast ? 1 : 0], [100, isLast ? 1 : 0],
    ])
    const fadeKeyframes = doFade ? `
@keyframes ${fadeName} {
${[...fadePoints.entries()].sort((a, b) => a[0] - b[0]).map(([pct, op]) => `  ${pct.toFixed(2)}% { opacity: ${op}; }`).join('\n')}
}` : ''
    const zoomPoints = new Map([[0, zoomDir[0]], [p0, zoomDir[0]], [p3, zoomDir[1]], [100, zoomDir[1]]])
    const zoomKeyframes = doZoom ? `
@keyframes ${zoomName} {
${[...zoomPoints.entries()].sort((a, b) => a[0] - b[0]).map(([pct, sc]) => `  ${pct.toFixed(2)}% { transform: scale(${sc}); }`).join('\n')}
}` : ''
    return { i, dataUri, opacityCss, zoomCss, fadeKeyframes, zoomKeyframes }
  })

  const layerDivs = layers.map(l => `
  <div class="layer" style="${l.opacityCss}${!doFade ? 'opacity:1;' : ''}">
    <img src="${l.dataUri}" style="${l.zoomCss}" />
  </div>`).join('\n')

  const keyframeCss = layers.map(l => l.fadeKeyframes + l.zoomKeyframes).join('\n')

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
* { margin:0; padding:0; box-sizing:border-box; }
html, body { width:${w}px; height:${h}px; overflow:hidden; background:#000; }
.layer { position:absolute; inset:0; width:${w}px; height:${h}px; }
.layer img { position:absolute; inset:0; width:100%; height:100%; object-fit:${fit === 'contain' ? 'contain' : 'cover'}; transform-origin:center center; }
${keyframeCss}
</style>
</head>
<body>
${layerDivs}
</body>
</html>`
}
