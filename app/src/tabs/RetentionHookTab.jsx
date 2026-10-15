// src/tabs/RetentionHookTab.jsx
// yeori-studio에 그대로 붙여넣기 가능한 파일
// 위치: src/tabs/RetentionHookTab.jsx

import { useState, useEffect, useMemo } from 'react'
import { useApp } from '../context/AppContext'
import EpisodeInfoSidebar from '../components/EpisodeInfoSidebar'
import TabToolbar from '../components/TabToolbar'
import { claudeMessages } from '../lib/api'
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
  const [mode, setMode] = useState('hook')   // 'hook' | 'signature' | 'change' — 2026-10-10/11 모드 전환
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
    // 2026-10-13 수정 — 브라우저에서 api.anthropic.com 직접 호출(CORS·키 노출 위험,
    // state.apiKey라는 실제로 어디에도 연결 안 된 유령 필드 참조) 때문에 "Failed to
    // fetch"로 항상 실패하던 버그. ScriptGenTab.jsx의 generateScript()와 동일하게
    // claudeMessages() 헬퍼(서버 프록시 경유) + apiKeys.claude로 교체.
    if (!state.apiKeys?.claude) { setError('Claude API 키를 입력하세요 (상단 API 바)'); return }
    setLoading(true); setError(''); setResult('')
    try {
      const res = await claudeMessages(state.apiKeys.claude, {
        model: 'claude-sonnet-4-6',
        max_tokens: 1000,
        messages: [{ role: 'user', content: buildPrompt() }],
      })
      if (!res.ok) { const e = await res.json(); throw new Error(e.error?.message || '오류') }
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
        <h2 className={styles.title}>{mode === 'hook' ? '리텐션 훅 설계' : mode === 'signature' ? '✨ 시그 레퍼런스' : mode === 'freeze' ? '🧊 프리즈 비트 생성기' : '🔄 체인지 조합 생성기'}</h2>
        <p className={styles.desc}>
          {mode === 'hook'
            ? '4구간 훅을 설정하면 서여리 말투로 CUT 스크립트를 자동 생성합니다 — 대본의 BEAT 태그와 연동됩니다'
            : mode === 'signature'
            ? '몽환·절정 구간 연출 기법(시간멈춤·초근접·앵글반전 등)을 저장해두고, 시그 컷 프롬프트에 적용합니다'
            : mode === 'change'
            ? '트리거 액션×VFX×Scene B 조합으로 리빌 컷 하나(IP/VP/오디오)를 생성합니다 — 같은 구도 고정 + 별도 컷 생성 원칙(R07 패턴)'
            : '빠르게 움직이다가 돌발상황이 터지는 순간 시간이 멈추고 카메라만 도는 컷을 생성합니다 — 의상/배경 변화 없이 "사건"만 얼어붙습니다'}
        </p>
        <div className={styles.modeToggle}>
          <button className={`${styles.modeBtn} ${mode === 'hook' ? styles.modeBtnActive : ''}`} onClick={() => setMode('hook')}>🎣 리텐션 훅</button>
          <button className={`${styles.modeBtn} ${mode === 'signature' ? styles.modeBtnActive : ''}`} onClick={() => setMode('signature')}>✨ 시그 레퍼런스</button>
          <button className={`${styles.modeBtn} ${mode === 'change' ? styles.modeBtnActive : ''}`} onClick={() => setMode('change')}>🔄 체인지 생성기</button>
          <button className={`${styles.modeBtn} ${mode === 'freeze' ? styles.modeBtnActive : ''}`} onClick={() => setMode('freeze')}>🧊 프리즈 비트</button>
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
      {mode === 'change' && <ChangeComboPanel state={state} dispatch={dispatch} />}
      {mode === 'freeze' && <FreezeBeatPanel state={state} dispatch={dispatch} />}
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
// 2026-10-13 — 성준님 피드백("레퍼런스 1개뿐이고 새 레퍼런스는 백지상태 작성 구조라 시그
// 영상 효과·기법에 대한 설정/선택지가 없다") 1차 반영: app/docs/direction-material-bank.md의
// ①(AI만 할 수 있는 '불가능한 비주얼')·③(채널 고유 시그널) 카탈로그 중 이미 구체적으로
// 문서화된 기법들을 선택 가능한 출발점으로 제공 — 클릭하면 "새 레퍼런스 추가" 폼을
// 채워주고, 그 상태에서 자유롭게 수정 후 저장하면 된다(완전 백지 아님, 완전 고정도 아님).
const SIGNATURE_TECHNIQUE_PRESETS = [
  {
    name: '수중/반수면 초근접 포트레이트',
    description: '얼굴이 물에 반쯤 잠긴 채 수면 굴절·물방울·기포 속에서 눈빛만 또렷 — 2026-10-12 인스타 레퍼런스 발견, 체인지 리빌(water_emerge 트리거)·시그·감정비트 3갈래로 쓸 수 있음(연출 재료 창고 ①)',
    ch: 'half-submerged underwater portrait, face breaking the water surface, light caustics rippling across skin, scattered air bubbles, keep eyes and eye color sharply in focus as the one clear anchor, rest of face softly distorted by water refraction',
    sp: 'OT.POOL.DY.LT_RAIN (또는 꿈-세계 물가)',
    audioMotif: '물속 기포 소리 + 수면 깨지는 소리(트리거)',
  },
  {
    name: '단색 스튜디오 강렬 대비',
    description: '배경·바닥·소품까지 전부 한 가지 강렬한 솔리드 컬러로 통일하고 고대비 소재 의상 하나만 얹는 컬러 블로킹 — 체인지 "After" 리빌처럼 극적 전환 장면에 적합(연출 재료 창고, 2026-10-12 kirin.cookie 레퍼런스)',
    ch: 'glossy black leather trench coat, high black boots, vintage red accessory, standing in a solid red studio',
    sp: 'IN.STUDIO.NT.LT_DRAMA (배경·바닥 전부 솔리드 컬러 통일)',
    audioMotif: '충격파 베이스 드롭 + 완전한 정적 뒤 울림',
  },
  {
    name: '무중력 / 공중부양',
    description: '중력을 무시하는 연출 — 머리카락·옷자락이 떠다니는 무중력 상태, 또는 역재생 낙하. 실사 크리에이터는 물리적으로 못 하는 "AI만 할 수 있는 연출"(연출 재료 창고 ①)',
    ch: 'suspended weightlessly, hair and fabric drifting in zero gravity, floating naturally as if weightless',
    sp: 'OT.SPACE.NT.LT_STAR (또는 꿈-세계 무중력 공간)',
    audioMotif: '신스 패드로 웅장하게 확장 + 반짝이는 차임',
  },
  {
    name: '멀티 서여리 (한 프레임 다중 등장)',
    description: '같은 인물이 한 프레임에 여러 명 등장 — 지아·지유 등 캐릭터 레지스트리 구조를 서여리 자신에게 확장 적용하면 기술적 기반 있음(연출 재료 창고 ①)',
    ch: '(미완성 — 동일 인물 2~3명이 한 프레임에 서로 다른 포즈로 등장, 합성 방식 설계 필요)',
    sp: '',
    audioMotif: '',
  },
]

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
      {/* 2026-10-13 — 체인지 생성기와 동일한 "섹션헤더(열)+섹션헤더(열), 각각 아래로 전개"
          구조. 프리셋(시작점)과 저장된 레퍼런스(기존 자산)를 나란히 두 열로 비교하며 고름. */}
      <div className={styles.columns}>
        <div className={styles.column}>
          <div className={styles.columnHeader}>연출 재료 창고 — 시작점 고르기</div>
          <div className={styles.columnList}>
            {SIGNATURE_TECHNIQUE_PRESETS.map((p) => (
              <div key={p.name} className={styles.columnItem}
                onClick={() => setEditing({ name: p.name, description: p.description, ch: p.ch, lookId: '', sp: p.sp, audioMotif: p.audioMotif })}>
                <div className={styles.columnItemLabel}>{p.name}</div>
                <div className={styles.columnItemDesc}>{p.description}</div>
              </div>
            ))}
          </div>
          <div className={styles.desc} style={{ marginTop: 8, fontSize: 10.5 }}>클릭하면 오른쪽 아래 폼을 채워줍니다 — 자유 수정 가능.</div>
        </div>

        <div className={styles.column}>
          <div className={styles.columnHeader}>저장된 시그 레퍼런스</div>
          <div className={styles.columnList}>
            {loading && <div className={styles.desc}>불러오는 중…</div>}
            {!loading && refs.length === 0 && <div className={styles.desc}>아직 없습니다.</div>}
            {refs.map((ref) => (
              <div key={ref.id} className={styles.columnItem} style={{ cursor: 'default' }}>
                <div className={styles.columnItemLabel}>{ref.name}</div>
                {ref.originEpisode && <div className={styles.columnItemDesc}>출처: {ref.originEpisode} 컷{ref.originCutNo}</div>}
                <div className={styles.columnItemDesc}>{ref.description}</div>
                <div style={{ fontSize: 10.5, color: '#888', lineHeight: 1.6, marginTop: 4 }}>
                  {ref.masterCodeTemplate?.ch && <div>CH: {ref.masterCodeTemplate.ch.slice(0, 50)}{ref.masterCodeTemplate.ch.length > 50 ? '…' : ''}</div>}
                  {ref.masterCodeTemplate?.sp && <div>SP: {ref.masterCodeTemplate.sp}</div>}
                </div>
              </div>
            ))}
          </div>
          {editing ? (
            <div style={{ marginTop: 6 }}>
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
                <button className={styles.genBtn} style={{ marginBottom: 0 }} onClick={saveEditing}>저장</button>
                <button className={styles.copyBtn} onClick={() => setEditing(null)}>취소</button>
              </div>
            </div>
          ) : (
            <button type="button" className={styles.columnAddBtn} style={{ marginTop: 6 }} onClick={startNew}>+ 새 레퍼런스 추가</button>
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

// ── 체인지 조합 생성기(2026-10-11) ────────────────────────────────────────
// 트리거 액션×VFX×Scene B 조합으로 "리빌 컷 하나"의 IP/VP/CP/오디오를 생성해 기존 컷에
// 반영한다. 원본 도구(Instagram Change Effect Prompt Studio)처럼 한 샷 안에서 의상+배경을
// 통째로 모핑시키지 않는다 — 실측(2026-10-11, Veo)에서 그 방식은 얼굴 identity가 끝까지
// 안 붙잡혔다. 대신 이 컷의 시작 이미지(G2)가 이미 Scene B 모습이라는 전제로 VP는 "트리거
// 동작이 시작→VFX 걷힘→완성 포즈"만 담당(R07 CUT2와 동일 로직) — 반영 후 기존 G2(Nano
// Banana, 캐릭터 얼굴 레퍼런스 자동 첨부)를 돌리면 identity 문제가 자연히 해결된다.
function ChangeComboPanel({ state, dispatch }) {
  const [options, setOptions] = useState({ triggers: [], vfx: [], sceneBFashionPresets: [] })
  const [triggerId, setTriggerId] = useState('')
  const [vfxIndex, setVfxIndex] = useState(null)
  const [sceneB, setSceneB] = useState({ outfit: '', env: '', lighting: '', outfitEn: '', envEn: '', lightingEn: '' })
  // 2026-10-15: IP(시작 이미지)가 sceneB("후" 모습)를 그리면 Veo가 시작 프레임에 고정돼 트리거
  // 동작(AC)이 전혀 재현 안 된다는 게 실측으로 밝혀져(IG_R08 CUT4) IP는 항상 "전" 모습을 그리게
  // 바꿨다 — sceneA는 선택 입력, 비우면 서버가 범용 문구로 대체(changeEffects.js 참고).
  const [sceneA, setSceneA] = useState({ poseKo: '', poseEn: '', envEn: '', lightingEn: '' })
  const [durationSec, setDurationSec] = useState(6)
  const [beat, setBeat] = useState('고조')
  const [cpLine, setCpLine] = useState('')
  const [targetCutId, setTargetCutId] = useState('')
  const [buildResult, setBuildResult] = useState(null)   // { cutPatch, preview, audioCue }
  const [buildError, setBuildError] = useState('')
  const [applyMsg, setApplyMsg] = useState('')
  const [lkSpace, setLkSpace] = useState('IN')
  const [lkSeason, setLkSeason] = useState('CH')
  const [registerMsg, setRegisterMsg] = useState('')
  // 2026-10-13 — 성준님 피드백("효과별 조합 매트릭스와 확장성이 안 보여서 연출방법이 이미
  // 뻔한 범위에 머물러 있게 된다") 1차 반영: 트리거/VFX를 코드 수정 없이 화면에서 바로
  // 추가할 수 있게 함(server/lib/customChangePresets.js, custom:true로 내장과 구분).
  const [newTrigger, setNewTrigger] = useState(null)
  const [newVfx, setNewVfx] = useState(null)

  const loadOptions = () => fetch(`${SERVER}/api/change-combo/options`).then((r) => r.json()).then(setOptions).catch(() => {})
  useEffect(() => { loadOptions() }, [])

  const addTrigger = async () => {
    if (!newTrigger?.nameKo?.trim() || !newTrigger?.en?.trim()) return
    await fetch(`${SERVER}/api/change-combo/custom-trigger`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newTrigger),
    })
    setNewTrigger(null)
    loadOptions()
  }
  const addVfx = async () => {
    if (!newVfx?.nameKo?.trim() || !newVfx?.en?.trim()) return
    await fetch(`${SERVER}/api/change-combo/custom-vfx`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newVfx),
    })
    setNewVfx(null)
    loadOptions()
  }

  const pickRandom = () => {
    if (!options.triggers.length) return
    const t = options.triggers[Math.floor(Math.random() * options.triggers.length)]
    const v = Math.floor(Math.random() * options.vfx.length)
    const s = options.sceneBFashionPresets[Math.floor(Math.random() * options.sceneBFashionPresets.length)] || sceneB
    setTriggerId(t.id); setVfxIndex(v); setSceneB(s)
    setBuildResult(null); setBuildError('')
  }

  const doBuild = async () => {
    setBuildError(''); setApplyMsg('')
    if (!triggerId || vfxIndex == null || !sceneB.outfit) { setBuildError('트리거·VFX·Scene B(의상)를 먼저 채워주세요.'); return }
    if (!sceneB.outfitEn || !sceneB.envEn || !sceneB.lightingEn) { setBuildError('Scene B의 영문 설명(의상/배경/조명)도 채워주세요 — 이미지·영상 프롬프트는 전부 영문이어야 합니다.'); return }
    const r = await fetch(`${SERVER}/api/change-combo/build`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ triggerId, vfxIndex, sceneA, sceneB, durationSec, beat, cpLine }),
    })
    const d = await r.json()
    if (!r.ok) { setBuildError(d.error || '생성 실패'); return }
    setBuildResult(d)
  }

  const commitApply = () => {
    const cut = (state.cuts || []).find((c) => c.id === targetCutId)
    if (!cut || !buildResult?.cutPatch) return
    dispatch({ type: 'UPDATE_CUT', id: cut.id, p: buildResult.cutPatch })
    setApplyMsg(`✅ CUT${cut.no}에 반영 완료 — G2(이미지 생성)를 돌리면 캐릭터 얼굴 레퍼런스가 자동 첨부됩니다.`)
  }

  // CA_BANK 룩 등록(2026-10-11, 성준님 설계 LK_{공간}_{계절}{번호}) — file은 아직 없을 수
  // 있음(G2 생성 전이면 CA_BANK 화면에서 나중에 채움). server/lib/changeEffects.js nextLookId 참조.
  const registerLook = async () => {
    if (!sceneB.outfit) return
    setRegisterMsg('')
    const r = await fetch(`${SERVER}/api/characters/yeori/looks`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ spaceCode: lkSpace, seasonCode: lkSeason, desc: sceneB.outfit, season: options.lkSeasonCodes?.[lkSeason] || '' }),
    })
    const d = await r.json()
    if (!r.ok) { setRegisterMsg(`❌ ${d.error || '등록 실패'}`); return }
    setRegisterMsg(`✅ ${d.lookId}로 등록 완료 (characters.json) — 이미지 파일은 CA_BANK에서 나중에 연결하세요.`)
  }

  return (
    <>
      <div className={styles.result} style={{ marginBottom: 14 }}>
        {/* 2026-10-13 — 성준님 설계: 섹션헤더(열)+섹션헤더(열)+섹션헤더(열), 각각 아래로
            전개. 트리거×VFX×Scene B를 3열 칸반으로 나란히 세워서 조합을 한눈에 비교. */}
        <div className={styles.columns}>
          <div className={styles.column}>
            <div className={styles.columnHeader}>① 트리거 액션</div>
            <div className={styles.columnList}>
              {options.triggers.map((t) => (
                <div key={t.id} className={`${styles.columnItem} ${triggerId === t.id ? styles.columnItemActive : ''}`}
                  onClick={() => { setTriggerId(t.id); setBuildResult(null) }}>
                  <div className={styles.columnItemLabel}>{t.icon} {t.nameKo}</div>
                  <div className={styles.columnItemDesc}>{t.descKo}</div>
                  {t.custom && <div className={styles.columnItemBadge}>커스텀</div>}
                </div>
              ))}
            </div>
            {newTrigger ? (
              <div style={{ marginTop: 6 }}>
                <input className={styles.textarea} style={{ marginBottom: 4, fontSize: 11 }} placeholder="이름 (예: 눈물 자국 와이프)"
                  value={newTrigger.nameKo} onChange={(e) => setNewTrigger({ ...newTrigger, nameKo: e.target.value })} />
                <input className={styles.textarea} style={{ marginBottom: 4, fontSize: 11 }} placeholder="한글 설명(선택)"
                  value={newTrigger.descKo || ''} onChange={(e) => setNewTrigger({ ...newTrigger, descKo: e.target.value })} />
                <input className={styles.textarea} style={{ marginBottom: 4, fontSize: 11 }} placeholder="영문 트리거 묘사 (VP에 들어갈 동작 텍스트)"
                  value={newTrigger.en || ''} onChange={(e) => setNewTrigger({ ...newTrigger, en: e.target.value })} />
                <div style={{ display: 'flex', gap: 4 }}>
                  <button className={styles.genBtn} style={{ padding: '4px 8px', fontSize: 11, marginBottom: 0 }} onClick={addTrigger}>저장</button>
                  <button className={styles.copyBtn} onClick={() => setNewTrigger(null)}>취소</button>
                </div>
              </div>
            ) : (
              <button type="button" className={styles.columnAddBtn} style={{ marginTop: 6 }}
                onClick={() => setNewTrigger({ nameKo: '', descKo: '', en: '', icon: '✨' })}>+ 새 트리거 추가</button>
            )}
          </div>

          <div className={styles.column}>
            <div className={styles.columnHeader}>② VFX 이펙트</div>
            <div className={styles.columnList}>
              {options.vfx.map((v, idx) => (
                <div key={idx} className={`${styles.columnItem} ${vfxIndex === idx ? styles.columnItemActive : ''}`}
                  onClick={() => { setVfxIndex(idx); setBuildResult(null) }}>
                  <div className={styles.columnItemLabel}>{v.nameKo}</div>
                  {v.custom && <div className={styles.columnItemBadge}>커스텀</div>}
                </div>
              ))}
            </div>
            {newVfx ? (
              <div style={{ marginTop: 6 }}>
                <input className={styles.textarea} style={{ marginBottom: 4, fontSize: 11 }} placeholder="이름 (예: 빗방울 리플 디졸브)"
                  value={newVfx.nameKo} onChange={(e) => setNewVfx({ ...newVfx, nameKo: e.target.value })} />
                <input className={styles.textarea} style={{ marginBottom: 4, fontSize: 11 }} placeholder="영문 VFX 묘사"
                  value={newVfx.en || ''} onChange={(e) => setNewVfx({ ...newVfx, en: e.target.value })} />
                <div style={{ display: 'flex', gap: 4 }}>
                  <button className={styles.genBtn} style={{ padding: '4px 8px', fontSize: 11, marginBottom: 0 }} onClick={addVfx}>저장</button>
                  <button className={styles.copyBtn} onClick={() => setNewVfx(null)}>취소</button>
                </div>
              </div>
            ) : (
              <button type="button" className={styles.columnAddBtn} style={{ marginTop: 6 }}
                onClick={() => setNewVfx({ nameKo: '', en: '' })}>+ 새 VFX 추가</button>
            )}
          </div>

          <div className={styles.column}>
            <div className={styles.columnHeader}>③ Scene B — 리빌될 모습</div>
            <div className={styles.columnList}>
              {options.sceneBFashionPresets.map((p, idx) => (
                <div key={idx} className={styles.columnItem}
                  onClick={() => { setSceneB(p); setBuildResult(null) }}>
                  <div className={styles.columnItemLabel}>{p.outfit.slice(0, 20)}…</div>
                  <div className={styles.columnItemDesc}>{p.env.slice(0, 26)}…</div>
                </div>
              ))}
            </div>
            <div className={styles.desc} style={{ marginTop: 8, fontSize: 10.5 }}>프리셋을 클릭해 채우거나, 아래 입력란에 직접 입력하세요.</div>
          </div>
        </div>

        {/* 2026-10-15 — "쪼개는 기준": 시작 이미지(IP)는 항상 변신 "전" 모습을 그리고, 영상
            프롬프트(VP)가 트리거→VFX→리빌 전체를 책임진다. IP가 "후" 모습(sceneB)을 그리면
            Veo가 시작 프레임에 고정돼 트리거 동작 자체가 영상에 전혀 안 나온다(IG_R08 CUT4 실측:
            "회중시계 감고 연기 피어오르는 장면 없이 애초에 변신의상으로 등장"). Scene A는 비워도
            되고, 비우면 서버가 "트리거 동작 중, 평소 모습" 범용 문구로 채운다. */}
        <div className={styles.desc} style={{ fontSize: 10.5, marginBottom: 4, color: '#f0a050' }}>
          ↓ Scene A — 변신 "전" 모습(선택) · 시작 이미지(IP)는 항상 이쪽을 그립니다
        </div>
        <input className={styles.textarea} style={{ marginBottom: 6 }} placeholder="전 모습 포즈/동작 (한글, 선택 — 예: 회중시계 태엽을 감는 중)"
          value={sceneA.poseKo} onChange={(e) => { setSceneA({ ...sceneA, poseKo: e.target.value }); setBuildResult(null) }} />
        <input className={styles.textarea} style={{ marginBottom: 6 }} placeholder="Pose/action before the change, in English (optional)"
          value={sceneA.poseEn} onChange={(e) => { setSceneA({ ...sceneA, poseEn: e.target.value }); setBuildResult(null) }} />
        <input className={styles.textarea} style={{ marginBottom: 6 }} placeholder="Environment before the change, in English (optional)"
          value={sceneA.envEn} onChange={(e) => { setSceneA({ ...sceneA, envEn: e.target.value }); setBuildResult(null) }} />
        <input className={styles.textarea} style={{ marginBottom: 10 }} placeholder="Lighting before the change, in English (optional)"
          value={sceneA.lightingEn} onChange={(e) => { setSceneA({ ...sceneA, lightingEn: e.target.value }); setBuildResult(null) }} />

        <div className={styles.desc} style={{ fontSize: 10.5, marginBottom: 4 }}>↓ Scene B — 변신 "후" 모습 · 영상 프롬프트(VP)의 리빌 구간에만 쓰입니다</div>
        <input className={styles.textarea} style={{ marginBottom: 6 }} placeholder="의상 (필수, 한글 — 화면 설명용)"
          value={sceneB.outfit} onChange={(e) => { setSceneB({ ...sceneB, outfit: e.target.value }); setBuildResult(null) }} />
        <input className={styles.textarea} style={{ marginBottom: 6 }} placeholder="배경/환경 (한글 — 화면 설명용)"
          value={sceneB.env} onChange={(e) => { setSceneB({ ...sceneB, env: e.target.value }); setBuildResult(null) }} />
        <input className={styles.textarea} style={{ marginBottom: 10 }} placeholder="조명 (한글 — 화면 설명용)"
          value={sceneB.lighting} onChange={(e) => { setSceneB({ ...sceneB, lighting: e.target.value }); setBuildResult(null) }} />
        {/* 2026-10-14: 이미지·영상 프롬프트(IP/VP)는 전부 영문이어야 하는데, 위 한글 입력을
            그대로 꽂아 넣었더니 영문 프롬프트 한가운데 한글이 섞이는 버그가 있었다(IG_R08 CUT2
            실측). 프리셋을 고르면 자동으로 채워지고, 직접 입력할 때도 영문은 따로 받는다. */}
        <div className={styles.desc} style={{ fontSize: 10.5, marginBottom: 4 }}>↓ 실제 이미지·영상 프롬프트에 들어가는 영문 설명(필수)</div>
        <input className={styles.textarea} style={{ marginBottom: 6 }} placeholder="Outfit in English (required)"
          value={sceneB.outfitEn} onChange={(e) => { setSceneB({ ...sceneB, outfitEn: e.target.value }); setBuildResult(null) }} />
        <input className={styles.textarea} style={{ marginBottom: 6 }} placeholder="Environment in English"
          value={sceneB.envEn} onChange={(e) => { setSceneB({ ...sceneB, envEn: e.target.value }); setBuildResult(null) }} />
        <input className={styles.textarea} style={{ marginBottom: 10 }} placeholder="Lighting in English"
          value={sceneB.lightingEn} onChange={(e) => { setSceneB({ ...sceneB, lightingEn: e.target.value }); setBuildResult(null) }} />

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
          <label style={{ fontSize: 11, color: '#888' }}>CA_BANK 룩 코드</label>
          <select className={styles.textarea} style={{ width: 'auto' }} value={lkSpace} onChange={(e) => setLkSpace(e.target.value)}>
            {Object.entries(options.lkSpaceCodes || {}).map(([k, v]) => <option key={k} value={k}>{k} — {v}</option>)}
          </select>
          <select className={styles.textarea} style={{ width: 'auto' }} value={lkSeason} onChange={(e) => setLkSeason(e.target.value)}>
            {Object.entries(options.lkSeasonCodes || {}).map(([k, v]) => <option key={k} value={k}>{k} — {v}</option>)}
          </select>
          <button className={styles.copyBtn} disabled={!sceneB.outfit} onClick={registerLook}>🗂 캐릭터 룩으로 등록</button>
          {registerMsg && <span style={{ fontSize: 11, color: registerMsg.startsWith('✅') ? '#6ee7b7' : '#f09595' }}>{registerMsg}</span>}
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
          <label style={{ fontSize: 11, color: '#888' }}>컷 길이(초)</label>
          <input className={styles.textarea} style={{ width: 60 }} type="number" min={4} max={10}
            value={durationSec} onChange={(e) => setDurationSec(Number(e.target.value) || 6)} />
          <label style={{ fontSize: 11, color: '#888' }}>BEAT</label>
          <select className={styles.textarea} style={{ width: 'auto' }} value={beat} onChange={(e) => setBeat(e.target.value)}>
            {['훅', '긴장', '반전', '안정', '고조', '결말', '시그'].map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
          <input className={styles.textarea} style={{ flex: 1, minWidth: 160 }} placeholder="자막(CP) — 비우면 기본 문구"
            value={cpLine} onChange={(e) => setCpLine(e.target.value)} />
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button className={styles.copyBtn} onClick={pickRandom}>🎲 랜덤 뽑기</button>
          <button className={styles.genBtn} style={{ width: 'auto', padding: '8px 16px' }} onClick={doBuild}>조합 생성</button>
        </div>
        {buildError && <div className={styles.error} style={{ marginTop: 8 }}>{buildError}</div>}
      </div>

      {buildResult && (
        <div className={styles.result}>
          <div className={styles.resultLabel}>미리보기</div>
          <pre className={styles.resultText}>{buildResult.preview.step1}{'\n'}{buildResult.preview.step2}{'\n'}{buildResult.preview.step3}</pre>
          <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>IP (이미지 프롬프트)</div>
          <pre className={styles.resultText} style={{ fontSize: 11 }}>{buildResult.cutPatch.imagePrompt}</pre>
          <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>VP (영상 프롬프트)</div>
          <pre className={styles.resultText} style={{ fontSize: 11, marginBottom: 10 }}>{buildResult.cutPatch.videoPrompt}</pre>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <select className={styles.textarea} style={{ width: 'auto', minWidth: 220 }} value={targetCutId} onChange={(e) => setTargetCutId(e.target.value)}>
              <option value="">대상 컷 선택…</option>
              {(state.cuts || []).map((c) => <option key={c.id} value={c.id}>CUT{c.no} — {(c.cutTitle || c.scene || '').slice(0, 30)}</option>)}
            </select>
            <button className={styles.genBtn} style={{ width: 'auto', padding: '8px 16px' }} disabled={!targetCutId} onClick={commitApply}>이 컷에 반영</button>
          </div>
          {applyMsg && <div style={{ fontSize: 12, color: '#6ee7b7', marginTop: 8 }}>{applyMsg}</div>}
        </div>
      )}
    </>
  )
}

