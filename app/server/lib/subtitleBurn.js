// ── 자막 번인(2026-11-03, 성준님 요청: "영상 탭 설정을 실제 번인 영상으로") ─────────────
// 영상 탭 "자막 디자인 설정"(글씨체·크기·색·배경 스타일·위치)을 실제 cut_NN_final.mp4에
// ffmpeg drawtext로 굽는다. VideoTab.jsx drawPreview()(미리보기 캔버스)와 같은 비율식
// (h*0.75/0.85/0.93, 외곽선 자동반전 등)을 그대로 따라 "미리보기 = 실제 결과"가 되게 맞춤
// — SF/LF(비릴스) 전용. 릴스는 이 경로를 안 타고 기존 reelFinalize.js(handwriting_overlay.py)
// 가 그대로 담당한다.
import fs from 'fs'
import path from 'path'

const WIN_FONTS_DIR = 'C:\\Windows\\Fonts'

// 드롭다운(VideoTab.jsx FONTS)의 표시용 이름 → 이 PC에 실제 존재하는 ttf 후보(우선순위순).
// 애플/구글 전용 폰트는 이 윈도우 PC엔 파일 자체가 없어서(실측 확인: 설치된 글꼴 중
// arial/impact/malgun*/NanumGothic만 매치) 맑은고딕으로 조용히 대체된다 — ffmpeg는
// fontfile 경로가 없으면 그냥 죽어버리므로(크래시보다 낫다는 판단), 빈 번인보다 "약간
// 다른 폰트로라도 보이는" 쪽을 택함.
const FONT_CANDIDATES = {
  'Apple SD Gothic Neo': ['malgunbd.ttf', 'malgun.ttf'],
  'Noto Sans KR': ['malgunbd.ttf', 'malgun.ttf'],
  'Nanum Gothic': ['NanumGothic.ttf', 'malgun.ttf'],
  'Nanum Myeongjo': ['malgun.ttf'],
  'Gothic A1': ['malgun.ttf'],
  'Arial': ['arialbd.ttf', 'arial.ttf'],
  'Impact': ['impact.ttf'],
}

export function resolveSubtitleFontFile(fontName) {
  const candidates = FONT_CANDIDATES[fontName] || ['malgun.ttf']
  for (const name of candidates) {
    const p = path.join(WIN_FONTS_DIR, name)
    if (fs.existsSync(p)) return p
  }
  return path.join(WIN_FONTS_DIR, 'malgun.ttf')
}

// VideoTab.jsx isLightColor()와 동일 공식(표준 상대 휘도 근사) — 외곽선 색을 글자색과
// 자동으로 반대로 둬서 밝은/어두운 배경 둘 다에서 읽히게 함.
function isLightColor(hex) {
  const h = (hex || '#ffffff').replace('#', '')
  const r = parseInt(h.substring(0, 2), 16) || 0
  const g = parseInt(h.substring(2, 4), 16) || 0
  const b = parseInt(h.substring(4, 6), 16) || 0
  return (0.299 * r + 0.587 * g + 0.114 * b) > 150
}

// ffmpeg 필터그래프 안의 "경로"(드라이브 문자 콜론이 옵션 구분자와 겹침) 이스케이프.
function escFilterPath(p) {
  return String(p).replace(/\\/g, '/').replace(/:/g, '\\:')
}
function escFilterValue(v) {
  return String(v).replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\\'")
}

// VideoTab.jsx drawPreview()와 같은 기준값(2026-11-03 재수정분) — position별 "박스 아래쪽
// 가장자리"가 프레임 높이의 몇 %에 오는지.
const POSITION_RATIO = { top: 0.75, middle: 0.85, bottom: 0.93 }

