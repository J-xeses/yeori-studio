import { useState, useRef } from 'react'
import { useApp } from '../context/AppContext'
import s from './StudioTab.module.css'

const TOOLS = ['Flow', 'Imagen', 'Midjourney', 'DALL-E 3', 'Stable Diffusion']

export default function StudioTab() {
  const { state, dispatch } = useApp()
  const { cuts } = state
  const [images, setImages] = useState({})
  const [selected, setSelected] = useState(TOOLS[0])
  const fileRefs = useRef({})

  const updateCut = (id, p) => dispatch({ type: 'UPDATE_CUT', id, p })

  const handleImageUpload = (cutId, file) => {
    if (!file) return
    const url = URL.createObjectURL(file)
    setImages(prev => ({ ...prev, [cutId]: url }))
  }

  const copyPrompt = (text) => {
    navigator.clipboard.writeText(text).then(() => {
      // visual feedback handled inline
    })
  }

  const generateAllPrompts = () => {
    cuts.forEach(c => {
      if (!c.imagePrompt) {
        const auto = `${c.character || 'Korean woman'}, ${c.scene || 'cinematic scene'}, ${c.action || ''}, dramatic lighting, 4K, hyperrealistic, film style`
        updateCut(c.id, { imagePrompt: auto.replace(/,\s*,/g, ',').trim() })
      }
    })
  }

  return (
    <div className={s.root}>
      <div className={s.toolbar}>
        <div className={s.toolLeft}>
          <span className={s.toolLabel}>이미지 생성 도구</span>
          {TOOLS.map(t => (
            <button key={t} className={`${s.toolBtn} ${selected === t ? s.toolActive : ''}`}
              onClick={() => setSelected(t)}>{t}</button>
          ))}
        </div>
        <button className={s.autoBtn} onClick={generateAllPrompts}>⚡ 전체 프롬프트 자동 생성</button>
      </div>

      <div className={s.grid}>
        {cuts.map((cut) => (
          <div key={cut.id} className={s.card}>
            <div className={s.cardHeader}>
              <span className={s.cutBadge}>CUT {cut.no}</span>
              <span className={s.scene}>{cut.scene || '씬 미입력'}</span>
            </div>

            <div className={s.imageArea}
              onClick={() => fileRefs.current[cut.id]?.click()}
              style={images[cut.id] ? { backgroundImage: `url(${images[cut.id]})` } : {}}
            >
              {!images[cut.id] && (
                <div className={s.uploadPlaceholder}>
                  <span className={s.uploadIcon}>🖼️</span>
                  <span>이미지 업로드</span>
                  <span className={s.uploadSub}>클릭하여 선택</span>
                </div>
              )}
              {images[cut.id] && (
                <button className={s.removeImg} onClick={e => { e.stopPropagation(); setImages(p => { const n = {...p}; delete n[cut.id]; return n }) }}>✕</button>
              )}
              <input ref={el => fileRefs.current[cut.id] = el} type="file" accept="image/*" style={{ display: 'none' }}
                onChange={e => handleImageUpload(cut.id, e.target.files[0])} />
            </div>

            <div className={s.promptSection}>
              <div className={s.promptHeader}>
                <span className={s.promptLabel}>{selected} 프롬프트</span>
                <button className={s.copyBtn} onClick={() => copyPrompt(cut.imagePrompt)}
                  title="복사">📋 복사</button>
              </div>
              <textarea
                className={s.promptInput}
                rows={3}
                placeholder={`${selected}용 이미지 프롬프트를 입력하세요...`}
                value={cut.imagePrompt || ''}
                onChange={e => updateCut(cut.id, { imagePrompt: e.target.value })}
              />
            </div>

            <div className={s.dialoguePreview}>
              {cut.dialogue && <div className={s.dial}><span className={s.dialLabel}>대사</span>{cut.dialogue}</div>}
              {cut.narration && <div className={s.narr}><span className={s.dialLabel}>VO</span>{cut.narration}</div>}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
