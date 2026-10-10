// src/tabs/RetentionHookTab.jsx
// yeori-studio에 그대로 붙여넣기 가능한 파일
// 위치: src/tabs/RetentionHookTab.jsx

import { useState, useEffect, useMemo } from 'react'
import { useApp } from '../context/AppContext'
import EpisodeInfoSidebar from '../components/EpisodeInfoSidebar'
import TabToolbar from '../components/TabToolbar'
import styles from './RetentionHookTab.module.css'

const SERVER = 'http://localhost:3001'

// 2026-10-10 — 성준님: "롱폼의 경우 대본기획시 단계별 비트를 구성 컷에 반영하고, 그 내용이
// 리텐션 훅 탭과 연동이 되어야겠다." 각 훅 슬롯에 대응하는 BEAT 태그(ScriptGenTab.jsx의
// BEAT_CANON과 동일 어휘)를 매핑 — 시그는 "같은 성격"(성준님 표현)이라 피크 구간(mid2)·
// 클로징에 같이 연결해둔다.
const HOOK_CONFIG = [
  { key: 'opening', label: '오프닝 훅',    time: '0:00 ~ 0:30', color: '#534AB7', emotions: ['궁금증','충격','공감','호기심'],   placeholder: '질문 또는 갈등을 제시하세요...', beats: ['훅'] },
  { key: 'mid1',    label: '1차 리텐션 훅', time: '2분 ~ 3분',  color: '#0F6E56', emotions: ['반전','예고','긴장감','놀람'],     placeholder: '반전 또는 예고를 입력하세요...', beats: ['긴장', '반전'] },
  { key: 'mid2',    label: '2차 리텐션 훅', time: '6분 ~ 7분',  color: '#0F6E56', emotions: ['감동','공감','피크','울컥'],       placeholder: '감정 피크 순간을 입력하세요...', beats: ['고조', '시그'] },
  { key: 'closing', label: '클로징 CTA',    time: '마지막 2분', color: '#3B6D11', emotions: ['떡밥','예고','구독유도','기대감'], placeholder: '다음 화 예고 또는 구독 유도...', beats: ['결말', '시그'] },
]

