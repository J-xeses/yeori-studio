import { useState, useRef } from 'react'
import { useApp } from '../context/AppContext'
import s from './StudioTab.module.css'

const TOOLS = ['Flow', 'Imagen', 'Midjourney', 'DALL-E 3', 'Stable Diffusion']

export default function StudioTab() {
  const { state, dispatch } = useApp()
  const { cuts } = state
  const [images, setImages] = useState({})
  const [videos, setVideos] = useState({})
  const [selected, setSelected] = useState(TOOLS[0])
  const [copiedId, setCopiedId] = useState(null)
  const fileRefs = useRef({})
  const videoRefs = useRef({})

  const updateCut = (id, p) => dispatch({ type: 'UPDATE_CUT', id, p })

  const handleImageUpload = (cutId, file) => {
    if (!file) return
    setImages(prev => ({ ...prev, [cutId]: URL.createObjectURL(file) }))
  }

  const handleVideoUpload = (cutId, file) => {
    if (!file) return
    setVideos(prev => ({ ...prev, [cutId]: { url: URL.createObjectURL(file), name: file.name } }))
  }

  const copyPrompt = (cutId, text) => {
    navigator.clipboard.writeText(text)
    setCopiedId(cutId)
    setTimeout(() => setCopiedId(null), 1500)
  }

  const generateAllPrompts = () => {
    cuts.forEach(c => {
      if (!c.imagePrompt) {
        const auto = `${c.character || 'Korean woman'}, ${c.scene || 'cinematic scene'}, ${c.action || ''}, dramatic lighting, 4K, hyperrealistic, film style`
        updateCut(c.id, { imagePrompt: auto.replace(/,\s*,/g, ',').trim() })
      }
    })
  }

  const sigCuts = cuts.filter(c => c.cutType === 'SIGNATURE')
  const normalCuts = cuts.filter(c => c.cutType !== 'SIGNATURE')

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

      <div className={s.content}>

        {/* ── 시그니처 컷 섹션 ── */}
        {sigCuts.length > 0 && (
          <div className={s.sigSection}>
            <div className={s.sectionHeader}>
              <span className={s.sectionTitleSig}>✨ 시그니처 컷 (MindVideo)</span>
              <span className={s.sectionCount}>{sigCuts.length}컷</span>
            </div>
            <div className={s.sigGrid}>
              {sigCuts.map(cut => (
                <div key={cut.id} className={s.sigCard}>
                  <div className={s.sigCardHeader}>
                    <span className={s.cutBadge}>CUT {cut.no}</span>
                    <span className={s.sigBadge}>✨ SIGNATURE</span>
                    <span className={s.scene}>{cut.scene || '씬 미입력'}</span>
                  </div>

                  <div className={s.sigPromptBox}>
                    <pre className={s.sigPromptText}>{cut.imagePrompt || '(이미지 프롬프트 없음)'}</pre>
                  </div>

                  <div className={s.sigActions}>
                    <button className={`${s.copyBtnSig} ${copiedId === cut.id ? s.copyBtnDone : ''}`}
                      onClick={() => copyPrompt(cut.id, cut.imagePrompt)}>
                      {copiedId === cut.id ? '✅ 복사됨!' : '📋 복사'}
                    </button>
                    <a className={s.mindvideoBtn}
                      href="https://www.mindvideo.ai"
                      target="_blank" rel="noopener noreferrer">
                      🎬 MindVideo에서 열기
                    </a>
                  </div>

                  <div className={s.videoSlot}
                    onClick={() => videoRefs.current[cut.id]?.click()}>
                    {videos[cut.id] ? (
                      <div className={s.videoLoaded}>
                        <span className={s.videoName}>🎬 {videos[cut.id].name}</span>
                        <button className={s.removeVideo}
                          onClick={e => { e.stopPropagation(); setVideos(p => { const n = { ...p }; delete n[cut.id]; return n }) }}>
                          ✕
                        </button>
                      </div>
                    ) : (
                      <div className={s.videoPlaceholder}>
                        <span className={s.videoIcon}>🎥</span>
                        <span>영상 업로드</span>
                        <span className={s.videoSub}>MindVideo 생성 결과물 연결</span>
                      </div>
                    )}
                    <input ref={el => videoRefs.current[cut.id] = el}
                      type="file" accept="video/*" style={{ display: 'none' }}
                      onChange={e => handleVideoUpload(cut.id, e.target.files[0])} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── 일반 컷 섹션 ── */}
        <div className={s.normalSection}>
          <div className={s.sectionHeader}>
            <span className={s.sectionTitleNorm}>🎬 일반 컷 (Flow 자동화)</span>
            <span className={s.sectionCount}>{normalCuts.length}컷</span>
          </div>
          <div className={s.grid}>
            {normalCuts.map(cut => (
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
                    <button className={s.removeImg}
                      onClick={e => { e.stopPropagation(); setImages(p => { const n = { ...p }; delete n[cut.id]; return n }) }}>
                      ✕
                    </button>
                  )}
                  <input ref={el => fileRefs.current[cut.id] = el} type="file" accept="image/*" style={{ display: 'none' }}
                    onChange={e => handleImageUpload(cut.id, e.target.files[0])} />
                </div>

                <div className={s.promptSection}>
                  <div className={s.promptHeader}>
                    <span className={s.promptLabel}>{selected} 프롬프트</span>
                    <button className={`${s.copyBtn} ${copiedId === cut.id ? s.copyBtnDone : ''}`}
                      onClick={() => copyPrompt(cut.id, cut.imagePrompt)}>
                      {copiedId === cut.id ? '✅ 복사됨!' : '📋 복사'}
                    </button>
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

      </div>
    </div>
  )
}
