import { useApp } from '../context/AppContext'
import { setGPoint } from '../lib/gpoints'
import s from './ExtractTab.module.css'

function downloadText(content, filename) {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

export default function ExtractTab() {
  const { state } = useApp()
  const { cuts, episode, scriptRaw } = state

  const exportFullScript = () => {
    const lines = [
      `에피소드 ${episode.number}: ${episode.title || '제목 없음'}`,
      `배경: ${episode.location} | 분위기: ${episode.mood}`,
      `캐릭터: ${episode.character}`,
      '', '─'.repeat(50), '',
      ...cuts.flatMap(c => [
        `[CUT ${c.no}]`,
        c.scene ? `씬: ${c.scene}` : '',
        c.action ? `액션: ${c.action}` : '',
        c.character ? `캐릭터: ${c.character}` : '',
        c.dialogue ? `대사: ${c.dialogue}` : '',
        c.narration ? `나레이션: ${c.narration}` : '',
        '',
      ]).filter(Boolean),
    ]
    downloadText(lines.join('\n'), `ep${episode.number}_대본.txt`)
  }

  const exportDialogue = () => {
    const lines = cuts.flatMap(c => {
      const parts = []
      if (c.dialogue) parts.push(`[CUT ${c.no}] ${c.character}: ${c.dialogue}`)
      if (c.narration) parts.push(`[CUT ${c.no}] (VO): ${c.narration}`)
      return parts
    })
    downloadText(lines.join('\n'), `ep${episode.number}_대사.txt`)
  }

  const exportPrompts = () => {
    const lines = cuts.map(c => `[CUT ${c.no}]\n${c.imagePrompt || '(프롬프트 없음)'}`).join('\n\n')
    downloadText(lines, `ep${episode.number}_이미지프롬프트.txt`)
  }

  const exportJSON = () => {
    const data = { episode, cuts }
    downloadText(JSON.stringify(data, null, 2), `ep${episode.number}_data.json`)
    // ── G4 포인트 자동 저장 ──────────────────────────────
    cuts.forEach(c => setGPoint(c.no, 'g4', true))
  }

  const exportRaw = () => {
    if (!scriptRaw) { alert('생성된 원본 대본이 없습니다'); return }
    downloadText(scriptRaw, `ep${episode.number}_원본.txt`)
  }

  const totalDialogue = cuts.reduce((acc, c) => acc + (c.dialogue?.length || 0) + (c.narration?.length || 0), 0)
  const cutsWithPrompt = cuts.filter(c => c.imagePrompt).length
  const cutsWithDialogue = cuts.filter(c => c.dialogue || c.narration).length

  return (
    <div className={s.root}>
      <div className={s.header}>
        <h2>추출 및 내보내기</h2>
        <p className={s.desc}>대본 데이터를 다양한 형식으로 내보냅니다.</p>
      </div>

      <div className={s.statsRow}>
        {[
          { label: '총 컷 수', value: cuts.length },
          { label: '대사/VO 컷', value: cutsWithDialogue },
          { label: '이미지 프롬프트', value: cutsWithPrompt },
          { label: '총 글자 수', value: totalDialogue.toLocaleString() },
        ].map(stat => (
          <div key={stat.label} className={s.stat}>
            <span className={s.statVal}>{stat.value}</span>
            <span className={s.statLabel}>{stat.label}</span>
          </div>
        ))}
      </div>

      <div className={s.section}>
        <div className={s.sectionTitle}>📄 대본 내보내기</div>
        <div className={s.cards}>
          <ExportCard icon="📝" title="전체 대본" desc="씬/액션/대사/나레이션 포함 전체 대본 텍스트" color="accent" onClick={exportFullScript} />
          <ExportCard icon="💬" title="대사만 추출" desc="캐릭터 대사와 나레이션(VO)만 텍스트로 추출" color="blue" onClick={exportDialogue} />
          <ExportCard icon="📋" title="원본 생성 텍스트" desc="Claude가 생성한 원본 마크다운 텍스트" color="gray" onClick={exportRaw} />
        </div>
      </div>

      <div className={s.section}>
        <div className={s.sectionTitle}>🖼️ 이미지 프롬프트</div>
        <div className={s.cards}>
          <ExportCard icon="✨" title="이미지 프롬프트" desc="모든 컷의 Flow/Imagen/Midjourney 프롬프트" color="yellow" onClick={exportPrompts} />
        </div>
      </div>

      <div className={s.section}>
        <div className={s.sectionTitle}>📦 데이터</div>
        <div className={s.cards}>
          <ExportCard icon="{ }" title="JSON 데이터" desc="에피소드 설정 + 전체 컷 데이터 JSON" color="green" onClick={exportJSON} />
        </div>
      </div>

      <div className={s.preview}>
        <div className={s.previewTitle}>미리보기</div>
        <div className={s.previewTable}>
          <div className={s.tableHead}>
            <span>컷</span><span>씬</span><span>대사</span><span>나레이션</span><span>프롬프트</span>
          </div>
          {cuts.map(c => (
            <div key={c.id} className={s.tableRow}>
              <span className={s.tableNo}>CUT {c.no}</span>
              <span>{c.scene || '-'}</span>
              <span>{c.dialogue || '-'}</span>
              <span>{c.narration || '-'}</span>
              <span className={s.promptCell}>{c.imagePrompt ? '✓' : '-'}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function ExportCard({ icon, title, desc, color, onClick }) {
  const colorMap = { accent: '#7c3aed', blue: '#3b82f6', yellow: '#eab308', green: '#22c55e', gray: '#6b7280' }
  return (
    <button className={s.exportCard} onClick={onClick}
      style={{ borderColor: colorMap[color] + '55', '--hc': colorMap[color] }}>
      <span className={s.exportIcon}>{icon}</span>
      <div>
        <div className={s.exportTitle} style={{ color: colorMap[color] }}>{title}</div>
        <div className={s.exportDesc}>{desc}</div>
      </div>
      <span className={s.exportArrow}>⬇</span>
    </button>
  )
}