export default function RetentionHookTab() {
  const { state, dispatch } = useApp()
  const [mode, setMode] = useState('hook')   // 'hook' | 'signature' — 2026-10-10 모드 전환 추가
  const [hooks, setHooks] = useState(
    Object.fromEntries(HOOK_CONFIG.map(h => [h.key, { text: '', emotions: [] }]))
  )
  const [loading, setLoading] = useState(false)
  const [result, setResult]   = useState('')
  const [error, setError]     = useState('')

  // 이 슬롯의 beats에 해당하는, 현재 에피소드 컷들(비트 태그 기준) — 리텐션 훅과 대본 비트 연동.
  const cutsByBeatSlot = useMemo(() => {
    const out = {}
    for (const h of HOOK_CONFIG) {
      out[h.key] = (state.cuts || []).filter((c) => h.beats.includes(c.beat))
    }
    return out
  }, [state.cuts])
  const importCutText = (key, cut) => {
    const t = [cut.dialogue, cut.narration, cut.scene].filter(Boolean)[0] || ''
    setHooks((prev) => ({ ...prev, [key]: { ...prev[key], text: prev[key].text ? `${prev[key].text}\n${t}` : t } }))
  }

  const updateText = (key, text) =>
    setHooks(prev => ({ ...prev, [key]: { ...prev[key], text } }))

  const toggleEmotion = (key, em) =>
    setHooks(prev => {
      const cur  = prev[key].emotions
      const next = cur.includes(em) ? cur.filter(e => e !== em) : [...cur, em]
      return { ...prev, [key]: { ...prev[key], emotions: next } }
    })

  const buildPrompt = () => {
    const hookSummary = HOOK_CONFIG.map(h => {
      const d = hooks[h.key]
      return `【${h.label} (${h.time})】\n핵심 문장: ${d.text || '(미입력)'}\n감정 키워드: ${d.emotions.join(', ') || '없음'}`
    }).join('\n\n')

    return `당신은 AI 버추얼 인플루언서 "서여리"의 유튜브 롱폼 대본 작가입니다.
서여리는 인플루언서 출신으로 일상 브이로그를 올리는 20대 여성 캐릭터입니다.
말투는 자연스럽고 친근하며, 감정이 솔직하게 드러납니다.

에피소드 제목: ${state.projectName || '(미입력)'}

아래 4구간 리텐션 훅 설계를 바탕으로, 각 구간에 삽입할 실제 대사(CUT 스크립트)를 작성하세요.
각 훅은 자연스러운 서여리 말투로, 2~4문장 분량으로 작성합니다.

${hookSummary}

출력 형식:
[오프닝 훅 CUT]
(대사)

[1차 리텐션 훅 CUT]
(대사)

[2차 리텐션 훅 CUT]
(대사)

[클로징 CTA CUT]
(대사)`
  }

  const generate = async () => {
    setLoading(true); setError(''); setResult('')
    try {
      const apiKey = state.apiKey || ''
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(apiKey ? { 'x-api-key': apiKey } : {}),
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 1000,
          messages: [{ role: 'user', content: buildPrompt() }],
        }),
      })
      const data = await res.json()
      setResult(data.content?.map(b => b.text || '').join('') || '')
    } catch (e) {
      setError('API 오류: ' + e.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className={styles.outer}>
      <TabToolbar />
    <div className={styles.page}>
      <EpisodeInfoSidebar maxStage={0} />
      <div className={styles.wrap}>
      <div className={`${styles.header} ${styles.topBar}`}>
        <h2 className={styles.title}>{mode === 'hook' ? '리텐션 훅 설계' : '✨ 시그 레퍼런스'}</h2>
        <p className={styles.desc}>
          {mode === 'hook'
            ? '4구간 훅을 설정하면 서여리 말투로 CUT 스크립트를 자동 생성합니다 — 대본의 BEAT 태그와 연동됩니다'
            : '몽환·절정 구간 연출 기법(시간멈춤·초근접·앵글반전 등)을 저장해두고, 시그 컷 프롬프트에 적용합니다'}
        </p>
        <div className={styles.modeToggle}>
          <button className={`${styles.modeBtn} ${mode === 'hook' ? styles.modeBtnActive : ''}`} onClick={() => setMode('hook')}>🎣 리텐션 훅</button>
          <button className={`${styles.modeBtn} ${mode === 'signature' ? styles.modeBtnActive : ''}`} onClick={() => setMode('signature')}>✨ 시그 레퍼런스</button>
        </div>
      </div>

      <div className={styles.scrollBody}>
      {mode === 'hook' && (<>
      <div className={styles.grid}>
        {HOOK_CONFIG.map(h => (
          <div key={h.key} className={styles.card} style={{ borderLeftColor: h.color }}>
            <div className={styles.cardLabel}>{h.label}</div>
            <div className={styles.cardTime}>{h.time}</div>
            {cutsByBeatSlot[h.key]?.length > 0 && (
              <div className={styles.linkedCuts}>
                <span className={styles.linkedCutsLabel}>연동된 컷 ({h.beats.join('·')})</span>
                {cutsByBeatSlot[h.key].map((cut) => (
                  <button key={cut.id} type="button" className={styles.linkedCutChip} title={cut.dialogue || cut.narration || cut.scene}
                    onClick={() => importCutText(h.key, cut)}>
                    CUT{cut.no} 가져오기 →
                  </button>
                ))}
              </div>
            )}
            <textarea
              className={styles.textarea}
              rows={3}
              placeholder={h.placeholder}
              value={hooks[h.key].text}
              onChange={e => updateText(h.key, e.target.value)}
            />
            <div className={styles.emotions}>
              {h.emotions.map(em => {
                const active = hooks[h.key].emotions.includes(em)
                return (
                  <span
                    key={em}
                    className={`${styles.tag} ${active ? styles.tagActive : ''}`}
                    style={active ? { background: h.color, color: '#fff' } : {}}
                    onClick={() => toggleEmotion(h.key, em)}
                  >{em}</span>
                )
              })}
            </div>
          </div>
        ))}
      </div>

      <button className={styles.genBtn} onClick={generate} disabled={loading}>
        {loading ? '생성 중...' : '훅 CUT 스크립트 자동 생성'}
      </button>

      {error && <div className={styles.error}>{error}</div>}

      {result && (
        <div className={styles.result}>
          <div className={styles.resultLabel}>생성된 훅 CUT 스크립트</div>
          <pre className={styles.resultText}>{result}</pre>
          <button className={styles.copyBtn} onClick={() => navigator.clipboard?.writeText(result)}>
            클립보드 복사
          </button>
        </div>
      )}
      </>)}

      {mode === 'signature' && <SignatureRefPanel state={state} dispatch={dispatch} />}
      </div>
      </div>
    </div>
    </div>
  )
}

