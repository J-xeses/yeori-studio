import { useState } from 'react'
import { useApp } from '../context/AppContext'
import { claudeMessages } from '../lib/api'
import { setGPoints, setGPoint } from '../lib/gpoints'
import s from './ScriptGenTab.module.css'

const LOCATIONS = ['카페', '공원', '집 (방)', '도서관', '학교', '회사', '해변', '산', '거리', '기타']
const MOODS = ['감성', '유머', '정보', '힐링', '동기부여', '일상', '여행', 'K문화', '공감', '치명']

function cleanMarkdown(text) {
  return text
    .replace(/\*\*/g, '')     // ** 굵은 글씨 제거
    .replace(/\*/g, '')       // * 이탤릭 제거
    .replace(/^#+\s/gm, '')   // # 헤더 제거
    .replace(/^---+$/gm, '')  // --- 구분선 제거
    .replace(/^>\s/gm, '')    // > 인용 제거
    .replace(/`/g, '')        // ` 코드 제거
    .trim()
}

function parseCuts(raw, n) {
  // 마크다운 정리
  const cleaned = cleanMarkdown(raw)
  const cuts = []
  const blocks = cleaned.split(/\[CUT\s*(\d+)\]/i).filter(Boolean)
  let cur = null

  for (const block of blocks) {
    if (/^\d+$/.test(block.trim())) {
      if (cur) cuts.push(cur)
      cur = {
        id: `cut-${block.trim()}`,
        no: parseInt(block.trim()),
        scene: '', action: '', character: '서여리',
        dialogue: '', narration: '', imagePrompt: '', duration: 5
      }
    } else if (cur) {
      // 멀티라인 파싱 (다음 필드 키워드가 나올 때까지 수집)
      const getField = (startRegex) => {
        const m = block.match(startRegex)
        if (!m) return ''
        const startIdx = block.indexOf(m[0]) + m[0].length
        const rest = block.slice(startIdx)
        // 다음 필드 키워드 전까지
        const nextField = rest.search(/\n(씬|액션|캐릭터|대사|나레이션|이미지 프롬프트)[:：]/)
        const content = nextField > -1 ? rest.slice(0, nextField) : rest
        return content.replace(/^[\s\n]+|[\s\n]+$/g, '').replace(/^없음$/i, '')
      }

      cur.scene      = getField(/씬[:：]\s*/) || getField(/장면[:：]\s*/)
      cur.action     = getField(/액션[:：]\s*/) || getField(/행동[:：]\s*/)
      cur.character  = getField(/캐릭터[:：]\s*/) || '서여리'
      cur.dialogue   = getField(/대사[:：]\s*/)
      cur.narration  = getField(/나레이션[:：](?:\s*\(VO\))?\s*/) || getField(/나레이션[:：]\s*/)
      cur.shotType   = (getField(/샷 타입[:：]\s*/) || '').toUpperCase().includes('CLOSE') ? 'CLOSEUP' : 'FULLBODY'
      cur.imagePrompt = getField(/이미지 프롬프트[:：]\s*/) || getField(/프롬프트[:：]\s*/)

      // 룰셋 통과 표시 제거 (UI에서 별도 표시)
      cur.imagePrompt = cur.imagePrompt
        .replace(/✅\s*룰셋\s*통과/g, '')
        .replace(/⚠️.*확인 필요/g, '')
        .trim()

      // duration 자동 계산: 대사+나레이션 글자수 기반 (5자/초 + 여유 2초)
      const text = (cur.dialogue || '') + (cur.narration || '')
      const chars = text.replace(/\s/g, '').length
      cur.duration = chars > 0
        ? Math.min(20, Math.max(4, Math.round(chars / 5) + 2))
        : 5
    }
  }
  if (cur) cuts.push(cur)
  if (cuts.length === 0) {
    return Array.from({ length: n }, (_, i) => ({
      id: `cut-${i+1}`, no: i+1, scene: '', action: '', character: '서여리',
      dialogue: '', narration: '', imagePrompt: '', duration: 5,
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

  // ── 서여리 연출 원칙 룰셋 v1.1 ─────────────────────────────
  const YEORI_RULESET = `
=== 서여리 연출 원칙 룰셋 v1.1 (반드시 준수) ===

[샷 타입 분류 — 필수]
모든 컷은 반드시 아래 두 가지 중 하나로 분류한다:

◆ CLOSEUP (클로즈업)
  - 얼굴·상반신 위주 컷 (표정, 눈빛, 감정 강조)
  - 서여리 레퍼런스 이미지를 직접 활용하는 컷
  - 이미지 프롬프트: "CLOSEUP SHOT —" 으로 시작
  - 얼굴 재현이 핵심이므로 프롬프트에 얼굴 특징 정밀 기술 생략 가능
    (레퍼런스 이미지가 직접 사용됨)
  - 대신 표정·감정·조명·분위기 묘사에 집중

◆ FULLBODY (풀바디/씬)
  - 전신·배경·이동·공간감 강조 컷
  - Google Flow로 생성하는 컷
  - 이미지 프롬프트: "FULLBODY SHOT —" 으로 시작
  - 얼굴이 작게 보이므로 씬·의상·체형·배경 묘사에 집중
  - K-model proportions, very small face, long slim legs 필수 포함

[캐릭터 일관성 — 절대 원칙]
- 스타트 프레임: 반드시 서여리 얼굴 있는 이미지 기준
- 헤어: long wavy dark brown hair / NOT short — 이중 강조 필수
- 시그니처: "natural skin texture on right cheek" — 아주 희미하게, 과장 금지
- 의상: DO NOT change clothing — 색상·소재·스타일 명시
- 소품: 골드 목걸이·브레이슬렛 등 디테일 명시
- 나이: "early 20s, appearing no older than 22-23" 명시
- 스타일: Photorealistic 8K cinematic, natural Korean beauty
- 체형: "K-model proportions, very small face, long slim legs, slender figure" — FULLBODY 필수 포함
- 비율: "small head-to-body ratio, DO NOT make average body proportions" — FULLBODY 필수 포함

[영상 생성 원칙]
- 프롬프트에 대사 텍스트 절대 금지 (립싱크+행동 동시 발생 방지)
- 행동은 시간 단위로 분리: "First 3s / Next 3s / Final 4s"
- CLOSEUP과 FULLBODY를 스토리 흐름에 맞게 교차 편집
- 배경 인물은 허용하되 서여리 연출에 개입·간섭 금지
  → "background people must not interact with the main character"

[K감성 / 리얼리티]
- "effortlessly photogenic, not posing, just existing beautifully"
- 증명사진 느낌 NG
- 현실적 K감성 디테일 필수 (볼캡 여유감, 부츠컷 롤업 등)
- 디테일 오류 방지 (소품 중복·변형 주의)

[스토리텔링]
- 3막 구조: 사건 → 감정변화 → 선택
- 서여리 = 감성 큐레이터 (다양한 소재를 서여리 시선으로 필터링)
- 시각 요소는 반드시 대사/스토리와 연결
- 엔딩: 대사 끝 후 여운 2~3초 필수 (침묵, 컵 바라보기 등)
- BGM 대비: 감정 전환점에서 BGM 완전 중단 → 현장감 극대화

[이미지 프롬프트 생성 시 체크리스트]
□ 샷 타입 명시: "CLOSEUP SHOT —" 또는 "FULLBODY SHOT —" 으로 시작
□ long wavy dark brown hair, NOT short 이중 강조 포함
□ CLOSEUP: natural skin texture 문구 + 표정/감정/조명 묘사 집중
□ FULLBODY: K-model proportions, small face, long legs, DO NOT make average body
□ DO NOT change clothing 포함
□ 배경 인물 개입 방지 문구 포함
□ 대사 텍스트 없음
□ 행동이 시간 단위로 분리됨
□ K감성 디테일 1개 이상 포함
=== 룰셋 끝 ===`

  const generateScript = async () => {
    if (!apiKeys.claude) { alert('Claude API 키를 입력하세요 (상단 API 바)'); return }
    setLoading(true)
    setProgress('Claude에게 요청 중...')

    const prompt = `당신은 한국 유튜브 숏폼/영상 전문 대본 작가입니다.
아래 연출 원칙을 반드시 준수하여 대본과 이미지 프롬프트를 생성하세요.

${YEORI_RULESET}

위 룰셋을 완전히 내재화한 상태에서
아래 설정에 맞는 ${episode.cutCount}컷 짜리 유튜브 영상 대본을 작성해주세요.

에피소드 번호: ${episode.number}
제목: ${episode.title || '(자유 설정)'}
배경 장소: ${episode.location}
전체 분위기: ${Array.isArray(episode.mood) ? episode.mood.join(' + ') : episode.mood}
주인공 캐릭터: ${episode.character}

각 컷은 반드시 아래 형식으로 작성하세요.
⚠️ 중요: 마크다운 형식 절대 금지! ** 굵은 글씨, # 헤더, --- 구분선 사용 금지!
⚠️ 반드시 아래 키워드로 시작하는 줄 형식만 사용할 것!

[CUT 1]
씬: INT/EXT. 장소 - 시간대
액션: 주인공의 행동 묘사 — First 3s: / Next 3s: / Final 4s: 형식으로 분리
캐릭터: 서여리
대사: 실제 대사 (자연스러운 한국어, 없으면 "없음" 으로 표기)
나레이션: 보이스오버 나레이션 (감성적으로)
샷 타입: CLOSEUP 또는 FULLBODY (반드시 명시)
이미지 프롬프트: 영어로 작성, "CLOSEUP SHOT —" 또는 "FULLBODY SHOT —" 으로 시작, 룰셋 체크리스트 전체 반영

[CUT 2]
씬:
액션:
캐릭터: 서여리
대사:
나레이션:
샷 타입:
이미지 프롬프트:

[CUT ${episode.cutCount}]
씬:
액션:
캐릭터: 서여리
대사:
나레이션:
샷 타입:
이미지 프롬프트:

⚠️ 절대 지킬 것:
- 마크다운 ** ## --- 완전 금지
- 각 필드는 반드시 "씬:" "액션:" "캐릭터:" "대사:" "나레이션:" "이미지 프롬프트:" 로 시작
- [CUT 번호] 형식 정확히 유지
- 대사 없는 컷은 대사: 없음 으로 표기
- 이미지 프롬프트 끝에 ✅ 룰셋 통과 또는 ⚠️ [항목명] 확인 필요 표시

대사는 구어체로 자연스럽게, 나레이션은 감성적으로 작성하세요.
이미지 프롬프트는 영어로, 룰셋의 체크리스트를 모두 통과한 상태로 작성하세요.`

    try {
      const res = await claudeMessages(apiKeys.claude, {
        model: 'claude-sonnet-4-6',
        max_tokens: 8192,
        messages: [{ role: 'user', content: prompt }],
      })
      if (!res.ok) { const e = await res.json(); throw new Error(e.error?.message || '오류') }
      const data = await res.json()
      const raw = data.content[0].text
      setProgress('대본 파싱 중...')
      dispatch({ type: 'SET_SCRIPT_RAW', p: raw })
      const parsed = parseCuts(raw, episode.cutCount)
      dispatch({ type: 'SET_CUTS', p: parsed })

      // ── 룰셋 자동 체크 ──────────────────────────────────
      let passCount = 0, failItems = []
      parsed.forEach(cut => {
        const p = cut.imagePrompt || ''
        const isClose = cut.shotType === 'CLOSEUP'
        const isFull  = cut.shotType === 'FULLBODY'
        if (!isClose && !isFull) failItems.push(`CUT${cut.no}: 샷 타입 누락 (CLOSEUP/FULLBODY 미명시)`)
        if (!p.match(/CLOSEUP SHOT|FULLBODY SHOT/i)) failItems.push(`CUT${cut.no}: 프롬프트 샷 타입 접두어 누락`)
        if (!p.includes('NOT short')) failItems.push(`CUT${cut.no}: 헤어 이중강조 누락`)
        if (isClose && !p.includes('skin texture') && !p.includes('beauty mark')) failItems.push(`CUT${cut.no}: CLOSEUP natural skin texture 문구 누락`)
        if (isFull && !p.match(/K-model|small face|long.*legs/i)) failItems.push(`CUT${cut.no}: FULLBODY 체형 문구 누락`)
        if (!p.includes('DO NOT change clothing')) failItems.push(`CUT${cut.no}: 의상 고정 문구 누락`)
        else passCount++
      })

      // ── G1 포인트 자동 저장 ──────────────────────────────
      parsed.forEach(cut => {
        const hasContent = !!(cut.dialogue || cut.narration || cut.scene)
        setGPoint(cut.no, 'g1', hasContent)
      })

      if (failItems.length > 0) {
        setProgress(`⚠️ 룰셋 미달 ${failItems.length}항목 — 이미지 프롬프트 확인 권장`)
        console.warn('[룰셋 체크]', failItems)
      } else {
        setProgress('✅ 완료! 룰셋 통과 · G1 포인트 업데이트됨')
      }
      setTimeout(() => setProgress(''), 3000)
    } catch (err) {
      alert('오류: ' + err.message)
      setProgress('')
    } finally {
      setLoading(false)
    }
  }

  const updateCut = (id, field, val) => {
    dispatch({ type: 'UPDATE_CUT', id, p: { [field]: val } })
    // 대사/나레이션/씬 입력 시 G1 자동 판단
    if (['dialogue', 'narration', 'scene'].includes(field)) {
      const cut = cuts.find(c => c.id === id)
      if (cut) {
        const updated = { ...cut, [field]: val }
        const hasContent = !!(updated.dialogue || updated.narration || updated.scene)
        setGPoint(cut.no, 'g1', hasContent)
      }
    }
  }

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
          <label>전체 분위기 <span style={{fontSize:10,color:'var(--text3)'}}>(최대 2개)</span></label>
          <div className={s.chips}>
            {MOODS.map(m => {
              const selected = Array.isArray(episode.mood)
                ? episode.mood.includes(m)
                : episode.mood === m
              const moodArr = Array.isArray(episode.mood) ? episode.mood : [episode.mood]
              return (
                <button key={m}
                  className={`${s.chip} ${selected ? s.chipActive : ''}`}
                  onClick={() => {
                    if (selected) {
                      // 선택 해제 (최소 1개 유지)
                      const next = moodArr.filter(x => x !== m)
                      dispatch({ type: 'SET_EPISODE', p: { mood: next.length ? next : moodArr } })
                    } else {
                      // 최대 2개
                      const next = moodArr.length >= 2 ? [moodArr[1], m] : [...moodArr, m]
                      dispatch({ type: 'SET_EPISODE', p: { mood: next } })
                    }
                  }}
                >{m}</button>
              )
            })}
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

        <div className={s.divider} />
        <div className={s.sideTitle}>컷 목록</div>
        <div className={s.cutList}>
          {cuts.map((c, i) => (
            <button key={c.id} className={`${s.cutItem} ${activeCut === i ? s.cutActive : ''}`}
              onClick={() => setActiveCut(i)}>
              <span className={s.cutNo}>CUT {c.no}</span>
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
