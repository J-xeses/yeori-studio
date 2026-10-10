import { useState, useEffect } from 'react'
import { useApp } from '../context/AppContext'
import { loadGPoints } from '../lib/gpoints'
import { displayEpisodeCode, resolveEpisodeCode } from '../lib/episodeCode'
import s from './EpisodeInfoSidebar.module.css'

// 대본생성 탭(ScriptGenTab.jsx)의 코드 라벨과 동일 — 이 사이드바는 읽기 전용
// 개요 표시용이라 대본생성 탭의 편집 폼(설정)과는 별개로 최소 라벨만 둔다.
const CONTENT_TYPE_LABELS = {
  LF: 'LF — YouTube 롱폼', SF: 'SF — YouTube 숏폼',
  IG_R: 'IG_R — Instagram 릴스', IG_P: 'IG_P — Instagram 피드',
  IG_S: 'IG_S — Instagram 스토리', TK: 'TK — TikTok',
}
const TOPIC_LABELS = {
  PSY: 'PSY — 심리', SOC: 'SOC — 사회', LIF: 'LIF — 라이프스타일',
  REL: 'REL — 관계', TRD: 'TRD — 트렌드',
}
const SCN_LABELS = {
  DOC: 'DOC — 다큐', MYS: 'MYS — 미스터리', NEWS: 'NEWS — 뉴스',
  EDU: 'EDU — 교육', ENT: 'ENT — 엔터테인먼트',
}

// 사이드바 섹션 접기/펼치기 상태 — localStorage 에 기억(모든 탭 공통, 컷 목록 볼 공간 확보용).
function useSectionOpen(key, defaultOpen) {
  const storageKey = `yeori_sidebar_open_${key}`
  const [open, setOpen] = useState(() => {
    try { const v = localStorage.getItem(storageKey); return v === null ? defaultOpen : v === '1' } catch { return defaultOpen }
  })
  const toggle = () => setOpen(o => {
    const next = !o
    try { localStorage.setItem(storageKey, next ? '1' : '0') } catch { /* 프라이빗 모드 등 무시 */ }
    return next
  })
  return [open, toggle]
}

// 접기/펼치기 가능한 사이드바 섹션 — 제목 클릭으로 토글, 화살표로 상태 표시.
function CollapsibleSection({ titleKey, title, defaultOpen = true, children }) {
  const [open, toggle] = useSectionOpen(titleKey, defaultOpen)
  return (
    <div className={s.section}>
      <button type="button" className={s.titleBtn} onClick={toggle}>
        <span className={s.title}>{title}</span>
        <span className={s.chevron}>{open ? '▾' : '▸'}</span>
      </button>
      {open && children}
    </div>
  )
}

// 대본생성 탭에서만 수정 가능한 에피소드 개요/마스터코드/EP.HEADER를 다른 탭에서
// 참고용으로 표시하는 읽기 전용 블록. 이미 자체 컷 목록 사이드바가 있는 탭
// (TTS/내음성삽입/편집메타 등)은 이 블록만 그 사이드바 상단에 끼워 넣고,
// 자체 사이드바가 없는 탭(스튜디오/퍼블리싱/추출/영상/리텐션훅 등)은
// 아래 EpisodeInfoSidebar(컷 목록 포함 풀 사이드바)를 통째로 쓴다.
// 개요/마스터코드는 접어서 컷 목록 볼 공간을 늘릴 수 있음(2026-09-11, 사용자 요청).
// 비트 태그 → 색상(ScriptGenTab.jsx의 BEAT_CANON과 같은 7종). 시그는 별 마커까지 겸한다.
const BEAT_COLORS = { 훅: '#60a5fa', 긴장: '#fbbf24', 반전: '#f472b6', 안정: '#94a3b8', 고조: '#f97316', 결말: '#34d399', 시그: '#a78bfa' }

