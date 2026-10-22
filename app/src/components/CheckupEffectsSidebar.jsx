import { useState, useEffect } from 'react'
import { KEN_BURNS_EFFECTS } from '../lib/kenBurnsEffects'
import s from './CheckupEffectsSidebar.module.css'

const SERVER = 'http://localhost:3001'

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
export default function CheckupEffectsSidebar({ selectedCutNo, cutsByNo, onApplied, cuts, epNum, episodeCode, onOpenDiagnosis }) {
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

      <InstantFixSection epNum={epNum} episodeCode={episodeCode} fullCut={fullCut} onOpenDiagnosis={onOpenDiagnosis} />
    </div>
  )
}
