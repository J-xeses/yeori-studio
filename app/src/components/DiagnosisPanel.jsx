import { useState, useRef, useEffect, useCallback } from 'react'
import { useApp } from '../context/AppContext'
import { claudeMessages } from '../lib/api'
import s from './DiagnosisPanel.module.css'

// Field Gate(C:\yeori-genline\index.html)의 "AI 판단/진단 챗"을 스튜디오 안으로 옮긴 패널
// (2026-09-20, 로드맵 ①). Field Gate와 달리 "대본에 반영"이 핸드오프 큐를 거치지 않고 곧장
// UPDATE_CUT 으로 들어간다 — AppContext 가 보호 필드(duration/segments/…)의 override 를 자동으로
// 찍어주므로 자동화/옛 탭이 되돌리지 못한다. 세그 조합은 아래 parseSeg 로 8/10 조합만 통과시켜
// CUT3/5/7 clip 배열 사고(잘못된 segments 가 슬롯 수를 망가뜨림)가 재발하지 않게 한다.

const SEG_UNITS = [8, 10]
const VALID_SCRIPT_FIELDS = ['SC', 'SH', 'CA', 'MD', 'AC', 'DU', 'DL', 'NR', 'CP', 'SEG', 'CT', 'SP', 'PL', 'CH', 'LOOK_ID']

const SYSTEM = `당신은 서여리 채널의 이미지·영상 생성 결과 검토 도구입니다.
성준님이 Flow/힉스필드(Veo)로 만든 결과를 대본과 대조해, 무엇이 어긋났고 왜 그런지 진단하고
"바로 고칠 수 있는 안"을 제시합니다. 판정은 성준님 몫 — 당신은 근거와 선택지만 냅니다.

[생성기 특성]
- Flow·힉스필드는 프롬프트 "앞쪽"과 "반복된" 지시에 강하게 반응. 문장 중간 한 번뿐인 지시는 묻힘.
- Veo 3 생성단위는 8초 또는 10초 두 가지뿐. 컷을 몇 클립으로 나눌지 정할 때 항상 2클립(8+8, 8+10, 10+8, 10+10 = 16~20초)이
  되는지부터 확인하고, 안 커버되는 길이(21초 이상)일 때만 3클립으로 넘어갈 것. 트림(생성 합계 − 실제 DU)이 가장 적은 조합 우선.
- 대사(DL) 컷: Veo 가 한국어로 "말하도록" 생성 — 이후 음성만 추출해 서여리 음성으로 변환. 목소리 음색은 무시하고
  입모양·타이밍·발화 유무만 본다. NR(나레이션)은 인물이 말하지 않아야 정상.
- 발화 시점은 초 단위로 정확히 찍을 것. 대사를 다른 동작(이동·착석 등)과 겹쳐 쓰지 말 것.

[대화 이력] 이 컷에 대해 지금까지 오간 대화가 이어집니다. 성준님이 이미 결정한 것(클립 수, 초 배분, G2/G4 중 무엇을
만드는지)은 [컷] 블록의 정적 태그보다 대화에서 가장 최근에 확정된 내용이 우선입니다. 직전 합의를 되돌리지 마세요.

[출력] 아래 JSON 만. 마크다운/설명 금지. 줄바꿈은 \\n, 따옴표(")는 \\" 로 이스케이프(대사 인용도 예외 없음).
fixes 는 핵심만 간결하게(각 body 400자 이내 권장) — 응답이 잘리면 파싱이 깨집니다.
{
 "summaryLine": "한 줄 요약",
 "diag": [ {"k":"대본","t":"..."}, {"k":"결과","t":"...","miss":true}, {"k":"원인","t":"..."} ],
 "fixes": [
   {"ic":"✎","title":"IP 프롬프트에 반영 — ...","act":"ip","body":"<수정된 전체 이미지 프롬프트>"},
   {"ic":"🎬","title":"VP 프롬프트에 반영 — ...","act":"vp","body":"<수정된 전체 영상 프롬프트>"},
   {"ic":"↩","title":"대본 CUT N 에 반영 — ...","act":"script","body":"DU: 18\\nSEG: 10+8\\nDL: ..."},
   {"ic":"⧉","title":"재생성 프롬프트만 복사 — 대본 안 건드림","act":"copy","body":"<재생성용 프롬프트>"}
 ]
}
fixes 는 필요한 것만(최대 3개). act 는 ip / vp / script / copy 중 하나.

["script" body 규칙] 정해진 필드명만 한 줄씩 "필드명: 값" — SC, SH, CA, MD, AC, DU, DL, NR, CP, SEG, CT, SP, PL, CH, LOOK_ID.
CLIP A/B 같은 필드명을 지어내면 무시됩니다. 여러 클립 분할은 반드시 SEG: 10+8 처럼(8 또는 10의 조합, 2개 이상),
DU 는 트림 반영 실길이, DL/NR 은 그 컷 전체 원문 그대로(클립별로 쪼개지 말 것).`