// 2026-10-10: 컷 길이 비율로 구간을 나눠 그리는 타임라인 바 — "유튜브 챕터구간·시그구간
// 표시" 기능의 1차 버전. 챕터 자체는 컷 경계를 그대로 쓴다(컷 = 장면 전환 단위라 대체로
// 챕터 경계와 일치). BEAT: 태그를 하나도 안 단 에피소드는 전부 회색으로만 보여 구분이
// 안 되므로, 그런 경우(anyTagged===false) 바 자체를 숨긴다 — 의미 없는 회색 막대를
// "표시바가 고장났다"로 오인하지 않게.
function BeatTimelineBar({ cuts }) {
  const list = Array.isArray(cuts) ? cuts : []
  const total = list.reduce((s, c) => s + (Number(c.duration) || 0), 0)
  const anyTagged = list.some((c) => c.beat)
  if (!total || !anyTagged) return null
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ display: 'flex', width: '100%', height: 14, borderRadius: 4, overflow: 'hidden', border: '1px solid var(--border)' }}>
        {list.map((c) => {
          const pct = ((Number(c.duration) || 0) / total) * 100
          const color = BEAT_COLORS[c.beat] || 'var(--surface2)'
          return (
            <div key={c.id || c.no} title={`CUT ${c.no}${c.beat ? ` · ${c.beat}` : ''} (${c.duration}s)`}
              style={{ width: `${pct}%`, background: color, position: 'relative', borderRight: '1px solid var(--bg)' }}>
              {c.beat === '시그' && (
                <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9 }}>✨</span>
              )}
            </div>
          )
        })}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4, fontSize: 10, color: 'var(--text-3)' }}>
        {Object.entries(BEAT_COLORS).map(([beat, color]) => (
          <span key={beat} style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: color, display: 'inline-block' }} />{beat}
          </span>
        ))}
      </div>
    </div>
  )
}

export function EpisodeOverviewBlock() {
  const { state } = useApp()
  const { episode, cuts } = state
  const code = displayEpisodeCode(episode)
  const moods = Array.isArray(episode?.mood) ? episode.mood : (episode?.mood ? [episode.mood] : [])

  return (
    <>
      <CollapsibleSection titleKey="overview" title="에피소드 개요" defaultOpen={true}>
        <div className={s.row}>
          <span className={s.label}>코드</span>
          <span className={s.codeBadge}>{code}</span>
        </div>
        <div className={s.row}>
          <span className={s.label}>제목</span>
          <span className={s.value}>{episode?.title || '(제목 없음)'}</span>
        </div>
        <div className={s.row}>
          <span className={s.label}>유형</span>
          <span className={s.value}>{CONTENT_TYPE_LABELS[episode?.contentType] || episode?.contentType || '-'}</span>
        </div>
        <div className={s.row}>
          <span className={s.label}>주제</span>
          <span className={s.value}>{TOPIC_LABELS[episode?.topicCode] || episode?.topicCode || '-'}</span>
        </div>
        <div className={s.row}>
          <span className={s.label}>시나리오</span>
          <span className={s.value}>{SCN_LABELS[episode?.scnCode] || episode?.scnCode || '-'}</span>
        </div>
        <div className={s.row}>
          <span className={s.label}>장소</span>
          <span className={s.value}>{episode?.location || '-'}</span>
        </div>
        {moods.length > 0 && (
          <div className={s.chips}>
            {moods.map(m => <span key={m} className={s.chip}>{m}</span>)}
          </div>
        )}
        <BeatTimelineBar cuts={cuts} />
      </CollapsibleSection>

      {episode?.masterCode && (
        <CollapsibleSection titleKey="masterCode" title="마스터 코드" defaultOpen={false}>
          {episode.masterCode.includes('::') ? (
            <div className={s.codeRows}>
              {episode.masterCode.split('::').map((seg, i) => (
                <div key={i} className={s.codeRow}>{seg.trim()}</div>
              ))}
            </div>
          ) : (
            <pre className={s.code}>{episode.masterCode}</pre>
          )}
          {/* episode.code(생성 시 확정한 정식 식별자)와 대본에서 파싱된 masterCode가
              다르면 경고만 표시 — 어느 쪽 값도 건드리지 않는다(둘 다 그대로 저장됨). */}
          {episode?.code && episode.masterCode !== episode.code && (
            <div style={{ fontSize: 11, color: '#f59e0b', marginTop: 4 }}>
              ⚠️ 에피소드 코드({episode.code})와 다릅니다
            </div>
          )}
        </CollapsibleSection>
      )}

      {episode?.epHeaderRaw && (
        <CollapsibleSection titleKey="epHeader" title="EP.HEADER" defaultOpen={false}>
          <pre className={s.code}>{episode.epHeaderRaw}</pre>
        </CollapsibleSection>
      )}
    </>
  )
}

