import { useState, useRef, useEffect } from 'react'
import { useApp } from '../context/AppContext'
import { setGPoint, setGPoints, loadGPoints } from '../lib/gpoints'
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
  const [images, setImages] = useState({})      // cut.id → [url, url, ...]
  const [selectedImage, setSelectedImage] = useState({}) // cut.id → index
  const [selected, setSelected] = useState(TOOLS[0])
  const [copiedId, setCopiedId] = useState(null)
  const [generating, setGenerating] = useState({})
  const [confirmed, setConfirmed] = useState({})
  const [g2Approved, setG2Approved] = useState({})
  const [flowRunning, setFlowRunning] = useState(false)
  const [flowLogs, setFlowLogs] = useState([])
  const [flowDone, setFlowDone] = useState(false)
  const [proxyOk, setProxyOk] = useState(null) // null=checking, true=ok, false=error
  const [gData, setGData] = useState(() => loadGPoints())
  const fileRefs = useRef({})
  const autoFlowTriggered = useRef(false)

  useEffect(() => {
    const check = async () => {
      try {
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), 3000)
        await fetch('http://localhost:3001/api/health', { signal: controller.signal })
        clearTimeout(timer)
        setProxyOk(true)
      } catch {
        setProxyOk(false)
      }
    }
    check()
  }, [])

  // G1 전체 승인 시 Flow 자동 실행 (항상 fresh gData 사용)
  useEffect(() => {
    if (autoFlowTriggered.current || !cuts.length) return
    const gd = loadGPoints()
    const allG1 = cuts.every(c => gd[`cut_${c.no}`]?.g1)
    if (allG1) {
      autoFlowTriggered.current = true
      runFlow()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cuts.length])

  const updateCut = (id, p) => dispatch({ type: 'UPDATE_CUT', id, p })

  const handleImageUpload = (cutId, file) => {
    if (!file) return
    const url = URL.createObjectURL(file)
    setImages(prev => {
      const existing = Array.isArray(prev[cutId]) ? prev[cutId] : (prev[cutId] ? [prev[cutId]] : [])
      return { ...prev, [cutId]: [...existing, url] }
    })
    setSelectedImage(prev => ({ ...prev, [cutId]: (Array.isArray(images[cutId]) ? images[cutId].length : 0) }))
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
      setImages(prev => {
        const existing = Array.isArray(prev[cut.id]) ? prev[cut.id] : (prev[cut.id] ? [prev[cut.id]] : [])
        return { ...prev, [cut.id]: [...existing, imgUrl] }
      })
      setSelectedImage(prev => ({ ...prev, [cut.id]: 0 }))
      setGPoint(cut.no, 'g3', true)
    } catch(e) {
      alert(`CUT ${cut.no} 생성 실패: ${e.message}`)
    } finally {
      setGenerating(prev => ({ ...prev, [cut.id]: false }))
    }
  }

  // ── 단일 컷 Flow 재생성 ────────────────────────────────────────
  const runFlowForCut = async (cut) => {
    const { episode } = state
    if (!cut.imagePrompt?.trim()) { alert(`CUT ${cut.no} 프롬프트가 없어요!`); return }

    const prompts = {
      episode: episode.number,
      title: episode.title || '',
      cuts: [{
        no: cut.no,
        imagePrompt: cut.imagePrompt,
        ...(cut.narration?.trim() ? { narration: cut.narration.trim() } : {}),
        ...(cut.dialogue?.trim() && !/^없음$/i.test(cut.dialogue) ? { dialogue: cut.dialogue.trim() } : {}),
        duration: cut.duration || 5,
      }],
    }

    setGenerating(prev => ({ ...prev, [cut.id]: true }))
    setFlowLogs(prev => [...prev, { type: 'info', message: `🔄 CUT ${cut.no} Flow 재생성 중…` }])

    try {
      const res = await fetch('http://localhost:3001/api/run-flow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ep: episode.number, prompts }),
      })
      if (!res.ok) throw new Error(`서버 오류 ${res.status} — npm run proxy 실행 중인지 확인`)

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop()
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const ev = JSON.parse(line.slice(6))
            if (ev.type === 'cut_done') {
              const padded = String(ev.cutNo).padStart(2, '0')
              for (const ext of ['jpg', 'jpeg', 'png']) {
                const url = `http://localhost:3001/downloads/flow/ep${episode.number}/cut_${padded}.${ext}?t=${Date.now()}`
                try {
                  const r = await fetch(url, { method: 'HEAD' })
                  if (r.ok) {
                    setImages(p => ({ ...p, [cut.id]: url }))
                    setGPoint(cut.no, 'g3', true)
                    setFlowLogs(prev => [...prev, { type: 'done', message: `✅ CUT ${cut.no} Flow 완료` }])
                    break
                  }
                } catch {}
              }
            } else if (ev.type === 'error') {
              setFlowLogs(prev => [...prev, { type: 'error', message: `❌ CUT ${cut.no} Flow 실패: ${ev.message}` }])
            } else if (ev.type === 'log' && ev.level === 'error') {
              setFlowLogs(prev => [...prev, { type: 'error', message: `⚠️ ${ev.message}` }])
            }
          } catch {}
        }
      }
    } catch (err) {
      setFlowLogs(prev => [...prev, { type: 'error', message: `❌ CUT ${cut.no}: ${err.message}` }])
    } finally {
      setGenerating(prev => ({ ...prev, [cut.id]: false }))
    }
  }

  // ── Flow 파이프라인 실행 (prompts 저장 → npm run flow → 이미지 자동 로드) ──
  const runFlow = async () => {
    const { episode, cuts: allCuts } = state
    const prompts = {
      episode: episode.number,
      title: episode.title || '',
      cuts: allCuts.filter(c => c.imagePrompt?.trim()).map(c => ({
        no: c.no,
        imagePrompt: c.imagePrompt,
        ...(c.narration?.trim() ? { narration: c.narration.trim() } : {}),
        ...(c.dialogue?.trim() && !/^없음$/i.test(c.dialogue) ? { dialogue: c.dialogue.trim() } : {}),
        duration: c.duration || 5,
      })),
    }
    if (!prompts.cuts.length) { alert('이미지 프롬프트가 있는 컷이 없어요!'); return }

    setFlowRunning(true)
    setFlowDone(false)
    setFlowLogs([{ type: 'info', message: 'prompts.json 저장 중…' }])

    try {
      const res = await fetch('http://localhost:3001/api/run-flow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ep: episode.number, prompts }),
      })
      if (!res.ok) throw new Error(`서버 오류 ${res.status} — npm run proxy 실행 중인지 확인`)

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop()
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const ev = JSON.parse(line.slice(6))
            if (ev.type === 'saved') {
              setFlowLogs(prev => [...prev, { type: 'ok', message: '✅ prompts.json 저장 완료' }])
            } else if (ev.type === 'progress') {
              setFlowLogs(prev => [...prev, {
                type: 'progress', cutNo: ev.cutNo,
                message: `🔄 C${String(ev.cutNo).padStart(2,'0')} 생성 중… (${ev.current}/${ev.total})`,
              }])
            } else if (ev.type === 'cut_done') {
              setFlowLogs(prev => {
                const next = [...prev]
                for (let j = next.length - 1; j >= 0; j--) {
                  if (next[j].cutNo === ev.cutNo && next[j].type === 'progress') {
                    next[j] = { type: 'done', cutNo: ev.cutNo, message: `✅ C${String(ev.cutNo).padStart(2,'0')} 완료 (${ev.current}/${ev.total})` }
                    break
                  }
                }
                return next
              })
              // 생성된 이미지 자동 로드
              const padded = String(ev.cutNo).padStart(2, '0')
              const cut = allCuts.find(c => c.no === ev.cutNo)
              if (cut) {
                for (const ext of ['jpg', 'jpeg', 'png']) {
                  const url = `http://localhost:3001/downloads/flow/ep${episode.number}/cut_${padded}.${ext}?t=${Date.now()}`
                  try {
                    const r = await fetch(url, { method: 'HEAD' })
                    if (r.ok) { setImages(p => ({ ...p, [cut.id]: url })); setGPoint(cut.no, 'g3', true); break }
                  } catch {}
                }
              }
            } else if (ev.type === 'cut_error') {
              setFlowLogs(prev => [...prev, { type: 'error', cutNo: ev.cutNo, message: `❌ C${String(ev.cutNo).padStart(2,'0')} 실패` }])
            } else if (ev.type === 'log' && ev.level === 'error') {
              setFlowLogs(prev => [...prev, { type: 'error', message: `⚠️ ${ev.message}` }])
            } else if (ev.type === 'error') {
              setFlowLogs(prev => [...prev, { type: 'error', message: `❌ ${ev.message}${ev.detail ? ` (${ev.detail})` : ''}` }])
            } else if (ev.type === 'complete') {
              setFlowRunning(false)
              setFlowDone(ev.success)
              if (!ev.success) {
                const reason = ev.reason ? ` — ${ev.reason}` : ''
                setFlowLogs(prev => [...prev, { type: 'error', message: `파이프라인 실패${reason} (code: ${ev.code ?? 'null'})` }])
              }
            }
          } catch {}
        }
      }
    } catch (err) {
      setFlowLogs(prev => [...prev, { type: 'error', message: `❌ ${err.message}` }])
      setFlowRunning(false)
    }
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

  const allConfirmed = cuts.length > 0 && cuts.every(c => confirmed[c.id] && images[c.id]?.length > 0)
  const g1Count = cuts.filter(c => gData[`cut_${c.no}`]?.g1).length
  const g3Count = cuts.filter(c => images[c.id]?.length > 0).length
  const g2Count = cuts.filter(c => confirmed[c.id]).length

  const exportPromptsJson = () => runFlow()

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
          <button className={s.autoBtn} onClick={exportPromptsJson}
            disabled={flowRunning}
            title="prompts.json 저장 후 Google Flow 자동 실행"
            style={{ background: flowRunning ? 'var(--surface3)' : 'linear-gradient(135deg,#22c55e,#16a34a)', color: '#fff', border: 'none', opacity: flowRunning ? 0.7 : 1 }}>
            {flowRunning ? '⏳ Flow 실행 중…' : '📤 Flow용 JSON 내보내기'}
          </button>
          <button
            onClick={runFlow}
            disabled={flowRunning}
            style={{
              padding:'8px 14px', borderRadius:6,
              background: flowRunning ? 'var(--surface3)' : 'linear-gradient(135deg,#a78bfa,#60a5fa)',
              color:'#fff', border:'none', fontSize:12, fontWeight:700,
              cursor: flowRunning ? 'not-allowed' : 'pointer',
              display:'flex', alignItems:'center', gap:6,
              fontFamily:'Noto Sans KR, sans-serif',
              opacity: flowRunning ? 0.7 : 1,
            }}
          >
            {flowRunning ? '🔄 Flow 실행 중…' : '🤖 전체 이미지 자동 생성'}
          </button>
        </div>
      </div>

      {/* 프록시 서버 연결 경고 */}
      {proxyOk === false && (
        <div style={{
          background:'rgba(239,68,68,.12)', border:'1px solid rgba(239,68,68,.35)',
          borderRadius:8, padding:'10px 16px', margin:'8px 16px 0',
          fontSize:12.5, color:'#fca5a5', fontWeight:600, flexShrink:0,
          display:'flex', alignItems:'center', gap:8,
        }}>
          ⚠️ 프록시 서버가 실행되지 않았습니다. 터미널에서 <code style={{background:'rgba(0,0,0,.3)',padding:'1px 6px',borderRadius:4,fontFamily:'monospace'}}>npm run studio</code>를 실행해주세요.
        </div>
      )}

      {/* Flow 실행 로그 */}
      {flowLogs.length > 0 && (
        <div style={{
          background:'var(--surface2)', border:'1px solid var(--border)',
          borderRadius:8, padding:'12px 16px', margin:'0 0 12px',
          fontSize:11, fontFamily:'Space Mono, monospace',
        }}>
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:8}}>
            <div style={{fontWeight:700,color:'var(--purple)'}}>🤖 Google Flow 이미지 생성</div>
            {!flowRunning && (
              <button onClick={() => { setFlowLogs([]); setFlowDone(false) }}
                style={{background:'transparent',border:'none',color:'var(--text3)',cursor:'pointer',fontSize:11}}>✕ 닫기</button>
            )}
          </div>
          <div style={{maxHeight:100,overflowY:'auto',color:'var(--text2)',display:'flex',flexDirection:'column',gap:2}}>
            {flowLogs.map((l,i) => (
              <div key={i} style={{
                color: l.type==='done'||l.type==='ok' ? 'var(--teal)'
                     : l.type==='error' ? 'var(--red)'
                     : l.type==='progress' ? 'var(--purple)'
                     : 'var(--text3)'
              }}>{l.message}</div>
            ))}
          </div>
          {flowDone && (
            <div style={{marginTop:8,color:'var(--teal)',fontWeight:700,borderTop:'1px solid var(--border)',paddingTop:8}}>
              🎉 전체 완료!
            </div>
          )}
        </div>
      )}

      <div className={s.grid}>
        {cuts.map((cut) => (
          <div key={cut.id} className={s.card}>
            {/* 왼쪽: 이미지 영역 */}
            <div className={s.cardLeft}>
              {images[cut.id]?.length > 0 && (
                <div style={{display:'flex',gap:'4px',flexWrap:'wrap',padding:'6px',background:'rgba(0,0,0,0.2)',flexShrink:0}}>
                  {images[cut.id].map((url, idx) => (
                    <div key={idx} onClick={() => setSelectedImage(prev => ({...prev, [cut.id]: idx}))}
                      style={{width:'58px',height:'58px',borderRadius:'5px',overflow:'hidden',cursor:'pointer',
                        border: (selectedImage[cut.id]??0) === idx ? '2px solid #a78bfa' : '2px solid transparent',
                        flexShrink:0}}>
                      <img src={url} style={{width:'100%',height:'100%',objectFit:'cover'}} alt="" />
                    </div>
                  ))}
                  <div onClick={() => fileRefs.current[cut.id]?.click()}
                    style={{width:'58px',height:'58px',borderRadius:'5px',border:'2px dashed rgba(255,255,255,0.2)',
                      display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer',
                      flexShrink:0,color:'#5c5870',fontSize:'18px'}}>+</div>
                </div>
              )}
              <div className={s.imageArea}
                onClick={() => !images[cut.id]?.length && !generating[cut.id] && fileRefs.current[cut.id]?.click()}
                style={images[cut.id]?.length > 0 ? { backgroundImage: `url(${images[cut.id][selectedImage[cut.id]??0]})` } : {}}
              >
                {!images[cut.id]?.length && !generating[cut.id] && (
                  <div className={s.uploadPlaceholder}>
                    <span className={s.uploadIcon}>🖼️</span>
                    <span>이미지 업로드</span>
                    <span className={s.uploadSub}>클릭하여 선택</span>
                  </div>
                )}
                {generating[cut.id] && (
                  <div className={s.uploadPlaceholder}>
                    <span style={{fontSize:24,animation:'spin 1s linear infinite'}}>⟳</span>
                    <span style={{fontSize:11,color:'var(--purple)'}}>{selected === 'Flow' ? 'Flow 생성 중...' : 'Gemini 생성 중...'}</span>
                  </div>
                )}
                {images[cut.id] && (
                  <button className={s.removeImg} onClick={e => {
                    e.stopPropagation()
                    setImages(p => {
                      const arr = Array.isArray(p[cut.id]) ? p[cut.id] : []
                      const idx = selectedImage[cut.id] ?? 0
                      const newArr = arr.filter((_, i) => i !== idx)
                      const n = {...p}
                      if (newArr.length) n[cut.id] = newArr
                      else delete n[cut.id]
                      return n
                    })
                    setSelectedImage(prev => ({...prev, [cut.id]: 0}))
                  }}>✕</button>
                )}
                <input ref={el => fileRefs.current[cut.id] = el} type="file" accept="image/*"
                  style={{ display: 'none' }}
                  onChange={e => handleImageUpload(cut.id, e.target.files[0])} />
              </div>
              {apiKeys.gemini && cut.imagePrompt && !images[cut.id] && (
                <button
                  onClick={() => generateSingleImage(cut)}
                  disabled={generating[cut.id]}
                  style={{
                    width:'100%', padding:'5px 0', flexShrink:0,
                    background:'var(--purple-bg)', border:'none', borderTop:'1px solid var(--border)',
                    color:'var(--purple)', fontSize:11, fontWeight:700,
                    cursor: generating[cut.id] ? 'not-allowed' : 'pointer',
                    fontFamily:'Noto Sans KR, sans-serif',
                  }}
                >
                  {generating[cut.id] ? '⟳ 생성 중...' : '🤖 자동 생성'}
                </button>
              )}
            </div>

            {/* 오른쪽: 정보·컨트롤 영역 */}
            <div className={s.cardRight}>
              <div className={s.cardHeader}>
                <span className={s.cutBadge}>CUT {cut.no}</span>
                <span className={s.scene}>{cut.scene || '씬 미입력'}</span>
                {gData[`cut_${cut.no}`]?.g1 && <span className={`${s.gBadge} ${s.g1Badge}`}>G1</span>}
                {g2Approved[cut.id] && <span className={`${s.gBadge} ${s.g2Badge}`}>G2</span>}
              </div>

              <div className={s.promptSection}>
                <div className={s.promptHeader}>
                  <span className={s.promptLabel}>{selected} 프롬프트</span>
                  <button className={s.copyBtn} onClick={() => copyPrompt(cut.imagePrompt)}
                    title="복사">📋 복사</button>
                </div>
                <textarea
                  className={s.promptInput}
                  rows={4}
                  placeholder={`${selected}용 이미지 프롬프트를 입력하세요...`}
                  value={cut.imagePrompt || ''}
                  onChange={e => updateCut(cut.id, { imagePrompt: e.target.value })}
                />
              </div>

              <div className={s.dialoguePreview}>
                {cut.dialogue && <div className={s.dial}><span className={s.dialLabel}>대사</span>{cut.dialogue}</div>}
                {cut.narration && <div className={s.narr}><span className={s.dialLabel}>VO</span>{cut.narration}</div>}
              </div>

              <div className={s.confirmRow} style={{marginTop:'auto'}}>
                <button className={s.confirmBtn}
                  disabled={!images[cut.id]?.length || confirmed[cut.id]}
                  onClick={() => setConfirmed(p => ({ ...p, [cut.id]: true }))}>
                  {confirmed[cut.id] ? '✓ 컨펌' : '컨펌'}
                </button>
                <button className={s.regenBtn}
                  onClick={() => {
                    if (selected === 'Flow' && !proxyOk) {
                      alert('프록시 서버를 먼저 실행해주세요 (npm run studio)')
                      return
                    }
                    setConfirmed(p => ({ ...p, [cut.id]: false }))
                    setImages(p => { const n = {...p}; delete n[cut.id]; return n })
                    if (selected === 'Flow') {
                      runFlowForCut(cut)
                    } else if (apiKeys.gemini && cut.imagePrompt) {
                      generateSingleImage(cut)
                    }
                  }}>
                  🔄 재생성
                </button>
                <button className={s.g2Btn}
                  disabled={!confirmed[cut.id] || g2Approved[cut.id]}
                  onClick={() => {
                    setG2Approved(p => ({ ...p, [cut.id]: true }))
                    setGPoint(cut.no, 'g2', true)
                  }}>
                  {g2Approved[cut.id] ? '✓ G2 완료' : 'G2 승인'}
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* G2 전체 승인 바 */}
      {cuts.length > 0 && (
        <div className={s.g2AllBar}>
          <span className={s.g2AllCount}>
            G2 완료 {Object.values(g2Approved).filter(Boolean).length} / {cuts.length}
          </span>
          <button
            className={s.g2AllBtn}
            disabled={!cuts.every(c => g2Approved[c.id])}
            onClick={() => {
              cuts.forEach(c => setGPoints(c.no, { g2: true }))
              dispatch({ type: 'SET_TAB', p: 'tts' })
            }}>
            {cuts.every(c => g2Approved[c.id]) ? '🎉 G2 전체 승인 → TTS 탭' : 'G2 전체 승인'}
          </button>
        </div>
      )}
    </div>
  )
}
