import { useState, useEffect } from 'react'
import { KEN_BURNS_EFFECTS } from '../lib/kenBurnsEffects'
import { COLOR_MASK_EFFECTS, OVERLAY_EFFECTS } from '../lib/checkupVisualEffects'
import s from './CheckupEffectsSidebar.module.css'

const SERVER = 'http://localhost:3001'

// 2026-10-23 — PDF 13페이지 "마스킹 및 색상 수정 / 오버레이 및 이펙트(모션블러·필터링·
// 스타일효과) / 프레임 동결(Freeze) / 역재생(Reverse)" 신규 구현. 켄번스와 달리 "의도"만
// 저장하는 게 아니라 선택 즉시 cut_NN.mp4를 재인코딩한다(/api/checkup-visual-effect) —
// 백업 1벌은 서버가 자동 보관하고, 기존 /api/checkup-trim-undo로 그대로 되돌릴 수 있다.
function VisualEffectsSection({ epNum, selectedCutNo, onApplied, onCutDurationChange }) {
  const [busy, setBusy] = useState(false)
  const [freezeSec, setFreezeSec] = useState(1.5)
  const [msg, setMsg] = useState('')

  useEffect(() => { setMsg('') }, [selectedCutNo])

  const run = async (body) => {
    setBusy(true); setMsg('')
    try {
      const r = await fetch(`${SERVER}/api/checkup-visual-effect`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ epNum, cutNo: selectedCutNo, ...body }),
      })
      const d = await r.json()
      if (!r.ok || !d.success) { setMsg(`❌ ${d.error || '적용 실패'}`); return }
      if (d.duration) onCutDurationChange?.(selectedCutNo, d.duration)
      onApplied?.(true)
      setMsg('✅ 적용 완료 — 백업 1벌 보관(아래 ↩로 바로 전 상태 복구 가능)')
    } catch (e) {
      setMsg(`❌ ${e.message}`)
    } finally {
      setBusy(false)
    }
  }

  const undo = async () => {
    setBusy(true); setMsg('')
    try {
      const r = await fetch(`${SERVER}/api/checkup-trim-undo`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ epNum, cutNo: selectedCutNo }),
      })
      const d = await r.json()
      if (!r.ok || !d.success) { setMsg(`❌ ${d.error || '되돌릴 백업이 없습니다'}`); return }
      if (d.duration) onCutDurationChange?.(selectedCutNo, d.duration)
      onApplied?.(true)
      setMsg('↩ 바로 전 상태로 되돌렸습니다')
    } catch (e) {
      setMsg(`❌ ${e.message}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={s.section}>
      <div className={s.sectionTitle}>🎞 비주얼 효과</div>
      <div className={s.hint}>이미 완성된 컷 파일을 즉시 재인코딩합니다(백업 1벌 보관).</div>

      <div className={s.hint2}>마스킹 및 색상 수정</div>
      <div className={s.kbGrid}>
        {COLOR_MASK_EFFECTS.map(e => (
          <button key={e.value} className={s.kbBtn} disabled={busy} onClick={() => run({ category: 'color', value: e.value })}>
            {e.label}
          </button>
        ))}
      </div>

      <div className={s.hint2}>오버레이 및 이펙트(모션블러·필터링·스타일효과)</div>
      <div className={s.kbGrid}>
        {OVERLAY_EFFECTS.map(e => (
          <button key={e.value} className={s.kbBtn} disabled={busy} onClick={() => run({ category: 'overlay', value: e.value })}>
            {e.label}
          </button>
        ))}
      </div>

      <div className={s.hint2}>프레임 동결(Freeze)</div>
      <div className={s.freezeRow}>
        <input type="number" min={0.5} max={5} step={0.5} className={s.freezeInput}
          value={freezeSec} onChange={(e) => setFreezeSec(e.target.value)} />
        <span className={s.hint}>초 멈춤</span>
        <button className={`${s.fixBtn} ${s.freezeBtn}`} disabled={busy} onClick={() => run({ category: 'freeze', freezeSec })}>❄ 적용</button>
      </div>

      <button className={s.fixBtn} disabled={busy} onClick={() => run({ category: 'reverse' })}>⏪ 역재생 적용</button>
      <button className={s.fixBtn} disabled={busy} onClick={undo}>↩ 마지막 효과 되돌리기</button>
      {msg && <div className={s.hint}>{msg}</div>}
    </div>
  )
}

// 2026-10-22 4차 보완 — "즉석 조치" 3종(목소리 보정 / 반려 / AI 검토코멘트). PDF 13페이지:
// "(1차 편집 후, 즉석 수정, 조치가능) 목소리 보정 · 편집 미완성·오류체크(반려기능) · 컷별
// AI 검토코멘트". 전부 기존 기능 재사용 — 목소리 보정은 genline STS, 반려는 메이킹 탭과
// 같은 /api/episode-making-review, AI 검토코멘트는 VideoTab의 DiagnosisPanel.
function InstantFixSection({ epNum, episodeCode, fullCut, onOpenDiagnosis }) {
  const [voiceBusy, setVoiceBusy] = useState(false)
  const [voiceMsg, setVoiceMsg] = useState('')
  const [review, setReview] = useState(null)
  const [reviewBusy, setReviewBusy] = useState(false)

  useEffect(() => {
    setVoiceMsg('')
    if (epNum == null || !fullCut) { setReview(null); return }
    fetch(`${SERVER}/api/episode-making-review?epNum=${epNum}`).then(r => r.json())
      .then(d => setReview((d.review || {})[String(fullCut.no)] || null)).catch(() => {})
  }, [epNum, fullCut?.no])

  if (!fullCut) return null

  const runVoiceFix = async () => {
    setVoiceBusy(true); setVoiceMsg('')
    try {
      const r = await fetch(`${SERVER}/api/checkup-voice-fix`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ epNum, cutNo: fullCut.no }),
      })
      const d = await r.json()
      if (!r.ok || !d.ok) { setVoiceMsg(`❌ ${d.error || '실패'}`); setVoiceBusy(false); return }
      setVoiceMsg(`⏳ 처리 중… (${d.voice?.charName || '기본'} 목소리)`)
      const poll = async () => {
        try {
          const jr = await fetch(`${SERVER}/api/genline/job/${d.jobId}`)
          const jd = await jr.json()
          if (!jd.done) { setTimeout(poll, 1500); return }
          const result = jd.results?.[0]
          setVoiceMsg(result?.status === 'ok' ? '✅ 목소리 보정 완료' : `❌ ${result?.error || '실패'}`)
          setVoiceBusy(false)
        } catch { setVoiceMsg('❌ 진행 확인 실패'); setVoiceBusy(false) }
      }
      poll()
    } catch (e) {
      setVoiceMsg(`❌ ${e.message}`); setVoiceBusy(false)
    }
  }

  const toggleReject = async () => {
    const nextStatus = review?.status === 'rejected' ? 'pending' : 'rejected'
    setReviewBusy(true)
    try {
      await fetch(`${SERVER}/api/episode-making-review`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ epNum, cutNo: fullCut.no, status: nextStatus }),
      })
      setReview(p => ({ ...(p || {}), status: nextStatus }))
    } finally { setReviewBusy(false) }
  }

  return (
    <div className={s.section}>
      <div className={s.sectionTitle}>⚡ 즉석 조치</div>
      <button className={s.fixBtn} disabled={voiceBusy} onClick={runVoiceFix}>
        {voiceBusy ? '⏳ 처리 중…' : '🎙 목소리 보정'}
      </button>
      {voiceMsg && <div className={s.hint}>{voiceMsg}</div>}
      <button className={s.fixBtn} disabled={reviewBusy}
        style={review?.status === 'rejected' ? { borderColor: '#f59e0b', color: '#f59e0b' } : undefined}
        onClick={toggleReject}>
        {review?.status === 'rejected' ? '🚩 반려됨 — 해제하기' : '🚩 반려 — 재작업 필요'}
      </button>
      <button className={s.fixBtn} onClick={() => onOpenDiagnosis?.(fullCut.id)}>
        🔍 AI 검토코멘트
      </button>
      {/* 컷별 코멘트만 재사용 — 전체 흐름별 코멘트는 별도 범위(미포함) */}
    </div>
  )
}

// 체크업 탭 효과 사이드바(Tier3, 기본판) — 메이킹 탭에서 이미 실제로 쓸 수 있는 효과(켄번스)만
// 노출한다. 배경/그린스크린/인트로&엔드 같은 실제 에셋 없는 카테고리는 이번 스코프에서 아예 뺐다
// (2026-09-13, 사용자 확정: "문제없이 불러오기가 가능한 기능만 우선 반영").
export default function CheckupEffectsSidebar({ selectedCutNo, cutsByNo, onApplied, cuts, epNum, episodeCode, onOpenDiagnosis, onCutDurationChange }) {
  const [applying, setApplying] = useState(false)
  const cut = selectedCutNo != null ? cutsByNo?.[selectedCutNo] : null
  const fullCut = selectedCutNo != null ? cuts?.find(c => c.no === selectedCutNo) : null

  useEffect(() => { setApplying(false) }, [selectedCutNo])

  if (selectedCutNo == null || !cut) {
    return (
      <div className={s.wrap}>
        <div className={s.noSelection}>타임라인에서 클립을 선택하면 여기서 효과를 적용할 수 있습니다.</div>
      </div>
    )
  }

  const applyKenburns = async (value) => {
    setApplying(true)
    try {
      const r = await fetch(`${SERVER}/api/checkup-effect`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cutNo: selectedCutNo, kenburns: value }),
      })
      const d = await r.json()
      if (d.ok) onApplied?.(selectedCutNo, d.editIntent)
    } catch {
      // 조용히 무시 — 체크업 탭은 참고용
    } finally {
      setApplying(false)
    }
  }

  return (
    <div className={s.wrap}>
      <div className={s.section}>
        <div className={s.sectionTitle}>CUT {selectedCutNo}</div>
        {cut.startFrame
          ? <div className={s.thumb} style={{ backgroundImage: `url(${cut.startFrame})` }} />
          : <div className={`${s.thumb} ${s.emptyThumb}`}>미리보기 없음</div>}
      </div>

      {cut.motionBaked ? (
        <div className={s.bakedNote}>
          이미 모션이 구워진 컷입니다({cut.cutType}) — 여기서 켄번스를 바꿀 수 없습니다.
          다른 모션이 필요하면 메이킹 탭에서 재제작하세요.
        </div>
      ) : (
        <div className={s.section}>
          <div className={s.sectionTitle}>켄번스 (CapCut 배치 시 적용)</div>
          <div className={s.hint}>run-cutter.js가 다음 실행부터 그대로 반영합니다.</div>
          <div className={s.kbGrid}>
            {KEN_BURNS_EFFECTS.map(e => (
              <button key={e.value} className={`${s.kbBtn} ${cut.editIntent?.kenburns === e.value ? s.active : ''}`}
                disabled={applying} onClick={() => applyKenburns(e.value)}>
                {e.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <VisualEffectsSection epNum={epNum} selectedCutNo={selectedCutNo} onApplied={onApplied} onCutDurationChange={onCutDurationChange} />

      <InstantFixSection epNum={epNum} episodeCode={episodeCode} fullCut={fullCut} onOpenDiagnosis={onOpenDiagnosis} />
    </div>
  )
}