// ── 프리즈 비트(돌발상황 정지) 패널 — 2026-10-15 ──────────────────────────
// ChangeComboPanel(체인지 생성기)과 달리 트리거 목록·Scene B(의상 리빌)가 없다 — 의상/배경은
// 그대로고 "무슨 돌발상황인지"만 자유 입력. 성준님 피드백: "변신 장면보다, 빠르게 움직이다가
// 돌발상황이 확 펼쳐지는 순간에 멈춰서 효과가 연출되는 장면이 적합" — buildRevealCut()과
// 아키텍처 자체를 분리(server/lib/changeEffects.js buildFreezeBeatCut() 참고).
function FreezeBeatPanel({ state, dispatch }) {
  const [actionKo, setActionKo] = useState('')
  const [actionEn, setActionEn] = useState('')
  const [actionLabel, setActionLabel] = useState('')
  const [sceneA, setSceneA] = useState({ poseKo: '', poseEn: '', envEn: '', lightingEn: '' })
  const [durationSec, setDurationSec] = useState(6)
  const [beat, setBeat] = useState('긴장')
  const [cpLine, setCpLine] = useState('')
  const [targetCutId, setTargetCutId] = useState('')
  const [buildResult, setBuildResult] = useState(null)
  const [buildError, setBuildError] = useState('')
  const [applyMsg, setApplyMsg] = useState('')

  const EXAMPLES = [
    { label: '급브레이크 + 튀어나온 고양이', ko: '급브레이크를 밟는 순간 눈앞에 고양이가 튀어나옴', en: 'slamming the brakes as a cat suddenly darts in front of her' },
    { label: '커피잔이 손에서 미끄러져 깨짐', ko: '들고 있던 커피잔이 손에서 미끄러져 바닥에 부딪혀 산산조각 남', en: 'the coffee cup slipping from her hand and shattering as it hits the floor, coffee droplets and ceramic shards exploding outward' },
    { label: '갑자기 날아든 물건을 피함', ko: '어디선가 갑자기 날아든 물건을 반사적으로 피함', en: 'reflexively dodging an object suddenly flying toward her from off-frame' },
  ]
  const applyExample = (ex) => { setActionLabel(ex.label); setActionKo(ex.ko); setActionEn(ex.en); setBuildResult(null) }

  const doBuild = async () => {
    setBuildError(''); setApplyMsg('')
    if (!actionKo.trim() || !actionEn.trim()) { setBuildError('돌발상황 설명(한글/영문)을 먼저 채워주세요.'); return }
    const r = await fetch(`${SERVER}/api/change-combo/build-freeze`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: { nameKo: actionLabel, ko: actionKo, en: actionEn }, sceneA, durationSec, beat, cpLine }),
    })
    const d = await r.json()
    if (!r.ok) { setBuildError(d.error || '생성 실패'); return }
    setBuildResult(d)
  }

  const commitApply = () => {
    const cut = (state.cuts || []).find((c) => c.id === targetCutId)
    if (!cut || !buildResult?.cutPatch) return
    dispatch({ type: 'UPDATE_CUT', id: cut.id, p: buildResult.cutPatch })
    setApplyMsg(`✅ CUT${cut.no}에 반영 완료 — G2(이미지 생성)를 돌리면 캐릭터 얼굴 레퍼런스가 자동 첨부됩니다.`)
  }

  return (
    <>
      <div className={styles.result} style={{ marginBottom: 14 }}>
        <div className={styles.desc} style={{ fontSize: 10.5, marginBottom: 6 }}>
          예시에서 고르거나 직접 입력하세요 — 의상·배경은 바뀌지 않고, 이 "사건" 하나만 얼어붙습니다.
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
          {EXAMPLES.map((ex) => (
            <button key={ex.label} className={styles.copyBtn} onClick={() => applyExample(ex)}>{ex.label}</button>
          ))}
        </div>

        <input className={styles.textarea} style={{ marginBottom: 6 }} placeholder="상황 이름(짧게, 한글 — 예: 급브레이크+고양이)"
          value={actionLabel} onChange={(e) => { setActionLabel(e.target.value); setBuildResult(null) }} />
        <input className={styles.textarea} style={{ marginBottom: 6 }} placeholder="돌발상황 묘사 (한글, 필수 — 화면 설명용)"
          value={actionKo} onChange={(e) => { setActionKo(e.target.value); setBuildResult(null) }} />
        <input className={styles.textarea} style={{ marginBottom: 10 }} placeholder="Sudden event in English (required — goes into the video prompt)"
          value={actionEn} onChange={(e) => { setActionEn(e.target.value); setBuildResult(null) }} />

        <div className={styles.desc} style={{ fontSize: 10.5, marginBottom: 4, color: '#f0a050' }}>
          ↓ 평소 모습(선택) — 돌발상황이 터지기 전, 의상·배경·동작은 끝까지 그대로 유지됩니다
        </div>
        <input className={styles.textarea} style={{ marginBottom: 6 }} placeholder="평소 동작 (한글, 선택 — 예: 운전 중)"
          value={sceneA.poseKo} onChange={(e) => { setSceneA({ ...sceneA, poseKo: e.target.value }); setBuildResult(null) }} />
        <input className={styles.textarea} style={{ marginBottom: 6 }} placeholder="Everyday pose/action, in English (optional)"
          value={sceneA.poseEn} onChange={(e) => { setSceneA({ ...sceneA, poseEn: e.target.value }); setBuildResult(null) }} />
        <input className={styles.textarea} style={{ marginBottom: 6 }} placeholder="Environment, in English (optional)"
          value={sceneA.envEn} onChange={(e) => { setSceneA({ ...sceneA, envEn: e.target.value }); setBuildResult(null) }} />
        <input className={styles.textarea} style={{ marginBottom: 10 }} placeholder="Lighting, in English (optional)"
          value={sceneA.lightingEn} onChange={(e) => { setSceneA({ ...sceneA, lightingEn: e.target.value }); setBuildResult(null) }} />

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
          <label style={{ fontSize: 11, color: '#888' }}>컷 길이(초)</label>
          <input className={styles.textarea} style={{ width: 60 }} type="number" min={4} max={10}
            value={durationSec} onChange={(e) => setDurationSec(Number(e.target.value) || 6)} />
          <label style={{ fontSize: 11, color: '#888' }}>BEAT</label>
          <select className={styles.textarea} style={{ width: 'auto' }} value={beat} onChange={(e) => setBeat(e.target.value)}>
            {['훅', '긴장', '반전', '안정', '고조', '결말', '시그'].map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
          <input className={styles.textarea} style={{ flex: 1, minWidth: 160 }} placeholder="자막(CP) — 비우면 기본 문구"
            value={cpLine} onChange={(e) => setCpLine(e.target.value)} />
        </div>

        <button className={styles.genBtn} style={{ width: 'auto', padding: '8px 16px' }} onClick={doBuild}>프리즈 비트 생성</button>
        {buildError && <div className={styles.error} style={{ marginTop: 8 }}>{buildError}</div>}
      </div>

      {buildResult && (
        <div className={styles.result}>
          <div className={styles.resultLabel}>미리보기</div>
          <pre className={styles.resultText}>{buildResult.preview.step1}{'\n'}{buildResult.preview.step2}{'\n'}{buildResult.preview.step3}</pre>
          <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>IP (이미지 프롬프트)</div>
          <pre className={styles.resultText} style={{ fontSize: 11 }}>{buildResult.cutPatch.imagePrompt}</pre>
          <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>VP (영상 프롬프트)</div>
          <pre className={styles.resultText} style={{ fontSize: 11, marginBottom: 10 }}>{buildResult.cutPatch.videoPrompt}</pre>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <select className={styles.textarea} style={{ width: 'auto', minWidth: 220 }} value={targetCutId} onChange={(e) => setTargetCutId(e.target.value)}>
              <option value="">대상 컷 선택…</option>
              {(state.cuts || []).map((c) => <option key={c.id} value={c.id}>CUT{c.no} — {(c.cutTitle || c.scene || '').slice(0, 30)}</option>)}
            </select>
            <button className={styles.genBtn} style={{ width: 'auto', padding: '8px 16px' }} disabled={!targetCutId} onClick={commitApply}>이 컷에 반영</button>
          </div>
          {applyMsg && <div style={{ fontSize: 12, color: '#6ee7b7', marginTop: 8 }}>{applyMsg}</div>}
        </div>
      )}
    </>
  )
}
