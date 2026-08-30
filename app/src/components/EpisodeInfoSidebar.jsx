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

// 대본생성 탭에서만 수정 가능한 에피소드 개요/마스터코드/EP.HEADER를 다른 탭에서
// 참고용으로 표시하는 읽기 전용 블록. 이미 자체 컷 목록 사이드바가 있는 탭
// (TTS/내음성삽입/편집메타 등)은 이 블록만 그 사이드바 상단에 끼워 넣고,
// 자체 사이드바가 없는 탭(스튜디오/퍼블리싱/추출/영상/리텐션훅 등)은
// 아래 EpisodeInfoSidebar(컷 목록 포함 풀 사이드바)를 통째로 쓴다.
export function EpisodeOverviewBlock() {
  const { state } = useApp()
  const { episode } = state
  const code = displayEpisodeCode(episode)
  const moods = Array.isArray(episode?.mood) ? episode.mood : (episode?.mood ? [episode.mood] : [])

  return (
    <>
      <div className={s.section}>
        <div className={s.title}>에피소드 개요</div>
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
      </div>

      {episode?.masterCode && (
        <div className={s.section}>
          <div className={s.title}>마스터 코드</div>
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
        </div>
      )}

      {episode?.epHeaderRaw && (
        <div className={s.section}>
          <div className={s.title}>EP.HEADER</div>
          <pre className={s.code}>{episode.epHeaderRaw}</pre>
        </div>
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
export function CutList({ cuts, gData, episodeCode, activeCutId, onCutClick, maxStage = 5, renderPreview, previewText, renderExtra, videoStatus }) {
  const stages = ['g1', 'g2', 'g3', 'g4', 'g5'].slice(0, maxStage)
  const isRow = !!(renderPreview || renderExtra)
  return (
    <div className={s.cutList}>
      {(cuts || []).map(c => {
        const g = gData?.[episodeCode]?.[`cut_${c.no}`] || {}
        const badges = stages.filter(key => g[key])
        const madeVideo = maxStage >= 4 && !!videoStatus?.[c.no]
        return (
          <div key={c.id}
            className={`${s.cutItem} ${isRow ? s.cutItemRow : ''} ${activeCutId === c.id ? s.cutItemActive : ''}`}
            onClick={() => onCutClick?.(c)}>
            {renderPreview && <div className={s.cutThumb}>{renderPreview(c)}</div>}
            <div className={s.cutInfo}>
              <span className={s.cutNo}>CUT {c.no}</span>
              <span className={s.cutPreview}>{previewText ? previewText(c) : (c.dialogue || c.narration || c.scene || '(내용 없음)')}</span>
              {(badges.length > 0 || madeVideo) && (
                <span className={s.cutBadges}>
                  {badges.map(key => <span key={key} className={`${s.gBadge} ${s[key]}`}>{key.toUpperCase()}</span>)}
                  {madeVideo && <span className={s.doneBadge}>✅ 제작완료</span>}
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
export default function EpisodeInfoSidebar({ onCutClick, activeCutId, maxStage = 5 }) {
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
          videoStatus={videoStatus}
        />
      </div>
    </div>
  )
}