// "10+8" → [10, 8]. 8/10 이외 값이 하나라도 있거나 2개 미만이면 null (적용 거부).
function parseSeg(raw) {
  const nums = String(raw || '').split(/[+,\s]+/).filter(Boolean).map(Number)
  if (nums.length < 2 || nums.some(n => !SEG_UNITS.includes(n))) return null
  return nums
}

// script body 를 필드별로 읽어 UPDATE_CUT 패치로 변환. 반환: { patch, notes[] }
export function scriptBodyToPatch(body) {
  const fields = {}
  let cur = null
  for (const line of String(body || '').split('\n')) {
    const m = line.match(/^\s*([A-Z_]+)\s*:\s*(.*)$/)
    if (m && VALID_SCRIPT_FIELDS.includes(m[1])) { cur = m[1]; fields[cur] = m[2] }
    else if (cur) fields[cur] += '\n' + line
  }
  const patch = {}, notes = []
  if (fields.SC != null) patch.scene = fields.SC.trim()
  if (fields.DL != null) patch.dialogue = fields.DL.trim()
  if (fields.NR != null) patch.narration = fields.NR.trim()
  if (fields.DU != null) {
    const du = parseFloat(fields.DU)
    if (du > 0) patch.duration = du; else notes.push(`DU "${fields.DU.trim()}" 는 숫자가 아니라 건너뜀`)
  }
  if (fields.SEG != null) {
    const seg = parseSeg(fields.SEG)
    if (seg) patch.segments = seg
    else notes.push(`SEG "${fields.SEG.trim()}" 는 8/10초 조합(2개 이상)이 아니라 건너뜀`)
  }
  const ignored = Object.keys(fields).filter(k => !['SC', 'DL', 'NR', 'DU', 'SEG'].includes(k))
  if (ignored.length) notes.push(`${ignored.join('/')} 는 이 패널에서 적용하지 않음(대본생성 탭에서 수정)`)
  return { patch, notes }
}

// 문자열 안의 날 줄바꿈/탭만 이스케이프해서 재파싱 (Claude 가 대사를 그대로 인용할 때 흔한 실패)
function parseLooseJson(text) {
  const slice = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)
  try { return JSON.parse(slice) } catch { /* fallthrough */ }
  let out = '', inStr = false, esc = false
  for (const c of slice) {
    if (inStr) {
      if (esc) { out += c; esc = false }
      else if (c === '\\') { out += c; esc = true }
      else if (c === '"') { inStr = false; out += c }
      else if (c === '\n') out += '\\n'
      else if (c === '\r') out += '\\r'
      else if (c === '\t') out += '\\t'
      else out += c
    } else { if (c === '"') inStr = true; out += c }
  }
  try { return JSON.parse(out) } catch { throw new Error('응답 형식 오류(JSON) — 입력을 더 짧게 나눠 다시 보내보세요.') }
}

const lsKey = (code, no) => `diag:${code || 'ep'}:cut${no}`
const loadThread = (k) => { try { return JSON.parse(localStorage.getItem(k) || '[]') } catch { return [] } }
const saveThread = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v.slice(-40))) } catch { /* 용량 초과 등 — 무시 */ } }

