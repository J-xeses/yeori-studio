import { useState, useEffect } from 'react'
import { KEN_BURNS_EFFECTS } from '../lib/kenBurnsEffects'
import s from './CheckupEffectsSidebar.module.css'

const SERVER = 'http://localhost:3001'

// 체크업 탭 효과 사이드바(Tier3, 기본판) — 메이킹 탭에서 이미 실제로 쓸 수 있는 효과(켄번스)만
// 노출한다. 배경/그린스크린/인트로&엔드 같은 실제 에셋 없는 카테고리는 이번 스코프에서 아예 뺐다
// (2026-09-13, 사용자 확정: "문제없이 불러오기가 가능한 기능만 우선 반영").
export default function CheckupEffectsSidebar({ selectedCutNo, cutsByNo, onApplied }) {
  const [applying, setApplying] = useState(false)
  const cut = selectedCutNo != null ? cutsByNo?.[selectedCutNo] : null

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
    </div>
  )
}