// 컷 목록 (배지 + 미리보기) — 여러 탭이 공유하는 카드 골격.
// maxStage: 그 탭이 실제로 다루는 단계까지만 G배지를 보여줌(스튜디오=2, TTS/음성=3,
//   영상=4, 메이킹=5). 0이면 파이프라인 단계 배지를 아예 숨김(리텐션훅·퍼블리싱·추출·
//   대시보드 등 비-파이프라인 탭). "✅ 제작완료"(최종 컷 영상 존재) 배지도 영상·메이킹
//   단계(maxStage>=4)에서만 의미가 있으므로 그 아래 탭에선 함께 숨긴다.
// renderPreview: 기본 텍스트 미리보기 대신 커스텀 콘텐츠(예: 영상 탭의 썸네일)를 앞에 붙임 —
// 넘기면 카드가 세로 쌓기 대신 가로 배치(썸네일 | 정보 | 액션)로 바뀐다.
// previewText: 가운데 텍스트 줄을 대사/나레이션/씬 대신 탭 전용 문구(예: 영상 탭의 "영상 2개")로 교체.
// renderExtra: 카드 오른쪽 끝에 탭 전용 액션(예: 영상 탭의 "✨생성" 버튼)을 추가.
// doneStage: "제작완료" 배지가 볼 G키를 강제 고정(예: 메이킹 탭은 항상 'g4') — 안 넘기면
// 컷 타입별로 자동 판단(아래 MAKING_TYPES 로직). 메이킹 탭은 G5를 아예 다루지 않는 탭이라
// (2026-09-14, 사용자 확정: "메이킹 탭에서는 G5 배지도 있을 수가 없잖아") YEORI 컷이 같은
// 목록에 섞여 있어도 그 탭 안에서는 G5를 절대 들여다보지 않아야 한다 — 탭 스코프 문제라
// cutType만으론 못 가리고 호출부가 명시해야 함.
export function CutList({ cuts, gData, episodeCode, activeCutId, onCutClick, maxStage = 5, renderPreview, previewText, renderExtra, videoStatus, doneStage, thumbAspect }) {
  const stages = ['g1', 'g2', 'g3', 'g4', 'g5'].slice(0, maxStage)
  const isRow = !!(renderPreview || renderExtra)
  return (
    <div className={s.cutList}>
      {(cuts || []).map(c => {
        const g = gData?.[episodeCode]?.[`cut_${c.no}`] || {}
        const badges = stages.filter(key => g[key])
        // "제작완료" 기준(2026-09-14, 사용자 확정):
        // - doneStage가 명시되면 무조건 그 키만 봄(메이킹 탭="g4" 고정 — G5는 그 탭 스코프 밖).
        // - 안 넘기면(영상 탭 등) 컷 타입별로 자동 판단: 메이킹이 직접 만드는 유형
        //   (GRAPHIC/BROLL/CAPCUT)은 메이킹 탭 자체 리뷰 게이트인 G4가 완료 기준이고,
        //   영상탭이 만드는 유형(YEORI/PIP 등)은 "G4가 찍힌 후 G5를 거쳐야" 완료(사용자 명시
        //   순서) — G5 하나만 보면 G4 승인 없이 조립에 휩쓸려 들어간 컷도 완료로 잘못 보일 수
        //   있다(2026-09-14 실측: cut_2~21 전부 G4 없이 G5만 찍혀있던 사고 — 데이터도 정리했지만
        //   같은 사고가 또 나도 화면엔 안 뜨게 g4·g5 둘 다 확인).
        const MAKING_TYPES = ['GRAPHIC', 'BROLL', 'CAPCUT']
        const isMakingType = MAKING_TYPES.includes(c.cutType)
        const done = doneStage ? !!g[doneStage] : (isMakingType ? !!g.g4 : !!(g.g4 && g.g5))
        const anyProgress = doneStage ? !!g[doneStage] : (isMakingType ? !!g.g4 : !!(g.g4 || g.g5))
        const madeVideo = maxStage >= 4 && done
        const fileReadyOnly = maxStage >= 4 && !done && (!!videoStatus?.[c.no] || anyProgress)
        return (
          <div key={c.id}
            className={`${s.cutItem} ${isRow ? s.cutItemRow : ''} ${activeCutId === c.id ? s.cutItemActive : ''}`}
            style={thumbAspect ? { alignItems: 'stretch' } : undefined}
            onClick={() => onCutClick?.(c)}>
            {renderPreview && (
              // thumbAspect(예: '9 / 16')가 있으면 썸네일을 정보 텍스트 3줄(맨위~맨아래) 높이에 맞춰 세로 비율로 세운다
              <div className={s.cutThumb}
                style={thumbAspect ? { alignSelf: 'stretch', aspectRatio: thumbAspect, minHeight: 46, position: 'relative', overflow: 'hidden', borderRadius: 4 } : undefined}>
                {renderPreview(c)}
              </div>
            )}
            <div className={s.cutInfo}>
              <span className={s.cutNo}>CUT {c.no}</span>
              <span className={s.cutPreview}>{previewText ? previewText(c) : (c.dialogue || c.narration || c.scene || '(내용 없음)')}</span>
              {(badges.length > 0 || madeVideo || fileReadyOnly) && (
                <span className={s.cutBadges}>
                  {badges.map(key => <span key={key} className={`${s.gBadge} ${s[key]}`}>{key.toUpperCase()}</span>)}
                  {madeVideo && <span className={s.doneBadge}>✅ 제작완료</span>}
                  {fileReadyOnly && <span className={s.fileReadyBadge} title="파일은 생성됐지만 아직 편집메타(G5) 승인 전입니다">📦 파일 생성됨</span>}
                </span>
              )}
            </div>
            {renderExtra && <div onClick={e => e.stopPropagation()}>{renderExtra(c)}</div>}
          </div>
        )
      })}
    </div>
  )
}

