import { useState } from 'react'
import { useApp } from '../context/AppContext'
import { claudeMessages } from '../lib/api'
import s from './ScriptGenTab.module.css'

const LOCATIONS = ['카페', '공원', '집 (방)', '도서관', '학교', '회사', '해변', '산', '거리', '기타']
const MOODS = ['감성', '유머', '정보', '힐링', '동기부여', '일상', '여행']

const SIGNATURE_PREFIX = `[SIGNATURE CUT - HIGH QUALITY]
Extreme close-up OR dramatic cinematic shot.
Golden hour warm backlight, shallow depth of field,
cinematic lens flare, photorealistic 8K,
emotionally captivating, scroll-stopping quality.`

// ** __ # 등 마크다운 기호를 제거하고 앞뒤 공백 정리
const clean = (str) => str.replace(/\*\*/g, '').replace(/\*/g, '').replace(/^#+\s*/, '').trim()

function parseCuts(raw, n) {
  const cuts = []
  const blocks = raw.split(/\[CUT\s*(\d+)\]/i).filter(Boolean)
  let cur = null
  for (const block of blocks) {
    if (/^\d+$/.test(block.trim())) {
      if (cur) cuts.push(cur)
      cur = { id: `cut-${block.trim()}`, no: parseInt(block.trim()), scene: '', action: '', character: '서여리', dialogue: '', narration: '', imagePrompt: '', duration: 5, cutType: 'NORMAL' }
    } else if (cur) {
      const line = (regex) => { const m = block.match(regex); return m ? clean(m[1]) : '' }
      cur.scene       = line(/씬[:\s]+(.+)/m)          || line(/장면[:\s]+(.+)/m)
      cur.action      = line(/액션[:\s]+(.+)/m)         || line(/행동[:\s]+(.+)/m)
      cur.character   = line(/캐릭터[:\s]+(.+)/m)       || '서여리'
      cur.dialogue    = line(/대사[:\s]+(.+)/m)
      cur.narration   = line(/나레이션[:\s]+(.+)/m)
      cur.imagePrompt = line(/이미지 프롬프트[:\s]+(.+)/m) || line(/프롬프트[:\s]+(.+)/m)
    }
  }
  if (cur) cuts.push(cur)
  if (cuts.length === 0) {
    return Array.from({ length: n }, (_, i) => ({
      id: `cut-${i+1}`, no: i+1, scene: '', action: '', character: '서여리',
      dialogue: '', narration: '', imagePrompt: '', duration: 5, cutType: 'NORMAL',
    }))
  }
  return cuts
}

export default function ScriptGenTab() {
  const { state, dispatch } = useApp()
  const { episode, scriptRaw, cuts, apiKeys } = state
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState('')
  const [activeCut, setActiveCut] = useState(0)
  const [exportMsg, setExportMsg] = useState('')

  const generateScript = async () => {
    if (!apiKeys.claude) { alert('Claude API 키를 입력하세요 (상단 API 바)'); return }
    setLoading(true)
    setProgress('Claude에게 요청 중...')
    const cutCount = episode.cutCount
    const hookEnd = 3
    const emotionEnd = hookEnd + 10
    const choiceEnd = emotionEnd + 4  // 17 total
    const prompt = `당신은 서여리 유튜브 채널 전담 대본 작가입니다.
아래 에피소드 구조와 대사 스타일에 맞는 ${cutCount}컷 대본을 작성하세요.

에피소드 번호: ${episode.number}
제목: ${episode.title || '(자유 설정)'}
배경 장소: ${episode.location}
전체 분위기: ${episode.mood}
주인공 캐릭터: ${episode.character}

━━━ 에피소드 구조 ━━━

1. 사건 (Hook) — CUT 1~${hookEnd}
   예상치 못한 일이 발생하는 장면
   시청자의 궁금증을 강하게 유발

2. 감정 변화 — CUT ${hookEnd + 1}~${emotionEnd}
   혼란 → 의문 → 발견 → 깨달음 순서로 전개
   서여리의 내면 솔직한 감정 변화 과정

3. 선택 — CUT ${emotionEnd + 1}~${cutCount}
   서여리만의 결론을 내리는 장면
   마지막 컷은 반드시 시청자에게 질문으로 끝낼 것

━━━ 대사 스타일 ━━━
- 혼잣말과 나레이션을 자연스럽게 섞어서 작성
- 짧고 감성적인 문장 (한 컷당 1~2문장)
- 마지막 컷의 대사 또는 나레이션은 시청자에게 던지는 질문으로 마무리

각 컷은 반드시 아래 형식으로 작성하세요:

[CUT 1]
씬: INT/EXT. 장소 - 시간대
액션: (주인공의 행동 묘사)
캐릭터: 서여리
대사: (혼잣말 형식의 짧은 대사)
나레이션: (감성적인 한 줄 나레이션)
이미지 프롬프트: (영어로, Stable Diffusion/Midjourney 스타일)

[CUT 2]
...
[CUT ${cutCount}]
...`

    try {
      const res = await claudeMessages(apiKeys.claude, {
        model: 'claude-sonnet-4-6',
        max_tokens: 4096,
        messages: [{ role: 'user', content: prompt }],
      })
      if (!res.ok) { const e = await res.json(); throw new Error(e.error?.message || '오류') }
      const data = await res.json()
      const raw = data.content[0].text.replace(/\*\*/g, '')
      setProgress('대본 파싱 중...')
      dispatch({ type: 'SET_SCRIPT_RAW', p: raw })
      const parsed = parseCuts(raw, episode.cutCount)
      dispatch({ type: 'SET_CUTS', p: parsed })
      setProgress('완료!')
      setTimeout(() => setProgress(''), 2000)
    } catch (err) {
      alert('오류: ' + err.message)
      setProgress('')
    } finally {
      setLoading(false)
    }
  }

  const exportPipeline = async () => {
    const payload = {
      episode: episode.number,
      type: 'shorts',
      cuts: cuts.map(c => ({
        id: `C${String(c.no).padStart(2, '0')}`,
        imagePrompt: c.cutType === 'SIGNATURE'
          ? `${SIGNATURE_PREFIX}\n${c.imagePrompt}`
          : c.imagePrompt,
        narration: c.narration,
        dialogue: c.dialogue,
        duration: c.duration,
        cutType: c.cutType || 'NORMAL',
      })),
    }
    try {
      const res = await fetch('http://localhost:3001/api/save-prompts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (data.success) {
        setExportMsg('✅ prompts.json 저장완료! npm run flow 실행 가능')
      } else {
        throw new Error(data.error || '저장 실패')
      }
    } catch (err) {
      setExportMsg('❌ 저장 실패: ' + err.message)
    }
    setTimeout(() => setExportMsg(''), 3000)
  }

  const updateCut = (id, field, val) => dispatch({ type: 'UPDATE_CUT', id, p: { [field]: val } })

  const handleCutCountChange = (n) => {
    const count = Math.max(1, Math.min(20, parseInt(n) || 7))
    dispatch({ type: 'RESET_CUTS', n: count })
  }

  return (
    <div className={s.root}>
      {/* Left: Settings */}
      <div className={s.sidebar}>
        <div className={s.sideTitle}>에피소드 설정</div>

        <div className={s.field}>
          <label>에피소드 번호</label>
          <input type="number" min="1" value={episode.number}
            onChange={e => dispatch({ type: 'SET_EPISODE', p: { number: parseInt(e.target.value) || 1 } })} />
        </div>
        <div className={s.field}>
          <label>에피소드 제목</label>
          <input placeholder="예: 카페에서 혼자 쓰는 편지" value={episode.title}
            onChange={e => dispatch({ type: 'SET_EPISODE', p: { title: e.target.value } })} />
        </div>
        <div className={s.field}>
          <label>배경 장소</label>
          <select value={episode.location}
            onChange={e => dispatch({ type: 'SET_EPISODE', p: { location: e.target.value } })}>
            {LOCATIONS.map(l => <option key={l}>{l}</option>)}
          </select>
        </div>
        <div className={s.field}>
          <label>전체 분위기</label>
          <div className={s.chips}>
            {MOODS.map(m => (
              <button key={m}
                className={`${s.chip} ${episode.mood === m ? s.chipActive : ''}`}
                onClick={() => dispatch({ type: 'SET_EPISODE', p: { mood: m } })}
              >{m}</button>
            ))}
          </div>
        </div>
        <div className={s.field}>
          <label>컷 수</label>
          <div className={s.cutCountRow}>
            <input type="number" min="1" max="20" value={episode.cutCount}
              onChange={e => handleCutCountChange(e.target.value)} />
            <span className={s.cutHint}>컷 (최대 20)</span>
          </div>
        </div>
        <div className={s.field}>
          <label>캐릭터 설정</label>
          <textarea rows={3} value={episode.character}
            onChange={e => dispatch({ type: 'SET_EPISODE', p: { character: e.target.value } })} />
        </div>

        <button className={s.genBtn} onClick={generateScript} disabled={loading}>
          {loading ? (
            <><span className={s.spinner} />{progress || '생성 중...'}</>
          ) : '✨ Claude로 대본 생성'}
        </button>

        {progress && !loading && <div className={s.progressMsg}>{progress}</div>}

        <button className={s.exportBtn} onClick={exportPipeline} disabled={cuts.length === 0}>
          📤 파이프라인 내보내기
        </button>

        {exportMsg && <div className={s.exportMsg}>{exportMsg}</div>}

        <div className={s.divider} />
        <div className={s.sideTitle}>컷 목록</div>
        <div className={s.cutList}>
          {cuts.map((c, i) => (
            <button key={c.id} className={`${s.cutItem} ${activeCut === i ? s.cutActive : ''}`}
              onClick={() => setActiveCut(i)}>
              <span className={s.cutNo}>
                CUT {c.no}
                {c.cutType === 'SIGNATURE'
                  ? <span className={s.badgeSig}>✨ SIG</span>
                  : <span className={s.badgeNorm}>NORMAL</span>}
              </span>
              <span className={s.cutPreview}>{c.dialogue || c.narration || c.scene || '(비어있음)'}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Right: Editor */}
      <div className={s.editor}>
        {cuts.length > 0 && (
          <>
            <div className={s.editorHeader}>
              <h2>CUT {cuts[activeCut]?.no}</h2>
              <div className={s.editorNav}>
                <button disabled={activeCut === 0} onClick={() => setActiveCut(i => i - 1)}>◀ 이전</button>
                <span>{activeCut + 1} / {cuts.length}</span>
                <button disabled={activeCut === cuts.length - 1} onClick={() => setActiveCut(i => i + 1)}>다음 ▶</button>
              </div>
            </div>

            <div className={s.fields}>
              {[
                { key: 'scene', label: '씬 헤딩', ph: 'INT. 카페 - 낮' },
                { key: 'action', label: '액션/지문', ph: '여리가 창가에 앉아 노트북을 연다.' },
                { key: 'character', label: '캐릭터', ph: '서여리' },
                { key: 'dialogue', label: '대사', ph: '오늘 여기서 처음 써보는 이야기야.' },
                { key: 'narration', label: '나레이션 (VO)', ph: '평범한 화요일 오후, 새로운 루틴이 시작된다.' },
                { key: 'imagePrompt', label: '이미지 프롬프트', ph: 'Young Korean woman at cafe window, cinematic, 4K' },
              ].map(({ key, label, ph }) => (
                <div key={key} className={s.edField}>
                  <label>{label}</label>
                  {key === 'imagePrompt' || key === 'action' || key === 'narration' || key === 'dialogue' ? (
                    <textarea rows={key === 'imagePrompt' ? 3 : 2}
                      placeholder={ph}
                      value={cuts[activeCut]?.[key] || ''}
                      onChange={e => updateCut(cuts[activeCut].id, key, e.target.value)} />
                  ) : (
                    <input placeholder={ph}
                      value={cuts[activeCut]?.[key] || ''}
                      onChange={e => updateCut(cuts[activeCut].id, key, e.target.value)} />
                  )}
                </div>
              ))}
              <div className={s.edField}>
                <label>컷 길이 (초)</label>
                <input type="number" min="1" max="60" value={cuts[activeCut]?.duration || 5}
                  onChange={e => updateCut(cuts[activeCut].id, 'duration', parseInt(e.target.value) || 5)} />
              </div>
              <div className={s.edField}>
                <label>컷 타입</label>
                <div className={s.cutTypeRow}>
                  {['NORMAL', 'SIGNATURE'].map(type => {
                    const cur = cuts[activeCut]?.cutType || 'NORMAL'
                    return (
                      <button key={type}
                        className={`${s.cutTypeBtn} ${cur === type ? (type === 'SIGNATURE' ? s.cutTypeSigActive : s.cutTypeNormActive) : ''}`}
                        onClick={() => updateCut(cuts[activeCut].id, 'cutType', type)}>
                        {type === 'NORMAL' ? '⬜ NORMAL — Flow 자동화' : '✨ SIGNATURE — 고품질'}
                      </button>
                    )
                  })}
                </div>
                {(cuts[activeCut]?.cutType === 'SIGNATURE') && (
                  <div className={s.sigHint}>내보내기 시 이미지 프롬프트 앞에 고품질 접두어가 자동으로 추가됩니다.</div>
                )}
              </div>
            </div>
          </>
        )}

        {scriptRaw && (
          <details className={s.rawSection}>
            <summary>원본 생성 텍스트 보기</summary>
            <pre className={s.rawText}>{scriptRaw}</pre>
          </details>
        )}
      </div>
    </div>
  )
}
