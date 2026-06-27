// src/tabs/EditMetaTab.jsx
import { useState } from 'react'
import { useApp } from '../context/AppContext'
import { claudeMessages } from '../lib/api'
import { setGPoint, setGPoints } from '../lib/gpoints'
import styles from './EditMetaTab.module.css'

function estimateDuration(text = '') {
  const chars = text.replace(/\s/g, '').length
  return Math.max(4, Math.round((chars / 300) * 60))
}

function toTimecode(sec) {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`
}

function toSRTTime(sec) {
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = Math.floor(sec % 60)
  const ms = Math.round((sec % 1) * 1000)
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')},${String(ms).padStart(3,'0')}`
}

export default function EditMetaTab() {
  const { state, dispatch } = useApp()
  const [activeTab, setActiveTab] = useState('meta') // meta | srt | analyze | guide
  const [loading, setLoading] = useState(false)
  const [meta, setMeta] = useState([])
  const [aiNote, setAiNote] = useState('')
  const [error, setError] = useState('')
  const [hookIndices, setHookIndices] = useState([0])
  const [accRunning, setAccRunning] = useState(false)
  const [accStatus, setAccStatus]   = useState('')
  const [g5Approved, setG5Approved] = useState({})

  // 음성 타이밍 상태
  const [audioSettings, setAudioSettings] = useState({})

  // 컷 상세 분석
  const [selectedCut, setSelectedCut] = useState(null)
  const [analyzeResult, setAnalyzeResult] = useState(null)

  // SRT 설정
  const [srtOffset, setSrtOffset] = useState(0)

  const cuts = state.cuts?.length
    ? state.cuts
    : Array.from({ length: 7 }, (_, i) => ({
        label: `CUT ${String(i+1).padStart(2,'0')}`,
        script: '',
      }))

  const getAudio = (i) => audioSettings[i] || {
    audioFile: `cut_${String(i + 1).padStart(2, '0')}.mp3`,
    audioStart: 0,
    audioEnd: '',
    sfxOnly: false,
    hasSubtitle: true,
  }

  const getAudioStatus = (i) => {
    const a = getAudio(i)
    if (!a.audioFile) return { dot: '🔴', label: '미설정' }
    if (!a.audioEnd)  return { dot: '🟡', label: '기본타이밍' }
    return { dot: '🟢', label: '완료' }
  }

  const setAudio = (i, key, value) => {
    setAudioSettings(prev => ({
      ...prev,
      [i]: { ...getAudio(i), [key]: value }
    }))
  }

  const buildMeta = () => {
    let cursor = 0
    return cuts.map((cut, i) => {
      const dur = cut.sec || cut.duration || estimateDuration(cut.script || cut.text || '')
      const start = cursor
      cursor += dur
      const isHook = hookIndices.includes(i)
      const audio = getAudio(i)
      return {
        cutNo: String(i+1).padStart(2,'0'),
        label: cut.label || `CUT ${String(i+1).padStart(2,'0')}`,
        start: toTimecode(start),
        end: toTimecode(cursor),
        startSec: start,
        endSec: cursor,
        duration: dur,
        type: isHook ? '훅' : '일반',
        transition: i === 0 ? '페이드 인/아웃' : '컷 편집',
        note: isHook ? '리텐션 훅 구간 — 강조 효과 권장' : '',
        audioFile: audio.audioFile,
        audioStart: audio.audioStart,
        audioEnd: audio.audioEnd || dur,
        sfxOnly: audio.sfxOnly,
        hasSubtitle: audio.hasSubtitle,
        script: cut.script || cut.text || '',
        dialogue: cut.dialogue || cut.대사 || '',
        narration: cut.narration || cut.나레이션 || '',
      }
    })
  }

  const generate = async () => {
    setLoading(true); setError('')
    const computed = buildMeta()
    setMeta(computed)
    try {
      const apiKey = state.apiKeys?.claude || state.apiKey || ''
      const totalSec = computed.reduce((a,c) => a + c.duration, 0)
      const hookCuts = computed.filter(c => c.type === '훅').map(c => c.label).join(', ')
      const data = await claudeMessages(apiKey, {
        model: 'claude-sonnet-4-6',
        max_tokens: 400,
        messages: [{
          role: 'user',
          content: `AI 버추얼 인플루언서 "서여리" 유튜브 영상 CapCut 편집 시 주의사항 3줄 요약.
총 길이: ${toTimecode(totalSec)} / CUT: ${computed.length}개 / 훅 CUT: ${hookCuts || '없음'}
실용적인 조언만.`,
        }],
      }).then(r => r.json())
      setAiNote(data.content?.map(b => b.text || '').join('') || '')
    } catch (e) {
      setError('AI 주의사항 생성 오류: ' + e.message)
    } finally {
      setLoading(false)
    }
  }

  // ── SRT 생성 ──
  const generateSRT = () => {
    if (!meta.length) { alert('먼저 편집 메타를 생성해주세요'); return }
    let srt = ''
    let idx = 1
    const offset = parseFloat(srtOffset) || 0

    meta.forEach(m => {
      const text = m.dialogue || m.narration || m.script
      if (!text || m.sfxOnly) return
      const start = m.startSec + offset
      const end = m.endSec + offset
      srt += `${idx}\n`
      srt += `${toSRTTime(start)} --> ${toSRTTime(end)}\n`
      srt += `${text}\n\n`
      idx++
    })

    if (!srt) { alert('자막으로 사용할 대사/나레이션이 없습니다'); return }

    const blob = new Blob([srt], { type: 'text/plain;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `yeori_ep${state.episodeNo || '00'}_subtitles.srt`
    a.click()
  }

  // ── 컷 상세 분석 ──
  const analyzeCut = (cutIdx) => {
    const m = meta[cutIdx]
    if (!m) return
    setSelectedCut(cutIdx)

    const videoDur = m.duration
    const audioEnd = parseFloat(m.audioEnd) || videoDur
    const audioStart = parseFloat(m.audioStart) || 0
    const audioDur = audioEnd - audioStart
    const diff = videoDur - audioDur
    const textLen = (m.dialogue || m.narration || '').replace(/\s/g,'').length
    const estimatedSpeechSec = Math.round(textLen / 5) // 한국어 평균 5자/초

    const issues = []
    if (diff < -1) issues.push({ type: 'error', msg: `음성(${audioDur}s)이 영상(${videoDur}s)보다 ${Math.abs(diff).toFixed(1)}s 깁니다 → 영상 재생성 필요` })
    if (diff > 3) issues.push({ type: 'warn', msg: `영상(${videoDur}s)이 음성(${audioDur}s)보다 ${diff.toFixed(1)}s 깁니다 → 여운 구간으로 활용 가능` })
    if (!m.audioFile) issues.push({ type: 'warn', msg: '음성 파일이 지정되지 않았습니다' })
    if (estimatedSpeechSec > videoDur) issues.push({ type: 'warn', msg: `대사 길이 추정(${estimatedSpeechSec}s)이 영상(${videoDur}s)보다 깁니다 → TTS 속도 확인 필요` })

    setAnalyzeResult({
      cutLabel: m.label,
      videoDur,
      audioDur,
      diff,
      textLen,
      estimatedSpeechSec,
      issues,
      hasDialogue: !!m.dialogue,
      hasNarration: !!m.narration,
      isHook: m.type === '훅',
    })
  }

  // ── 캡컷 가이드 생성 ──
  const generateCapcutGuide = () => {
    if (!meta.length) { alert('먼저 편집 메타를 생성해주세요'); return }
    let guide = `# 서여리 캡컷 편집 가이드\n`
    guide += `생성: ${new Date().toLocaleString('ko-KR')}\n`
    guide += `${'='.repeat(50)}\n\n`

    meta.forEach(m => {
      guide += `## ${m.label} (${m.type})\n`
      guide += `- 구간: ${m.start} ~ ${m.end} (${m.duration}초)\n`
      guide += `- 영상파일: cut_${m.cutNo}.mp4\n`
      guide += `- 음성파일: ${m.audioFile || '미지정'}\n`
      guide += `- 자막: ${m.hasSubtitle ? '있음' : '없음'}\n`
      if (m.dialogue) guide += `- 대사: ${m.dialogue}\n`
      if (m.narration) guide += `- 나레이션: ${m.narration}\n`
      if (m.note) guide += `- 주의: ${m.note}\n`
      guide += `- 립싱크: ${m.dialogue ? '필요 (대사 있음)' : '불필요'}\n`
      guide += `\n`
    })

    if (aiNote) {
      guide += `${'='.repeat(50)}\n`
      guide += `## AI 편집 주의사항\n${aiNote}\n`
    }

    const blob = new Blob([guide], { type: 'text/plain;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `yeori_capcut_guide.txt`
    a.click()
  }

  const exportJSON = async () => {
    const blob = new Blob([JSON.stringify(meta, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob); a.download = 'yeori_edit_meta.json'; a.click()
    try {
      await fetch('http://localhost:3001/api/save-edit-meta', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(meta),
      })
    } catch (e) {
      console.warn('[EditMeta] 서버 저장 실패:', e.message)
    }
  }

  const exportCSV = () => {
    const headers = ['CUT번호','레이블','시작','끝','길이(초)','타입','트랜지션','음성파일','음성시작','음성끝','효과음만','자막']
    const rows = meta.map(m =>
      [m.cutNo, m.label, m.start, m.end, m.duration, m.type, m.transition,
       m.audioFile, m.audioStart, m.audioEnd, m.sfxOnly, m.hasSubtitle].join(',')
    )
    const csv = [headers.join(','), ...rows].join('\n')
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob); a.download = 'yeori_edit_meta.csv'; a.click()
  }

  const runACC = async () => {
    const epNum = state.episode?.number
    if (!epNum) { setAccStatus('❌ 에피소드 번호가 없습니다'); return }

    setAccRunning(true)

    const post = (url, body) =>
      fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        .then(r => r.json())

    try {
      // ① 편집 메타 자동 생성 (AI 주의사항 포함)
      setAccStatus('① 편집 메타 생성 중...')
      await generate()

      // ② 편집 메타 서버 저장
      setAccStatus('② 편집 메타 저장 중...')
      const computed = buildMeta()
      setMeta(computed)
      await post('http://localhost:3001/api/save-edit-meta', computed)

      // ③ SRT 생성
      setAccStatus('③ SRT 생성 중...')
      const srtRes = await post('http://localhost:3001/api/generate-srt', { epNum })
      if (!srtRes.success) {
        setAccStatus(`❌ SRT 생성 실패: ${srtRes.error}`)
        setAccRunning(false); return
      }

      // ④ 영상 합치기
      setAccStatus('④ 영상 합치는 중...')
      const concatRes = await post('http://localhost:3001/api/concat-video', { epNum })
      if (!concatRes.success) {
        setAccStatus(`❌ 영상 합치기 실패: ${concatRes.error}`)
        setAccRunning(false); return
      }

      // ④ 완료
      setAccStatus('✅ 완료! 편집 메타 → SRT → 영상 합치기 성공.')
      setTimeout(() => { setAccRunning(false); setAccStatus('') }, 6000)
    } catch (err) {
      setAccStatus(`❌ 오류: ${err.message}`)
      setAccRunning(false)
    }
  }

  const toggleHook = idx =>
    setHookIndices(prev => prev.includes(idx) ? prev.filter(i => i !== idx) : [...prev, idx])

  const totalDur = meta.reduce((a,c) => a + c.duration, 0)

  const tabStyle = (t) => ({
    padding: '8px 16px', border: 'none', borderRadius: '6px',
    cursor: 'pointer', fontSize: '12px', fontWeight: 600,
    background: activeTab === t ? '#7c3aed' : 'rgba(255,255,255,0.06)',
    color: activeTab === t ? '#fff' : '#9490a8',
    transition: 'all 0.15s',
  })

  return (
    <div className={styles.root}>
    <div className={styles.wrap}>
      <div className={styles.header}>
        <h2 className={styles.title}>편집 메타</h2>
        <p className={styles.desc}>타임코드 · SRT 자막 · 컷 분석 · 캡컷 가이드</p>
      </div>

      {/* A Creative Cutter ON 버튼 */}
      <div style={{marginBottom:'16px',padding:'14px 16px',background:'rgba(249,115,22,0.08)',border:'1px solid rgba(249,115,22,0.3)',borderRadius:'10px'}}>
        <div style={{display:'flex',alignItems:'center',gap:'12px'}}>
          <div style={{flex:1}}>
            <div style={{fontSize:'13px',fontWeight:700,color:'#fb923c'}}>A Creative Cutter + CapCut 연동</div>
            <div style={{fontSize:'11.5px',color:'#9490a8',marginTop:'2px'}}>① 메타 생성 → ② 메타 저장 → ③ SRT 생성 → ④ 영상 합치기</div>
          </div>
          <button
            onClick={runACC}
            disabled={accRunning}
            style={{padding:'9px 22px',borderRadius:'8px',fontSize:'13px',fontWeight:700,
              background: accRunning ? 'rgba(249,115,22,0.2)' : '#f97316',
              color: accRunning ? '#fb923c' : '#fff',
              border: accRunning ? '1px solid rgba(249,115,22,0.4)' : 'none',
              cursor: accRunning ? 'not-allowed' : 'pointer',whiteSpace:'nowrap'}}>
            {accRunning ? '⏳ 실행 중...' : '▶ ON'}
          </button>
        </div>
        {accStatus && (
          <div style={{marginTop:'8px',fontSize:'12px',fontWeight:600,
            color: accStatus.startsWith('❌') ? '#f87171'
                 : accStatus.startsWith('⚠️') ? '#fbbf24'
                 : accStatus.startsWith('✅') ? '#4ade80' : '#fb923c'}}>
            {accStatus}
          </div>
        )}
      </div>

      {/* 탭 네비게이션 */}
      <div style={{display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:'6px', marginBottom:'20px'}}>
        {[
          { key:'meta',    label:'① 메타 생성' },
          { key:'srt',     label:'② SRT 생성' },
          { key:'analyze', label:'③ 컷 분석' },
          { key:'guide',   label:'④ 캡컷 가이드' },
        ].map(t => (
          <button key={t.key} style={{...tabStyle(t.key), width:'100%', textAlign:'center'}} onClick={() => setActiveTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── ① 메타 생성 탭 ── */}
      {activeTab === 'meta' && (
        <>
          <div className={styles.section}>
            <div className={styles.sectionLabel}>훅 CUT 지정 (클릭으로 토글)</div>
            <div className={styles.hookRow}>
              {cuts.map((cut, i) => (
                <span key={i}
                  className={`${styles.cutTag} ${hookIndices.includes(i) ? styles.cutTagActive : ''}`}
                  onClick={() => toggleHook(i)}>
                  {cut.label || `CUT ${i+1}`}
                </span>
              ))}
            </div>
          </div>

          <div className={styles.section}>
            <div className={styles.sectionLabel}>컷별 음성 타이밍 설정</div>
            <div className={styles.audioTable}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    {['상태','CUT','음성 파일명','시작(초)','끝(초)','효과음만','자막'].map(h => (
                      <th key={h} className={styles.th}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {cuts.map((cut, i) => {
                    const st = getAudioStatus(i)
                    return (
                    <tr key={i}>
                      <td className={styles.td} style={{textAlign:'center',fontSize:'14px'}} title={st.label}>{st.dot}</td>
                      <td className={styles.td}>{cut.label || `CUT ${i+1}`}</td>
                      <td className={styles.td}>
                        <input type="text" placeholder="cut_01.mp3"
                          value={getAudio(i).audioFile}
                          onChange={e => setAudio(i, 'audioFile', e.target.value)}
                          style={{width:'160px',background:'#1c1c22',color:'#e8e6f0',border:'1px solid rgba(255,255,255,0.12)',borderRadius:'4px',padding:'3px 6px',fontSize:'11px'}} />
                      </td>
                      <td className={styles.td}>
                        <input type="number" step="0.1" min="0" placeholder="0"
                          value={getAudio(i).audioStart}
                          onChange={e => setAudio(i, 'audioStart', e.target.value)}
                          style={{width:'60px',background:'#1c1c22',color:'#e8e6f0',border:'1px solid rgba(255,255,255,0.12)',borderRadius:'4px',padding:'3px 6px',fontSize:'11px'}} />
                      </td>
                      <td className={styles.td}>
                        <input type="number" step="0.1" min="0" placeholder="영상끝"
                          value={getAudio(i).audioEnd}
                          onChange={e => setAudio(i, 'audioEnd', e.target.value)}
                          style={{width:'60px',background:'#1c1c22',color:'#e8e6f0',border:'1px solid rgba(255,255,255,0.12)',borderRadius:'4px',padding:'3px 6px',fontSize:'11px'}} />
                      </td>
                      <td className={styles.td} style={{textAlign:'center'}}>
                        <input type="checkbox" checked={getAudio(i).sfxOnly}
                          onChange={e => setAudio(i, 'sfxOnly', e.target.checked)} />
                      </td>
                      <td className={styles.td} style={{textAlign:'center'}}>
                        <input type="checkbox" checked={getAudio(i).hasSubtitle}
                          onChange={e => setAudio(i, 'hasSubtitle', e.target.checked)} />
                      </td>
                    </tr>
                  )})}

                </tbody>
              </table>
            </div>
          </div>

          <button className={styles.genBtn} onClick={generate} disabled={loading}>
            {loading ? '메타 생성 중...' : '편집 메타 자동 생성'}
          </button>

          {error && <div className={styles.error}>{error}</div>}

          {meta.length > 0 && (
            <>
              <div className={styles.statRow}>
                {[
                  { label:'총 길이', value: toTimecode(totalDur) },
                  { label:'CUT 수',  value: `${meta.length}개` },
                  { label:'훅 CUT',  value: `${meta.filter(m => m.type === '훅').length}개` },
                ].map(s => (
                  <div key={s.label} className={styles.statCard}>
                    <div className={styles.statLabel}>{s.label}</div>
                    <div className={styles.statValue}>{s.value}</div>
                  </div>
                ))}
              </div>

              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      {['CUT','구간','길이','타입','트랜지션','음성파일','시작','끝','메모'].map(h => (
                        <th key={h} className={styles.th}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {meta.map((m, i) => (
                      <tr key={i} className={m.type === '훅' ? styles.hookRow2 : ''}>
                        <td className={styles.td}>{m.label}</td>
                        <td className={`${styles.td} ${styles.mono}`}>{m.start} ~ {m.end}</td>
                        <td className={styles.td}>{m.duration}초</td>
                        <td className={styles.td}>
                          <span className={m.type === '훅' ? styles.badgeHook : styles.badge}>{m.type}</span>
                        </td>
                        <td className={`${styles.td} ${styles.muted}`}>{m.transition}</td>
                        <td className={`${styles.td} ${styles.muted}`}>{m.audioFile || '-'}</td>
                        <td className={`${styles.td} ${styles.muted}`}>{m.sfxOnly ? '효과음' : `+${m.audioStart}s`}</td>
                        <td className={`${styles.td} ${styles.muted}`}>{m.sfxOnly ? '-' : `${m.audioEnd}s`}</td>
                        <td className={`${styles.td} ${styles.muted}`}>{m.note}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {aiNote && (
                <div className={styles.aiNote}>
                  <div className={styles.aiNoteLabel}>AI 편집 주의사항</div>
                  <div className={styles.aiNoteText}>{aiNote}</div>
                </div>
              )}

              <div className={styles.exportRow}>
                <button className={styles.exportBtn} onClick={exportJSON}>JSON 내보내기</button>
                <button className={styles.exportBtn} onClick={exportCSV}>CSV 내보내기</button>
              </div>
            </>
          )}
        </>
      )}

      {/* ── ② SRT 생성 탭 ── */}
      {activeTab === 'srt' && (
        <div>
          {meta.length === 0 ? (
            <div style={{padding:'32px',textAlign:'center',color:'#5c5870',fontSize:'13px'}}>
              ① 메타 생성 탭에서 먼저 편집 메타를 생성해주세요
            </div>
          ) : (
            <>
              <div style={{background:'rgba(52,211,153,0.08)',border:'1px solid rgba(52,211,153,0.2)',borderRadius:'8px',padding:'14px',marginBottom:'16px',fontSize:'12px',color:'#6ee7b7'}}>
                💡 SRT 자막 파일을 생성합니다. 생성된 파일은 A Creative Cutter에서 사용하세요.
              </div>

              <div style={{marginBottom:'16px'}}>
                <div style={{fontSize:'12px',color:'#9490a8',marginBottom:'6px'}}>시작 시간 오프셋 (초)</div>
                <input type="number" step="0.1" value={srtOffset}
                  onChange={e => setSrtOffset(e.target.value)}
                  style={{width:'100px',background:'#1c1c22',color:'#e8e6f0',border:'1px solid rgba(255,255,255,0.12)',borderRadius:'4px',padding:'5px 8px',fontSize:'12px'}} />
              </div>

              <div style={{background:'#1c1c22',border:'1px solid rgba(255,255,255,0.07)',borderRadius:'8px',padding:'14px',marginBottom:'16px',fontFamily:'monospace',fontSize:'11px',color:'#9490a8',maxHeight:'300px',overflowY:'auto'}}>
                {meta.map((m, i) => {
                  const text = m.dialogue || m.narration || m.script
                  if (!text || m.sfxOnly) return null
                  const offset = parseFloat(srtOffset) || 0
                  return (
                    <div key={i} style={{marginBottom:'12px',paddingBottom:'12px',borderBottom:'1px solid rgba(255,255,255,0.05)'}}>
                      <div style={{color:'#c4b5fd',fontWeight:700}}>{i+1}</div>
                      <div style={{color:'#60a5fa'}}>{toSRTTime(m.startSec+offset)} --&gt; {toSRTTime(m.endSec+offset)}</div>
                      <div style={{color:'#e8e6f0'}}>{text}</div>
                    </div>
                  )
                })}
              </div>

              <button onClick={generateSRT}
                style={{background:'#34d399',color:'#fff',border:'none',borderRadius:'6px',padding:'10px 24px',fontSize:'13px',fontWeight:700,cursor:'pointer',width:'100%'}}>
                📝 SRT 자막 파일 다운로드
              </button>
            </>
          )}
        </div>
      )}

      {/* ── ③ 컷 분석 탭 ── */}
      {activeTab === 'analyze' && (
        <div>
          {meta.length === 0 ? (
            <div style={{padding:'32px',textAlign:'center',color:'#5c5870',fontSize:'13px'}}>
              ① 메타 생성 탭에서 먼저 편집 메타를 생성해주세요
            </div>
          ) : (
            <>
              <div style={{display:'flex',gap:'8px',flexWrap:'wrap',marginBottom:'16px'}}>
                {meta.map((m, i) => (
                  <button key={i} onClick={() => analyzeCut(i)}
                    style={{padding:'6px 12px',border:'1px solid',borderRadius:'6px',cursor:'pointer',fontSize:'12px',fontWeight:600,
                      borderColor: selectedCut===i ? '#a78bfa' : 'rgba(255,255,255,0.12)',
                      background: selectedCut===i ? 'rgba(167,139,250,0.15)' : '#1c1c22',
                      color: selectedCut===i ? '#a78bfa' : '#9490a8'}}>
                    {m.label}
                  </button>
                ))}
              </div>

              {analyzeResult && (
                <div style={{background:'#141418',border:'1px solid rgba(255,255,255,0.07)',borderRadius:'8px',padding:'16px'}}>
                  <div style={{fontSize:'14px',fontWeight:700,color:'#e8e6f0',marginBottom:'14px'}}>{analyzeResult.cutLabel} 분석</div>

                  {/* 영상 미리보기 */}
                  {analyzeResult.videoPath && (
                    <div style={{marginBottom:'16px',borderRadius:'8px',overflow:'hidden',background:'#000',border:'1px solid rgba(255,255,255,0.07)'}}>
                      <video
                        key={analyzeResult.videoPath}
                        controls
                        style={{width:'100%',maxHeight:'300px',display:'block'}}
                        src={analyzeResult.videoPath}
                      >
                        영상을 재생할 수 없습니다
                      </video>
                    </div>
                  )}
                  {!analyzeResult.videoPath && (
                    <div style={{marginBottom:'16px',padding:'20px',background:'rgba(255,255,255,0.03)',border:'1px dashed rgba(255,255,255,0.1)',borderRadius:'8px',textAlign:'center'}}>
                      <div style={{fontSize:'12px',color:'#5c5870',marginBottom:'8px'}}>영상 파일을 선택하면 미리보기가 표시됩니다</div>
                      <input
                        type="file"
                        accept="video/*"
                        id={`video-preview-${selectedCut}`}
                        style={{display:'none'}}
                        onChange={e => {
                          const file = e.target.files[0]
                          if (file) {
                            const url = URL.createObjectURL(file)
                            setAnalyzeResult(prev => ({ ...prev, videoPath: url }))
                          }
                        }}
                      />
                      <label htmlFor={`video-preview-${selectedCut}`}
                        style={{display:'inline-block',padding:'6px 16px',background:'rgba(167,139,250,0.15)',border:'1px solid rgba(167,139,250,0.3)',borderRadius:'6px',color:'#a78bfa',fontSize:'12px',cursor:'pointer',fontWeight:600}}>
                        🎬 영상 파일 선택
                      </label>
                    </div>
                  )}

                  <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:'8px',marginBottom:'14px'}}>
                    {[
                      { label:'영상 길이', value:`${analyzeResult.videoDur}s`, color:'#60a5fa' },
                      { label:'음성 길이', value:`${analyzeResult.audioDur}s`, color:'#a78bfa' },
                      { label:'차이', value:`${analyzeResult.diff > 0 ? '+' : ''}${analyzeResult.diff.toFixed(1)}s`,
                        color: Math.abs(analyzeResult.diff) > 2 ? '#f87171' : '#34d399' },
                    ].map(s => (
                      <div key={s.label} style={{background:'#1c1c22',borderRadius:'6px',padding:'10px',textAlign:'center'}}>
                        <div style={{fontSize:'18px',fontWeight:700,color:s.color,fontFamily:'monospace'}}>{s.value}</div>
                        <div style={{fontSize:'10px',color:'#5c5870',marginTop:'2px'}}>{s.label}</div>
                      </div>
                    ))}
                  </div>

                  <div style={{display:'flex',gap:'8px',marginBottom:'14px',flexWrap:'wrap'}}>
                    {[
                      { label:'대사', active: analyzeResult.hasDialogue },
                      { label:'나레이션', active: analyzeResult.hasNarration },
                      { label:'훅', active: analyzeResult.isHook },
                      { label:'립싱크 필요', active: analyzeResult.hasDialogue },
                    ].map(b => (
                      <span key={b.label} style={{fontSize:'11px',padding:'3px 10px',borderRadius:'20px',
                        background: b.active ? 'rgba(167,139,250,0.15)' : 'rgba(255,255,255,0.04)',
                        color: b.active ? '#a78bfa' : '#5c5870',
                        border: `1px solid ${b.active ? 'rgba(167,139,250,0.3)' : 'rgba(255,255,255,0.07)'}`}}>
                        {b.label}
                      </span>
                    ))}
                  </div>

                  {analyzeResult.issues.length > 0 ? (
                    <div>
                      <div style={{fontSize:'11px',color:'#9490a8',marginBottom:'8px',fontWeight:600}}>발견된 이슈</div>
                      {analyzeResult.issues.map((issue, i) => (
                        <div key={i} style={{display:'flex',alignItems:'flex-start',gap:'8px',padding:'8px 10px',borderRadius:'6px',marginBottom:'6px',
                          background: issue.type==='error' ? 'rgba(239,68,68,0.08)' : 'rgba(251,191,36,0.08)',
                          border: `1px solid ${issue.type==='error' ? 'rgba(239,68,68,0.25)' : 'rgba(251,191,36,0.25)'}`}}>
                          <span style={{fontSize:'12px'}}>{issue.type==='error' ? '🔴' : '🟡'}</span>
                          <span style={{fontSize:'11px',color: issue.type==='error' ? '#fca5a5' : '#fde68a'}}>{issue.msg}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div style={{padding:'10px',background:'rgba(52,211,153,0.08)',border:'1px solid rgba(52,211,153,0.2)',borderRadius:'6px',fontSize:'12px',color:'#6ee7b7'}}>
                      ✅ 이슈 없음 — 정상 범위입니다
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ── ④ 캡컷 가이드 탭 ── */}
      {activeTab === 'guide' && (
        <div>
          {meta.length === 0 ? (
            <div style={{padding:'32px',textAlign:'center',color:'#5c5870',fontSize:'13px'}}>
              ① 메타 생성 탭에서 먼저 편집 메타를 생성해주세요
            </div>
          ) : (
            <>
              <div style={{background:'rgba(251,191,36,0.08)',border:'1px solid rgba(251,191,36,0.2)',borderRadius:'8px',padding:'14px',marginBottom:'16px',fontSize:'12px',color:'#fde68a'}}>
                💡 캡컷 편집 시 참고할 가이드를 생성합니다. 립싱크 필요 컷, 음성 타이밍, 주의사항을 확인하세요.
              </div>

              <div style={{display:'flex',flexDirection:'column',gap:'8px',marginBottom:'16px'}}>
                {meta.map((m, i) => (
                  <div key={i} style={{background:'#1c1c22',border:'1px solid rgba(255,255,255,0.07)',borderRadius:'8px',padding:'12px'}}>
                    <div style={{display:'flex',alignItems:'center',gap:'8px',marginBottom:'8px'}}>
                      <span style={{fontSize:'12px',fontWeight:700,color:'#e8e6f0'}}>{m.label}</span>
                      <span style={{fontSize:'10px',padding:'2px 8px',borderRadius:'20px',
                        background: m.type==='훅' ? 'rgba(167,139,250,0.15)' : 'rgba(255,255,255,0.06)',
                        color: m.type==='훅' ? '#a78bfa' : '#5c5870',
                        border: `1px solid ${m.type==='훅' ? 'rgba(167,139,250,0.3)' : 'rgba(255,255,255,0.07)'}`}}>
                        {m.type}
                      </span>
                      {m.dialogue && (
                        <span style={{fontSize:'10px',padding:'2px 8px',borderRadius:'20px',background:'rgba(96,165,250,0.1)',color:'#60a5fa',border:'1px solid rgba(96,165,250,0.2)'}}>
                          립싱크 필요
                        </span>
                      )}
                    </div>
                    <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:'6px',fontSize:'11px',color:'#9490a8'}}>
                      <div>🎬 {m.start} ~ {m.end}</div>
                      <div>🎙 {m.audioFile || '음성 미지정'}</div>
                      <div>⏱ {m.duration}초</div>
                    </div>
                    {(m.dialogue || m.narration) && (
                      <div style={{marginTop:'8px',padding:'6px 10px',background:'rgba(255,255,255,0.03)',borderRadius:'4px',fontSize:'11px',color:'#6b7280',fontStyle:'italic'}}>
                        "{m.dialogue || m.narration}"
                      </div>
                    )}
                  </div>
                ))}
              </div>

              <button onClick={generateCapcutGuide}
                style={{background:'#fbbf24',color:'#000',border:'none',borderRadius:'6px',padding:'10px 24px',fontSize:'13px',fontWeight:700,cursor:'pointer',width:'100%'}}>
                📋 캡컷 가이드 TXT 다운로드
              </button>

              {/* G5 컷별 승인 */}
              <div style={{marginTop:'20px',borderTop:'1px solid rgba(255,255,255,0.07)',paddingTop:'16px'}}>
                <div style={{fontSize:'12.5px',fontWeight:700,color:'#e8e6f0',marginBottom:'10px'}}>G5 단계 — 편집 승인</div>
                <div style={{display:'flex',flexDirection:'column',gap:'6px',marginBottom:'14px'}}>
                  {meta.map((m, i) => {
                    const cutId = cuts[i]?.id || `cut-${i}`
                    return (
                      <div key={i} style={{display:'flex',alignItems:'center',gap:'8px',padding:'8px 12px',background:'#1c1c22',borderRadius:'6px',border:'1px solid rgba(255,255,255,0.06)'}}>
                        <span style={{fontSize:'12px',fontWeight:700,color:'#e8e6f0',minWidth:'60px'}}>{m.label}</span>
                        <span style={{flex:1,fontSize:'11px',color:'#9490a8',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{m.dialogue || m.narration || '(대사 없음)'}</span>
                        {g5Approved[cutId] ? (
                          <span style={{fontSize:'10.5px',fontWeight:700,color:'#4ade80',background:'rgba(34,197,94,0.12)',border:'1px solid rgba(34,197,94,0.3)',padding:'2px 8px',borderRadius:'4px',flexShrink:0}}>G5 ✓</span>
                        ) : (
                          <button
                            onClick={() => {
                              setG5Approved(p => ({ ...p, [cutId]: true }))
                              if (cuts[i]) setGPoint(cuts[i].no, 'g5', true)
                            }}
                            style={{fontSize:'11px',fontWeight:700,color:'#fb923c',background:'rgba(249,115,22,0.1)',border:'1px solid rgba(249,115,22,0.3)',borderRadius:'4px',padding:'2px 10px',cursor:'pointer',flexShrink:0}}>
                            G5 승인
                          </button>
                        )}
                      </div>
                    )
                  })}
                </div>
                <button
                  disabled={!meta.every((_, i) => g5Approved[cuts[i]?.id || `cut-${i}`])}
                  onClick={() => {
                    cuts.forEach(c => setGPoints(c.no, { g5: true }))
                    dispatch({ type: 'SET_TAB', p: 'dashboard' })
                  }}
                  style={{
                    width:'100%', padding:'11px', borderRadius:'8px', fontSize:'13px', fontWeight:700,
                    background: meta.every((_, i) => g5Approved[cuts[i]?.id || `cut-${i}`]) ? 'linear-gradient(135deg,#f97316,#fb923c)' : 'rgba(249,115,22,0.12)',
                    color: meta.every((_, i) => g5Approved[cuts[i]?.id || `cut-${i}`]) ? '#fff' : '#9490a8',
                    border: '1px solid rgba(249,115,22,0.3)', cursor: meta.every((_, i) => g5Approved[cuts[i]?.id || `cut-${i}`]) ? 'pointer' : 'default',
                    opacity: meta.every((_, i) => g5Approved[cuts[i]?.id || `cut-${i}`]) ? 1 : 0.5,
                  }}>
                  {meta.every((_, i) => g5Approved[cuts[i]?.id || `cut-${i}`]) ? '🎉 G5 전체 승인 → 업로드 탭' : `G5 전체 승인 (${Object.values(g5Approved).filter(Boolean).length}/${meta.length})`}
                </button>
              </div>
            </>
          )}
        </div>
      )}

    </div>
    </div>
  )
}
