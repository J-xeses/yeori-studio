import s from './TabToolbar.module.css'

// 탭 전체 폭에 걸치는 공통 "생성도구 등록·사양·연동" 상단바.
// 좌측 = 생성도구 선택 버튼(선택), 우측 = 탭별 핵심 액션 버튼(선택).
// 아직 내용이 확정 안 된 탭은 tools/actions/right를 모두 생략하면
// 빈 틀(placeholder)만 렌더링된다 — PDF 기획안의 "상단바 구성만" 단계용.
export default function TabToolbar({ toolLabel, tools, activeTool, onToolChange, actions, right }) {
  const hasLeft = tools && tools.length > 0
  const hasRight = (actions && actions.length > 0) || !!right
  const isEmpty = !hasLeft && !hasRight

  return (
    <div className={s.toolbar}>
      <div className={s.toolLeft}>
        {hasLeft && (
          <>
            {toolLabel && <span className={s.toolLabel}>{toolLabel}</span>}
            {tools.map(t => (
              <button key={t}
                className={`${s.toolBtn} ${activeTool === t ? s.toolActive : ''}`}
                onClick={() => onToolChange?.(t)}>{t}</button>
            ))}
          </>
        )}
        {isEmpty && <span className={s.emptyHint}>🔧 생성도구 연동 예정</span>}
      </div>

      {hasRight && (
        <div className={s.toolRight}>
          {right}
          {actions?.map(a => (
            <button key={a.key ?? a.label}
              className={`${s.actionBtn} ${s[`variant_${a.variant || 'default'}`] || ''} ${a.done ? s.actionDone : ''}`}
              onClick={a.onClick}
              disabled={a.disabled}
              title={a.title}
            >{a.label}</button>
          ))}
        </div>
      )}
    </div>
  )
}
