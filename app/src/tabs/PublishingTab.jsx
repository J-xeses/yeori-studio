import { useState, useRef, useEffect, useCallback } from 'react'
import { useApp } from '../context/AppContext'
import { claudeMessages } from '../lib/api'
import EpisodeInfoSidebar from '../components/EpisodeInfoSidebar'
import TabToolbar from '../components/TabToolbar'
import s from './PublishingTab.module.css'

const SERVER = 'http://localhost:3001'
const SECTIONS = [
  { key: 'thumb',   label: '① 썸네일' },
  { key: 'meta',    label: '② 제목/설명/태그' },
  { key: 'package', label: '③ 결과물 패키징' },
  { key: 'upload',  label: '④ 업로드' },
  { key: 'status',  label: '⑤ 업로드 현황' },
]

// 2026-11-04 — ThumbTrend Studio(성준님 별도 썸네일 도구, localhost:4000) 벤치마킹 반영:
// 거기선 16:9/9:16 외에 인스타 피드용 1:1·4:5도 기본 제공했음 — 여리 스튜디오에도 추가.
const RATIOS = [
  { key: '16:9', label: '16:9 (YouTube)', w: 1280, h: 720 },
  { key: '9:16', label: '9:16 (쇼츠/릴스/TikTok)', w: 1080, h: 1920 },
  { key: '1:1',  label: '1:1 (인스타 피드)', w: 1080, h: 1080 },
  { key: '4:5',  label: '4:5 (인스타 세로피드)', w: 1080, h: 1350 },
]

// 해상도 배수 — ThumbTrend Studio Step4("고화질 출력")의 1x/2x QHD/4x 4K 선택지를 그대로 반영.
const EXPORT_SCALES = [
  { key: 1, label: '1x (기본)' },
  { key: 2, label: '2x (QHD 권장)' },
  { key: 4, label: '4x (4K 마스터)' },
]

// 2026-11-03 — "포스터 레이어" 손글씨 타이포 프리셋. 굵고 자유분방한 느낌 위주로 구글 폰트에서
// 선별(눈누 상업용 폰트는 앱에 직접 임베드하기 번거로워 웹폰트로 안정적으로 로드되는 쪽을 택함).
const FONT_PRESETS = [
  { key: 'black-han-sans', label: 'Black Han Sans · 굵은 임팩트', family: '"Black Han Sans", sans-serif' },
  { key: 'jua',             label: 'Jua · 두껍고 둥근 손글씨',    family: '"Jua", sans-serif' },
  { key: 'gamja-flower',    label: 'Gamja Flower · 굵은 손글씨',  family: '"Gamja Flower", cursive' },
  { key: 'do-hyeon',        label: 'Do Hyeon · 굵은 고딕',        family: '"Do Hyeon", sans-serif' },
  { key: 'east-sea-dokdo',  label: 'East Sea Dokdo · 손글씨',     family: '"East Sea Dokdo", cursive' },
  { key: 'gaegu',           label: 'Gaegu · 편안한 손글씨',       family: '"Gaegu", cursive' },
]
const GOOGLE_FONTS_HREF = 'https://fonts.googleapis.com/css2?family=Black+Han+Sans&family=Jua&family=Gamja+Flower&family=Do+Hyeon&family=East+Sea+Dokdo&family=Gaegu:wght@700&display=swap'
const fontFamilyFor = (key) => (FONT_PRESETS.find(f => f.key === key) || FONT_PRESETS[0]).family

const DOODLE_TYPES = [
  { key: 'circle', label: '○ 낙서 동그라미' },
  { key: 'star',   label: '★ 별' },
  { key: 'arrow2', label: '↝ 손그림 화살표' },
]

// 2026-11-04 — ThumbTrend Studio TEXT_PRESETS 포팅(6종 선별). 거긴 TextLayer마다 독립 스타일을
// 가지는 레이어 모델이었지만, 여기 메인 텍스트는 단일 thumbnail.text 필드이므로 "1클릭으로
// thumbnail 상태 전체를 덮어쓰는 프리셋"으로 단순화. secondaryOutline·bgBox는 이번에 새로
// 추가하는 필드(기존엔 외곽선 1단 + 글로우만 있었음).
const VIRAL_TEXT_PRESETS = [
  {
    key: 'yt_dual_stroke', label: '유튜브 2단 외곽선', preview: '충격 실화',
    apply: { fontKey: 'black-han-sans', color: '#FFE600', textOutline: true, outlineColor: '#000000', secondaryOutline: true, secondaryOutlineColor: '#1E1E24', textGlow: false, bgBox: false },
  },
  {
    key: 'cyber_neon', label: '사이버펑크 네온 글로우', preview: '미친 성능', fontFamily: "'Pretendard', sans-serif",
    apply: { fontKey: 'do-hyeon', color: '#00F0FF', textOutline: true, outlineColor: '#050515', secondaryOutline: false, textGlow: true, glowColor: '#00F0FF', bgBox: false },
  },
  {
    key: 'breaking_red', label: '긴급 이슈 레드박스', preview: '단독 입수',
    apply: { fontKey: 'black-han-sans', color: '#FFFFFF', textOutline: true, outlineColor: '#7F1D1D', secondaryOutline: false, textGlow: false, bgBox: true, bgBoxColor: '#DC2626' },
  },
  {
    key: 'highlighter', label: '형광펜 마커 강조', preview: '진짜 이유',
    apply: { fontKey: 'jua', color: '#0F172A', textOutline: false, secondaryOutline: false, textGlow: false, bgBox: true, bgBoxColor: '#A3E635' },
  },
  {
    key: 'gold_luxury', label: '골드 럭셔리', preview: 'TOP 1%',
    apply: { fontKey: 'do-hyeon', color: '#FDE047', textOutline: true, outlineColor: '#422006', secondaryOutline: false, textGlow: false, bgBox: false },
  },
  {
    key: 'black_han_impact', label: '어그로 치트키', preview: '역대급 발견',
    apply: { fontKey: 'black-han-sans', color: '#EF4444', textOutline: true, outlineColor: '#FFFFFF', secondaryOutline: true, secondaryOutlineColor: '#000000', textGlow: false, bgBox: false },
  },
]

// ThumbTrend Studio TREND_BADGES 중 코너 뱃지에 바로 쓸 수 있는 9종 — 기존 badgeText/badgeColor를
// 1클릭으로 채워주는 용도(색상 조합까지 포함해서 디자인 고민 없이 바로 적용).
const TREND_BADGE_PRESETS = [
  { label: '🔴 LIVE', text: '🔴 LIVE', bg: '#EF4444', fg: '#FFFFFF' },
  { label: '🚨 긴급 속보', text: '🚨 긴급 속보', bg: '#DC2626', fg: '#FFFFFF' },
  { label: '🔥 100만뷰 돌파', text: '🔥 100만뷰 돌파', bg: '#F59E0B', fg: '#000000' },
  { label: '⚠️ 충격 주의', text: '⚠️ 충격 주의', bg: '#EAB308', fg: '#000000' },
  { label: '🏆 TOP 5 추천', text: '🏆 TOP 5 추천', bg: '#6366F1', fg: '#FFFFFF' },
  { label: '✨ 최신판', text: '✨ 2026 최신판', bg: '#10B981', fg: '#FFFFFF' },
  { label: '💯 내돈내산', text: '💯 솔직 내돈내산', bg: '#06B6D4', fg: '#FFFFFF' },
  { label: '⚡ 종결판', text: '⚡ 종결판 끝판왕', bg: '#8B5CF6', fg: '#FFFFFF' },
]

// 포스터 레이어용 손그림 느낌 도형 — 랜덤 없이 고정된 손맛 변형(두 번 겹쳐 그린 삐뚠 원 등)으로
// 매 렌더마다 모양이 흔들리지 않게 한다. ctx는 레이어 중심으로 이미 translate/rotate된 상태로 들어온다.
function drawDoodle(ctx, type, r, color) {
  ctx.save()
  ctx.strokeStyle = color
  ctx.fillStyle = color
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  if (type === 'star') {
    const spikes = 5, outerR = r, innerR = r * 0.45
    ctx.beginPath()
    for (let i = 0; i < spikes * 2; i++) {
      const rad = i % 2 === 0 ? outerR : innerR
      const ang = (Math.PI / spikes) * i - Math.PI / 2
      const px = Math.cos(ang) * rad, py = Math.sin(ang) * rad
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py)
    }
    ctx.closePath(); ctx.fill()
  } else if (type === 'arrow2') {
    ctx.lineWidth = Math.max(4, r * 0.18)
    ctx.beginPath()
    ctx.moveTo(-r, r * 0.6)
    ctx.quadraticCurveTo(0, -r * 0.8, r, -r * 0.1)
    ctx.stroke()
    const headLen = r * 0.4
    ctx.beginPath()
    ctx.moveTo(r, -r * 0.1)
    ctx.lineTo(r - headLen * 0.9, -r * 0.1 - headLen * 0.5)
    ctx.moveTo(r, -r * 0.1)
    ctx.lineTo(r - headLen * 0.3, -r * 0.1 + headLen * 0.55)
    ctx.stroke()
  } else {
    ctx.lineWidth = Math.max(3, r * 0.1)
    ctx.beginPath(); ctx.ellipse(0, 0, r, r * 0.9, 0.08, 0, Math.PI * 2 * 0.96); ctx.stroke()
    ctx.beginPath(); ctx.ellipse(r * 0.04, r * 0.03, r * 0.97, r * 0.93, -0.05, 0, Math.PI * 2 * 0.9); ctx.stroke()
  }
  ctx.restore()
}

// object-fit: cover와 동일하게 비율을 유지하며 대상 영역을 꽉 채워 그린다
function drawImageCover(ctx, img, x, y, w, h) {
  const imgRatio = img.width / img.height
  const boxRatio = w / h
  let sx, sy, sw, sh
  if (imgRatio > boxRatio) {
    sh = img.height
    sw = sh * boxRatio
    sx = (img.width - sw) / 2
    sy = 0
  } else {
    sw = img.width
    sh = sw / boxRatio
    sx = 0
    sy = (img.height - sh) / 2
  }
  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h)
}

