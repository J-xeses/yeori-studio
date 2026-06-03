import { useState, useRef } from 'react'
import { useApp } from '../context/AppContext'
import { setGPoint } from '../lib/gpoints'
import s from './StudioTab.module.css'

const TOOLS = ['Flow', 'Imagen', 'Midjourney', 'DALL-E 3', 'Stable Diffusion']

// ── Gemini 이미지 생성 (Vercel 프록시 경유) ───────────────────
// 한국 네트워크 차단 우회: 브라우저 → Vercel(미국) → Google API
async function generateImageWithGemini(prompt, apiKey) {
  const response = await fetch('/api/gemini', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, apiKey }),
  })

  if (!response.ok) {
    const err = await response.json()
    throw new Error(err.error || `프록시 오류 ${response.status}`)
  }

  const data = await response.json()
  if (!data.success) throw new Error(data.error || '이미지 생성 실패')

  return `data:${data.mimeType};base64,${data.imageData}`
}

export default function StudioTab() {
  const { state, dispatch } = useApp()
  const { cuts, apiKeys } = state
  const [images, setImages] = useState({})
  const [selected, setSelected] = useState(TOOLS[0])
  const [copiedId, setCopiedId] = useState(null)
  const [generating, setGenerating] = useState({}) // { cutId: true/false }
  const [autoProgress, setAutoProgress] = useState({ running: false, current: 0, total: 0, log: [] })
  const fileRefs = useRef({})

  const updateCut = (id, p) => dispatch({ type: 'UPDATE_CUT', id, p })

  const handleImageUpload = (cutId, file) => {
    if (!file) return
    const url = URL.createObjectURL(file)
    setImages(prev => ({ ...prev, [cutId]: url }))
    // G3 포인트 자동 저장
    const cut = cuts.find(c => c.id === cutId)
    if (cut) setGPoint(cut.no, 'g3', true)
  }

  const copyPrompt = (text, cutId) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedId(cutId)
      setTimeout(() => setCopiedId(null), 2000)
    })
  }

  // ── 단일 컷 이미지 자동 생성 ──────────────────────────────────
  const generateSingleImage = async (cut) => {
    if (!apiKeys.gemini) { alert('GEMINI API 키를 입력하세요!'); return }
    if (!cut.imagePrompt) { alert(`CUT ${cut.no} 프롬프트가 없어요!`); return }
    setGenerating(prev => ({ ...prev, [cut.id]: true }))
    try {
      const imgUrl = await generateImageWithGemini(cut.imagePrompt, apiKeys.gemini)
      setImages(prev => ({ ...prev, [cut.id]: imgUrl }))
      setGPoint(cut.no, 'g3', true)
    } catch(e) {
      alert(`CUT ${cut.no} 생성 실패: ${e.message}`)
    } finally {
      setGenerating(prev => ({ ...prev, [cut.id]: false }))
    }
  }

  // ── 전체 컷 자동 생성 ─────────────────────────────────────────
  const generateAllImages = async () => {
    if (!apiKeys.gemini) { alert('GEMINI API 키를 입력하세요!'); return }
    const validCuts = cuts.filter(c => c.imagePrompt)
    if (!validCuts.length) { alert('프롬프트가 있는 컷이 없어요!\n먼저 전체 프롬프트 자동 생성을 실행하세요.'); return }
    if (!confirm(`${validCuts.length}컷 이미지를 자동 생성할까요?\n(무료 한도: 하루 500장)`)) return

    setAutoProgress({ running: true, current: 0, total: validCuts.length, log: [] })

    for (let i = 0; i < validCuts.length; i++) {
      const cut = validCuts[i]
      setAutoProgress(prev => ({
        ...prev, current: i + 1,
        log: [...prev.log, `CUT ${cut.no} 생성 중...`]
      }))
      try {
        const imgUrl = await generateImageWithGemini(cut.imagePrompt, apiKeys.gemini)
        setImages(prev => ({ ...prev, [cut.id]: imgUrl }))
        setGPoint(cut.no, 'g3', true)
        setAutoProgress(prev => ({
          ...prev,
          log: [...prev.log.slice(0, -1), `✅ CUT ${cut.no} 완료`]
        }))
      } catch(e) {
        setAutoProgress(prev => ({
          ...prev,
          log: [...prev.log.slice(0, -1), `❌ CUT ${cut.no} 실패: ${e.message}`]
        }))
      }
      // API 레이트 리밋 방지 (1초 대기)
      if (i < validCuts.length - 1) await new Promise(r => setTimeout(r, 1000))
    }
    setAutoProgress(prev => ({ ...prev, running: false }))
  }

  // ── 룰셋 체크 ─────────────────────────────────────────────────
  const rulesetCheck = (prompt) => {
    const issues = []
    if (!prompt.includes('NOT short')) issues.push('헤어 이중강조')
    if (!prompt.includes('skin texture') && !prompt.includes('beauty mark')) issues.push('매력점')
    if (!prompt.includes('DO NOT change')) issues.push('캐릭터 고정')
    if (!prompt.includes('K-model') && !prompt.includes('proportions')) issues.push('K모델 비율')
    return issues
  }

  // ── 서여리 베이스 프롬프트 ────────────────────────────────────
  const YEORI_BASE = `Young Korean woman early 20s (22-23 years old), long wavy dark brown hair NOT short, natural skin texture on right cheek (subtle, not a prominent mark), delicate gold necklace, effortlessly photogenic not posing just existing beautifully, K-model proportions very small face long slim legs slender figure tall fashion model body, small head-to-body ratio DO NOT make average body proportions, appearing no older than 22-23, DO NOT change character appearance, Photorealistic 8K cinematic, natural Korean beauty`

  // 툴별 접미사
  const TOOL_SUFFIX = {
    'Flow':             'Photorealistic 8K cinematic 9:16, background people must not interact with main character, consistent character face',
    'Imagen':           'Photorealistic 8K cinematic, semi-realistic Korean style',
    'Midjourney':       'photorealistic, 8K, cinematic lighting, --ar 9:16 --v 6',
    'DALL-E 3':         'photorealistic, cinematic, high quality, 9:16 aspect ratio',
    'Stable Diffusion': 'masterpiece, best quality, photorealistic, cinematic lighting, 8k uhd',
  }

  const exportPromptsJson = () => {
    const { episode, cuts: allCuts } = state
    const payload = {
      episode: episode.number,
      title: episode.title || '',
      generatedAt: new Date().toISOString(),
      cuts: allCuts
        .filter(c => c.imagePrompt?.trim())
        .map(c => ({
          no: c.no,
          episode: episode.number,
          scene: c.scene || '',
          dialogue: c.dialogue || '',
          imagePrompt: c.imagePrompt,
        })),
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `prompts_ep${episode.number}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const generateAllPrompts = () => {
    let failCount = 0
    cuts.forEach(c => {
      const scene = c.scene || ''
      const action = c.action || ''
      const isCloseup = action.toLowerCase().includes('close') ||
        action.includes('클로즈') || action.includes('표정') || action.includes('얼굴')
      const beautyMark = 'natural skin texture on right cheek (subtle, not a prominent mark)'
      const actionPrompt = action
        ? `First 3 seconds: ${action.split('.')[0] || action}`
        : ''
      const prompt = [
        YEORI_BASE.replace('natural skin texture on right cheek (subtle, not a prominent mark)', beautyMark),
        c.imagePrompt || '',
        scene,
        actionPrompt,
        TOOL_SUFFIX[selected] || TOOL_SUFFIX['Flow']
      ].filter(Boolean).join(', ').replace(/,\s*,/g, ',').trim()

      const issues = rulesetCheck(prompt)
      if (issues.length > 0) failCount++
      updateCut(c.id, { imagePrompt: prompt })
    })
    if (failCount > 0) {
      alert(`⚠️ ${failCount}컷에서 룰셋 미달 항목이 있어요.\n각 컷 프롬프트를 확인해주세요.`)
    } else {
      alert(`✅ ${cuts.length}컷 프롬프트 생성 완료!\n서여리 베이스 + K모델 비율 + 룰셋 통과`)
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
        <div style={{display:'flex',gap:8,alignItems:'center'}}>
          <button className={s.autoBtn} onClick={generateAllPrompts}>⚡ 전체 프롬프트 자동 생성</button>
          <button className={s.autoBtn} onClick={exportPromptsJson}
            title="downloads/flow/prompts.json 생성 → npm run flow 실행"
            style={{ background: 'linear-gradient(135deg,#22c55e,#16a34a)', color: '#fff', border: 'none' }}>
            📤 Flow용 JSON 내보내기
          </button>
          <button
            onClick={generateAllImages}
            disabled={autoProgress.running}
            style={{
              padding:'8px 14px', borderRadius:6,
              background: autoProgress.running ? 'var(--surface3)' : 'linear-gradient(135deg,#a78bfa,#60a5fa)',
              color:'#fff', border:'none', fontSize:12, fontWeight:700,
              cursor: autoProgress.running ? 'not-allowed' : 'pointer',
              display:'flex', alignItems:'center', gap:6,
              fontFamily:'Noto Sans KR, sans-serif',
              opacity: autoProgress.running ? 0.7 : 1,
            }}
          >
            {autoProgress.running
              ? `🤖 생성 중... ${autoProgress.current}/${autoProgress.total}`
              : '🤖 전체 이미지 자동 생성'}
          </button>
        </div>
      </div>

      {/* 자동 생성 진행 로그 */}
      {(autoProgress.running || autoProgress.log.length > 0) && (
        <div style={{
          background:'var(--surface2)', border:'1px solid var(--border)',
          borderRadius:8, padding:'12px 16px', margin:'0 0 12px',
          fontSize:11, fontFamily:'Space Mono, monospace',
        }}>
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:8}}>
            <div style={{fontWeight:700,color:'var(--purple)'}}>
              🤖 이미지 자동 생성
              {autoProgress.running && ` (${autoProgress.current}/${autoProgress.total})`}
            </div>
            {!autoProgress.running && (
              <button
                onClick={() => setAutoProgress({ running:false, current:0, total:0, log:[] })}
                style={{background:'transparent',border:'none',color:'var(--text3)',cursor:'pointer',fontSize:11}}
              >✕ 닫기</button>
            )}
          </div>
          {autoProgress.running && (
            <div style={{background:'var(--surface3)',borderRadius:4,height:6,marginBottom:8,overflow:'hidden'}}>
              <div style={{
                width:`${(autoProgress.current/autoProgress.total)*100}%`,
                height:'100%', background:'linear-gradient(90deg,var(--purple),var(--teal))',
                borderRadius:4, transition:'width 0.3s'
              }}/>
            </div>
          )}
          <div style={{maxHeight:80,overflowY:'auto',color:'var(--text2)'}}>
            {autoProgress.log.map((l,i) => (
              <div key={i} style={{
                color: l.startsWith('✅') ? 'var(--teal)' : l.startsWith('❌') ? 'var(--red)' : 'var(--text3)'
              }}>{l}</div>
            ))}
          </div>
          {!autoProgress.running && autoProgress.log.length > 0 && (
            <div style={{marginTop:8,color:'var(--teal)',fontWeight:700}}>
              ✅ {autoProgress.log.filter(l=>l.startsWith('✅')).length}컷 완료
              {autoProgress.log.filter(l=>l.startsWith('❌')).length > 0 &&
                ` / ❌ ${autoProgress.log.filter(l=>l.startsWith('❌')).length}컷 실패`}
            </div>
          )}
        </div>
      )}

      <div className={s.grid}>
        {cuts.map((cut) => (
          <div key={cut.id} className={s.card}>
            <div className={s.cardHeader}>
              <span className={s.cutBadge}>CUT {cut.no}</span>
              <span className={s.scene}>{cut.scene || '씬 미입력'}</span>
            </div>

            <div className={s.imageArea}
              onClick={() => !generating[cut.id] && fileRefs.current[cut.id]?.click()}
              style={images[cut.id] ? { backgroundImage: `url(${images[cut.id]})` } : {}}
            >
              {!images[cut.id] && !generating[cut.id] && (
                <div className={s.uploadPlaceholder}>
                  <span className={s.uploadIcon}>🖼️</span>
                  <span>이미지 업로드</span>
                  <span className={s.uploadSub}>클릭하여 선택</span>
                </div>
              )}
              {generating[cut.id] && (
                <div className={s.uploadPlaceholder}>
                  <span style={{fontSize:24,animation:'spin 1s linear infinite'}}>⟳</span>
                  <span style={{fontSize:11,color:'var(--purple)'}}>Gemini 생성 중...</span>
                </div>
              )}
              {images[cut.id] && (
                <button className={s.removeImg} onClick={e => {
                  e.stopPropagation()
                  setImages(p => { const n={...p}; delete n[cut.id]; return n })
                }}>✕</button>
              )}
              <input ref={el => fileRefs.current[cut.id] = el} type="file" accept="image/*"
                style={{ display: 'none' }}
                onChange={e => handleImageUpload(cut.id, e.target.files[0])} />
            </div>

            {/* 개별 자동 생성 버튼 */}
            {apiKeys.gemini && cut.imagePrompt && !images[cut.id] && (
              <button
                onClick={() => generateSingleImage(cut)}
                disabled={generating[cut.id]}
                style={{
                  width:'100%', padding:'6px 0', margin:'4px 0',
                  background:'var(--purple-bg)', border:'1px solid rgba(167,139,250,0.3)',
                  borderRadius:6, color:'var(--purple)', fontSize:11, fontWeight:700,
                  cursor: generating[cut.id] ? 'not-allowed' : 'pointer',
                  fontFamily:'Noto Sans KR, sans-serif',
                }}
              >
                {generating[cut.id] ? '⟳ 생성 중...' : '🤖 이미지 자동 생성'}
              </button>
            )}

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
