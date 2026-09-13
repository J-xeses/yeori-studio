import s from './AspectGuideOverlay.module.css'

// 16:9로 디자인된 화면 위에 9:16 세로 크롭 가이드를 오버레이 — 실제 크롭/내보내기는 하지 않고
// "9:16으로 생성할 때 이 영역이 쓰인다"는 참고용 표시만 한다(2026-09-13, 사용자 목업 요청).
// pointer-events:none이라 플레이어 컨트롤/스크럽을 절대 가리지 않는다.
export default function AspectGuideOverlay() {
  return (
    <div className={s.guide}>
      <span className={s.label}>9:16 비율 가이드</span>
    </div>
  )
}
