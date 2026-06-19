import { useState } from 'react'
import { useApp } from '../context/AppContext'
import { claudeMessages } from '../lib/api'
import { setGPoints, setGPoint, loadGPoints } from '../lib/gpoints'
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

// 나레이션·대사에 혼입된 촬영 지시어 제거
function stripShotDirective(text) {
  if (!text) return text
  return text
    .replace(/\n?샷\s*타입[:：]\s*(CLOSEUP|FULLBODY|클로즈업|풀바디)[^\n]*/gi, '')
    .replace(/^(CLOSEUP|FULLBODY)\s*(SHOT)?\s*[-—]?\s*/i, '')
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
        // 다음 필드 키워드 전까지 (샷 타입 포함)
        const nextField = rest.search(/\n(씬|액션|캐릭터|대사|나레이션|샷\s*타입|이미지 프롬프트)[:：]/)
        const content = nextField > -1 ? rest.slice(0, nextField) : rest
        return content.replace(/^[\s\n]+|[\s\n]+$/g, '').replace(/^없음$/i, '')
      }

      cur.scene      = getField(/씬[:：]\s*/) || getField(/장면[:：]\s*/)
      cur.action     = getField(/액션[:：]\s*/) || getField(/행동[:：]\s*/)
      cur.character  = getField(/캐릭터[:：]\s*/) || '서여리'
      cur.dialogue   = stripShotDirective(getField(/대사[:：]\s*/))
      cur.narration  = stripShotDirective(getField(/나레이션[:：](?:\s*\(VO\))?\s*/) || getField(/나레이션[:：]\s*/))
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
  const { episode, scriptRaw, cuts, apiKeys, episodes, activeEpisodeId } = state
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState('')
  const [activeCut, setActiveCut] = useState(0)
  const [numError, setNumError] = useState('')
  const [flowRunning, setFlowRunning] = useState(false)
  const [flowLogs, setFlowLogs] = useState([])
  const [flowDone, setFlowDone] = useState(false)
  const [episodeOpen, setEpisodeOpen] = useState(true)
  const [episodeListOpen, setEpisodeListOpen] = useState(false)
  const [gData, setGData] = useState(() => loadGPoints())
  const [revisionInput, setRevisionInput] = useState('')
  const [revisionLoading, setRevisionLoading] = useState(false)
  const [revisionHistory, setRevisionHistory] = useState([])

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
        setGData(loadGPoints())
      }
    }
  }

  // ── G1 승인/취소 ─────────────────────────────────────────────
  const approveG1 = (cutNo) => {
    setGPoint(cutNo, 'g1', true)
    const updated = loadGPoints()
    setGData(updated)
    // 타입 무관하게 문자열로 통일 후 비교
    const cutNoStr = String(cutNo)
    const allDone = cuts.length > 0 && cuts.every(c => {
      if (String(c.no) === cutNoStr) return true
      return !!updated[`cut_${c.no}`]?.g1
    })
    console.log('[G1] cutNo:', cutNo, 'allDone:', allDone, 'cuts:', cuts.map(c=>c.no), 'updated:', updated)
    if (allDone) {
      console.log('[G1] 전체 승인 완료 → 스튜디오 탭으로 이동')
      setTimeout(() => dispatch({ type: 'SET_TAB', p: 'studio' }), 1000)
    }
  }
  const revokeG1  = (cutNo) => { setGPoint(cutNo, 'g1', false); setGData(loadGPoints()) }
  const approveAllG1 = () => {
    cuts.forEach(c => setGPoint(c.no, 'g1', true))
    const updated = loadGPoints()
    setGData(updated)
    setTimeout(() => dispatch({ type: 'SET_TAB', p: 'studio' }), 1000)
  }
  const handleRevisionFileUpload = (e) => {
    const file = e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => setRevisionInput(ev.target.result)
    reader.readAsText(file, 'utf-8')
  }

  const handleRevision = async () => {
    if (!apiKeys.claude || !revisionInput.trim() || !cuts.length) return
    setRevisionLoading(true)

    const currentScript = cuts.map(c =>
      `[CUT ${c.no}]\n씬: ${c.scene}\n액션: ${c.action}\n대사: ${c.dialogue || '없음'}\n나레이션: ${c.narration || ''}\n이미지 프롬프트: ${c.imagePrompt || ''}`
    ).join('\n\n')

    const prompt = `당신은 한국 유튜브 숏폼 대본 편집 전문가입니다.
아래는 현재 작성된 대본 전체입니다.

${YEORI_RULESET}

=== 현재 대본 ===
${currentScript}
=== 대본 끝 ===

아래 수정 요청을 처리해주세요:
"${revisionInput}"

수정 규칙:
1. 요청한 컷만 수정, 나머지는 그대로 유지
2. 수정된 컷은 반드시 아래 형식으로 출력 (그대로 파싱에 사용됨):
[CUT N]
씬: ...
액션: ...
캐릭터: 서여리
대사: ...
나레이션: ...
샷 타입: CLOSEUP 또는 FULLBODY
이미지 프롬프트: ...

3. 수정 안 된 컷은 출력하지 말 것
4. 마크다운 ** ## --- 절대 금지
5. 수정 완료 후 마지막에 한 줄: "=== 수정 완료 ===" 추가`

    try {
      const res = await claudeMessages(apiKeys.claude, {
        model: 'claude-sonnet-4-6',
        max_tokens: 4096,
        messages: [{ role: 'user', content: prompt }],
      })
      if (!res.ok) throw new Error('Claude API 오류')
      const data = await res.json()
      const raw = data.content[0].text

      const revisedCuts = parseCuts(raw, cuts.length)
      revisedCuts.forEach(revised => {
        const original = cuts.find(c => c.no === revised.no)
        if (original) {
          dispatch({ type: 'UPDATE_CUT', id: original.id, p: {
            scene: revised.scene || original.scene,
            action: revised.action || original.action,
            dialogue: revised.dialogue !== undefined ? revised.dialogue : original.dialogue,
            narration: revised.narration || original.narration,
            imagePrompt: revised.imagePrompt || original.imagePrompt,
            shotType: revised.shotType || original.shotType,
          }})
        }
      })

      setRevisionHistory(prev => [...prev, {
        id: Date.now(),
        request: revisionInput.slice(0, 40) + (revisionInput.length > 40 ? '…' : ''),
        ts: new Date().toLocaleTimeString('ko-KR'),
      }])
      setRevisionInput('')
    } catch (err) {
      alert('수정 실패: ' + err.message)
    } finally {
      setRevisionLoading(false)
    }
  }

  const g1Count = cuts.filter(c => gData[`cut_${c.no}`]?.g1).length
  const allG1Done = cuts.length > 0 && g1Count === cuts.length

  const handleCutCountChange = (n) => {
    const count = Math.max(1, Math.min(20, parseInt(n) || 7))
    dispatch({ type: 'RESET_CUTS', n: count })
  }

  const handlePipelineExport = async () => {
    if (!cuts.length) { alert('컷이 없습니다. 대본을 먼저 생성하세요.'); return }

    const promptsData = {
      episode: episode.number,
      title: episode.title,
      cuts: cuts.map(c => {
        const cut = { no: c.no, imagePrompt: c.imagePrompt || '' }
        if (c.narration?.trim()) cut.narration = c.narration.trim()
        if (c.dialogue?.trim() && !/^없음$/i.test(c.dialogue.trim())) cut.dialogue = c.dialogue.trim()
        cut.duration = c.duration || 5
        return cut
      }),
    }

    setFlowRunning(true)
    setFlowDone(false)
    setFlowLogs([{ type: 'info', message: 'prompts.json 저장 중…' }])

    try {
      const res = await fetch('http://localhost:3001/api/run-flow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ep: episode.number, prompts: promptsData }),
      })
      if (!res.ok) throw new Error(`서버 오류 ${res.status} — npm run proxy가 실행 중인지 확인하세요`)

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop()
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const ev = JSON.parse(line.slice(6))
            if (ev.type === 'saved') {
              setFlowLogs(prev => [...prev, { type: 'ok', message: '✅ prompts.json 저장 완료' }])
            } else if (ev.type === 'progress') {
              setFlowLogs(prev => [...prev, { type: 'progress', cutNo: ev.cutNo, message: `C${String(ev.cutNo).padStart(2,'0')} 생성 중… (${ev.current}/${ev.total})` }])
            } else if (ev.type === 'cut_done') {
              setFlowLogs(prev => {
                const next = [...prev]
                for (let j = next.length - 1; j >= 0; j--) {
                  if (next[j].cutNo === ev.cutNo && next[j].type === 'progress') {
                    next[j] = { type: 'done', cutNo: ev.cutNo, message: `✅ C${String(ev.cutNo).padStart(2,'0')} 완료 (${ev.current}/${ev.total})` }
                    break
                  }
                }
                return next
              })
            } else if (ev.type === 'cut_error') {
              setFlowLogs(prev => [...prev, { type: 'error', cutNo: ev.cutNo, message: `❌ C${String(ev.cutNo).padStart(2,'0')} 실패` }])
            } else if (ev.type === 'log' && ev.level === 'error') {
              setFlowLogs(prev => [...prev, { type: 'error', message: `⚠️ ${ev.message}` }])
            } else if (ev.type === 'error') {
              setFlowLogs(prev => [...prev, { type: 'error', message: `❌ ${ev.message}${ev.detail ? ` (${ev.detail})` : ''}` }])
            } else if (ev.type === 'complete') {
              setFlowRunning(false)
              setFlowDone(ev.success)
              if (!ev.success) {
                const reason = ev.reason ? ` — ${ev.reason}` : ''
                setFlowLogs(prev => [...prev, { type: 'error', message: `파이프라인 실패${reason} (code: ${ev.code ?? 'null'})` }])
              }
            }
          } catch {}
        }
      }
    } catch (err) {
      setFlowLogs(prev => [...prev, { type: 'error', message: `❌ ${err.message}` }])
      setFlowRunning(false)
    }
  }

  return (
    <div className={s.root}>
      {/* Left: Settings */}
      <div className={s.sidebar}>

        {/* 에피소드 설정 - 접기/펼치기 */}
        <div className={s.epSection}>
          <button className={s.epToggle} onClick={() => setEpisodeOpen(o => !o)}>
            <span className={s.sideTitle}>에피소드 설정</span>
            <span className={s.toggleIcon}>{episodeOpen ? '▲' : '▼'}</span>
          </button>
          {episodeOpen && (
            <div className={s.epBody}>
              <div className={s.field}>
                <label>에피소드 번호</label>
                <input
                  type="number" min="1" value={episode.number}
                  style={numError ? { borderColor: '#ef4444' } : {}}
                  onChange={e => {
                    const num = parseInt(e.target.value) || 1
                    const isDup = Object.values(episodes || {}).some(
                      ep => ep.id !== activeEpisodeId && ep.episode.number === num
                    )
                    if (isDup) {
                      setNumError(`EP${num}은 이미 사용 중입니다`)
                    } else {
                      setNumError('')
                      dispatch({ type: 'RENUMBER_EPISODE', id: activeEpisodeId, number: num })
                    }
                  }}
                />
                {numError && (
                  <div style={{ fontSize: 11, color: '#ef4444', marginTop: 3 }}>⚠️ {numError}</div>
                )}
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
                            const next = moodArr.filter(x => x !== m)
                            dispatch({ type: 'SET_EPISODE', p: { mood: next.length ? next : moodArr } })
                          } else {
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
            </div>
          )}
        </div>

        {/* 에피소드 목록 패널 */}
        <div className={s.epSection}>
          <button className={s.epToggle} onClick={() => setEpisodeListOpen(o => !o)}>
            <span className={s.sideTitle}>📋 에피소드 목록</span>
            <span className={s.toggleIcon}>{episodeListOpen ? '▲' : '▼'}</span>
          </button>
          {episodeListOpen && (
            <div className={s.epListBody}>
              {Object.values(episodes || {}).map(ep => {
                const epCuts = ep.cuts || []
                const epG1 = epCuts.filter(c => gData[`cut_${c.no}`]?.g1).length
                const epTotal = epCuts.length
                const epAllDone = epTotal > 0 && epG1 === epTotal
                const isActive = ep.id === activeEpisodeId
                return (
                  <div key={ep.id} className={`${s.epListItem} ${isActive ? s.epListItemActive : ''}`}>
                    <div className={s.epListHeader}
                      onClick={() => dispatch({ type: 'SWITCH_EPISODE', id: ep.id })}>
                      <span className={s.epListNum}>EP{ep.episode?.number}</span>
                      <span className={s.epListTitle}>{ep.episode?.title || '(제목 없음)'}</span>
                      {epAllDone && <span className={s.epG1Badge}>G1 ✅</span>}
                    </div>
                    {epTotal > 0 && (
                      <div className={s.epG1Bar}>
                        <div className={s.epG1BarTrack}>
                          <div className={s.epG1BarFill} style={{ width: `${(epG1/epTotal)*100}%` }} />
                        </div>
                        <span className={s.epG1Count}>{epG1}/{epTotal}</span>
                      </div>
                    )}
                    {isActive && epTotal > 0 && !epAllDone && (
                      <button className={s.epApproveBtn} onClick={approveAllG1}>
                        ✅ 전체 G1 승인
                      </button>
                    )}
                    {isActive && epAllDone && (
                      <button className={s.epApproveBtn} style={{background:'rgba(34,197,94,.2)',borderColor:'rgba(34,197,94,.4)',color:'#4ade80'}}
                        onClick={() => dispatch({ type: 'SET_TAB', p: 'studio' })}>
                        🎬 스튜디오 탭으로 →
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* 컷 목록 */}
        <div className={s.cutSection}>
          <div className={s.cutSectionTitle}>컷 목록</div>
          <div className={s.cutList}>
            {cuts.map((c, i) => (
              <button key={c.id} className={`${s.cutItem} ${activeCut === i ? s.cutActive : ''}`}
                onClick={() => setActiveCut(i)}>
                <span className={s.cutNo}>
                  CUT {c.no}
                  {c.cutType === 'SIGNATURE' && <span className={s.sigBadge}>✨ SIG</span>}
                  {gData[`cut_${c.no}`]?.g1 && <span className={s.g1Badge}>G1</span>}
                </span>
                <span className={s.cutPreview}>{c.dialogue || c.narration || c.scene || '(비어있음)'}</span>
              </button>
            ))}
          </div>
        </div>

        {/* 버튼 3개 하단 고정 */}
        <div className={s.sideBottom}>
          <button className={s.genBtn} onClick={generateScript} disabled={loading}>
            {loading ? (
              <><span className={s.spinner} />{progress || '생성 중...'}</>
            ) : '✨ Claude로 대본 생성'}
          </button>
          {progress && !loading && <div className={s.progressMsg}>{progress}</div>}
          <button
            className={`${s.exportBtn} ${flowRunning ? s.exportBtnRunning : ''}`}
            onClick={handlePipelineExport}
            disabled={flowRunning || !cuts.length}
          >
            {flowRunning
              ? <><span className={s.spinner} />Flow 실행 중…</>
              : '🚀 파이프라인 내보내기'}
          </button>
          {flowLogs.length > 0 && (
            <div className={s.flowLog}>
              {flowLogs.map((log, i) => (
                <div key={i} className={`${s.flowLogLine} ${s[`flowLog_${log.type}`] || ''}`}>
                  {log.message}
                </div>
              ))}
              {flowDone && <div className={s.flowComplete}>🎉 G3 이미지 생성 완료!</div>}
            </div>
          )}
        </div>

      </div>

      {/* Right: Editor */}
      <div className={s.editor}>
        {cuts.length > 0 && (
          <>
            <div className={s.editorHeader}>
              <h2>CUT {cuts[activeCut]?.no}</h2>
              <div style={{display:'flex', alignItems:'center', gap:8}}>
                {gData[`cut_${cuts[activeCut]?.no}`]?.g1 ? (
                  <button onClick={() => revokeG1(cuts[activeCut].no)}
                    style={{padding:'4px 10px',borderRadius:6,background:'rgba(34,197,94,.15)',
                      border:'1px solid rgba(34,197,94,.4)',color:'#4ade80',fontSize:11,fontWeight:700,cursor:'pointer'}}>
                    ✅ G1 승인됨 (취소)
                  </button>
                ) : (
                  <button onClick={() => approveG1(cuts[activeCut].no)}
                    style={{padding:'4px 10px',borderRadius:6,background:'rgba(167,139,250,.15)',
                      border:'1px solid rgba(167,139,250,.4)',color:'var(--accent-light)',fontSize:11,fontWeight:700,cursor:'pointer'}}>
                    ☑ G1 승인
                  </button>
                )}
                <div className={s.editorNav}>
                  <button disabled={activeCut === 0} onClick={() => setActiveCut(i => i - 1)}>◀ 이전</button>
                  <span>{activeCut + 1} / {cuts.length}</span>
                  <button disabled={activeCut === cuts.length - 1} onClick={() => setActiveCut(i => i + 1)}>다음 ▶</button>
                </div>
              </div>
            </div>

            <div className={s.fields}>
              {[
                { key: 'scene', label: '씬 헤딩', ph: 'INT. 카페 - 낮' },
                { key: 'action', label: '액션/지문', ph: '여리가 창가에 앉아 노트북을 연다.' },
                { key: 'character', label: '캐릭터', ph: '서여리' },
                { key: 'dialogue', label: '대사', ph: '오늘 여기서 처음 써보는 이야기야.' },
                { key: 'narration', label: '나레이션 (VO)', ph: '평범한 화요일 오후, 새로운 루틴이 시작된다.' },
              ].map(({ key, label, ph }) => (
                <div key={key} className={s.edField}>
                  <label>{label}</label>
                  {key === 'action' || key === 'narration' || key === 'dialogue' ? (
                    <textarea rows={2}
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
                <label>컷 타입</label>
                <div className={s.cutTypeBtns}>
                  {['NORMAL', 'SIGNATURE'].map(type => {
                    const active = (cuts[activeCut]?.cutType ?? 'NORMAL') === type
                    return (
                      <button key={type}
                        className={`${s.cutTypeBtn} ${active ? (type === 'SIGNATURE' ? s.cutTypeBtnSig : s.cutTypeBtnNormal) : ''}`}
                        onClick={() => updateCut(cuts[activeCut].id, 'cutType', type)}
                      >
                        {type === 'NORMAL' ? '⬜ NORMAL' : '✨ SIGNATURE'}
                      </button>
                    )
                  })}
                </div>
              </div>
              <div className={s.edField}>
                <label>이미지 프롬프트</label>
                <textarea rows={3}
                  placeholder="Young Korean woman at cafe window, cinematic, 4K"
                  value={cuts[activeCut]?.imagePrompt || ''}
                  onChange={e => updateCut(cuts[activeCut].id, 'imagePrompt', e.target.value)} />
              </div>
              <div className={s.edField}>
                <label>컷 길이 (초)</label>
                <input type="number" min="1" max="60" value={cuts[activeCut]?.duration || 5}
                  onChange={e => updateCut(cuts[activeCut].id, 'duration', parseInt(e.target.value) || 5)} />
              </div>
            </div>
          </>
        )}

        <div className={s.revisionPanel}>
          <div className={s.revisionTitle}>💬 Claude에게 수정 요청</div>

          <textarea
            className={s.revisionInput}
            rows={3}
            placeholder={"예) CUT 2 대사 더 가볍고 재미있게 수정해줘\n예) 전체 이미지 프롬프트에 골드 목걸이 디테일 추가해줘\n예) CUT 3 나레이션 감성적으로 다시 써줘"}
            value={revisionInput}
            onChange={e => setRevisionInput(e.target.value)}
          />

          <div className={s.revisionActions}>
            <label className={s.fileUploadBtn}>
              📄 텍스트 파일 업로드
              <input type="file" accept=".txt" hidden onChange={handleRevisionFileUpload} />
            </label>
            <button
              className={s.revisionSendBtn}
              onClick={handleRevision}
              disabled={revisionLoading || !revisionInput.trim() || !cuts.length}
            >
              {revisionLoading
                ? <><span className={s.spinner} />수정 중…</>
                : 'Claude에게 전송 →'}
            </button>
          </div>

          {revisionHistory.length > 0 && (
            <div className={s.revisionHistory}>
              <div className={s.revisionHistTitle}>수정 이력</div>
              {revisionHistory.map((h, i) => (
                <div key={h.id} className={s.revisionHistItem}>
                  <span className={s.revisionHistNum}>#{i+1}</span>
                  <span className={s.revisionHistReq}>{h.request}</span>
                  <span className={s.revisionHistStatus}>✅</span>
                </div>
              ))}
            </div>
          )}
        </div>

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