// 자체 컷 목록 사이드바가 없는 탭에서 쓰는 풀 사이드바 (개요 블록 + 컷 목록)
export default function EpisodeInfoSidebar({ onCutClick, activeCutId, maxStage = 5, doneStage }) {
  const { state } = useApp()
  const { cuts, episode } = state
  // episode.code(3차 정식 필드) 우선, 레거시 에피소드는 과도기 방식(번호)으로 대체
  const episodeCode = resolveEpisodeCode(episode)
  const [gData, setGData] = useState(() => loadGPoints())
  // 컷별 cut_NN.mp4 제작완료 여부(파일 존재 기반) — MakingTab.jsx와 동일 출처
  // (/api/episode-video-status)를 이 공용 사이드바에서도 폴링해 어느 탭에서든
  // "✅ 제작완료" 뱃지가 보이게 한다.
  const [videoStatus, setVideoStatus] = useState({})

  useEffect(() => {
    const id = setInterval(() => setGData(loadGPoints()), 2000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    if (!episode?.number) return
    const load = () => {
      fetch(`http://localhost:3001/api/episode-video-status?epNum=${episode.number}`)
        .then(r => r.json())
        .then(data => setVideoStatus(data.videoByCut || {}))
        .catch(() => {})
    }
    load()
    const id = setInterval(load, 2000)
    return () => clearInterval(id)
  }, [episode?.number])

  return (
    <div className={s.sidebar}>
      <EpisodeOverviewBlock />

      <div className={s.cutSection}>
        <div className={s.title}>컷 목록 ({cuts?.length || 0})</div>
        <CutList
          cuts={cuts} gData={gData} episodeCode={episodeCode}
          activeCutId={activeCutId} onCutClick={onCutClick} maxStage={maxStage}
          videoStatus={videoStatus} doneStage={doneStage}
        />
      </div>
    </div>
  )
}
