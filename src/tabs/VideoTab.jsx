import { useState, useRef, useEffect, useCallback } from 'react'
import { useApp } from '../context/AppContext'
import JSZip from 'jszip'
import { setGPoint, setGPoints } from '../lib/gpoints'
import s from './VideoTab.module.css'

const FONTS = ['Apple SD Gothic Neo', 'Noto Sans KR', 'Nanum Gothic', 'Nanum Myeongjo', 'Gothic A1', 'Arial', 'Impact']
const BG_STYLES = ['반투명 직각 박스', '없음', '그림자']

function secondsToSrt(sec) {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), ss = sec % 60
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(Math.floor(ss)).padStart(2,'0')},000`
}

function stripMeta(text) {
  if (!text) return text
  return text
    .replace(/\n?샷\s*타입[:：][^\n]*/gi, '')
    .replace(/^(CLOSEUP|FULLBODY)\s*(SHOT)?\s*[-—]?\s*/i, '')
    .trim()
}

export default function VideoTab() {
  const { state, dispatch } = useApp()
  const { cuts, videoSettings, renderProgress } = state
  const { subtitleEnabled, font, fontSize, color, bgStyle } = videoSettings
  const canvasRef = useRef(null)
  const [previewText, setPreviewText] = useState('여기서 처음 써보는 이야기야.')
  const [previewEditing, setPreviewEditing] = useState(false)
  const [renderLog, setRenderLog] = useState([])
  const [g4Approved, setG4Approved] = useState({})

  const set = (p) => dispatch({ type: 'SET_VIDEO', p })

  const drawPreview = useCallback(() => {
    const canvas = canvasRef.current; if (!canvas) return
    const ctx = canvas.getContext('2d')
    const W = canvas.width, H = canvas.height
    ctx.clearRect(0, 0, W, H)
    // Background
    ctx.fillStyle = '#1a1030'
    ctx.fillRect(0, 0, W, H)
    // Grid pattern
    ctx.strokeStyle = 'rgba(100,80,180,.15)'; ctx.lineWidth = 1
    for (let x = 0; x < W; x += 40) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke() }
    for (let y = 0; y < H; y += 40) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke() }
    // Label
    ctx.fillStyle = 'rgba(160,130,255,.25)'; ctx.font = '13px Apple SD Gothic Neo,sans-serif'; ctx.textAlign = 'center'
    ctx.fillText('[ 자막 미리보기 ]', W/2, H/2 - 20)
    if (!subtitleEnabled) return
    const text = previewText
    // 캔버스(640×360)를 720p 기준으로 스케일링해 실제 영상과 동일한 비율 유지
    const scale = H / 720
    const fSize = Math.max(10, Math.round(fontSize * scale))
    ctx.font = `${fSize}px "${font}",sans-serif`
    ctx.textAlign = 'center'
    // 하단 20% 지점 (화면 높이의 80% 위치)
    const subX = W / 2
    const subY = H * 0.80
    const padX = 18, padY = 8
    if (bgStyle === '반투명 직각 박스') {
      const metrics = ctx.measureText(text)
      const bw = metrics.width + padX * 2
      const bh = fSize + padY * 2
      ctx.fillStyle = 'rgba(0,0,0,.68)'
      ctx.fillRect(subX - bw / 2, subY - fSize - padY, bw, bh)
    } else if (bgStyle === '그림자') {
      ctx.shadowColor = 'rgba(0,0,0,0.95)'
      ctx.shadowBlur = Math.max(4, Math.round(fSize * 0.28))
      ctx.shadowOffsetX = 1; ctx.shadowOffsetY = 1
    }
    ctx.fillStyle = color
    ctx.fillText(text, subX, subY)
    ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0
  }, [subtitleEnabled, font, fontSize, color, bgStyle, previewText])

  useEffect(() => { drawPreview() }, [drawPreview])

  const exportSRT = () => {
    let srt = '', t = 0
    cuts.forEach((c, i) => {
      const text = stripMeta(c.dialogue || c.narration); if (!text) return
      const dur = c.duration || 5
      srt += `${i + 1}\n${secondsToSrt(t)} --> ${secondsToSrt(t + dur)}\n${text}\n\n`
      t += dur
    })
    if (!srt) { alert('대사/나레이션이 없습니다'); return }
    const blob = new Blob([srt], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = 'subtitles.srt'; a.click()
    URL.revokeObjectURL(url)
    setRenderLog(l => [...l, '✅ SRT 자막 파일 생성 완료'])
    // ── G3 포인트 자동 저장 ──────────────────────────────
    cuts.forEach(c => { if (c.dialogue || c.narration) setGPoint(c.no, 'g3', true) })
  }

  const exportZip = async () => {
    dispatch({ type: 'SET_RENDER', p: { isRendering: true, current: 0, total: cuts.length } })
    setRenderLog(l => [...l, '📦 ZIP 패키징 시작...'])
    const zip = new JSZip()
    let srt = '', t = 0
    for (let i = 0; i < cuts.length; i++) {
      const c = cuts[i]
      dispatch({ type: 'SET_RENDER', p: { current: i + 1 } })
      const text = stripMeta(c.dialogue || c.narration || ''); const dur = c.duration || 5
      if (text) { srt += `${i+1}\n${secondsToSrt(t)} --> ${secondsToSrt(t+dur)}\n${text}\n\n`; t += dur }
      const info = `씬: ${c.scene || ''}\n액션: ${c.action || ''}\n대사: ${c.dialogue || ''}\n나레이션: ${c.narration || ''}\n이미지 프롬프트: ${c.imagePrompt || ''}`
      zip.file(`cut_${c.no}/info.txt`, info)
      setRenderLog(l => [...l, `  CUT ${c.no} 처리됨`])
      // ── G3 포인트 자동 저장 ──────────────────────────────
      setGPoint(c.no, 'g3', true)
    }
    if (srt) zip.file('subtitles.srt', srt)
    const readme = `여리 Script Studio - 영상 패키지\n생성일: ${new Date().toLocaleString('ko-KR')}\n\n포함 파일:\n- cut_*/info.txt: 각 컷 정보\n- subtitles.srt: SRT 자막 파일\n\n이미지, 음성은 각 탭에서 별도 다운로드하세요.`
    zip.file('README.txt', readme)
    const blob = await zip.generateAsync({ type: 'blob' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = 'yeori_studio_package.zip'; a.click()
    URL.revokeObjectURL(url)
    setRenderLog(l => [...l, '✅ ZIP 패키지 다운로드 완료!'])
    dispatch({ type: 'SET_RENDER', p: { isRendering: false } })
  }

  const exportFCPXML = () => {
    let t = 0
    const clips = cuts.map(c => {
      const dur = c.duration || 5
      const clip = `    <clip name="CUT ${c.no}" offset="${t}s" duration="${dur}s">\n      <title>${c.scene || 'Scene'}</title>\n    </clip>`
      t += dur; return clip
    }).join('\n')
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE fcpxml>\n<fcpxml version="1.9">\n  <library>\n    <event name="여리 Studio">\n      <project name="Ep ${state.episode.number}">\n        <sequence duration="${t}s">\n          <spine>\n${clips}\n          </spine>\n        </sequence>\n      </project>\n    </event>\n  </library>\n</fcpxml>`
    const blob = new Blob([xml], { type: 'text/xml' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = 'timeline.fcpxml'; a.click()
    URL.revokeObjectURL(url)
    setRenderLog(l => [...l, '✅ Premiere Pro FCPXML 생성 완료'])
  }

  const stopRender = () => {
    dispatch({ type: 'SET_RENDER', p: { isRendering: false } })
    setRenderLog(l => [...l, '⛔ 렌더링 중지됨'])
  }

  const totalDuration = cuts.reduce((a, c) => a + (c.duration || 5), 0)

  return (
    <div className={s.root}>
      {/* Left */}
      <div className={s.left}>
        {/* Subtitle settings */}
        <div className={s.panel}>
          <div className={s.panelHeader}>자막 디자인 설정</div>
          <div className={s.row}>
            <label className={s.check}>
              <input type="checkbox" checked={subtitleEnabled} onChange={e => set({ subtitleEnabled: e.target.checked })} />
              <span>자막 포함</span>
            </label>
          </div>
          <div className={s.field}>
            <label>글씨체</label>
            <select value={font} onChange={e => set({ font: e.target.value })} disabled={!subtitleEnabled}>
              {FONTS.map(f => <option key={f}>{f}</option>)}
            </select>
          </div>
          <div className={s.field}>
            <label>글자 크기 <span className={s.val}>{fontSize}px</span></label>
            <input type="range" min="16" max="72" value={fontSize} disabled={!subtitleEnabled}
              onChange={e => set({ fontSize: parseInt(e.target.value) })} />
          </div>
          <div className={s.field}>
            <label>글자 색상</label>
            <div className={s.colorRow}>
              <input type="color" value={color} disabled={!subtitleEnabled}
                onChange={e => set({ color: e.target.value })} className={s.colorPicker} />
              <span className={s.colorVal}>{color}</span>
            </div>
          </div>
          <div className={s.field}>
            <label>배경 스타일</label>
            <select value={bgStyle} onChange={e => set({ bgStyle: e.target.value })} disabled={!subtitleEnabled}>
              {BG_STYLES.map(b => <option key={b}>{b}</option>)}
            </select>
          </div>
        </div>

        {/* SRT 생성 */}
        <div className={s.panel}>
          <div className={s.panelHeader}>SRT 자막 생성</div>
          <div className={s.exportBtns}>
            <button className={`${s.exportBtn} ${s.green}`} onClick={exportSRT}>📄 SRT 자막 파일 다운로드</button>
          </div>
        </div>

        {/* G4 전체 승인 */}
        <div className={s.panel}>
          <div className={s.panelHeader}>G4 단계 — 영상 승인</div>
          <div style={{padding:'14px',display:'flex',flexDirection:'column',gap:'10px'}}>
            <div style={{fontSize:'12px',color:'var(--text-3)'}}>
              각 컷 영상을 확인하고 G4 승인하세요.
            </div>
            <div style={{fontSize:'13px',fontWeight:700,color:'var(--text-2)'}}>
              G4 완료: {Object.values(g4Approved).filter(Boolean).length} / {cuts.length}
            </div>
            <button
              className={`${s.exportBtn} ${cuts.every(c => g4Approved[c.id]) ? s.green : s.gray}`}
              disabled={!cuts.every(c => g4Approved[c.id])}
              style={{opacity: cuts.every(c => g4Approved[c.id]) ? 1 : 0.4, cursor: cuts.every(c => g4Approved[c.id]) ? 'pointer' : 'default'}}
              onClick={() => {
                cuts.forEach(c => setGPoints(c.no, { g4: true }))
                dispatch({ type: 'SET_TAB', p: 'editmeta' })
              }}>
              {cuts.every(c => g4Approved[c.id]) ? '🎉 G4 전체 승인 → 편집 메타' : 'G4 전체 승인'}
            </button>
          </div>
        </div>
      </div>

      {/* Right */}
      <div className={s.right}>
        {/* Canvas preview */}
        <div className={s.previewSection}>
          <div className={s.previewHeader}>
            <span>자막 미리보기</span>
            <span className={s.liveTag}>LIVE</span>
          </div>
          <canvas ref={canvasRef} width={640} height={360} className={s.canvas}
            onClick={() => setPreviewEditing(true)} />
          <div className={s.previewInputRow}>
            <input className={s.previewInput}
              value={previewText}
              onChange={e => setPreviewText(e.target.value)}
              placeholder="미리보기 텍스트 입력..." />
          </div>
        </div>

        {/* Scene list */}
        <div className={s.sceneList}>
          <div className={s.sceneHeader}>
            <span>장면 목록</span>
            <span className={s.totalDur}>총 {totalDuration}초</span>
          </div>
          <div className={s.scenes}>
            {cuts.map(c => (
              <div key={c.id} className={s.scene}>
                <div className={s.sceneThumbnail}>
                  <span className={s.sceneno}>CUT {c.no}</span>
                </div>
                <div className={s.sceneInfo}>
                  <div className={s.sceneScene}>{c.scene || '씬 미입력'}</div>
                  <div className={s.sceneDial}>{c.dialogue || c.narration || '(대사 없음)'}</div>
                </div>
                <div className={s.sceneDur}>{c.duration || 5}s</div>
                <button
                  className={`${s.g4Btn} ${g4Approved[c.id] ? s.g4Done : ''}`}
                  disabled={g4Approved[c.id]}
                  onClick={() => {
                    setG4Approved(p => ({ ...p, [c.id]: true }))
                    setGPoint(c.no, 'g4', true)
                  }}>
                  {g4Approved[c.id] ? 'G4 ✓' : 'G4 승인'}
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