// 2026-11-04 — 기존 draw()의 그리기 로직을 모듈 레벨 순수 함수로 분리(ThumbTrend Studio
// canvasRenderer.ts 벤치마킹: 해상도와 렌더 로직을 분리). scale은 EXPORT_SCALES 배수를 받아
// 폰트 크기·선 두께·그림자 같은 "절대 px" 값들을 캔버스 실제 크기에 맞춰 같이 키운다 — W/H 기반
// %값들은 자동으로 스케일되지만 thumbnail.fontSize 같은 절대값은 그대로 두면 고해상도 내보내기에서
// 상대적으로 작아져 버리기 때문. selectedLayerId는 내보내기 시 null로 넘겨 선택 테두리를 뺀다.
function renderThumbnailFrame(ctx, W, H, scale, { thumbnail, bgImage, posterLayers, selectedLayerId }) {
  ctx.clearRect(0, 0, W, H)

  ctx.save()
  ctx.filter = `brightness(${thumbnail.brightness ?? 100}%) contrast(${thumbnail.contrast ?? 100}%) saturate(${thumbnail.saturation ?? 100}%)`
  if (bgImage) {
    drawImageCover(ctx, bgImage, 0, 0, W, H)
  } else {
    const grad = ctx.createLinearGradient(0, 0, W, H)
    grad.addColorStop(0, '#1a0a2e'); grad.addColorStop(1, '#0a0a1f')
    ctx.fillStyle = grad; ctx.fillRect(0, 0, W, H)
    ctx.fillStyle = 'rgba(124,58,237,.06)'; ctx.fillRect(0, 0, W, H)
  }
  ctx.restore()

  if (thumbnail.vignette) {
    const strength = (thumbnail.vignetteStrength ?? 55) / 100
    const vgrad = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.25, W / 2, H / 2, Math.max(W, H) * 0.75)
    vgrad.addColorStop(0, 'rgba(0,0,0,0)'); vgrad.addColorStop(1, `rgba(0,0,0,${strength})`)
    ctx.fillStyle = vgrad; ctx.fillRect(0, 0, W, H)
  }

  if (thumbnail.text) {
    const overlay = ctx.createLinearGradient(0, H * 0.5, 0, H)
    overlay.addColorStop(0, 'rgba(0,0,0,0)'); overlay.addColorStop(1, 'rgba(0,0,0,0.75)')
    ctx.fillStyle = overlay; ctx.fillRect(0, 0, W, H)
  }
  if (thumbnail.text) {
    const lines = thumbnail.text.split('\n')
    const fSize = (thumbnail.fontSize || 48) * scale
    const fam = thumbnail.fontKey ? fontFamilyFor(thumbnail.fontKey) : '"Apple SD Gothic Neo",sans-serif'
    ctx.font = `${thumbnail.bold !== false ? 'bold ' : ''}${fSize}px ${fam}`
    ctx.textAlign = 'center'
    const yBase = H * ((thumbnail.textY || 70) / 100)
    const lineH = fSize * 1.3
    const totalH = lines.length * lineH

    // 형광펜/레드박스 하이라이트 배경 — ThumbTrend TextLayer.backgroundColor 포팅. 외곽선보다
    // 먼저(텍스트 뒤에) 그려야 글자가 박스 위에 얹힌 모양이 된다.
    if (thumbnail.bgBox) {
      let maxWidth = 0
      lines.forEach(line => { const w = ctx.measureText(line).width; if (w > maxWidth) maxWidth = w })
      const padX = 24 * scale, padY = 14 * scale, rad = 10 * scale
      const boxW = maxWidth + padX * 2, boxH = totalH + padY * 2
      const boxX = W / 2 - boxW / 2, boxY = yBase - totalH / 2 - padY
      ctx.save()
      ctx.fillStyle = thumbnail.bgBoxColor || '#DC2626'
      const r = Math.min(rad, boxW / 2, boxH / 2)
      ctx.beginPath()
      ctx.moveTo(boxX + r, boxY)
      ctx.lineTo(boxX + boxW - r, boxY)
      ctx.quadraticCurveTo(boxX + boxW, boxY, boxX + boxW, boxY + r)
      ctx.lineTo(boxX + boxW, boxY + boxH - r)
      ctx.quadraticCurveTo(boxX + boxW, boxY + boxH, boxX + boxW - r, boxY + boxH)
      ctx.lineTo(boxX + r, boxY + boxH)
      ctx.quadraticCurveTo(boxX, boxY + boxH, boxX, boxY + boxH - r)
      ctx.lineTo(boxX, boxY + r)
      ctx.quadraticCurveTo(boxX, boxY, boxX + r, boxY)
      ctx.closePath()
      ctx.fill()
      ctx.restore()
    }

    lines.forEach((line, i) => {
      const y = yBase - totalH / 2 + i * lineH + fSize / 2
      if (thumbnail.textGlow) {
        ctx.shadowColor = thumbnail.glowColor || '#fbbf24'; ctx.shadowBlur = 22 * scale
        ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0
        ctx.fillStyle = thumbnail.color || '#ffffff'
        ctx.fillText(line, W / 2, y)
      }
      ctx.shadowColor = '#000'; ctx.shadowBlur = 12 * scale; ctx.shadowOffsetX = 2 * scale; ctx.shadowOffsetY = 2 * scale
      // 2단 외곽선(secondaryOutline) — ThumbTrend "유튜브 시그니처 2단 외곽선" 포팅. 바깥쪽
      // 두꺼운 테두리를 먼저 그리고, 그 위에 기존 1단 외곽선을 더 얇게 겹쳐 그린다.
      if (thumbnail.secondaryOutline) {
        ctx.lineJoin = 'round'
        ctx.strokeStyle = thumbnail.secondaryOutlineColor || '#000000'
        ctx.lineWidth = Math.max(2, fSize * 0.26)
        ctx.strokeText(line, W / 2, y)
      }
      if (thumbnail.textOutline) {
        ctx.lineJoin = 'round'
        ctx.strokeStyle = thumbnail.outlineColor || '#000000'
        ctx.lineWidth = Math.max(2, fSize * 0.12)
        ctx.strokeText(line, W / 2, y)
      }
      ctx.fillStyle = thumbnail.color || '#ffffff'
      ctx.fillText(line, W / 2, y)
    })
    ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0
  }

  if (thumbnail.circleOn) {
    const cx = W * (thumbnail.circleX ?? 75) / 100
    const cy = H * (thumbnail.circleY ?? 35) / 100
    const r = Math.min(W, H) * (thumbnail.circleSize ?? 18) / 100
    ctx.save()
    ctx.strokeStyle = thumbnail.circleColor || '#ef4444'
    ctx.lineWidth = Math.max(4, r * 0.08)
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke()
    ctx.restore()
  }
  if (thumbnail.arrowOn) {
    const tipX = W * (thumbnail.arrowX ?? 50) / 100
    const tipY = H * (thumbnail.arrowY ?? 50) / 100
    const len = Math.min(W, H) * (thumbnail.arrowSize ?? 20) / 100
    const angle = ((thumbnail.arrowAngle ?? 45) * Math.PI) / 180
    const tailX = tipX - Math.cos(angle) * len, tailY = tipY - Math.sin(angle) * len
    const color = thumbnail.arrowColor || '#facc15'
    ctx.save()
    ctx.strokeStyle = color; ctx.fillStyle = color
    ctx.lineWidth = Math.max(5, len * 0.08); ctx.lineCap = 'round'
    ctx.beginPath(); ctx.moveTo(tailX, tailY); ctx.lineTo(tipX, tipY); ctx.stroke()
    const headLen = len * 0.32, headAngle = Math.PI / 7
    ctx.beginPath()
    ctx.moveTo(tipX, tipY)
    ctx.lineTo(tipX - headLen * Math.cos(angle - headAngle), tipY - headLen * Math.sin(angle - headAngle))
    ctx.lineTo(tipX - headLen * Math.cos(angle + headAngle), tipY - headLen * Math.sin(angle + headAngle))
    ctx.closePath(); ctx.fill()
    ctx.restore()
  }

  if (thumbnail.badgeOn && thumbnail.badgeText) {
    ctx.save()
    ctx.font = `bold ${28 * scale}px "Apple SD Gothic Neo",sans-serif`
    const tw = ctx.measureText(thumbnail.badgeText).width
    const boxW = tw + 28 * scale, boxH = 44 * scale, margin = 16 * scale
    const corner = thumbnail.badgeCorner || 'tl'
    const bx = corner === 'tr' || corner === 'br' ? W - boxW - margin : margin
    const by = corner === 'bl' || corner === 'br' ? H - boxH - margin : margin
    ctx.fillStyle = thumbnail.badgeColor || '#ef4444'
    ctx.fillRect(bx, by, boxW, boxH)
    ctx.fillStyle = thumbnail.badgeTextColor || '#ffffff'
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.fillText(thumbnail.badgeText, bx + boxW / 2, by + boxH / 2 + 1)
    ctx.restore()
  }

  posterLayers.forEach(layer => {
    ctx.save()
    const lx = W * (layer.xPct ?? 50) / 100
    const ly = H * (layer.yPct ?? 50) / 100
    ctx.translate(lx, ly)
    ctx.rotate(((layer.rotate ?? 0) * Math.PI) / 180)
    let bw = 80 * scale, bh = 60 * scale
    if (layer.kind === 'text') {
      const fam = fontFamilyFor(layer.fontKey)
      const size = (layer.size || 64) * scale
      ctx.font = `${size}px ${fam}`
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
      const text = layer.text || ''
      if (layer.stroke) {
        ctx.lineJoin = 'round'
        ctx.strokeStyle = layer.strokeColor || '#141214'
        ctx.lineWidth = Math.max(3, size * 0.16)
        ctx.strokeText(text, 0, 0)
      }
      ctx.fillStyle = layer.color || '#ffffff'
      ctx.fillText(text, 0, 0)
      bw = Math.max(60 * scale, ctx.measureText(text).width + size * 0.3); bh = size * 1.4
    } else if (layer.kind === 'doodle') {
      const r = Math.min(W, H) * (layer.size ?? 14) / 100
      drawDoodle(ctx, layer.doodleType, r, layer.color || '#fbbf24')
      bw = bh = r * 2.3
    }
    if (layer.id === selectedLayerId) {
      ctx.strokeStyle = 'rgba(167,139,250,.9)'; ctx.lineWidth = 2; ctx.setLineDash([6, 4])
      ctx.strokeRect(-bw / 2, -bh / 2, bw, bh)
      ctx.setLineDash([])
    }
    ctx.restore()
  })

  ctx.fillStyle = 'rgba(167,139,250,.25)'; ctx.font = `${12 * scale}px sans-serif`; ctx.textAlign = 'right'; ctx.textBaseline = 'alphabetic'
  ctx.fillText('여리 Studio', W - 12 * scale, H - 10 * scale)
}

