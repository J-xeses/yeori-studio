import { useState, useRef, useEffect, useCallback } from 'react'
import { useApp } from '../context/AppContext'
import s from './ThumbnailTab.module.css'

export default function ThumbnailTab() {
  const { state, dispatch } = useApp()
  const { thumbnail } = state
  const canvasRef = useRef(null)
  const bgRef = useRef(null)
  const fileRef = useRef(null)
  const [bgImage, setBgImage] = useState(null)

  const set = (p) => dispatch({ type: 'SET_THUMB', p })

  const draw = useCallback(() => {
    const canvas = canvasRef.current; if (!canvas) return
    const ctx = canvas.getContext('2d')
    const W = canvas.width, H = canvas.height
    ctx.clearRect(0, 0, W, H)
    // Background
    if (bgImage) {
      ctx.drawImage(bgImage, 0, 0, W, H)
    } else {
      const grad = ctx.createLinearGradient(0, 0, W, H)
      grad.addColorStop(0, '#1a0a2e'); grad.addColorStop(1, '#0a0a1f')
      ctx.fillStyle = grad; ctx.fillRect(0, 0, W, H)
      ctx.fillStyle = 'rgba(124,58,237,.06)'; ctx.fillRect(0, 0, W, H)
    }
    // Overlay gradient at bottom
    if (thumbnail.text) {
      const overlay = ctx.createLinearGradient(0, H * 0.5, 0, H)
      overlay.addColorStop(0, 'rgba(0,0,0,0)'); overlay.addColorStop(1, 'rgba(0,0,0,0.75)')
      ctx.fillStyle = overlay; ctx.fillRect(0, 0, W, H)
    }
    // Text
    if (thumbnail.text) {
      const lines = thumbnail.text.split('\n')
      const fSize = thumbnail.fontSize || 48
      ctx.font = `${thumbnail.bold ? 'bold ' : ''}${fSize}px ${'"Apple SD Gothic Neo"'},sans-serif`
      ctx.textAlign = 'center'
      ctx.shadowColor = '#000'; ctx.shadowBlur = 12; ctx.shadowOffsetX = 2; ctx.shadowOffsetY = 2
      ctx.fillStyle = thumbnail.color || '#ffffff'
      const yBase = H * ((thumbnail.textY || 70) / 100)
      const lineH = fSize * 1.3
      const totalH = lines.length * lineH
      lines.forEach((line, i) => {
        const y = yBase - totalH / 2 + i * lineH + fSize / 2
        ctx.fillText(line, W / 2, y)
      })
      ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0
    }
    // Watermark
    ctx.fillStyle = 'rgba(167,139,250,.25)'; ctx.font = '12px sans-serif'; ctx.textAlign = 'right'
    ctx.fillText('여리 Studio', W - 12, H - 10)
  }, [bgImage, thumbnail])

  useEffect(() => { draw() }, [draw])

  const handleBgUpload = (file) => {
    if (!file) return
    const url = URL.createObjectURL(file)
    const img = new Image(); img.src = url
    img.onload = () => { bgRef.current = img; setBgImage(img) }
  }

  const downloadPNG = () => {
    const canvas = canvasRef.current; if (!canvas) return
    const url = canvas.toDataURL('image/png')
    const a = document.createElement('a'); a.href = url; a.download = 'thumbnail.png'; a.click()
  }

  return (
    <div className={s.root}>
      <div className={s.left}>
        <div className={s.panel}>
          <div className={s.panelTitle}>썸네일 텍스트</div>
          <textarea className={s.textInput} rows={3}
            placeholder={'첫 줄 텍스트\n둘째 줄 텍스트'}
            value={thumbnail.text || ''}
            onChange={e => set({ text: e.target.value })} />
        </div>

        <div className={s.panel}>
          <div className={s.panelTitle}>배경 이미지</div>
          <div className={s.bgArea} onClick={() => fileRef.current?.click()}>
            {bgImage ? (
              <div className={s.bgLoaded}>
                <span>✓ 이미지 로드됨</span>
                <button className={s.removeBg} onClick={e => { e.stopPropagation(); setBgImage(null) }}>제거</button>
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
          </div>
        </div>

        <button className={s.downloadBtn} onClick={downloadPNG}>
          ⬇ PNG 다운로드 (1280×720)
        </button>
      </div>

      <div className={s.right}>
        <div className={s.previewHeader}>
          <span>썸네일 미리보기</span>
          <span className={s.size}>1280 × 720</span>
        </div>
        <div className={s.canvasWrap}>
          <canvas ref={canvasRef} width={1280} height={720} className={s.canvas} />
        </div>
      </div>
    </div>
  )
}
