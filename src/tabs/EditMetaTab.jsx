// src/tabs/EditMetaTab.jsx
// yeori-studio에 그대로 붙여넣기 가능한 파일
// 위치: src/tabs/EditMetaTab.jsx

import { useState } from 'react'
import { useApp } from '../context/AppContext'
import { claudeMessages } from '../lib/api'
import styles from './EditMetaTab.module.css'

function estimateDuration(text = '') {
  const chars = text.replace(/\s/g, '').length
  return Math.max(4, Math.round((chars / 300) * 60))
}

function toTimecode(sec) {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`
}

const TRANSITION_OPTIONS = ['컷 편집','J-Cut','L-Cut','크로스 디졸브','페이드 인/아웃','점프컷']

export default function EditMetaTab() {
  const { state } = useApp()
  const [loading, setLoading] = useState(false)
  const [meta, setMeta]       = useState([])
  const [aiNote, setAiNote]   = useState('')
  const [error, setError]     = useState('')
  const [hookIndices, setHookIndices] = useState([0])

  // state.cuts 또는 샘플 데이터 사용
  const cuts = state.cuts?.length
    ? state.cuts
    : Array.from({ length: 10 }, (_, i) => ({
        label: `CUT ${String(i+1).padStart(2,'0')}`,
        script: state.script || '서여리 대사 샘플입니다. 실제 대본 탭에서 대본을 먼저 생성해주세요.',
      }))

  const buildMeta = () => {
    let cursor = 0
    return cuts.map((cut, i) => {
      const dur   = estimateDuration(cut.script || cut.text || '')
      const start = cursor
      cursor += dur
      const isHook = hookIndices.includes(i)
      return {
        cutNo: String(i+1).padStart(2,'0'),
        label: cut.label || `CUT ${String(i+1).padStart(2,'0')}`,
        start: toTimecode(start),
        end:   toTimecode(cursor),
        duration: dur,
        type: isHook ? '훅' : '일반',
        transition: i === 0 ? '페이드 인/아웃' : '컷 편집',
        note: isHook ? '리텐션 훅 구간 — 강조 효과 권장' : '',
      }
    })
  }

  const generate = async () => {
    setLoading(true); setError('')
    const computed = buildMeta()
    setMeta(computed)

    try {
      const apiKey   = state.apiKey || ''
      const totalSec = computed.reduce((a,c) => a + c.duration, 0)
      const hookCuts = computed.filter(c => c.type === '훅').map(c => c.label).join(', ')

      const data = await claudeMessages(apiKey, {
        model: 'claude-sonnet-4-20250514',
        max_tokens: 400,
        messages: [{
          role: 'user',
          content: `AI 버추얼 인플루언서 "서여리" 유튜브 롱폼 영상 CapCut 편집 시 주의사항 3줄 요약.
총 길이: ${toTimecode(totalSec)} / CUT: ${computed.length}개 / 훅 CUT: ${hookCuts || '없음'}
실용적인 조언만.`,
        }],
      })
      setAiNote(data.content?.map(b => b.text || '').join('') || '')
    } catch (e) {
      setError('AI 주의사항 생성 오류: ' + e.message)
    } finally {
      setLoading(false)
    }
  }

  const exportJSON = () => {
    const blob = new Blob([JSON.stringify(meta, null, 2)], { type: 'application/json' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href = url; a.download = 'yeori_edit_meta.json'; a.click()
    URL.revokeObjectURL(url)
  }

  const exportCSV = () => {
    const headers = ['CUT번호','레이블','시작','끝','길이(초)','타입','트랜지션','메모']
    const rows = meta.map(m =>
      [m.cutNo, m.label, m.start, m.end, m.duration, m.type, m.transition, `"${m.note}"`].join(',')
    )
    const csv  = [headers.join(','), ...rows].join('\n')
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href = url; a.download = 'yeori_edit_meta.csv'; a.click()
    URL.revokeObjectURL(url)
  }

  const toggleHook = idx =>
    setHookIndices(prev =>
      prev.includes(idx) ? prev.filter(i => i !== idx) : [...prev, idx]
    )

  const totalDur = meta.reduce((a,c) => a + c.duration, 0)

  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <h2 className={styles.title}>편집 메타 자동 생성</h2>
        <p className={styles.desc}>CUT 목록에서 CapCut 편집에 필요한 타임코드·타입·트랜지션을 자동으로 계산합니다</p>
      </div>

      {/* 훅 CUT 지정 */}
      <div className={styles.section}>
        <div className={styles.sectionLabel}>훅 CUT 지정 (클릭으로 토글)</div>
        <div className={styles.hookRow}>
          {cuts.map((cut, i) => (
            <span
              key={i}
              className={`${styles.cutTag} ${hookIndices.includes(i) ? styles.cutTagActive : ''}`}
              onClick={() => toggleHook(i)}
            >
              {cut.label || `CUT ${i+1}`}
            </span>
          ))}
        </div>
      </div>

      <button className={styles.genBtn} onClick={generate} disabled={loading}>
        {loading ? '메타 생성 중...' : '편집 메타 자동 생성'}
      </button>

      {error && <div className={styles.error}>{error}</div>}

      {meta.length > 0 && (
        <>
          {/* 요약 카드 */}
          <div className={styles.statRow}>
            {[
              { label: '총 길이', value: toTimecode(totalDur) },
              { label: 'CUT 수',  value: `${meta.length}개` },
              { label: '훅 CUT', value: `${meta.filter(m => m.type === '훅').length}개` },
            ].map(s => (
              <div key={s.label} className={styles.statCard}>
                <div className={styles.statLabel}>{s.label}</div>
                <div className={styles.statValue}>{s.value}</div>
              </div>
            ))}
          </div>

          {/* 테이블 */}
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  {['CUT','구간','길이','타입','트랜지션','메모'].map(h => (
                    <th key={h} className={styles.th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {meta.map((m, i) => (
                  <tr key={i} className={m.type === '훅' ? styles.hookRow2 : ''}>
                    <td className={styles.td}>{m.label}</td>
                    <td className={`${styles.td} ${styles.mono}`}>{m.start} ~ {m.end}</td>
                    <td className={styles.td}>{m.duration}초</td>
                    <td className={styles.td}>
                      <span className={m.type === '훅' ? styles.badgeHook : styles.badge}>{m.type}</span>
                    </td>
                    <td className={`${styles.td} ${styles.muted}`}>{m.transition}</td>
                    <td className={`${styles.td} ${styles.muted}`}>{m.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* AI 주의사항 */}
          {aiNote && (
            <div className={styles.aiNote}>
              <div className={styles.aiNoteLabel}>AI 편집 주의사항</div>
              <div className={styles.aiNoteText}>{aiNote}</div>
            </div>
          )}

          {/* 내보내기 */}
          <div className={styles.exportRow}>
            <button className={styles.exportBtn} onClick={exportJSON}>JSON 내보내기</button>
            <button className={styles.exportBtn} onClick={exportCSV}>CSV 내보내기</button>
          </div>
        </>
      )}
    </div>
  )
}
