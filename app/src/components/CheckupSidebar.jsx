import { useState } from 'react'
import { CutList } from './EpisodeInfoSidebar'
import CheckupEffectsSidebar from './CheckupEffectsSidebar'
import s from './CheckupSidebar.module.css'

// 로컬 아코디언 섹션 — EpisodeInfoSidebar.jsx의 CollapsibleSection과 같은 UX 패턴이지만
// 그 파일이 여러 탭에서 공유되는 컴포넌트라 안 건드리고 여기 작게 재구현(2026-09-13).
function Section({ title, defaultOpen = true, bodyClassName, children }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className={s.section}>
      <button type="button" className={s.titleBtn} onClick={() => setOpen(o => !o)}>
        <span className={s.title}>{title}</span>
        <span className={s.chevron}>{open ? '▾' : '▸'}</span>
      </button>
      {open && <div className={`${s.body} ${bodyClassName || ''}`}>{children}</div>}
    </div>
  )
}

// 체크업 탭 전용 통합 좌측 사이드바(Tier4, 2026-09-13) — "컷 목록"과 "효과"를 접이식
// 카테고리로 묶었다. 원래 있던 EpisodeInfoSidebar(다른 탭들과 공유하는 풀 사이드바)를
// 체크업 탭에서만 이걸로 교체 — 다른 탭은 전혀 영향 없음.
//
// cuts: state.cuts(AppContext, .id/.no/.dialogue 보유) — checklist API의 cuts와는 다른 배열이라
// "제작완료" 뱃지는 cutsByNo(checklist 파생, hasVideo)로 별도 합성해서 videoStatus로 넘긴다.
export default function CheckupSidebar({ cuts, cutsByNo, selectedCutNo, onSelectCut, onSeek, onApplied }) {
  const videoStatus = Object.fromEntries(Object.values(cutsByNo || {}).map(c => [c.no, c.hasVideo]))
  const selectedId = cuts?.find(c => c.no === selectedCutNo)?.id ?? null

  return (
    <div className={s.sidebar}>
      <Section title={`컷 목록 (${cuts?.length || 0})`} defaultOpen={true} bodyClassName={s.cutListBody}>
        <CutList
          cuts={cuts} gData={{}} episodeCode={null}
          activeCutId={selectedId} maxStage={0} videoStatus={videoStatus}
          onCutClick={(c) => { onSelectCut?.(c.no); onSeek?.(c.no, 0) }}
        />
      </Section>
      <Section title="효과" defaultOpen={true}>
        <CheckupEffectsSidebar selectedCutNo={selectedCutNo} cutsByNo={cutsByNo} onApplied={onApplied} />
      </Section>
    </div>
  )
}