// 2026-11-07 추가(성준님 제보 — SF_E01 전체 재번인 중 컷5~8만 글자가 눈에 띄게 크게 나옴):
// VideoTab.jsx 미리보기 캔버스는 항상 1920x1080 고정 좌표계라 fontSize를 그 안에서
// 그대로(스케일 없이) 픽셀값으로 쓰는데, 이 번인 함수도 똑같이 fontSize를 "실제 영상
// 해상도와 무관하게" 그대로 픽셀로 썼다. 실측: 같은 fontSize=58인데 컷2/4는 출력이
// 1080x1920(세로폭 1920)이라 의도한 크기로 나왔고, 컷5~8은 원본 Veo 클립 자체가
// 720x1280(세로폭 1280, 더 낮은 해상도)이라 같은 58px가 프레임에서 차지하는 비율이
// 1920/1280=1.5배 커 보였다 — 해상도가 들쭉날쭉한 소스를 다루는 이 파이프라인 구조상
// 당연히 생기는 문제인데 보정이 전혀 없었음. referenceHeight(기본 1920, 지금까지
// "정상으로 보였던" 컷들의 실제 세로폭)를 기준으로 fontSize·패딩·외곽선 두께를 실제
// 영상 세로폭에 비례해서 조정 — videoHeight를 안 넘기면(호출부가 해상도를 모르는 옛
// 경로) 기존처럼 스케일 없이 그대로 동작해 하위호환 유지.
const DEFAULT_REFERENCE_HEIGHT = 1920

// 2026-11-07 추가(같은 제보 — SF_E01 컷5 재번인 실측 중 발견): VideoTab.jsx 미리보기
// 캔버스는 wrapCanvasText()로 긴 자막을 ctx.measureText 기반 정확 측정해 여러 줄로
// 접는데, 이 번인 함수는 그런 줄바꿈이 아예 없어서 긴 문장이 한 줄로 프레임 밖까지
// 삐져나갔다(실측: 컷5 "인플루언서 생활이, 가끔은 인형이 된 기분이라니까"가 좌우로
// 잘려서 나옴 — "미리보기=번인 결과"가 짧은 자막에만 성립했던 셈). 서버엔 캔버스처럼
// 실제 폰트로 측정할 방법이 없어(node-canvas 미설치) 글자당 너비를 어림(한글/한자 등
// 전각은 fontSize, 영문·숫자·기호는 fontSize*0.55, 공백은 fontSize*0.3)해 greedy로
// 줄바꿈 — 공백 기준으로 먼저 끊고, 공백 없이 한 단어(또는 한글 어절)가 그 자체로
// maxWidth를 넘으면 글자 단위로도 끊는다(wrapCanvasText와 같은 전략).
function estimateCharWidth(ch, fSize) {
  if (ch === ' ') return fSize * 0.3
  // 한글 완성형(가-힣)·한자·가나 등 전각 범위 — 대략 정사각형에 가깝게 그려짐.
  if (/[぀-ヿ㐀-鿿가-힣＀-￯]/.test(ch)) return fSize
  return fSize * 0.55
}
function measureLine(line, fSize) {
  let w = 0
  for (const ch of line) w += estimateCharWidth(ch, fSize)
  return w
}
function wrapForDrawtext(text, maxWidth, fSize) {
  const lines = []
  for (const para of String(text ?? '').split('\n')) {
    const words = para.split(' ')
    let line = ''
    for (const word of words) {
      const test = line ? `${line} ${word}` : word
      if (measureLine(test, fSize) > maxWidth && line) {
        if (measureLine(word, fSize) > maxWidth) {
          let charLine = line
          for (const ch of word) {
            const t2 = charLine + ch
            if (measureLine(t2, fSize) > maxWidth && charLine) {
              lines.push(charLine)
              charLine = ch
            } else {
              charLine = t2
            }
          }
          line = charLine
        } else {
          lines.push(line)
          line = word
        }
      } else {
        line = test
      }
    }
    lines.push(line)
  }
  return lines.join('\n')
}

