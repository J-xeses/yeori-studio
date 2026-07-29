import { useState, useEffect } from 'react'
import { useApp } from '../context/AppContext'
import { loadGPoints } from '../lib/gpoints'
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

function getEpisodeCode(contentType, number) {
  const n = String(number ?? 1).padStart(2, '0')
  if (['IG_R', 'IG_P', 'IG_S'].includes(contentType)) return `${contentType}${n}`
  return `${contentType || 'LF'}_E${n}`
}

// 대본생성 탭에서만 수정 가능한 에피소드 개요/마스터코드/EP.HEADER를 다른 탭에서
// 참고용으로 표시하는 읽기 전용 블록. 이미 자체 컷 목록 사이드바가 있는 탭
// (TTS/내음성삽입/편집메타 등)은 이 블록만 그 사이드바 상단에 끼워 넣고,
// 자체 사이드바가 없는 탭(스튜디오/퍼블리싱/추출/영상/리텐션훅 등)은
// 아래 EpisodeInfoSidebar(컷 목록 포함 풀 사이드바)를 통째로 쓴다.
export function EpisodeOverviewBlock() {
  const { state } = useApp()
  const { episode } = state
  const code = getEpisodeCode(episode?.contentType, episode?.number)
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
          <pre className={s.code}>{episode.masterCode}</pre>
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

// 자체 컷 목록 사이드바가 없는 탭에서 쓰는 풀 사이드바 (개요 블록 + 컷 목록)
export default function EpisodeInfoSidebar({ onCutClick, activeCutId }) {
  const { state } = useApp()
  const { cuts } = state
  const [gData, setGData] = useState(() => loadGPoints())

  useEffect(() => {
    const id = setInterval(() => setGData(loadGPoints()), 2000)
    return () => clearInterval(id)
  }, [])

  return (
    <div className={s.sidebar}>
      <EpisodeOverviewBlock />

      <div className={s.cutSection}>
        <div className={s.title}>컷 목록 ({cuts?.length || 0})</div>
        <div className={s.cutList}>
          {(cuts || []).map(c => {
            const g = gData[`cut_${c.no}`] || {}
            return (
              <button key={c.id}
                className={`${s.cutItem} ${activeCutId === c.id ? s.cutItemActive : ''}`}
                onClick={() => onCutClick?.(c)}>
                <span className={s.cutNo}>CUT {c.no}</span>
                <span className={s.cutPreview}>{c.dialogue || c.narration || c.scene || '(내용 없음)'}</span>
                <span className={s.cutBadges}>
                  {g.g1 && <span className={`${s.gBadge} ${s.g1}`}>G1</span>}
                  {g.g2 && <span className={`${s.gBadge} ${s.g2}`}>G2</span>}
                  {g.g3 && <span className={`${s.gBadge} ${s.g3}`}>G3</span>}
                </span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
