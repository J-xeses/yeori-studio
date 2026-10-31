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

const RATIOS = [
  { key: '16:9', label: '16:9 (YouTube)', w: 1280, h: 720 },
  { key: '9:16', label: '9:16 (인스타/TikTok)', w: 1080, h: 1920 },
]

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

// ── ① 썸네일 섹션 (기존 캔버스 편집기 + 스튜디오 이미지 불러오기 + 서버 저장) ──
function ThumbnailSection({ epNum }) {
  const { state, dispatch } = useApp()
  const { thumbnail } = state
  const canvasRef = useRef(null)
  const bgRef = useRef(null)
  const fileRef = useRef(null)
  const [bgImage, setBgImage] = useState(null)
  const [studioImages, setStudioImages] = useState([])
  const [loadingImages, setLoadingImages] = useState(true)
  const [saveStatus, setSaveStatus] = useState('')

  const set = (p) => dispatch({ type: 'SET_THUMB', p })
  const ratio = thumbnail.ratio || '16:9'
  const dims = RATIOS.find(r => r.key === ratio) || RATIOS[0]

  // 2026-10-23 — 성준님 요청: "YouTube 업로드용 썸네일 편집효과" 1단계(편집의도 기획 수준,
  // AI 배경제거·컷아웃 같은 무거운 작업 없이 캔버스 2D로 즉시 미리보기 가능한 수준). 벤치마킹
  // (vidIQ·CapCut·Picsart 등 썸네일 메이커 + CTR 가이드)에서 추린 4종: ①텍스트 외곽선·글로우
  // ②이미지 보정(밝기·대비·채도) ③비네트 ④강조 도형(원·화살표)+코너 뱃지.
  const draw = useCallback(() => {
    const canvas = canvasRef.current; if (!canvas) return
    const ctx = canvas.getContext('2d')
    const W = canvas.width, H = canvas.height
    ctx.clearRect(0, 0, W, H)

    // ② 이미지 보정 — ctx.filter(CSS filter 문법 그대로 사용 가능)를 배경에만 적용하고
    // save/restore로 범위를 가둬 이후 텍스트/도형에는 전혀 영향을 안 준다.
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

    // ③ 비네트 — 가장자리를 어둡게 눌러 시선을 중앙(인물/텍스트)으로 모은다.
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
      const fSize = thumbnail.fontSize || 48
      ctx.font = `${thumbnail.bold ? 'bold ' : ''}${fSize}px ${'"Apple SD Gothic Neo"'},sans-serif`
      ctx.textAlign = 'center'
      const yBase = H * ((thumbnail.textY || 70) / 100)
      const lineH = fSize * 1.3
      const totalH = lines.length * lineH
      lines.forEach((line, i) => {
        const y = yBase - totalH / 2 + i * lineH + fSize / 2
        // ① 텍스트 글로우 — 네온 느낌의 번진 색 그림자를 한 번 먼저 깔고, 아래에서 외곽선+
        // 본문을 또렷하게 덮어 그린다(동시에 적용하면 번짐이 외곽선에 섞여 뭉개짐).
        if (thumbnail.textGlow) {
          ctx.shadowColor = thumbnail.glowColor || '#fbbf24'; ctx.shadowBlur = 22
          ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0
          ctx.fillStyle = thumbnail.color || '#ffffff'
          ctx.fillText(line, W / 2, y)
        }
        ctx.shadowColor = '#000'; ctx.shadowBlur = 12; ctx.shadowOffsetX = 2; ctx.shadowOffsetY = 2
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

    // ④ 강조 도형 — 얼굴·핵심 지점을 가리키는 원/화살표. 위치·크기는 %(화면비율 무관) 기준.
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

    // 코너 뱃지/리본 — "최초공개" 류 클릭베이트 문구를 모서리에 스티커처럼 고정.
    if (thumbnail.badgeOn && thumbnail.badgeText) {
      ctx.save()
      ctx.font = 'bold 28px "Apple SD Gothic Neo",sans-serif'
      const tw = ctx.measureText(thumbnail.badgeText).width
      const boxW = tw + 28, boxH = 44, margin = 16
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

    ctx.fillStyle = 'rgba(167,139,250,.25)'; ctx.font = '12px sans-serif'; ctx.textAlign = 'right'; ctx.textBaseline = 'alphabetic'
    ctx.fillText('여리 Studio', W - 12, H - 10)
  }, [bgImage, thumbnail])

  useEffect(() => { draw() }, [draw])

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

  const downloadPNG = () => {
    const canvas = canvasRef.current; if (!canvas) return
    const url = canvas.toDataURL('image/png')
    const a = document.createElement('a'); a.href = url; a.download = 'thumbnail.png'; a.click()
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

        <button className={s.downloadBtn} onClick={downloadPNG}>
          ⬇ PNG 다운로드 ({dims.w}×{dims.h})
        </button>
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
        <div className={s.canvasWrap} style={ratio === '9:16' ? { maxWidth: 320, aspectRatio: '9/16' } : undefined}>
          <canvas ref={canvasRef} width={dims.w} height={dims.h} className={s.canvas} />
        </div>
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
  const { publishing, scriptRaw, episode, cuts, apiKeys } = state
  const [generating, setGenerating] = useState(false)
  const [genError, setGenError] = useState('')

  const setPlatform = (platform, p) => dispatch({ type: 'SET_PUBLISHING', platform, p })

  const generate = async () => {
    const apiKey = apiKeys?.claude || ''
    if (!apiKey) { setGenError('상단 API 바에서 Claude 키를 입력하세요.'); return }
    const scriptText = scriptRaw?.trim() || buildScriptFromCuts(cuts)
    if (!scriptText.trim()) { setGenError('대본이 없습니다. 대본 생성 탭에서 먼저 대본을 작성하거나 컷을 입력하세요.'); return }
    setGenerating(true); setGenError('')
    try {
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
${scriptText.slice(0, 3000)}

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