// segments: [{text, start, end}] — 빈 텍스트는 호출부가 이미 걸러서 넘겨야 함.
// style: {font, fontSize, color, bgStyle, boxColor, position}
// workDir: 세그먼트별 자막 텍스트를 임시 .txt로 쓸 디렉터리 — 호출부가 ffmpeg 종료 후 정리.
// videoHeight/videoWidth: 실제 번인 대상 영상의 픽셀 크기 — 주어지면 referenceHeight
// 대비 비율로 fontSize/패딩/외곽선을 보정하고(해상도가 다른 컷들 사이 글자 크기 통일),
// videoWidth는 긴 자막 줄바꿈 폭 계산에 쓴다. 안 넘기면(호출부가 해상도를 모르는 옛
// 경로) 기존처럼 스케일·줄바꿈 없이 그대로 동작해 하위호환 유지.
// 반환: { filter: "drawtext=...,drawtext=...", tempFiles: [path,...] } — 세그먼트가
// 없으면 filter는 빈 문자열.
export function buildSubtitleDrawtextFilter(segments, style, workDir, videoHeight, videoWidth) {
  if (!Array.isArray(segments) || !segments.length) return { filter: '', tempFiles: [] }

  const fontFile = resolveSubtitleFontFile(style.font)
  const scale = (typeof videoHeight === 'number' && videoHeight > 0)
    ? videoHeight / DEFAULT_REFERENCE_HEIGHT : 1
  const fSize = Math.max(10, Math.round((Number(style.fontSize) || 32) * scale))
  const color = style.color || '#ffffff'
  const outline = isLightColor(color) ? '0x000000' : '0xffffff'
  const pad = Math.round(fSize * 0.28)
  // VideoTab.jsx drawPreview()와 같은 비율(세로형 0.86 / 가로형 0.80) — 실제 영상의
  // 가로세로를 직접 보고 판정(aspectRatio UI 토글이 아니라 실측값이라 더 신뢰할 수 있음).
  // 2026-11-07 재검증(성준님 제보 — 직접 두 줄로 입력한 자막이 또 세 줄로 쪼개짐):
  // "videoHeight 기준으로 스케일하면 캔버스와 같은 좌표계가 될 것"이라 보고 한 번
  // videoWidth 대신 videoHeight*scale로 바꿔봤는데, 실측(브라우저에서 실제 fontSize=39로
  // 직접 measureText) 결과 그건 틀렸다 — 미리보기 캔버스(1920×1080 고정, CSS로 실제
  // 플레이어 박스에 늘어나 맞춰짐)와 실제 영상 픽셀 사이엔 X·Y가 서로 다르게 늘어날 수
  // 있어 단일 배율로 안 맞는다. 실측 기준은 "글자가 실제 영상 프레임 폭을 벗어나는가"
  // 하나뿐 — videoWidth(진짜 가로 픽셀)에 비율을 곱한 게 맞는 상한선이었다(실측: 컷6
  // "어떤 음료수보다, 할머니가 끓여주신 이 시원한"이 fontSize 39에서 736px로 720px
  // 프레임 자체보다 넓어서, 사람이 그대로 한 줄로 써도 줄바꿈이 필요한 게 맞았음).
  const maxTextWidth = (typeof videoWidth === 'number' && videoWidth > 0)
    ? videoWidth * ((videoHeight >= videoWidth) ? 0.86 : 0.80)
    : Infinity
  const ratio = POSITION_RATIO[style.position] ?? POSITION_RATIO.bottom
  const boxHex = '0x' + (style.boxColor || '#000000').replace('#', '')

  fs.mkdirSync(workDir, { recursive: true })
  const tempFiles = []
  const parts = segments.map((seg, i) => {
    const txtPath = path.join(workDir, `cap_${i}.txt`)
    // drawtext textfile= 은 파일 내용을 그대로(이스케이프 불필요) 쓴다 — 콜론·슬래시·따옴표
    // 섞인 한글 대사를 text= 인라인으로 넘길 때 생기는 이스케이프 지옥을 통째로 피함.
    fs.writeFileSync(txtPath, wrapForDrawtext(seg.text, maxTextWidth, fSize), 'utf-8')
    tempFiles.push(txtPath)
    const opts = [
      `fontfile='${escFilterPath(fontFile)}'`,
      `textfile='${escFilterPath(txtPath)}'`,
      `fontsize=${fSize}`,
      `fontcolor=${escFilterValue(color)}`,
      `x=(w-text_w)/2`,
      `y=h*${ratio}-text_h`,
      // 배경 스타일과 무관하게 항상 외곽선 한 겹(미리보기 캔버스와 동일 — 2026-09-15 확정 방침).
      `borderw=${Math.max(2, Math.round(fSize * 0.09))}`,
      `bordercolor=${outline}@0.85`,
      `line_spacing=4`,
    ]
    if (style.bgStyle === '반투명 직각 박스') {
      opts.push(`box=1`, `boxcolor=${boxHex}@0.68`, `boxborderw=${pad}`)
    } else if (style.bgStyle === '그림자') {
      opts.push(`shadowcolor=black@0.95`, `shadowx=1`, `shadowy=1`)
    }
    const start = Math.max(0, Number(seg.start) || 0)
    const end = Math.max(start + 0.05, Number(seg.end) || start + 1)
    opts.push(`enable='between(t,${start.toFixed(3)},${end.toFixed(3)})'`)
    return `drawtext=${opts.join(':')}`
  })
  return { filter: parts.join(','), tempFiles }
}
