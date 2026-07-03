// src/tabs/EditMetaTab.jsx
import { useState, useEffect } from 'react'
import { useApp } from '../context/AppContext'
import { claudeMessages } from '../lib/api'
import { setGPoint, setGPoints, loadGPoints, getGPointSummary } from '../lib/gpoints'
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
  const [cutterResult, setCutterResult] = useState(null)
  const [g5Approved, setG5Approved] = useState({})

  // 음성 타이밍 상태
  const [audioSettings, setAudioSettings] = useState({})

  // G4 대기 접수 큐
  const [gpointData, setGpointData] = useState(() => loadGPoints())
  const [g4Queue, setG4Queue] = useState(() => {
    try { return JSON.parse(localStorage.getItem('acc_queue_v1') || '[]') } catch { return [] }
  })

  useEffect(() => {
    const handler = () => setGpointData(loadGPoints())
    window.addEventListener('gpoints_updated', handler)
    return () => window.removeEventListener('gpoints_updated', handler)
  }, [])

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
    setCutterResult(null)

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

      // ⑤ CapCut 스펙 생성
      setAccStatus('⑤ CapCut 스펙 생성 중...')
      const specRes = await post('http://localhost:3001/api/generate-capcut-spec', { epNum })
      if (!specRes.success) {
        setAccStatus(`❌ CapCut 스펙 생성 실패: ${specRes.error}`)
        setAccRunning(false); return
      }

      // ⑥⑦ 커터(켄번스) 실행 + CapCut 재시작
      setAccStatus('⑥ 커터 실행 중 (켄번스 적용) + CapCut 실행...')
      const cutterRes = await post('http://localhost:3001/api/send-to-cutter', { epNum })
      if (!cutterRes.success) {
        setAccStatus(`⚠️ 커터 연동 실패 (수동 편집 필요): ${cutterRes.error}`)
        setAccRunning(false); return
      }

      // 완료 — run-cutter.js가 실제로 몇 개 컷을 어느 프로젝트에 썼는지 구체적으로 표시
      // (문구만 바뀌고 사라지면 "진짜 됐는지" 확인할 방법이 없다는 피드백 반영 —
      //  자동으로 사라지지 않고, 클릭해서 확인했다는 걸 알 수 있게 유지)
      const r = cutterRes.cutterResult
      setAccStatus(r
        ? `✅ 완료! CapCut 프로젝트 "${r.projectName}"에 컷 ${r.segCount}개(총 ${r.durationSec}초) 배치 + 켄번스 적용 완료. CapCut에서 "${r.projectName}"을 열어 확인하세요.`
        : '✅ 완료! 커터 실행 + CapCut 실행됨. BGM/색보정/내보내기는 CapCut에서 직접 마무리하세요.')
      setCutterResult(r)
      // G5(편집/커터) 승인 — 커터가 실제로 draft_content.json에 반영한 컷들만 자동 승인
      if (r?.cuts?.length) {
        for (const c of r.cuts) setGPoint(c.cutNo, 'g5', true)
      }
      setAccRunning(false)
    } catch (err) {
      setAccStatus(`❌ 오류: ${err.message}`)
      setAccRunning(false)
    }
  }

  // G4 대기 → 실행 큐 계산
  const g4Pending = cuts
    .filter((cut, i) => {
      const no = cut.no || i + 1
      const gData = gpointData[`cut_${no}`] || {}
      return gData.g4 && !g4Queue.some(q => q.cutNo === no)
    })
    .map((cut, i) => ({
      cutNo: cut.no || i + 1,
      label: cut.label || `CUT ${String((cut.no || i + 1)).padStart(2, '0')}`,
      preview: (cut.dialogue || cut.narration || '(대사 없음)').slice(0, 45),
    }))

  const acceptCut = (item) => {
    const next = [...g4Queue, { ...item, acceptedAt: new Date().toISOString(), status: 'waiting' }]
    setG4Queue(next)
    localStorage.setItem('acc_queue_v1', JSON.stringify(next))
  }

  const removeFromQueue = (cutNo) => {
    const next = g4Queue.filter(q => q.cutNo !== cutNo)
    setG4Queue(next)
    localStorage.setItem('acc_queue_v1', JSON.stringify(next))
  }

  const hasEpisode  = !!state.episode?.number
  const hasApiKey   = !!(state.apiKeys?.claude || state.apiKey)
  const autoRunReady = g4Queue.length > 0 && hasEpisode && hasApiKey

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
    <div className={styles.layout}>

    {/* ── 왼쪽: G4 대기 접수 패널 ── */}
    <div className={styles.sidePanel}>
      <div className={styles.sidePanelInner}>
        <div className={styles.sideTitle}>편집 대기 접수</div>
        <div className={styles.sideDesc}>G4 승인된 컷이 자동으로 접수대기에 올라옵니다. 접수 후 자동실행 큐에서 관리하세요.</div>

        {/* 접수대기 */}
        <div className={styles.sideSectionLabel}>
          접수대기 <span>{g4Pending.length}</span>
        </div>
        {g4Pending.length === 0
          ? <div className={styles.emptyNote}>G4 승인된 컷이 없습니다</div>
          : g4Pending.map(item => (
            <div key={item.cutNo} className={styles.pendingCard}>
              <div className={styles.cardLabel}>🔵 {item.label}</div>
              <div className={styles.cardPreview}>{item.preview}</div>
              <button className={styles.acceptBtn} onClick={() => acceptCut(item)}>
                접수 ↓ 실행 큐로
              </button>
            </div>
          ))
        }

        {/* 실행 큐 */}
        <div className={styles.sideSectionLabel} style={{marginTop:'18px'}}>
          실행 큐 <span>{g4Queue.length}</span>
        </div>
        {g4Queue.length === 0
          ? <div className={styles.emptyNote}>접수된 컷이 없습니다</div>
          : g4Queue.map(item => (
            <div key={item.cutNo} className={styles.queueCard}>
              <div className={styles.cardLabel}>🟠 {item.label}</div>
              <div className={styles.cardPreview}>{item.preview}</div>
              <button className={styles.removeBtn} onClick={() => removeFromQueue(item.cutNo)}>
                × 큐에서 제거
              </button>
            </div>
          ))
        }
      </div>

      {/* 자동실행 조건 */}
      <div className={styles.autoRunPanel}>
        <div className={styles.autoRunTitle}>자동실행 조건</div>
        <div className={`${styles.conditionRow} ${g4Queue.length > 0 ? styles.ok : styles.bad}`}>
          {g4Queue.length > 0 ? '✅' : '○'} 실행 큐에 컷 있음 ({g4Queue.length}개)
        </div>
        <div className={`${styles.conditionRow} ${hasEpisode ? styles.ok : styles.bad}`}>
          {hasEpisode ? '✅' : '○'} 에피소드 번호 설정
        </div>
        <div className={`${styles.conditionRow} ${hasApiKey ? styles.ok : styles.bad}`}>
          {hasApiKey ? '✅' : '○'} Claude API 키 있음
        </div>
        <button
          className={`${styles.autoRunBtn} ${autoRunReady ? styles.ready : styles.notReady}`}
          disabled={!autoRunReady || accRunning}
          onClick={runACC}
        >
          {accRunning ? '⏳ 실행 중...' : autoRunReady ? '▶ 자동실행 ON' : '조건 미충족'}
        </button>
        {accStatus && (
          <div style={{marginTop:'8px',fontSize:'11px',fontWeight:600,lineHeight:1.5,
            color: accStatus.startsWith('❌') ? '#f87171'
                 : accStatus.startsWith('✅') ? '#4ade80' : '#fb923c'}}>
            {accStatus}
          </div>
        )}
      </div>
    </div>

    {/* ── 오른쪽: 메인 콘텐츠 ── */}
    <div className={styles.mainCol}>
      <div className={styles.header}>
        <h2 className={styles.title}>편집 메타</h2>
        <p className={styles.desc}>타임코드 · SRT 자막 · 컷 분석 · 캡컷 가이드</p>
      </div>

      {/* A Creative Cutter ON 버튼 */}
      <div style={{marginBottom:'16px',padding:'14px 16px',background:'rgba(249,115,22,0.08)',border:'1px solid rgba(249,115,22,0.3)',borderRadius:'10px'}}>
        <div style={{display:'flex',alignItems:'center',gap:'12px'}}>
          <div style={{flex:1}}>
            <div style={{display:'flex',alignItems:'center',gap:'8px'}}>
              <div style={{fontSize:'13px',fontWeight:700,color:'#fb923c'}}>A Creative Cutter + CapCut 연동</div>
              <span style={{fontSize:'10.5px',fontWeight:700,color:'#4ade80',background:'rgba(74,222,128,0.12)',border:'1px solid rgba(74,222,128,0.3)',borderRadius:'20px',padding:'2px 9px'}}>
                G5 완료: {getGPointSummary(cuts.length).g5} / {cuts.length}
              </span>
            </div>
            <div style={{fontSize:'11.5px',color:'#9490a8',marginTop:'2px'}}>① 메타 생성 → ② 저장 → ③ SRT → ④ 영상 합치기 → ⑤ 스펙 생성 → ⑥ 커터(켄번스) → ⑦ CapCut 실행</div>
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
        {cutterResult && (
          <div style={{marginTop:'12px',background:'rgba(0,0,0,0.2)',border:'1px solid rgba(74,222,128,0.25)',borderRadius:'8px',padding:'12px'}}>
            <div style={{display:'flex',gap:'10px',marginBottom:'10px',flexWrap:'wrap'}}>
              <div style={{flex:1,minWidth:'90px',background:'rgba(255,255,255,0.04)',borderRadius:'6px',padding:'8px 12px'}}>
                <div style={{fontSize:'18px',fontWeight:700,color:'#4ade80'}}>{cutterResult.segCount}</div>
                <div style={{fontSize:'10px',color:'#9490a8'}}>배치된 컷</div>
              </div>
              <div style={{flex:1,minWidth:'90px',background:'rgba(255,255,255,0.04)',borderRadius:'6px',padding:'8px 12px'}}>
                <div style={{fontSize:'18px',fontWeight:700,color:'#4ade80'}}>{cutterResult.durationSec}초</div>
                <div style={{fontSize:'10px',color:'#9490a8'}}>총 재생 시간</div>
              </div>
              <div style={{flex:1,minWidth:'90px',background:'rgba(255,255,255,0.04)',borderRadius:'6px',padding:'8px 12px'}}>
                <div style={{fontSize:'18px',fontWeight:700,color:'#4ade80'}}>{cutterResult.projectName}</div>
                <div style={{fontSize:'10px',color:'#9490a8'}}>CapCut 프로젝트</div>
              </div>
            </div>
            {Array.isArray(cutterResult.cuts) && cutterResult.cuts.length > 0 && (
              <table style={{width:'100%',fontSize:'11px',borderCollapse:'collapse'}}>
                <thead>
                  <tr style={{color:'#9490a8',textAlign:'left'}}>
                    <th style={{padding:'4px 8px'}}>컷</th>
                    <th style={{padding:'4px 8px'}}>구간</th>
                    <th style={{padding:'4px 8px'}}>길이</th>
                    <th style={{padding:'4px 8px'}}>파일</th>
                    <th style={{padding:'4px 8px'}}>켄번스</th>
                    <th style={{padding:'4px 8px'}}>G5</th>
                  </tr>
                </thead>
                <tbody>
                  {cutterResult.cuts.map(c => (
                    <tr key={c.cutNo} style={{borderTop:'1px solid rgba(255,255,255,0.06)'}}>
                      <td style={{padding:'4px 8px',color:'#e8e6f0'}}>{c.label}</td>
                      <td style={{padding:'4px 8px',color:'#e8e6f0'}}>{c.startSec}s ~ {c.endSec}s</td>
                      <td style={{padding:'4px 8px',color:'#e8e6f0'}}>{c.durationSec}초</td>
                      <td style={{padding:'4px 8px',color:'#9490a8'}}>{c.file}</td>
                      <td style={{padding:'4px 8px',color:'#fb923c'}}>{c.kenburns}</td>
                      <td style={{padding:'4px 8px',color:'#4ade80',fontWeight:700}}>✓</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>

      {/* 탭 네비게이션 */}
      <div style={{display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:'6px', marginBottom:'20px'}}>
        {[
          { key:'meta',    label:'메타 생성' },
          { key:'srt',     label:'SRT 생성' },
          { key:'analyze', label:'컷 분석' },
          { key:'guide',   label:'캡컷 가이드' },
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
              메타 생성 탭에서 먼저 편집 메타를 생성해주세요
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
              메타 생성 탭에서 먼저 편집 메타를 생성해주세요
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
              메타 생성 탭에서 먼저 편집 메타를 생성해주세요
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
    </div>
  )
}