// 세이프존 가이드 — ThumbTrend Studio validationEngine.ts의 좌표 규칙을 그대로 가져와 "위험
// 영역"을 캔버스 위에 점선으로 겹쳐 보여준다. 내보내기(PNG/클립보드)에는 포함하지 않고
// 미리보기에서만 토글로 켠다.
function drawSafeZoneGuides(ctx, W, H, ratio) {
  if (ratio !== '16:9' && ratio !== '9:16') return
  ctx.save()
  ctx.setLineDash([8, 6])
  ctx.lineWidth = 2
  ctx.strokeStyle = 'rgba(239,68,68,0.85)'
  ctx.font = '12px sans-serif'
  ctx.textAlign = 'left'; ctx.textBaseline = 'top'

  const zone = (x0, y0, x1, y1, label) => {
    const X = W * x0 / 100, Y = H * y0 / 100, Wz = W * (x1 - x0) / 100, Hz = H * (y1 - y0) / 100
    ctx.fillStyle = 'rgba(239,68,68,0.12)'
    ctx.fillRect(X, Y, Wz, Hz)
    ctx.strokeRect(X, Y, Wz, Hz)
    ctx.fillStyle = 'rgba(239,68,68,0.95)'
    ctx.fillText(label, X + 6, Y + 4)
  }

  if (ratio === '16:9') {
    zone(74, 70, 100, 100, '⏱ 재생시간 배지')
  } else if (ratio === '9:16') {
    zone(78, 30, 100, 90, '👍 좋아요/댓글')
    zone(0, 76, 100, 100, '🔊 사운드/계정명')
  }
  ctx.setLineDash([])
  ctx.restore()
}

// CTR 검증 — ThumbTrend Studio validationEngine.ts(runThumbnailValidation) 포팅. 레이어 모델이
// 아니라 이 탭의 단일 thumbnail 상태값 기준으로 같은 체크 항목을 재현한다.
function computeCtrReport(thumbnail, posterLayers, ratio) {
  const checks = []
  let score = 100

  const text = (thumbnail.text || '').trim()
  if (!text) {
    checks.push({ severity: 'danger', msg: '핵심 타이틀이 없습니다. 후킹 문구를 추가하세요.' })
    score -= 25
  } else {
    const wordCount = text.split(/\s+/).filter(Boolean).length
    if (wordCount > 6) {
      checks.push({ severity: 'warning', msg: `텍스트 단어 수가 ${wordCount}개로 많습니다. 3~6단어로 줄이세요.` })
      score -= 10
    } else {
      checks.push({ severity: 'success', msg: `적정 단어 수(${wordCount}단어) — 3초 스캔에 최적화됨.` })
    }
    const fSize = thumbnail.fontSize || 48
    if (fSize < 38) {
      checks.push({ severity: 'warning', msg: `폰트 크기(${fSize}px)가 작습니다. 48px 이상 권장.` })
      score -= 8
    } else {
      checks.push({ severity: 'success', msg: '충분한 폰트 크기 확보.' })
    }
    const hasContrast = thumbnail.textOutline || thumbnail.secondaryOutline || thumbnail.bgBox
    if (!hasContrast) {
      checks.push({ severity: 'warning', msg: '외곽선/하이라이트 박스가 없어 배경에 묻힐 수 있습니다.' })
      score -= 12
    } else {
      checks.push({ severity: 'success', msg: '외곽선/박스로 배경과 분리됨.' })
    }
  }

  // 세이프존 — 메인 텍스트(textY)·코너뱃지·강조원·화살표·포스터레이어 위치를 위험영역과 대조.
  const dangerHit = (x, y) => {
    if (ratio === '16:9') return x > 74 && y > 70
    if (ratio === '9:16') return (x > 78 && y > 30 && y < 90) || y > 76
    return false
  }
  const points = []
  if (text) points.push([50, thumbnail.textY || 70])
  if (thumbnail.badgeOn) {
    const corner = thumbnail.badgeCorner || 'tl'
    points.push([corner.includes('r') ? 92 : 8, corner.includes('b') ? 92 : 8])
  }
  if (thumbnail.circleOn) points.push([thumbnail.circleX ?? 75, thumbnail.circleY ?? 35])
  if (thumbnail.arrowOn) points.push([thumbnail.arrowX ?? 50, thumbnail.arrowY ?? 50])
  posterLayers.forEach(l => points.push([l.xPct ?? 50, l.yPct ?? 50]))
  const violated = points.some(([x, y]) => dangerHit(x, y))
  if (ratio === '16:9' || ratio === '9:16') {
    if (violated) {
      checks.push({ severity: 'danger', msg: ratio === '16:9' ? '우측 하단 재생시간 배지 영역을 요소가 가립니다.' : '쇼츠/릴스 UI(좋아요·사운드) 영역을 요소가 가립니다.' })
      score -= 20
    } else {
      checks.push({ severity: 'success', msg: '플랫폼 UI 세이프존을 침범하지 않았습니다.' })
    }
  }

  const hasHook = thumbnail.badgeOn || thumbnail.circleOn || thumbnail.arrowOn
  if (!hasHook) {
    checks.push({ severity: 'warning', msg: '뱃지/화살표 등 시선 유도 장식이 없습니다(선택, 클릭 유도력 +18% 참고).' })
    score -= 5
  } else {
    checks.push({ severity: 'success', msg: '시선 유도 장식(뱃지/화살표)이 적용됨.' })
  }

  score = Math.max(20, Math.min(100, score))
  let grade = 'C'
  if (score >= 90) grade = 'S'
  else if (score >= 80) grade = 'A'
  else if (score >= 68) grade = 'B'
  return { score, grade, checks }
}