export default function DiagnosisPanel({ cut, episodeCode, stage = 'G4', onClose }) {
  const { state, dispatch } = useApp()
  const key = lsKey(episodeCode, cut.no)
  const [thread, setThread] = useState(() => loadThread(key))
  const [text, setText] = useState('')
  const [shot, setShot] = useState(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const endRef = useRef(null)

  useEffect(() => { setThread(loadThread(key)); setText(''); setShot(null); setNotice('') }, [key])
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }) }, [thread, busy])

  const commit = useCallback((next) => { setThread(next); saveThread(key, next) }, [key])

  const onPaste = (e) => {
    const item = [...(e.clipboardData?.items || [])].find(i => i.type.startsWith('image/'))
    if (!item) return
    e.preventDefault()
    const r = new FileReader()
    r.onload = () => setShot(r.result)
    r.readAsDataURL(item.getAsFile())
  }

  async function send() {
    const msg = text.trim()
    if (busy || (!msg && !shot)) return
    const apiKey = state.apiKeys?.claude
    if (!apiKey) { setNotice('Claude API 키가 없습니다 — 상단 API 바에서 입력하세요.'); return }
    const me = { role: 'me', id: Date.now(), text: msg, hasShot: !!shot }
    const withMe = [...thread, me]
    commit(withMe); setText(''); setBusy(true); setNotice('')
    const sentShot = shot; setShot(null)

    try {
      const prompt = stage === 'G4' ? (cut.videoPrompt || '') : (cut.imagePrompt || '')
      const info = `[컷] CUT ${cut.no} · ${cut.cutTitle || ''} · ${stage === 'G4' ? 'G4 영상' : 'G2 이미지'}
[SC] ${cut.scene || ''}
[DU] ${cut.duration || '?'}초${Array.isArray(cut.segments) ? ` · 현재 SEG ${cut.segments.join('+')}` : ''}
${cut.dialogue ? '[DL] ' + cut.dialogue + '\n' : ''}${cut.narration ? '[NR] ' + cut.narration + '\n' : ''}[쓴 프롬프트]
${prompt}

[성준님이 결과 보고 한 말]
${msg || '(이미지만 붙여넣음 — 결과를 보고 대본과 대조해줘)'}${sentShot ? '\n(결과 이미지 첨부됨)' : ''}`
      const content = sentShot
        ? [{ type: 'image', source: { type: 'base64', media_type: sentShot.split(';')[0].split(':')[1], data: sentShot.split(',')[1] } }, { type: 'text', text: info }]
        : info
      // 이전 턴을 멀티턴으로 전달 — 단발 호출이면 직전 합의를 되돌리는 버그가 있었음(Field Gate 2026-09-12)
      const history = []
      thread.forEach(m => {
        if (m.role === 'me') { const t = m.text || (m.hasShot ? '(결과 이미지 첨부됨)' : ''); if (t) history.push({ role: 'user', content: t }) }
        else if (m.role === 'ai') {
          const applied = (m.fixes || []).filter(f => f.applied).map(f => f.title).join(' / ')
          history.push({ role: 'assistant', content: (m.summaryLine || m.error || '진단함') + (applied ? `\n[성준님이 반영함: ${applied}]` : '') })
        }
      })
      const res = await claudeMessages(apiKey, {
        model: 'claude-sonnet-4-6', max_tokens: 3000, system: SYSTEM,
        messages: [...history, { role: 'user', content }],
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error?.message || `HTTP ${res.status}`)
      if (d.stop_reason === 'max_tokens') throw new Error('응답이 길어서 중간에 잘렸습니다 — 입력을 나눠서 다시 보내보세요.')
      const j = parseLooseJson((d.content || []).map(b => b.text || '').join(''))
      const ai = {
        role: 'ai', id: Date.now(), summaryLine: j.summaryLine || '결과와 대본을 대조했어요.',
        diag: (j.diag || []).map(x => ({ k: x.k, t: x.t, miss: !!x.miss })),
        fixes: (j.fixes || []).slice(0, 4).map(f => ({ ic: f.ic || '•', title: f.title || '', act: f.act || 'copy', body: f.body || '', applied: false })),
      }
      commit([...withMe, ai])
    } catch (e) {
      commit([...withMe, { role: 'ai', id: Date.now(), error: 'Claude 호출 실패: ' + e.message }])
    } finally { setBusy(false) }
  }

  function markApplied(aiId, fi, msg) {
    commit(loadThread(key).map(m => m.id === aiId ? { ...m, fixes: m.fixes.map((f, i) => i === fi ? { ...f, applied: true } : f) } : m))
    setNotice(msg)
  }

  function applyFix(m, fi) {
    const f = m.fixes[fi]
    if (f.act === 'copy') {
      navigator.clipboard?.writeText(f.body).catch(() => {})
      markApplied(m.id, fi, '재생성 프롬프트를 복사했습니다 (대본 그대로).')
    } else if (f.act === 'ip') {
      dispatch({ type: 'UPDATE_CUT', id: cut.id, p: { imagePrompt: f.body }, overrideReason: 'AI 진단 패널: IP 프롬프트 반영' })
      navigator.clipboard?.writeText(f.body).catch(() => {})
      markApplied(m.id, fi, 'IP 프롬프트를 컷에 반영했습니다 (클립보드에도 복사).')
    } else if (f.act === 'vp') {
      dispatch({ type: 'UPDATE_CUT', id: cut.id, p: { videoPrompt: f.body }, overrideReason: 'AI 진단 패널: VP 프롬프트 반영' })
      navigator.clipboard?.writeText(f.body).catch(() => {})
      markApplied(m.id, fi, 'VP 프롬프트를 컷에 반영했습니다 (클립보드에도 복사).')
    } else if (f.act === 'script') {
      const { patch, notes } = scriptBodyToPatch(f.body)
      if (!Object.keys(patch).length) { setNotice('적용할 수 있는 필드(SC/DU/DL/NR/SEG)가 없습니다. ' + notes.join(' · ')); return }
      dispatch({ type: 'UPDATE_CUT', id: cut.id, p: patch, overrideReason: 'AI 진단 패널: 대본 반영' })
      markApplied(m.id, fi, `대본 반영: ${Object.keys(patch).join(', ')}` + (notes.length ? ` — ${notes.join(' · ')}` : ''))
    }
  }

  function clearThread() {
    if (!thread.length) return
    // 복원할 입력이 있으면 미리보기를 확인창에 보여주고 지운다 (Field Gate 와 같은 안전장치)
    const lastMe = [...thread].reverse().find(m => m.role === 'me')?.text || ''
    const keep = text.trim() || lastMe
    if (!window.confirm(`이 컷의 진단 대화를 초기화할까요?\n입력창에 "${keep.slice(0, 60)}${keep.length > 60 ? '…' : ''}" 가 복원됩니다.`)) return
    commit([]); setText(keep)
  }

  return (
    <div className={s.overlay} onClick={onClose}>
      <div className={s.panel} onClick={e => e.stopPropagation()}>
        <div className={s.head}>
          <b>🔍 AI 진단 — CUT {String(cut.no).padStart(2, '0')}</b>
          <span className={s.chip}>{stage}</span>
          <span className={s.headSpacer} />
          <button className={s.btn} onClick={clearThread} disabled={!thread.length}>🧹 초기화</button>
          <button className={s.btn} onClick={onClose}>닫기</button>
        </div>

        <div className={s.thread}>
          {!thread.length && <div className={s.empty}>결과 화면을 붙여넣거나(Ctrl+V) 느낀 점을 적어 보내면, 대본·룰셋과 대조해 고칠 안을 제시합니다.</div>}
          {thread.map(m => m.role === 'me' ? (
            <div key={m.id} className={s.me}>{m.text || '(이미지만)'}{m.hasShot && <span className={s.shotTag}> 🖼 이미지 첨부</span>}</div>
          ) : m.error ? (
            <div key={m.id} className={s.err}>{m.error}</div>
          ) : (
            <div key={m.id} className={s.ai}>
              <div className={s.summary}>{m.summaryLine}</div>
              {m.diag.map((x, i) => <div key={i} className={`${s.diagRow} ${x.miss ? s.miss : ''}`}><b>{x.k}</b><span>{x.t}</span></div>)}
              {m.fixes.map((f, fi) => (
                <div key={fi} className={`${s.fix} ${f.applied ? s.fixDone : ''}`}>
                  <div className={s.fixTop}><span>{f.ic} {f.title}</span>
                    <button className={s.btn} disabled={f.applied} onClick={() => applyFix(m, fi)}>
                      {f.applied ? '반영됨 ✓' : f.act === 'copy' ? '복사' : '반영'}
                    </button>
                  </div>
                  <pre className={s.fixBody}>{f.body}</pre>
                </div>
              ))}
            </div>
          ))}
          {busy && <div className={s.thinking}>대본·룰셋과 대조 중…</div>}
          <div ref={endRef} />
        </div>

        {notice && <div className={s.notice}>{notice}</div>}
        {shot && <div className={s.shotPreview}><img src={shot} alt="붙여넣은 결과" /><button className={s.btn} onClick={() => setShot(null)}>제거</button></div>}
        <div className={s.composer}>
          <textarea value={text} onChange={e => setText(e.target.value)} onPaste={onPaste}
            onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send() } }}
            placeholder="결과에서 느낀 점 / 연출 방향 (Ctrl+Enter 전송, 이미지는 Ctrl+V)" rows={3} />
          <button className={s.send} onClick={send} disabled={busy || (!text.trim() && !shot)}>{busy ? '…' : '보내기'}</button>
        </div>
      </div>
    </div>
  )
}
