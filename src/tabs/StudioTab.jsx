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

  const [copiedId, setCopiedId] = useState(null)

  const copyPrompt = (text, cutId) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedId(cutId)
      setTimeout(() => setCopiedId(null), 2000)
    })
  }

  // ── 서여리 베이스 프롬프트 (룰셋 v1.0) ──────────────────────
  const YEORI_BASE = `Young Korean woman mid-20s, long wavy dark brown hair NOT short, small natural beauty mark on right cheek, delicate gold necklace, effortlessly photogenic not posing just existing beautifully, K-model proportions small face long legs, appearing no older than 24-25, DO NOT change character appearance`

  // 툴별 접미사
  const TOOL_SUFFIX = {
    'Flow':             'Photorealistic 8K cinematic 9:16, background people must not interact with main character',
    'Imagen':           'Photorealistic 8K cinematic, semi-realistic Korean style',
    'Midjourney':       'photorealistic, 8K, cinematic lighting, --ar 9:16 --v 6',
    'DALL-E 3':         'photorealistic, cinematic, high quality, 9:16 aspect ratio',
    'Stable Diffusion': 'masterpiece, best quality, photorealistic, cinematic lighting, 8k uhd',
  }

  // 룰셋 체크리스트
  const rulesetCheck = (prompt) => {
    const issues = []
    if (!prompt.includes('NOT short')) issues.push('헤어 이중강조')
    if (!prompt.includes('beauty mark')) issues.push('매력점')
    if (!prompt.includes('DO NOT change')) issues.push('캐릭터 고정')
    return issues
  }

  const generateAllPrompts = () => {
    let failCount = 0
    cuts.forEach(c => {
      // 씬에서 장소/시간 추출
      const scene = c.scene || ''
      const action = c.action || ''

      // 클로즈업 여부 감지
      const isCloseup = action.toLowerCase().includes('close') ||
        action.includes('클로즈') || action.includes('표정') || action.includes('얼굴')

      // 클로즈업이면 매력점 강조 추가
      const beautyMark = isCloseup
        ? ', small natural beauty mark on right cheek clearly visible'
        : ', small natural beauty mark on right cheek'

      // 액션을 시간 단위로 분리 (룰셋 원칙)
      const actionPrompt = action
        ? `First 3 seconds: ${action.split('.')[0] || action}, gradually`
        : ''

      // 최종 프롬프트 조합
      const baseWithMark = YEORI_BASE.replace(
        'small natural beauty mark on right cheek',
        beautyMark.replace(', ', '')
      )

      const prompt = [
        baseWithMark,
        c.imagePrompt || '',           // 기존 프롬프트 보존
        scene,
        actionPrompt,
        TOOL_SUFFIX[selected] || TOOL_SUFFIX['Flow']
      ].filter(Boolean).join(', ').replace(/,\s*,/g, ',').trim()

      // 룰셋 체크
      const issues = rulesetCheck(prompt)
      if (issues.length > 0) failCount++

      updateCut(c.id, { imagePrompt: prompt })
    })

    if (failCount > 0) {
      alert(`⚠️ ${failCount}컷에서 룰셋 미달 항목이 있어요.\n각 컷 프롬프트를 확인해주세요.`)
    } else {
      alert(`✅ ${cuts.length}컷 프롬프트 생성 완료!\n서여리 베이스 + 룰셋 체크 통과`)
    }
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
                <div style={{display:'flex',gap:4,alignItems:'center'}}>
                  {cut.imagePrompt && rulesetCheck(cut.imagePrompt).length === 0 && (
                    <span style={{fontSize:10,color:'#34d399',fontWeight:700}}>✅ 룰셋 통과</span>
                  )}
                  {cut.imagePrompt && rulesetCheck(cut.imagePrompt).length > 0 && (
                    <span style={{fontSize:10,color:'#fbbf24',fontWeight:700}} title={rulesetCheck(cut.imagePrompt).join(', ')}>
                      ⚠️ {rulesetCheck(cut.imagePrompt).length}항목
                    </span>
                  )}
                  <button className={s.copyBtn} onClick={() => copyPrompt(cut.imagePrompt, cut.id)}
                    title="복사">{copiedId === cut.id ? '✓ 복사됨' : '📋 복사'}</button>
                </div>
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