// ── ① 썸네일 섹션 (기존 캔버스 편집기 + 스튜디오 이미지 불러오기 + 서버 저장) ──
function ThumbnailSection({ epNum }) {
  const { state, dispatch } = useApp()
  const { thumbnail, episode, scriptRaw, cuts } = state
  const canvasRef = useRef(null)
  const bgRef = useRef(null)
  const fileRef = useRef(null)
  const [bgImage, setBgImage] = useState(null)
  const [studioImages, setStudioImages] = useState([])
  const [loadingImages, setLoadingImages] = useState(true)
  const [saveStatus, setSaveStatus] = useState('')
  const [selectedLayerId, setSelectedLayerId] = useState(null)
  const [fontsTick, setFontsTick] = useState(0) // 구글 폰트 로드 완료 시 캔버스 강제 재렌더용
  const [exportScale, setExportScale] = useState(1)
  const [copyStatus, setCopyStatus] = useState('')
  // "AI 후킹 문구 제안" — ThumbTrend Studio geminiService.ts 포팅(서버의 /api/thumbnail-ai-copy
  // 경유, studio-secrets.json apiKeys.gemini 사용, 키 없으면 서버가 알고리즘 폴백으로 응답).
  const [aiLoading, setAiLoading] = useState(false)
  const [aiResult, setAiResult] = useState(null)
  const [aiError, setAiError] = useState('')
  const draggingRef = useRef(false)

  const set = (p) => dispatch({ type: 'SET_THUMB', p })
  const ratio = thumbnail.ratio || '16:9'
  const dims = RATIOS.find(r => r.key === ratio) || RATIOS[0]
  const posterLayers = thumbnail.posterLayers || []
  const ctrReport = computeCtrReport(thumbnail, posterLayers, ratio)

  // 2026-10-23 — 성준님 요청: "YouTube 업로드용 썸네일 편집효과" 1단계(편집의도 기획 수준,
  // AI 배경제거·컷아웃 같은 무거운 작업 없이 캔버스 2D로 즉시 미리보기 가능한 수준). 벤치마킹
  // (vidIQ·CapCut·Picsart 등 썸네일 메이커 + CTR 가이드)에서 추린 4종: ①텍스트 외곽선·글로우
  // ②이미지 보정(밝기·대비·채도) ③비네트 ④강조 도형(원·화살표)+코너 뱃지.
  // 2026-11-04 — 실제 그리기 로직은 renderThumbnailFrame(모듈 레벨, 해상도 독립)으로 옮겨
  // 내보내기(2x/4x)에서도 재사용. 여기서는 라이브 캔버스에 scale=1로 그리고, 세이프존 가이드는
  // 미리보기에만 겹쳐 그린다(내보낸 파일에는 포함 안 됨).
  const draw = useCallback(() => {
    const canvas = canvasRef.current; if (!canvas) return
    const ctx = canvas.getContext('2d')
    renderThumbnailFrame(ctx, canvas.width, canvas.height, 1, { thumbnail, bgImage, posterLayers, selectedLayerId })
    if (thumbnail.showSafeZone) drawSafeZoneGuides(ctx, canvas.width, canvas.height, ratio)
  }, [bgImage, thumbnail, posterLayers, selectedLayerId, fontsTick, ratio])

  useEffect(() => { draw() }, [draw])

  // 포스터 레이어용 구글 폰트 로드 — 링크는 한 번만 head에 추가하고, 로드 완료 후 fontsTick을
  // 올려 draw()가 fallback 폰트로 그려졌던 첫 프레임을 올바른 폰트로 다시 그리게 한다.
  useEffect(() => {
    if (!document.getElementById('yeori-poster-fonts')) {
      const link = document.createElement('link')
      link.id = 'yeori-poster-fonts'
      link.rel = 'stylesheet'
      link.href = GOOGLE_FONTS_HREF
      document.head.appendChild(link)
    }
    let cancelled = false
    Promise.all(FONT_PRESETS.map(f => document.fonts.load(`700 16px ${f.family}`).catch(() => {})))
      .then(() => { if (!cancelled) setFontsTick(t => t + 1) })
    return () => { cancelled = true }
  }, [])

  const addTextLayer = () => {
    const id = `t${Date.now()}`
    set({ posterLayers: [...posterLayers, {
      id, kind: 'text', text: '문구 입력', xPct: 50, yPct: 50,
      fontKey: 'gamja-flower', size: 64, color: '#ffffff', rotate: 0,
      stroke: true, strokeColor: '#141214',
    }] })
    setSelectedLayerId(id)
  }
  const addDoodleLayer = (doodleType) => {
    const id = `d${Date.now()}`
    set({ posterLayers: [...posterLayers, {
      id, kind: 'doodle', doodleType, xPct: 50, yPct: 50, size: 14, color: '#fbbf24', rotate: 0,
    }] })
    setSelectedLayerId(id)
  }
  const updateLayer = (id, patch) => {
    set({ posterLayers: posterLayers.map(l => l.id === id ? { ...l, ...patch } : l) })
  }
  const removeLayer = (id) => {
    set({ posterLayers: posterLayers.filter(l => l.id !== id) })
    if (selectedLayerId === id) setSelectedLayerId(null)
  }

  // 선택된 레이어가 있을 때만 캔버스 클릭·드래그로 위치(xPct/yPct)를 옮길 수 있게 한다 —
  // 슬라이더 대신 미리보기에서 직접 끌어다 놓는 쪽이 포스터형 자유배치에 훨씬 빠르다.
  const canvasPosFromEvent = (e) => {
    const canvas = canvasRef.current
    const rect = canvas.getBoundingClientRect()
    const x = (e.clientX - rect.left) * (canvas.width / rect.width)
    const y = (e.clientY - rect.top) * (canvas.height / rect.height)
    return {
      xPct: Math.max(0, Math.min(100, (x / canvas.width) * 100)),
      yPct: Math.max(0, Math.min(100, (y / canvas.height) * 100)),
    }
  }
  const handleCanvasDown = (e) => {
    if (!selectedLayerId) return
    draggingRef.current = true
    updateLayer(selectedLayerId, canvasPosFromEvent(e))
  }
  const handleCanvasMove = (e) => {
    if (!draggingRef.current || !selectedLayerId) return
    updateLayer(selectedLayerId, canvasPosFromEvent(e))
  }
  const handleCanvasUp = () => { draggingRef.current = false }

  // 탭 전환/재접속 후에도 배경 이미지가 유지되도록 thumbnail.bgImageUrl(데이터 URL 또는 서버 URL)로 복원.
  // bgImageUrl은 에피소드별 tabState에 들어있어 에피소드 전환 시 바뀌는데(AppContext swapTabState),
  // 기존엔 "bgImage가 이미 있으면 건너뛴다" 가드 때문에 한 번 로드된 뒤로는 에피소드를 바꿔도 이전
  // 이미지가 캔버스에 그대로 남아있었음(2026-10-18, 성준님 지적) — 로드한 URL을 직접 추적해서
  // bgImageUrl이 실제로 바뀐 경우에만(그리고 비워진 경우엔 비우도록) 반응하게 수정.
  const loadedBgUrlRef = useRef(null)
  useEffect(() => {
    const bgUrl = thumbnail.bgImageUrl
    if (bgUrl === loadedBgUrlRef.current) return
    if (!bgUrl) { loadedBgUrlRef.current = ''; bgRef.current = null; setBgImage(null); return }
    const img = new Image()
    if (/^https?:\/\//.test(bgUrl)) img.crossOrigin = 'anonymous'
    img.onload = () => { bgRef.current = img; setBgImage(img); loadedBgUrlRef.current = bgUrl }
    img.src = bgUrl
  }, [thumbnail.bgImageUrl])

  const handleBgUpload = (file) => {
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const dataUrl = ev.target.result
      const img = new Image()
      img.onload = () => { bgRef.current = img; setBgImage(img); loadedBgUrlRef.current = dataUrl }
      img.src = dataUrl
      set({ bgImageUrl: dataUrl })
    }
    reader.readAsDataURL(file)
  }

  // ThumbTrend Studio Step4("고화질 출력") 포팅 — 1x/2x/4x 중 선택한 배수로 오프스크린 캔버스에
  // 새로 렌더링해서 내보낸다(기존 라이브 캔버스를 그대로 업스케일하면 텍스트가 뭉개짐).
  const renderExportCanvas = (scale) => {
    const off = document.createElement('canvas')
    off.width = dims.w * scale
    off.height = dims.h * scale
    const ctx = off.getContext('2d')
    renderThumbnailFrame(ctx, off.width, off.height, scale, { thumbnail, bgImage, posterLayers, selectedLayerId: null })
    return off
  }

  const downloadPNG = () => {
    const off = renderExportCanvas(exportScale)
    const url = off.toDataURL('image/png')
    const a = document.createElement('a'); a.href = url; a.download = `thumbnail@${exportScale}x.png`; a.click()
  }

  // ThumbTrend Studio Step4 "클립보드로 이미지 복사(유튜브 스튜디오에 바로 붙여넣기)" 포팅.
  const copyToClipboard = async () => {
    setCopyStatus('복사 중...')
    try {
      const off = renderExportCanvas(exportScale)
      const blob = await new Promise(resolve => off.toBlob(resolve, 'image/png'))
      if (!blob) throw new Error('이미지 변환 실패')
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
      setCopyStatus('✅ 클립보드에 복사됨 — 유튜브 스튜디오 등에 바로 붙여넣기 가능')
    } catch (err) {
      setCopyStatus('❌ 복사 실패: ' + err.message)
    }
  }

  // "AI 후킹 문구 제안" — 서버 /api/thumbnail-ai-copy 호출(episode 제목 + 대본 요약 전달).
  const generateAiHooks = async () => {
    setAiLoading(true); setAiError(''); setAiResult(null)
    try {
      const scriptSummary = scriptRaw?.trim() || buildScriptFromCuts(cuts)
      const platform = ratio === '9:16' ? 'shorts' : ratio === '16:9' ? 'youtube' : 'instagram'
      const res = await fetch(`${SERVER}/api/thumbnail-ai-copy`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: episode?.title || '', scriptSummary, platform, currentText: thumbnail.text || '' }),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setAiResult(data)
    } catch (err) {
      setAiError('AI 제안 생성 오류: ' + err.message)
    } finally {
      setAiLoading(false)
    }
  }

  // 스튜디오 탭에서 생성된 현재 에피소드 이미지 목록 불러오기
  const loadStudioImages = async () => {
    if (!epNum) return
    try {
      const res = await fetch(`${SERVER}/api/scan-media`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ epNum }),
      })
      const data = await res.json()
      // 컷당 이미지가 여러 개(A/B 등) 올 수 있어 배열로 온다 — 전부 펼쳐서 갤러리에 보여준다.
      const urls = Object.entries(data.images || {}).flatMap(([key, absPaths]) =>
        (Array.isArray(absPaths) ? absPaths : [absPaths]).map((absPath, i) => ({
          key: `${key}_${i}`,
          url: `${SERVER}/downloads/${absPath.replace(/.*downloads[\\/]/i, '').replace(/\\/g, '/')}`,
        }))
      )
      setStudioImages(urls)
    } catch {
      setStudioImages([])
    } finally {
      setLoadingImages(false)
    }
  }

  useEffect(() => {
    if (!epNum) return
    fetch(`${SERVER}/api/scan-media`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ epNum }),
    })
      .then(r => r.json())
      .then(data => {
        const urls = Object.entries(data.images || {}).flatMap(([key, absPaths]) =>
          (Array.isArray(absPaths) ? absPaths : [absPaths]).map((absPath, i) => ({
            key: `${key}_${i}`,
            url: `${SERVER}/downloads/${absPath.replace(/.*downloads[\\/]/i, '').replace(/\\/g, '/')}`,
          }))
        )
        setStudioImages(urls)
      })
      .catch(() => setStudioImages([]))
      .finally(() => setLoadingImages(false))
  }, [epNum])

  const pickStudioImage = (url) => {
    const img = new Image()
    img.crossOrigin = 'anonymous' // 캔버스 toDataURL 시 오염 방지
    img.src = url
    img.onload = () => { bgRef.current = img; setBgImage(img); loadedBgUrlRef.current = url }
    set({ bgImageUrl: url })
  }

  const saveThumbnail = async () => {
    const canvas = canvasRef.current; if (!canvas || !epNum) return
    setSaveStatus('저장 중...')
    try {
      const dataUrl = canvas.toDataURL('image/jpeg', 0.92)
      const res = await fetch(`${SERVER}/api/save-thumbnail`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ epNum, dataUrl }),
      })
      const data = await res.json()
      setSaveStatus(data.success ? `✅ 저장 완료 → ${data.path}` : `❌ ${data.error}`)
    } catch (err) {
      setSaveStatus(`❌ 오류: ${err.message}`)
    }
  }

  return (
    <div className={s.root}>
      <div className={s.left}>
        <div className={s.panel}>
          <div className={s.panelTitle}>썸네일 비율</div>
          <div className={s.ratioRow}>
            {RATIOS.map(r => (
              <button key={r.key}
                className={`${s.ratioBtn} ${ratio === r.key ? s.ratioBtnActive : ''}`}
                onClick={() => set({ ratio: r.key })}>
                {r.label}
              </button>
            ))}
          </div>
        </div>

        <div className={s.panel}>
          <div className={s.panelTitle}>썸네일 텍스트</div>
          <textarea className={s.textInput} rows={3}
            placeholder={'첫 줄 텍스트\n둘째 줄 텍스트'}
            value={thumbnail.text || ''}
            onChange={e => set({ text: e.target.value })} />
        </div>

        {/* 2026-11-04 — "AI 후킹 문구 제안"(구글 Gemini). ThumbTrend Studio(성준님 별도 썸네일
            도구) geminiService.ts의 generateSocialContentAi를 포팅 — studio-secrets.json에
            이미 등록돼 있던 apiKeys.gemini를 처음으로 실제 사용하는 기능. 키가 없거나 호출이
            실패해도 서버가 알고리즘 폴백으로 항상 결과를 돌려준다. */}
        <div className={s.panel}>
          <div className={s.panelTitle}>🪄 AI 후킹 문구 제안 (Google Gemini)</div>
          <div className={s.fields}>
            <button className={s.genBtn} style={{ margin: 0 }} onClick={generateAiHooks} disabled={aiLoading}>
              {aiLoading ? '⏳ 생성 중...' : '✨ 현재 대본 기반 제안 받기'}
            </button>
            {aiError && <div style={{ color: '#f87171', fontSize: 12 }}>{aiError}</div>}
            {aiResult && (
              <div className={s.aiResultBox}>
                <div className={s.aiScoreRow}>
                  <span className={s.aiScore}>바이럴 점수 {aiResult.viralScore}</span>
                  <span className={s.aiSource}>{aiResult.source === 'gemini' ? 'Gemini' : '알고리즘 폴백'}</span>
                </div>
                {aiResult.titles.map((t, i) => (
                  <button key={i} type="button" className={s.aiTitleBtn} onClick={() => set({ text: t })}>
                    {t}
                  </button>
                ))}
                {aiResult.badge && (
                  <button type="button" className={s.aiBadgeBtn}
                    onClick={() => set({ badgeOn: true, badgeText: aiResult.badge })}>
                    코너 뱃지로 적용: {aiResult.badge}
                  </button>
                )}
                {aiResult.tips?.length > 0 && (
                  <div className={s.aiTips}>{aiResult.tips.join(' · ')}</div>
                )}
              </div>
            )}
          </div>
        </div>

        <div className={s.panel}>
          <div className={s.panelTitle} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>스튜디오 이미지 불러오기 (EP{epNum || '-'})</span>
            <button className={s.refreshBtn} onClick={() => { setLoadingImages(true); loadStudioImages() }}>{loadingImages ? '...' : '↻'}</button>
          </div>
          {studioImages.length > 0 ? (
            <div className={s.studioImgGrid}>
              {studioImages.map(img => (
                <div key={img.key} className={s.studioImgItem} onClick={() => pickStudioImage(img.url)} title={img.key}>
                  <img src={img.url} alt={img.key} />
                </div>
              ))}
            </div>
          ) : (
            <div className={s.studioImgEmpty}>{loadingImages ? '불러오는 중...' : '스튜디오 탭에서 생성된 이미지가 없습니다'}</div>
          )}
        </div>

        <div className={s.panel}>
          <div className={s.panelTitle}>배경 이미지 (직접 업로드)</div>
          <div className={s.bgArea} onClick={() => fileRef.current?.click()}>
            {bgImage ? (
              <div className={s.bgLoaded}>
                <span>✓ 이미지 로드됨</span>
                <button className={s.removeBg} onClick={e => { e.stopPropagation(); setBgImage(null); bgRef.current = null; set({ bgImageUrl: '' }) }}>제거</button>
              </div>
            ) : (
              <div className={s.bgPlaceholder}>
                <span>🖼️</span>
                <span>배경 이미지 업로드</span>
                <span className={s.bgSub}>JPG · PNG · WEBP</span>
              </div>
            )}
          </div>
          <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }}
            onChange={e => handleBgUpload(e.target.files[0])} />
        </div>

        <div className={s.panel}>
          <div className={s.panelTitle}>텍스트 설정</div>
          <div className={s.fields}>
            <div className={s.field}>
              <label>글자 크기 <span className={s.val}>{thumbnail.fontSize || 48}px</span></label>
              <input type="range" min="20" max="120" value={thumbnail.fontSize || 48}
                onChange={e => set({ fontSize: parseInt(e.target.value) })} />
            </div>
            <div className={s.field}>
              <label>글자 색상</label>
              <div className={s.colorRow}>
                <input type="color" className={s.colorPicker}
                  value={thumbnail.color || '#ffffff'}
                  onChange={e => set({ color: e.target.value })} />
                <span className={s.colorVal}>{thumbnail.color || '#ffffff'}</span>
              </div>
            </div>
            <div className={s.field}>
              <label>텍스트 위치 (세로) <span className={s.val}>{thumbnail.textY || 70}%</span></label>
              <input type="range" min="10" max="95" value={thumbnail.textY || 70}
                onChange={e => set({ textY: parseInt(e.target.value) })} />
            </div>
            <div className={s.field}>
              <label className={s.checkLabel}>
                <input type="checkbox" checked={thumbnail.bold !== false}
                  onChange={e => set({ bold: e.target.checked })} />
                굵게 (Bold)
              </label>
            </div>
            <div className={s.field}>
              <label className={s.checkLabel}>
                <input type="checkbox" checked={!!thumbnail.textOutline}
                  onChange={e => set({ textOutline: e.target.checked })} />
                외곽선 (클릭베이트 스타일)
              </label>
              {thumbnail.textOutline && (
                <div className={s.colorRow}>
                  <input type="color" className={s.colorPicker}
                    value={thumbnail.outlineColor || '#000000'}
                    onChange={e => set({ outlineColor: e.target.value })} />
                  <span className={s.colorVal}>{thumbnail.outlineColor || '#000000'}</span>
                </div>
              )}
            </div>
            <div className={s.field}>
              <label className={s.checkLabel}>
                <input type="checkbox" checked={!!thumbnail.textGlow}
                  onChange={e => set({ textGlow: e.target.checked })} />
                글로우 (네온 번짐)
              </label>
              {thumbnail.textGlow && (
                <div className={s.colorRow}>
                  <input type="color" className={s.colorPicker}
                    value={thumbnail.glowColor || '#fbbf24'}
                    onChange={e => set({ glowColor: e.target.value })} />
                  <span className={s.colorVal}>{thumbnail.glowColor || '#fbbf24'}</span>
                </div>
              )}
            </div>
            <div className={s.field}>
              <label className={s.checkLabel}>
                <input type="checkbox" checked={!!thumbnail.secondaryOutline}
                  onChange={e => set({ secondaryOutline: e.target.checked })} />
                2단 외곽선 (유튜브 시그니처 스타일)
              </label>
              {thumbnail.secondaryOutline && (
                <div className={s.colorRow}>
                  <input type="color" className={s.colorPicker}
                    value={thumbnail.secondaryOutlineColor || '#1E1E24'}
                    onChange={e => set({ secondaryOutlineColor: e.target.value })} />
                  <span className={s.colorVal}>{thumbnail.secondaryOutlineColor || '#1E1E24'}</span>
                </div>
              )}
            </div>
            <div className={s.field}>
              <label className={s.checkLabel}>
                <input type="checkbox" checked={!!thumbnail.bgBox}
                  onChange={e => set({ bgBox: e.target.checked })} />
                하이라이트 박스 (형광펜/레드박스)
              </label>
              {thumbnail.bgBox && (
                <div className={s.colorRow}>
                  <input type="color" className={s.colorPicker}
                    value={thumbnail.bgBoxColor || '#DC2626'}
                    onChange={e => set({ bgBoxColor: e.target.value })} />
                  <span className={s.colorVal}>{thumbnail.bgBoxColor || '#DC2626'}</span>
                </div>
              )}
            </div>
            <div className={s.field}>
              <label>바이럴 스타일 1클릭 적용 (ThumbTrend Studio 벤치마킹)</label>
              <div className={s.presetGrid}>
                {VIRAL_TEXT_PRESETS.map(p => (
                  <button key={p.key} type="button" className={s.presetBtn}
                    style={{ fontFamily: fontFamilyFor(p.apply.fontKey), color: p.apply.color }}
                    onClick={() => set(p.apply)} title={p.label}>
                    {p.preview}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className={s.panel}>
          <div className={s.panelTitle}>이미지 보정</div>
          <div className={s.fields}>
            <div className={s.field}>
              <label>밝기 <span className={s.val}>{thumbnail.brightness ?? 100}%</span></label>
              <input type="range" min="50" max="150" value={thumbnail.brightness ?? 100}
                onChange={e => set({ brightness: parseInt(e.target.value) })} />
            </div>
            <div className={s.field}>
              <label>대비 <span className={s.val}>{thumbnail.contrast ?? 100}%</span></label>
              <input type="range" min="50" max="200" value={thumbnail.contrast ?? 100}
                onChange={e => set({ contrast: parseInt(e.target.value) })} />
            </div>
            <div className={s.field}>
              <label>채도 <span className={s.val}>{thumbnail.saturation ?? 100}%</span></label>
              <input type="range" min="0" max="200" value={thumbnail.saturation ?? 100}
                onChange={e => set({ saturation: parseInt(e.target.value) })} />
            </div>
            <div className={s.field}>
              <label className={s.checkLabel}>
                <input type="checkbox" checked={!!thumbnail.vignette}
                  onChange={e => set({ vignette: e.target.checked })} />
                비네트 (가장자리 어둡게)
              </label>
              {thumbnail.vignette && (
                <input type="range" min="0" max="100" value={thumbnail.vignetteStrength ?? 55}
                  onChange={e => set({ vignetteStrength: parseInt(e.target.value) })} />
              )}
            </div>
          </div>
        </div>

        <div className={s.panel}>
          <div className={s.panelTitle}>강조 도형 · 코너 뱃지</div>
          <div className={s.fields}>
            <div className={s.field}>
              <label className={s.checkLabel}>
                <input type="checkbox" checked={!!thumbnail.circleOn}
                  onChange={e => set({ circleOn: e.target.checked })} />
                강조 원 (얼굴·핵심 지점 포인트)
              </label>
              {thumbnail.circleOn && (
                <>
                  <label>가로 위치 <span className={s.val}>{thumbnail.circleX ?? 75}%</span></label>
                  <input type="range" min="0" max="100" value={thumbnail.circleX ?? 75}
                    onChange={e => set({ circleX: parseInt(e.target.value) })} />
                  <label>세로 위치 <span className={s.val}>{thumbnail.circleY ?? 35}%</span></label>
                  <input type="range" min="0" max="100" value={thumbnail.circleY ?? 35}
                    onChange={e => set({ circleY: parseInt(e.target.value) })} />
                  <label>크기 <span className={s.val}>{thumbnail.circleSize ?? 18}%</span></label>
                  <input type="range" min="5" max="45" value={thumbnail.circleSize ?? 18}
                    onChange={e => set({ circleSize: parseInt(e.target.value) })} />
                  <div className={s.colorRow}>
                    <input type="color" className={s.colorPicker}
                      value={thumbnail.circleColor || '#ef4444'}
                      onChange={e => set({ circleColor: e.target.value })} />
                    <span className={s.colorVal}>{thumbnail.circleColor || '#ef4444'}</span>
                  </div>
                </>
              )}
            </div>
            <div className={s.field}>
              <label className={s.checkLabel}>
                <input type="checkbox" checked={!!thumbnail.arrowOn}
                  onChange={e => set({ arrowOn: e.target.checked })} />
                강조 화살표
              </label>
              {thumbnail.arrowOn && (
                <>
                  <label>끝점 가로 <span className={s.val}>{thumbnail.arrowX ?? 50}%</span></label>
                  <input type="range" min="0" max="100" value={thumbnail.arrowX ?? 50}
                    onChange={e => set({ arrowX: parseInt(e.target.value) })} />
                  <label>끝점 세로 <span className={s.val}>{thumbnail.arrowY ?? 50}%</span></label>
                  <input type="range" min="0" max="100" value={thumbnail.arrowY ?? 50}
                    onChange={e => set({ arrowY: parseInt(e.target.value) })} />
                  <label>방향(각도) <span className={s.val}>{thumbnail.arrowAngle ?? 45}°</span></label>
                  <input type="range" min="0" max="360" value={thumbnail.arrowAngle ?? 45}
                    onChange={e => set({ arrowAngle: parseInt(e.target.value) })} />
                  <label>길이 <span className={s.val}>{thumbnail.arrowSize ?? 20}%</span></label>
                  <input type="range" min="8" max="45" value={thumbnail.arrowSize ?? 20}
                    onChange={e => set({ arrowSize: parseInt(e.target.value) })} />
                  <div className={s.colorRow}>
                    <input type="color" className={s.colorPicker}
                      value={thumbnail.arrowColor || '#facc15'}
                      onChange={e => set({ arrowColor: e.target.value })} />
                    <span className={s.colorVal}>{thumbnail.arrowColor || '#facc15'}</span>
                  </div>
                </>
              )}
            </div>
            <div className={s.field}>
              <label className={s.checkLabel}>
                <input type="checkbox" checked={!!thumbnail.badgeOn}
                  onChange={e => set({ badgeOn: e.target.checked })} />
                코너 뱃지 (예: "최초공개")
              </label>
              {thumbnail.badgeOn && (
                <>
                  <input type="text" className={s.textInput} style={{ padding: '8px 10px', fontSize: 13 }}
                    placeholder="뱃지 문구" value={thumbnail.badgeText || ''}
                    onChange={e => set({ badgeText: e.target.value })} />
                  <div className={s.presetGrid}>
                    {TREND_BADGE_PRESETS.map(b => (
                      <button key={b.label} type="button" className={s.presetBtn}
                        style={{ background: b.bg, color: b.fg, fontSize: 11 }}
                        onClick={() => set({ badgeText: b.text, badgeColor: b.bg, badgeTextColor: b.fg })}>
                        {b.label}
                      </button>
                    ))}
                  </div>
                  <div className={s.ratioRow} style={{ padding: 0 }}>
                    {[['tl', '↖ 좌상'], ['tr', '↗ 우상'], ['bl', '↙ 좌하'], ['br', '↘ 우하']].map(([k, label]) => (
                      <button key={k} type="button"
                        className={`${s.ratioBtn} ${(thumbnail.badgeCorner || 'tl') === k ? s.ratioBtnActive : ''}`}
                        onClick={() => set({ badgeCorner: k })}>{label}</button>
                    ))}
                  </div>
                  <div className={s.colorRow}>
                    <input type="color" className={s.colorPicker}
                      value={thumbnail.badgeColor || '#ef4444'}
                      onChange={e => set({ badgeColor: e.target.value })} />
                    <span className={s.colorVal}>배경 {thumbnail.badgeColor || '#ef4444'}</span>
                  </div>
                  <div className={s.colorRow}>
                    <input type="color" className={s.colorPicker}
                      value={thumbnail.badgeTextColor || '#ffffff'}
                      onChange={e => set({ badgeTextColor: e.target.value })} />
                    <span className={s.colorVal}>글자 {thumbnail.badgeTextColor || '#ffffff'}</span>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* 2026-11-04 — ThumbTrend Studio Step3("세이프존 & CTR 정밀 검증") 포팅. 레이어 모델이
            아니라 이 탭의 단일 thumbnail 상태값 기준으로 같은 체크 항목(계산은 모듈 레벨
            computeCtrReport)을 재현. 가이드 오버레이는 미리보기에만 겹쳐 보이고 내보내기엔
            포함되지 않는다. */}
        <div className={s.panel}>
          <div className={s.panelTitle}>세이프존 & CTR 검증</div>
          <div className={s.fields}>
            <div className={s.field}>
              <label className={s.checkLabel}>
                <input type="checkbox" checked={!!thumbnail.showSafeZone}
                  onChange={e => set({ showSafeZone: e.target.checked })} />
                미리보기에 세이프존 가이드 표시 (타임코드/UI 영역)
              </label>
            </div>
            <div className={s.ctrScoreRow}>
              <span className={s.ctrGrade} data-grade={ctrReport.grade}>{ctrReport.grade}</span>
              <span className={s.ctrScoreNum}>{ctrReport.score}점</span>
            </div>
            <div className={s.ctrCheckList}>
              {ctrReport.checks.map((c, i) => (
                <div key={i} className={s.ctrCheckRow} data-severity={c.severity}>
                  <span className={s.ctrDot} />
                  {c.msg}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className={s.panel}>
          <div className={s.panelTitle}>포스터 레이어 (굵은 손글씨 포인트)</div>
          <div className={s.layerPanelHead}>
            <button className={s.smallAddBtn} onClick={addTextLayer}>+ 텍스트</button>
            {DOODLE_TYPES.map(d => (
              <button key={d.key} className={s.smallAddBtn} onClick={() => addDoodleLayer(d.key)}>+ {d.label}</button>
            ))}
          </div>
          {posterLayers.length > 0 && (
            <div className={s.layerHint}>레이어를 선택한 뒤 오른쪽 미리보기를 클릭·드래그하면 위치가 옮겨져요.</div>
          )}
          <div className={s.layerList}>
            {posterLayers.map(layer => (
              <div key={layer.id}
                className={`${s.layerRow} ${selectedLayerId === layer.id ? s.layerRowActive : ''}`}
                onClick={() => setSelectedLayerId(layer.id)}>
                <div className={s.layerRowHead}>
                  <span className={s.layerKindTag}>{layer.kind === 'text' ? '텍스트' : DOODLE_TYPES.find(d => d.key === layer.doodleType)?.label}</span>
                  <button className={s.layerDelBtn} onClick={e => { e.stopPropagation(); removeLayer(layer.id) }}>삭제</button>
                </div>
                {layer.kind === 'text' ? (
                  <>
                    <input className={s.layerText} value={layer.text}
                      onChange={e => updateLayer(layer.id, { text: e.target.value })}
                      onClick={e => e.stopPropagation()} />
                    <select className={s.fontSelect} value={layer.fontKey}
                      onChange={e => updateLayer(layer.id, { fontKey: e.target.value })}
                      onClick={e => e.stopPropagation()}>
                      {FONT_PRESETS.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
                    </select>
                    <div className={s.field}>
                      <label>크기 <span className={s.val}>{layer.size}px</span></label>
                      <input type="range" min="24" max="140" value={layer.size}
                        onChange={e => updateLayer(layer.id, { size: parseInt(e.target.value) })}
                        onClick={e => e.stopPropagation()} />
                    </div>
                    <div className={s.field}>
                      <label>회전 <span className={s.val}>{layer.rotate}°</span></label>
                      <input type="range" min="-45" max="45" value={layer.rotate}
                        onChange={e => updateLayer(layer.id, { rotate: parseInt(e.target.value) })}
                        onClick={e => e.stopPropagation()} />
                    </div>
                    <div className={s.colorRow} onClick={e => e.stopPropagation()}>
                      <input type="color" className={s.colorPicker} value={layer.color}
                        onChange={e => updateLayer(layer.id, { color: e.target.value })} />
                      <span className={s.colorVal}>{layer.color}</span>
                      <label className={s.checkLabel} style={{ marginLeft: 8 }}>
                        <input type="checkbox" checked={!!layer.stroke}
                          onChange={e => updateLayer(layer.id, { stroke: e.target.checked })} />
                        외곽선
                      </label>
                      {layer.stroke && (
                        <input type="color" className={s.colorPicker} value={layer.strokeColor || '#141214'}
                          onChange={e => updateLayer(layer.id, { strokeColor: e.target.value })} />
                      )}
                    </div>
                  </>
                ) : (
                  <>
                    <div className={s.field}>
                      <label>크기 <span className={s.val}>{layer.size}%</span></label>
                      <input type="range" min="4" max="35" value={layer.size}
                        onChange={e => updateLayer(layer.id, { size: parseInt(e.target.value) })}
                        onClick={e => e.stopPropagation()} />
                    </div>
                    <div className={s.field}>
                      <label>회전 <span className={s.val}>{layer.rotate}°</span></label>
                      <input type="range" min="-180" max="180" value={layer.rotate}
                        onChange={e => updateLayer(layer.id, { rotate: parseInt(e.target.value) })}
                        onClick={e => e.stopPropagation()} />
                    </div>
                    <div className={s.colorRow} onClick={e => e.stopPropagation()}>
                      <input type="color" className={s.colorPicker} value={layer.color}
                        onChange={e => updateLayer(layer.id, { color: e.target.value })} />
                      <span className={s.colorVal}>{layer.color}</span>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* 2026-11-04 — ThumbTrend Studio Step4("고화질 출력") 포팅: 1x/2x/4x 해상도 선택 +
            클립보드 복사(유튜브 스튜디오에 바로 붙여넣기). */}
        <div className={s.ratioRow} style={{ padding: 0 }}>
          {EXPORT_SCALES.map(sc => (
            <button key={sc.key} type="button"
              className={`${s.ratioBtn} ${exportScale === sc.key ? s.ratioBtnActive : ''}`}
              onClick={() => setExportScale(sc.key)}>
              {sc.label}
            </button>
          ))}
        </div>
        <button className={s.downloadBtn} onClick={downloadPNG}>
          ⬇ PNG 다운로드 ({dims.w * exportScale}×{dims.h * exportScale})
        </button>
        <button className={s.downloadBtn} onClick={copyToClipboard} style={{ background: 'rgba(255,255,255,0.08)' }}>
          📋 클립보드로 복사
        </button>
        {copyStatus && <div style={{ fontSize: 11.5, color: copyStatus.startsWith('❌') ? '#f87171' : '#4ade80' }}>{copyStatus}</div>}
        <button className={s.downloadBtn} onClick={saveThumbnail} style={{ background: '#059669' }}>
          💾 thumb.jpg로 서버 저장
        </button>
        {saveStatus && <div style={{ fontSize: 11.5, color: saveStatus.startsWith('❌') ? '#f87171' : '#4ade80' }}>{saveStatus}</div>}
      </div>

      <div className={s.right}>
        <div className={s.previewHeader}>
          <span>썸네일 미리보기</span>
          <span className={s.size}>{dims.w} × {dims.h}</span>
        </div>
        <div className={s.canvasWrap} style={{ aspectRatio: `${dims.w}/${dims.h}`, maxWidth: dims.h > dims.w ? 320 : dims.h === dims.w ? 420 : undefined }}>
          <canvas ref={canvasRef} width={dims.w} height={dims.h} className={s.canvas}
            style={{ cursor: selectedLayerId ? 'crosshair' : 'default' }}
            onMouseDown={handleCanvasDown} onMouseMove={handleCanvasMove}
            onMouseUp={handleCanvasUp} onMouseLeave={handleCanvasUp} />
        </div>
        {selectedLayerId && <div className={s.layerHint} style={{ padding: 0 }}>선택된 레이어를 캔버스에서 드래그해 위치를 조정하세요.</div>}
      </div>
    </div>
  )
}

// ── ② 제목/설명/태그 섹션 (Claude 자동 생성 + 플랫폼별 수동 편집) ──
// scriptRaw(대본 생성 탭에서 붙여넣은 원문)가 비어있어도 cuts 배열에 내용이 있으면(스튜디오
// 컷 에디터로 직접 작성한 에피소드) 그걸로 요약 텍스트를 만든다 — 2026-10-18, IG_R06처럼 컷은
// 전부 채워져 있는데 scriptRaw만 비어서 "대본이 없습니다"가 항상 뜨던 문제.
// AI가 JSON을 요청받아도 description처럼 긴 문장에 실제 줄바꿈(\n 문자가 아니라 진짜 개행)을
// 그대로 넣어버리는 경우가 있다 — JSON 문자열 안의 리터럴 개행/탭은 불법이라 JSON.parse가
// "Expected ',' or '}' ..." 로 깨진다(2026-10-31, 퍼블리싱 탭 제목/설명/태그 생성 실측).
// 문자열 안에 있을 때만 개행·탭을 \n·\t로 escape해서 되살린다(문자열 밖 들여쓰기는 그대로 둠).
function sanitizeLooseJson(text) {
  let out = ''
  let inString = false
  let escaped = false
  for (const ch of text) {
    if (inString) {
      if (escaped) { out += ch; escaped = false; continue }
      if (ch === '\\') { out += ch; escaped = true; continue }
      if (ch === '"') { inString = false; out += ch; continue }
      if (ch === '\n') { out += '\\n'; continue }
      if (ch === '\r') { continue }
      if (ch === '\t') { out += '\\t'; continue }
      out += ch
    } else {
      if (ch === '"') inString = true
      out += ch
    }
  }
  return out.replace(/,(\s*[}\]])/g, '$1')   // 끝에 붙은 trailing comma도 같이 방어
}

function buildScriptFromCuts(cuts) {
  return (cuts || []).map(c => {
    const lines = [`[CUT ${c.no}] ${c.cutTitle || ''}`]
    if (c.dialogue) lines.push(`대사: ${c.dialogue}`)
    if (c.narration) lines.push(`나레이션: ${c.narration}`)
    if (c.subtitle) lines.push(`자막: ${c.subtitle}`)
    return lines.join('\n')
  }).join('\n\n')
}

function MetaSection() {
  const { state, dispatch } = useApp()
  const { publishing, scriptRaw, episode, cuts, apiKeys, channelKeywords } = state
  const [generating, setGenerating] = useState(false)
  const [genError, setGenError] = useState('')
  const [kwInput, setKwInput] = useState('')

  const setPlatform = (platform, p) => dispatch({ type: 'SET_PUBLISHING', platform, p })
  const keywords = channelKeywords || []
  const setKeywords = (arr) => dispatch({ type: 'SET_CHANNEL_KEYWORDS', p: arr })
  const addKeyword = () => {
    const v = kwInput.trim()
    if (v && !keywords.includes(v)) setKeywords([...keywords, v])
    setKwInput('')
  }
  const removeKeyword = (k) => setKeywords(keywords.filter(x => x !== k))

  const generate = async () => {
    const apiKey = apiKeys?.claude || ''
    if (!apiKey) { setGenError('상단 API 바에서 Claude 키를 입력하세요.'); return }
    const scriptText = scriptRaw?.trim() || buildScriptFromCuts(cuts)
    if (!scriptText.trim()) { setGenError('대본이 없습니다. 대본 생성 탭에서 먼저 대본을 작성하거나 컷을 입력하세요.'); return }
    setGenerating(true); setGenError('')
    try {
      // 2026-11-04 — 성준님: "캡션에 핵심 키워드를 자주·반복해서 노출". 검색 노출용 키워드를
      // 지정해두면, 억지로 나열하지 않고 설명 문장 안에 자연스럽게 2~3회 반복되도록 AI에게 지시.
      const kwNote = keywords.length
        ? `\n\n검색 노출용 핵심 키워드(계정 공통): ${keywords.join(', ')}\n- 이 키워드들을 instagram.description 안에서 자연스러운 문장으로 2~3회 반복해서 녹여줘(나열식 금지, 억지스럽지 않게).\n- instagram.tags에도 이 키워드를 해시태그로 포함해줘.`
        : ''
      const data = await claudeMessages(apiKey, {
        model: 'claude-sonnet-4-6',
        // 1200 이었던 걸 3000으로 올림(2026-10-31) — 3플랫폼 제목/설명/태그를 전부 채우면
        // 모델이 이모지·타임스탬프 섞인 긴 설명을 쓰는데, 1200으론 JSON이 다 끝나기 전에
        // 토큰이 끊겨서 "따옴표도 안 닫힌 채 중간에 잘린" 응답이 됨 — 그래서 매번 JSON
        // 파싱이 깨졌던 것(원인을 브라우저 콘솔로 실측 확인: text가 항상 정확히 1200자에서
        // 끊기고 마지막 글자가 단어 중간). escape 문제가 아니라 순수 길이 부족이었음.
        max_tokens: 3000,
        messages: [{
          role: 'user',
          content: `아래는 유튜브 쇼츠/릴스용 영상 대본이다. 이 내용을 바탕으로 유튜브, 인스타그램, 틱톡 각 플랫폼에 맞는 제목/설명/태그를 만들어줘.

제목: ${episode?.title || '(제목 없음)'}
대본:
${scriptText.slice(0, 3000)}${kwNote}

반드시 아래 JSON 형식으로만, 다른 설명 없이 응답해:
{
  "youtube":   { "title": "...", "description": "...", "tags": "쉼표로 구분된 태그" },
  "instagram": { "title": "...", "description": "...", "tags": "#해시태그 형식" },
  "tiktok":    { "title": "...", "description": "...", "tags": "#해시태그 형식" }
}`,
        }],
      }).then(r => r.json())

      const text = data.content?.map(b => b.text || '').join('') || ''
      const jsonMatch = text.match(/\{[\s\S]*\}/)
      if (!jsonMatch) throw new Error('AI 응답에서 JSON을 찾을 수 없습니다')
      let parsed
      try { parsed = JSON.parse(jsonMatch[0]) }
      catch { parsed = JSON.parse(sanitizeLooseJson(jsonMatch[0])) }   // 설명에 실제 개행이 섞여 깨진 경우 복구
      for (const platform of ['youtube', 'instagram', 'tiktok']) {
        if (parsed[platform]) setPlatform(platform, parsed[platform])
      }
    } catch (err) {
      setGenError('생성 오류: ' + err.message)
    } finally {
      setGenerating(false)
    }
  }

  const platforms = [
    { key: 'youtube',   label: '📺 YouTube' },
    { key: 'instagram', label: '📸 Instagram' },
    { key: 'tiktok',    label: '🎵 TikTok' },
  ]

  return (
    <div className={s.metaWrap}>
      <div className={s.panel} style={{ marginBottom: 12 }}>
        <div className={s.panelTitle}>핵심 키워드 (검색 노출용 · 캡션에 반복 노출)</div>
        <div className={s.fields}>
          <div style={{ fontSize: 11.5, color: 'var(--text-3)', marginTop: -4 }}>
            계정 공통 설정입니다(에피소드 바꿔도 유지). AI 자동 생성 시 인스타 설명에 자연스럽게 2~3회 반복해 녹입니다.
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {keywords.map(k => (
              <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'rgba(167,139,250,.15)', color: '#c4b5fd', borderRadius: 999, padding: '3px 10px', fontSize: 12 }}>
                {k}
                <button onClick={() => removeKeyword(k)} style={{ background: 'none', border: 'none', color: '#c4b5fd', cursor: 'pointer', fontSize: 13, lineHeight: 1 }}>×</button>
              </span>
            ))}
            {keywords.length === 0 && <span style={{ fontSize: 12, color: 'var(--text-3)' }}>아직 등록된 키워드가 없습니다</span>}
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <input value={kwInput} onChange={e => setKwInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addKeyword() } }}
              placeholder="예: 자취생 일상, 인간관계 공감 (Enter로 추가)"
              style={{ flex: 1, padding: '8px 10px', fontSize: 13, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-input)', color: 'var(--text)' }} />
            <button className={s.smallAddBtn} onClick={addKeyword}>+ 추가</button>
          </div>
        </div>
      </div>
      <button className={s.genBtn} onClick={generate} disabled={generating}>
        {generating ? '⏳ 생성 중...' : '✨ AI 자동 생성 (대본 기반)'}
      </button>
      {genError && <div style={{ color: '#f87171', fontSize: 12, marginBottom: 12, marginTop: -8 }}>{genError}</div>}

      <div className={s.platformGrid}>
        {platforms.map(pf => {
          const v = publishing?.[pf.key] || { title: '', description: '', tags: '' }
          return (
            <div key={pf.key} className={s.platformCard}>
              <div className={s.platformTitle}>{pf.label}</div>
              <div className={s.metaField}>
                <label>제목</label>
                <input value={v.title} onChange={e => setPlatform(pf.key, { title: e.target.value })} />
              </div>
              <div className={s.metaField}>
                <label>설명</label>
                <textarea value={v.description} onChange={e => setPlatform(pf.key, { description: e.target.value })} />
              </div>
              <div className={s.metaField}>
                <label>태그</label>
                <textarea style={{ minHeight: 44 }} value={v.tags} onChange={e => setPlatform(pf.key, { tags: e.target.value })} />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── ③ 결과물 패키징 섹션 ──
function PackageSection({ epNum }) {
  const [checking, setChecking] = useState(true)
  const [assets, setAssets] = useState(null)
  const [packaging, setPackaging] = useState(false)
  const [packageResult, setPackageResult] = useState(null)
  const [error, setError] = useState('')

  const checkAssets = async () => {
    if (!epNum) return
    try {
      const res = await fetch(`${SERVER}/api/check-final-assets`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ epNum }),
      })
      setAssets(await res.json())
      setError('')
    } catch (err) {
      setError('확인 오류: ' + err.message)
    } finally {
      setChecking(false)
    }
  }

  useEffect(() => {
    if (!epNum) return
    fetch(`${SERVER}/api/check-final-assets`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ epNum }),
    })
      .then(r => r.json())
      .then(data => { setAssets(data); setError('') })
      .catch(err => setError('확인 오류: ' + err.message))
      .finally(() => setChecking(false))
  }, [epNum])

  const runPackage = async () => {
    if (!epNum) return
    setPackaging(true); setError(''); setPackageResult(null)
    try {
      const res = await fetch(`${SERVER}/api/package-final`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ epNum }),
      })
      const data = await res.json().catch((parseErr) => {
        console.error('[패키징] 응답 JSON 파싱 실패:', parseErr)
        return {}
      })
      if (!res.ok || !data.success) {
        console.error('[패키징 실패]', { status: res.status, statusText: res.statusText, body: data })
        setError(data.error || `패키징 실패 (HTTP ${res.status} ${res.statusText})`)
        return
      }
      setPackageResult(data)
      checkAssets()
    } catch (err) {
      console.error('[패키징] 서버 요청 실패 (proxy.js가 실행 중인지 확인):', err)
      setError('패키징 오류: ' + err.message)
    } finally {
      setPackaging(false)
    }
  }

  return (
    <div className={s.packageWrap}>
      <div className={s.checkRow}>
        <span className={`${s.checkIcon} ${assets?.videoExists ? s.checkOk : s.checkFail}`}>
          {assets?.videoExists ? '✅' : '❌'}
        </span>
        <span>ep{epNum}_final.mp4 (편집 완료 영상)</span>
        <span className={s.checkPath}>{assets?.videoPath || ''}</span>
      </div>
      <div className={s.checkRow}>
        <span className={`${s.checkIcon} ${assets?.thumbExists ? s.checkOk : s.checkFail}`}>
          {assets?.thumbExists ? '✅' : '❌'}
        </span>
        <span>thumb.jpg (썸네일)</span>
        <span className={s.checkPath}>{assets?.thumbPath || ''}</span>
      </div>

      {error && <div style={{ color: '#f87171', fontSize: 12.5, marginTop: 8 }}>{error}</div>}

      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <button className={s.refreshBtn} onClick={() => { setChecking(true); checkAssets() }}>{checking ? '확인 중...' : '↻ 다시 확인'}</button>
        <button className={s.packageBtn} onClick={runPackage} disabled={packaging || !assets?.videoExists}>
          {packaging ? '⏳ 패키징 중...' : '📦 downloads/final/ 로 패키징'}
        </button>
      </div>

      {packageResult && (
        <div className={s.packageResult}>
          ✅ 패키징 완료 → {packageResult.finalDir}
          <br />영상: {packageResult.files.video}
          {packageResult.files.thumb && <><br />썸네일: {packageResult.files.thumb}</>}
        </div>
      )}
    </div>
  )
}

// ── ④ 업로드 섹션 ── 2026-10-15: 1단계로 Instagram 릴스 업로드 연결(②캡션+③패키징 그대로 사용).
// YouTube/TikTok은 계정 연동이 아직 없어 "준비 중"으로 남김.
// 이미 게시된 플랫폼은 "업로드된 현황"으로 상단에 먼저 보여준다(2026-10-16) — 새로고침·
// 다른 세션에서도 "이거 이미 올렸던가?"를 다시 확인할 필요 없게 서버 기록을 그대로 띄움.
const PUBLISH_PLATFORM_LABEL = { instagram: '📸 Instagram', youtube: '📺 YouTube', tiktok: '🎵 TikTok' }

function PublishedStatusPanel({ publishStatus }) {
  const entries = Object.entries(publishStatus || {})
  if (entries.length === 0) return null
  return (
    <div className={s.uploadRow} style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
      <span className={s.uploadPlatform}>업로드된 현황</span>
      {entries.map(([platform, rec]) => (
        <div key={platform} style={{ fontSize: 12, color: '#4ade80', display: 'flex', gap: 6, alignItems: 'center' }}>
          <span>✅ {PUBLISH_PLATFORM_LABEL[platform] || platform}</span>
          <span style={{ color: 'var(--text-3)' }}>{new Date(rec.publishedAt).toLocaleString('ko-KR')}</span>
          {rec.permalink && <a href={rec.permalink} target="_blank" rel="noreferrer" style={{ color: '#a78bfa' }}>게시물 보기</a>}
        </div>
      ))}
    </div>
  )
}

function UploadSection({ epNum }) {
  const { state } = useApp()
  const ig = state.publishing?.instagram || { title: '', description: '', tags: '' }
  const [status, setStatus] = useState('idle') // idle | running | done | error
  const [message, setMessage] = useState('')
  const [permalink, setPermalink] = useState(null)
  const [publishStatus, setPublishStatus] = useState({})

  const loadPublishStatus = useCallback(() => {
    if (!epNum) return
    fetch(`${SERVER}/api/publish-status`).then(r => r.json())
      .then(all => setPublishStatus(all?.[epNum] || {}))
      .catch(() => {})
  }, [epNum])

  useEffect(() => { loadPublishStatus() }, [loadPublishStatus])

  const caption = [ig.title, ig.description, ig.tags].filter(s => s?.trim()).join('\n\n')
  const alreadyPublishedIg = !!publishStatus.instagram

  const doPublish = async () => {
    if (!epNum) return
    if (!caption.trim()) { setStatus('error'); setMessage('②제목/설명/태그를 먼저 채워주세요(인스타는 이걸 그대로 캡션으로 씁니다).'); return }
    const reconfirm = alreadyPublishedIg ? '\n\n⚠️ 이 에피소드는 Instagram에 이미 게시된 기록이 있습니다. 또 올리면 중복 게시됩니다.' : ''
    const preview = caption.length > 300 ? caption.slice(0, 300) + '…' : caption
    if (!window.confirm(`Instagram에 릴스로 실제 게시합니다. 되돌릴 수 없습니다.${reconfirm}\n\n캡션:\n${preview}\n\n진행할까요?`)) return
    setStatus('running'); setMessage('업로드 중… (영상 처리까지 최대 몇 분 걸릴 수 있습니다)'); setPermalink(null)
    try {
      const res = await fetch(`${SERVER}/api/instagram/publish`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ epNum, caption }),
      })
      const data = await res.json()
      if (!res.ok || !data.success) throw new Error(data.error || '업로드 실패')
      setStatus('done'); setMessage('✅ 게시 완료'); setPermalink(data.permalink)
      loadPublishStatus()
    } catch (err) {
      setStatus('error'); setMessage('❌ ' + err.message)
    }
  }

  return (
    <div className={s.uploadWrap}>
      <PublishedStatusPanel publishStatus={publishStatus} />
      <div className={s.uploadRow}>
        <span className={s.uploadPlatform}>📸 Instagram 업로드{alreadyPublishedIg ? ' (게시됨)' : ''}</span>
        <button className={s.uploadBtn} onClick={doPublish} disabled={status === 'running'}>
          {status === 'running' ? '⏳ 업로드 중...' : alreadyPublishedIg ? '🚀 다시 게시' : '🚀 릴스로 게시'}
        </button>
      </div>
      {message && (
        <div style={{ fontSize: 12, marginTop: 4, color: status === 'error' ? '#f87171' : status === 'done' ? '#4ade80' : 'var(--text-3)' }}>
          {message}
          {permalink && <> — <a href={permalink} target="_blank" rel="noreferrer" style={{ color: '#a78bfa' }}>게시물 보기</a></>}
        </div>
      )}
      <div className={s.uploadRow}>
        <span className={s.uploadPlatform}>📺 YouTube 업로드</span>
        <button className={s.uploadBtn} disabled title="준비 중 (API 연동 미구현)">준비 중</button>
      </div>
      <div className={s.uploadRow}>
        <span className={s.uploadPlatform}>🎵 TikTok 업로드</span>
        <button className={s.uploadBtn} disabled title="준비 중 (API 연동 미구현)">준비 중</button>
      </div>
    </div>
  )
}