// ── 시그 레퍼런스 패널(2026-10-10) ──────────────────────────────────────────
// 몽환+절정 구간용 연출 기법(시간멈춤·초근접·앵글반전 등)을 서버(signatureRefs.js)에
// 저장해두고, BEAT:시그 태그가 달린 컷에 CH/LOOK_ID/SP를 "적용"해 넣는다 — 원본 프롬프트를
// studio-state에서 직접 가공/수정반영(UPDATE_CUT)하는 역할. 리텐션 훅 탭 구성(카드 그리드 +
// 가공→생성→결과)을 그대로 재사용.
function SignatureRefPanel({ state, dispatch }) {
  const [refs, setRefs] = useState([])
  const [loading, setLoading] = useState(false)
  const [editing, setEditing] = useState(null)   // 새로 추가/수정 중인 레퍼런스 초안
  const [targetCutId, setTargetCutId] = useState('')
  const [selectedRefId, setSelectedRefId] = useState('')
  const [preview, setPreview] = useState(null)   // { snippet, sig }
  const [applyMsg, setApplyMsg] = useState('')

  const load = () => {
    setLoading(true)
    fetch(`${SERVER}/api/signature-refs`).then((r) => r.json())
      .then((d) => setRefs(d.signatures || [])).catch(() => {}).finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [])

  const sigCuts = (state.cuts || []).filter((c) => c.beat === '시그')
  const otherCuts = (state.cuts || []).filter((c) => c.beat !== '시그')

  const startNew = () => setEditing({ name: '', description: '', ch: '', lookId: '', sp: '', audioMotif: '' })
  const saveEditing = async () => {
    if (!editing?.name?.trim()) return
    await fetch(`${SERVER}/api/signature-refs`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: editing.name, description: editing.description,
        masterCodeTemplate: { ch: editing.ch, lookId: editing.lookId, sp: editing.sp },
        audioMotif: editing.audioMotif,
      }),
    })
    setEditing(null)
    load()
  }

  const doApply = async () => {
    if (!selectedRefId || !targetCutId) return
    setApplyMsg('')
    const r = await fetch(`${SERVER}/api/signature-refs/apply`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: selectedRefId }),
    })
    const d = await r.json()
    if (!r.ok) { setApplyMsg(`❌ ${d.error || '실패'}`); return }
    setPreview(d)
  }
  const commitApply = () => {
    const cut = (state.cuts || []).find((c) => c.id === targetCutId)
    if (!cut || !preview?.sig) return
    const t = preview.sig.masterCodeTemplate || {}
    dispatch({
      type: 'UPDATE_CUT', id: cut.id,
      p: { beat: '시그', masterCode: { ...(cut.masterCode || {}), ch: t.ch || cut.masterCode?.ch, lookId: t.lookId || cut.masterCode?.lookId, sp: t.sp || cut.masterCode?.sp } },
    })
    setApplyMsg(`✅ CUT${cut.no}에 반영 완료`)
    setPreview(null)
  }

  return (
    <>
      <div className={styles.grid}>
        {loading && <div className={styles.desc}>불러오는 중…</div>}
        {!loading && refs.length === 0 && <div className={styles.desc}>저장된 시그 레퍼런스가 없습니다 — 아래에서 추가하세요.</div>}
        {refs.map((ref) => (
          <div key={ref.id} className={styles.card} style={{ borderLeftColor: '#a78bfa' }}>
            <div className={styles.cardLabel}>{ref.name}</div>
            {ref.originEpisode && <div className={styles.cardTime}>출처: {ref.originEpisode} 컷{ref.originCutNo}</div>}
            <p style={{ fontSize: 12, color: '#aaa', margin: '6px 0' }}>{ref.description}</p>
            <div style={{ fontSize: 11, color: '#888', lineHeight: 1.6 }}>
              {ref.masterCodeTemplate?.ch && <div>CH: {ref.masterCodeTemplate.ch}</div>}
              {ref.masterCodeTemplate?.sp && <div>SP: {ref.masterCodeTemplate.sp}</div>}
              {ref.audioMotif && <div>오디오: {ref.audioMotif}</div>}
            </div>
          </div>
        ))}
        <div className={styles.card} style={{ borderLeftColor: '#555', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {editing ? (
            <div style={{ width: '100%' }}>
              <input className={styles.textarea} style={{ marginBottom: 6 }} placeholder="이름 (예: 모던 한복 클라이맥스)"
                value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
              <textarea className={styles.textarea} rows={2} placeholder="묘사 — 어떤 상황에 쓰는 기법인지"
                value={editing.description} onChange={(e) => setEditing({ ...editing, description: e.target.value })} />
              <input className={styles.textarea} style={{ marginBottom: 6 }} placeholder="CH (캐릭터/룩 코드)"
                value={editing.ch} onChange={(e) => setEditing({ ...editing, ch: e.target.value })} />
              <input className={styles.textarea} style={{ marginBottom: 6 }} placeholder="SP (공간 코드)"
                value={editing.sp} onChange={(e) => setEditing({ ...editing, sp: e.target.value })} />
              <input className={styles.textarea} style={{ marginBottom: 6 }} placeholder="오디오 모티프"
                value={editing.audioMotif} onChange={(e) => setEditing({ ...editing, audioMotif: e.target.value })} />
              <div style={{ display: 'flex', gap: 6 }}>
                <button className={styles.genBtn} onClick={saveEditing}>저장</button>
                <button className={styles.copyBtn} onClick={() => setEditing(null)}>취소</button>
              </div>
            </div>
          ) : (
            <button className={styles.genBtn} onClick={startNew}>+ 새 레퍼런스 추가</button>
          )}
        </div>
      </div>

      <div className={styles.result}>
        <div className={styles.resultLabel}>원본 프롬프트 가공 및 수정반영</div>
        <p className={styles.desc} style={{ marginBottom: 10 }}>
          시그 컷(BEAT:시그 태그된 컷)에 레퍼런스를 적용합니다 — 대본 작성 시 시그 컷이 미리
          반영돼 있어야 목록에 뜹니다.
        </p>
        <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
          <select className={styles.textarea} style={{ width: 'auto', minWidth: 220 }} value={targetCutId} onChange={(e) => setTargetCutId(e.target.value)}>
            <option value="">대상 컷 선택…</option>
            {sigCuts.length > 0 && <optgroup label="✨ 시그 태그된 컷">
              {sigCuts.map((c) => <option key={c.id} value={c.id}>CUT{c.no} — {(c.cutTitle || c.scene || '').slice(0, 30)}</option>)}
            </optgroup>}
            <optgroup label="기타 컷">
              {otherCuts.map((c) => <option key={c.id} value={c.id}>CUT{c.no} — {(c.cutTitle || c.scene || '').slice(0, 30)}</option>)}
            </optgroup>
          </select>
          <select className={styles.textarea} style={{ width: 'auto', minWidth: 220 }} value={selectedRefId} onChange={(e) => setSelectedRefId(e.target.value)}>
            <option value="">레퍼런스 선택…</option>
            {refs.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
          <button className={styles.genBtn} style={{ width: 'auto', padding: '8px 16px' }} disabled={!targetCutId || !selectedRefId} onClick={doApply}>가공해보기</button>
        </div>
        {preview && (
          <div style={{ fontSize: 12, color: '#c2c0b6', background: '#111', borderRadius: 6, padding: 10, marginBottom: 10 }}>
            <div style={{ color: '#888', marginBottom: 4 }}>적용될 내용:</div>
            <pre className={styles.resultText} style={{ marginBottom: 8 }}>{preview.snippet}</pre>
            <button className={styles.genBtn} onClick={commitApply}>이 컷에 반영</button>
          </div>
        )}
        {applyMsg && <div style={{ fontSize: 12, color: applyMsg.startsWith('✅') ? '#6ee7b7' : '#f09595' }}>{applyMsg}</div>}
      </div>
    </>
  )
}
