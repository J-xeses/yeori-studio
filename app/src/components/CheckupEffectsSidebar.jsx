import { useState, useEffect } from 'react'
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

// 체크업 탭 사이드바 "효과"(Tier4) — 2026-10-23 재배치: 켄번스·비주얼 효과 6종은
// "즉석으로 조치할 수 있는 기능"이 아니라 "효과"라, 메인화면 좌측 빈 영역(futureArea,
// CheckupMainEffectsPanel)으로 옮겼다(성준님 지적). 사이드바에는 선택한 컷을 바로 확인할
// 수 있는 썸네일과, 선택 즉시 결과가 나오는 "⚡ 즉석 조치" 3종만 남긴다.
export default function CheckupEffectsSidebar({ selectedCutNo, cutsByNo, cuts, epNum, episodeCode, ratio, onOpenDiagnosis }) {
  const cut = selectedCutNo != null ? cutsByNo?.[selectedCutNo] : null
  const fullCut = selectedCutNo != null ? cuts?.find(c => c.no === selectedCutNo) : null

  if (selectedCutNo == null || !cut) {
    return (
      <div className={s.wrap}>
        <div className={s.noSelection}>타임라인에서 클립을 선택하면 여기서 조치할 수 있습니다.</div>
      </div>
    )
  }

  return (
    <div className={s.wrap}>
      <div className={s.section}>
        <div className={s.sectionTitle}>CUT {selectedCutNo}</div>
        {/* 2026-10-23 — 썸네일이 항상 16:9로 고정돼 있어 9:16(릴스 등) 에피소드에서 실제 프레임과
            다르게 보였다(성준님: "화면비율에 따라 프레임 적용이 달라져야"). 메인 플레이어와 같은
            기준(contentRatio)으로 맞춘다. */}
        {cut.startFrame
          ? <div className={s.thumb} style={{ backgroundImage: `url(${cut.startFrame})`, aspectRatio: ratio === '9:16' ? '9/16' : '16/9' }} />
          : <div className={`${s.thumb} ${s.emptyThumb}`} style={{ aspectRatio: ratio === '9:16' ? '9/16' : '16/9' }}>미리보기 없음</div>}
      </div>

      <InstantFixSection epNum={epNum} episodeCode={episodeCode} fullCut={fullCut} onOpenDiagnosis={onOpenDiagnosis} />
    </div>
  )
}
