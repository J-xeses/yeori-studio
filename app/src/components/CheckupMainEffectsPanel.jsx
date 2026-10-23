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

// 체크업 탭 메인화면 좌측 "효과" 패널(2026-10-23 재배치) — 성준님 지적: "사이드바에는
// 즉석으로 조치할 수 있는 기능이 배치되고, 나머지 효과는 메인화면 좌측 빈 영역에 넣어야
// 한다". 켄번스와 비주얼 효과 6종은 "즉석 조치"(목소리보정/반려/AI코멘트)가 아니라
// "효과"라, 원래 사이드바(CheckupEffectsSidebar) 안에 있던 걸 여기로 옮겼다 — 마침 이
// 영역이 애초부터 "추후 반영 — 효과 라이브러리" 플레이스홀더였던 자리라 용도가 그대로 맞음.
export default function CheckupMainEffectsPanel({ selectedCutNo, cut, epNum, onApplied, onCutDurationChange }) {
  const [applying, setApplying] = useState(false)

  useEffect(() => { setApplying(false) }, [selectedCutNo])

  if (selectedCutNo == null || !cut) {
    return (
      <div className={s.wrap}>
        <div className={s.noSelection}>추후 반영 — 효과 라이브러리 / 미디어 임포트<br />타임라인에서 클립을 선택하면 여기서 효과를 적용할 수 있습니다.</div>
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
        <div className={s.sectionTitle}>CUT {selectedCutNo} 효과</div>
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
    </div>
  )
}