// ── ⑤ 업로드 현황 섹션 ── 2026-10-18: 에피소드 선택과 무관하게 전체 게시 기록을 한 번에 보여준다.
// 기존엔 ④업로드 섹션 안의 "업로드된 현황" 패널이 "지금 선택된 에피소드"에만 묶여 있어서, 뭐가
// 올라갔는지 파악하려면 에피소드를 하나씩 클릭해봐야 했음(성준님 지적) — 여기선 /api/episodes +
// /api/publish-status를 합쳐 전체 목록을 최신 게시일 순으로 보여준다.
function UploadStatusSection() {
  const [episodes, setEpisodes] = useState([])
  const [publishStatus, setPublishStatus] = useState({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      fetch(`${SERVER}/api/episodes`).then(r => r.json()),
      fetch(`${SERVER}/api/publish-status`).then(r => r.json()),
    ]).then(([epRes, statusRes]) => {
      setEpisodes(epRes?.episodes || [])
      setPublishStatus(statusRes || {})
    }).catch(() => {}).finally(() => setLoading(false))
  }, [])

  const latestOf = (platforms) => Math.max(...Object.values(platforms).map(p => p.publishedAt || 0))
  // 에피소드 번호로 매칭되면 그 제목을 쓰고, 안 되면(테스트번호·studio-state에 레코드가 없는
  // 구형 콘텐츠 등) 백필 시 레코드에 같이 넣어둔 code/title로 대체 표시 — 2026-10-18.
  const labelOf = (epNum, ep, platforms) => {
    if (ep) return `${ep.code} — ${ep.title}`
    const withMeta = Object.values(platforms).find(p => p.code || p.title)
    if (withMeta) return `${withMeta.code || epNum} — ${withMeta.title || ''}`
    return epNum
  }
  const rows = Object.entries(publishStatus)
    .map(([epNum, platforms]) => ({ epNum, ep: episodes.find(e => String(e.number) === epNum), platforms }))
    .filter(r => Object.keys(r.platforms).length > 0)
    .sort((a, b) => latestOf(b.platforms) - latestOf(a.platforms))

  if (loading) return <div className={s.uploadWrap}>불러오는 중...</div>

  return (
    <div className={s.uploadWrap} style={{ maxWidth: 640 }}>
      <div style={{ fontSize: 12, color: 'var(--text-3)' }}>
        전체 {rows.length}건 게시됨 — 에피소드를 선택하지 않아도 항상 여기서 전체 현황이 보입니다.
      </div>
      {rows.length === 0 && <div className={s.uploadRow}>아직 게시된 에피소드가 없습니다.</div>}
      {rows.map(({ epNum, ep, platforms }) => (
        <div key={epNum} className={s.uploadRow} style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
          <div className={s.uploadPlatform}>{labelOf(epNum, ep, platforms)}</div>
          {Object.entries(platforms).map(([platform, rec]) => (
            <div key={platform} style={{ fontSize: 12, color: '#4ade80', display: 'flex', gap: 6, alignItems: 'center' }}>
              <span>✅ {PUBLISH_PLATFORM_LABEL[platform] || platform}</span>
              <span style={{ color: 'var(--text-3)' }}>{new Date(rec.publishedAt).toLocaleString('ko-KR')}</span>
              {rec.permalink && <a href={rec.permalink} target="_blank" rel="noreferrer" style={{ color: '#a78bfa' }}>게시물 보기</a>}
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

export default function PublishingTab() {
  const { state } = useApp()
  const epNum = state.episode?.number
  const [activeSection, setActiveSection] = useState('thumb')

  return (
    <div className={s.appOuter}>
      <TabToolbar />
    <div className={s.pageOuter}>
      <EpisodeInfoSidebar maxStage={0} />
      <div className={s.page}>
        <div className={s.sectionTabs}>
          {SECTIONS.map(sec => (
            <button key={sec.key}
              className={`${s.sectionTab} ${activeSection === sec.key ? s.sectionTabActive : ''}`}
              onClick={() => setActiveSection(sec.key)}>
              {sec.label}
            </button>
          ))}
        </div>
        <div className={s.sectionBody}>
          {activeSection === 'thumb' && <ThumbnailSection epNum={epNum} />}
          {activeSection === 'meta' && <MetaSection />}
          {activeSection === 'package' && <PackageSection epNum={epNum} />}
          {activeSection === 'upload' && <UploadSection epNum={epNum} />}
          {activeSection === 'status' && <UploadStatusSection />}
        </div>
      </div>
    </div>
    </div>
  )
}
