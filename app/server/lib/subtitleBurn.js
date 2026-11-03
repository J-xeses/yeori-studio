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

// segments: [{text, start, end}] — 빈 텍스트는 호출부가 이미 걸러서 넘겨야 함.
// style: {font, fontSize, color, bgStyle, boxColor, position}
// workDir: 세그먼트별 자막 텍스트를 임시 .txt로 쓸 디렉터리 — 호출부가 ffmpeg 종료 후 정리.
// 반환: { filter: "drawtext=...,drawtext=...", tempFiles: [path,...] } — 세그먼트가
// 없으면 filter는 빈 문자열.
export function buildSubtitleDrawtextFilter(segments, style, workDir) {
  if (!Array.isArray(segments) || !segments.length) return { filter: '', tempFiles: [] }

  const fontFile = resolveSubtitleFontFile(style.font)
  const fSize = Math.max(10, Math.round(Number(style.fontSize) || 32))
  const color = style.color || '#ffffff'
  const outline = isLightColor(color) ? '0x000000' : '0xffffff'
  const pad = Math.round(fSize * 0.28)
  const ratio = POSITION_RATIO[style.position] ?? POSITION_RATIO.bottom
  const boxHex = '0x' + (style.boxColor || '#000000').replace('#', '')

  fs.mkdirSync(workDir, { recursive: true })
  const tempFiles = []
  const parts = segments.map((seg, i) => {
    const txtPath = path.join(workDir, `cap_${i}.txt`)
    // drawtext textfile= 은 파일 내용을 그대로(이스케이프 불필요) 쓴다 — 콜론·슬래시·따옴표
    // 섞인 한글 대사를 text= 인라인으로 넘길 때 생기는 이스케이프 지옥을 통째로 피함.
    fs.writeFileSync(txtPath, String(seg.text || ''), 'utf-8')
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
