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

// 리텐션 훅 탭 4개 모드(훅 설계·시그 레퍼런스·체인지 생성기·프리즈 비트) 전부에 걸친
// "스페셜 연출과 연관있는 앱 라인 심볼 버튼 추가!" 요청(2026-10-21 4차 보완) — 아직 실제
// 연동(API 키·업로드 흐름)이 없어 VideoTab의 Google AI Studio·runway와 같은 자리표시자로
// 둔다(클릭 시 "준비 중" 안내만).
const DIRECTION_TOOLS = ['LongTake AI Studio', 'colab', 'Morphic']

// StudioTab.jsx·MakingTab.jsx·VideoTab.jsx와 동일 로직(이 코드베이스 관례대로 작은 순수함수는
// 탭마다 복제) — /api/upload-cut-image 가 인스타 콘텐츠면 instaDir로 분기하는 데 필요하다.
function pipelineCodeToInstaContent(plCode) {
  const map = { IG_FD: 'FD', IG_RL: 'RL', IG_PT: 'PT', IG_ST: 'ST' }
  return map[(plCode || '').toUpperCase()] || null
}
function episodeContentTypeToInsta(contentType) {
  const map = { IG_R: 'RL', IG_F: 'FD', IG_P: 'PT', IG_S: 'ST' }
  return map[(contentType || '').toUpperCase()] || null
}

// ── 연출기법 공통 레퍼런스 이미지 — 2026-10-16 신설 ─────────────────────────
// 시그·체인지·프리즈 세 패널이 공유하는 레퍼런스 이미지 저장소(server/lib/directionRefs.js).
// 성준님 피드백: "모습이 머리에 배경으로 떠올라야 에피소드 n번 컷도 최적으로 선정할 수 있다"
// — 텍스트 설명뿐이던 기법 피커에 실제 레퍼런스 사진을 붙여서, 고를 때 바로 눈에 보이게 한다.
// server/lib/directionRefs.js의 slugKey()와 반드시 동일하게 유지 — 클라이언트가 같은 key로
// 조회해야 서버가 저장한 폴더(예: "서류 돌풍" → "서류_돌풍")와 매칭된다.
function refSlugKey(key) {
  return String(key).trim().toLowerCase().replace(/[^a-z0-9가-힣]+/gi, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'untitled'
}

function useDirectionRefs(group) {
  const [refsMap, setRefsMap] = useState({})
  const reload = () => {
    fetch(`${SERVER}/api/direction-refs?group=${group}`).then((r) => r.json())
      .then((d) => setRefsMap(d.all || {})).catch(() => {})
  }
  useEffect(() => { reload() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  return { refsMap, reload }
}

// key(기법 항목 이름)에 해당하는 레퍼런스 썸네일을 작게 보여주고, "+"로 새 이미지를 올릴 수
// 있게 하는 공용 조각. 클릭하면 원본 크기로 새 탭에서 열림(간단한 미리보기 대용).
// 2026-10-22 4차 보완 — 업로드 시 에피소드 이름을 같이 받아 caption으로 저장(성준님: "이미
// 만들어진 시그는 등록기능 추가되면 내가 등록하겠다, 이미지 하단에 에피소드명 표시").
// 2026-10-22 4차 보완 재점검 — "연출 재료 창고"의 "+"는 삭제하고 "+ 새 레퍼런스 추가" 폼
// 쪽으로 이미지 등록을 일원화(성준님: "'+' 기능을 삭제하고 '+ 새 레퍼런스 추가' 기능을
// 추가하자"). uploadable=false로 호출하면 썸네일 미리보기는 그대로 두고 "+" 업로드만 뺀다.
function RefThumbStrip({ group, itemKey, images, onUploaded, size = 40, uploadable = true }) {
  const upload = async (file) => {
    if (!file) return
    const caption = window.prompt('에피소드 이름/코드를 입력하세요(예: LF_T00) — 비워두면 나중에 다시 등록할 수 있습니다') || ''
    const ext = (file.name.match(/\.([a-z0-9]+)$/i)?.[1] || 'jpg').toLowerCase().replace('jpeg', 'jpg')
    await fetch(`${SERVER}/api/direction-refs/upload?group=${group}&key=${encodeURIComponent(itemKey)}&ext=${ext}&caption=${encodeURIComponent(caption)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: file,
    })
    onUploaded?.()
  }
  return (
    <div style={{ display: 'flex', gap: 4, alignItems: 'flex-start', marginTop: 4, flexWrap: 'wrap' }} onClick={(e) => e.stopPropagation()}>
      {(images || []).slice(0, 4).map((img) => (
        <a key={img.filename} href={`${SERVER}${img.url}`} target="_blank" rel="noreferrer" title={img.caption || ''}
          style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, width: size }}>
          <img src={`${SERVER}${img.url}`} alt="" style={{ width: size, height: size, objectFit: 'cover', borderRadius: 4, border: '1px solid var(--border)' }} />
          {img.caption && <span style={{ fontSize: 8.5, color: '#888', maxWidth: size, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{img.caption}</span>}
        </a>
      ))}
      {uploadable && (
        <label style={{
          width: size, height: size, display: 'flex', alignItems: 'center', justifyContent: 'center',
          border: '1px dashed var(--border)', borderRadius: 4, cursor: 'pointer', fontSize: 14, color: '#888', flexShrink: 0,
        }} title="레퍼런스 이미지 등록(에피소드 이름과 함께)">
          +
          <input type="file" accept="image/*" style={{ display: 'none' }}
            onChange={(e) => upload(e.target.files[0])} />
        </label>
      )}
    </div>
  )
}

// ── 기법별 이미지 리스트업 갤러리(2026-10-22 4차 보완) ───────────────────────
// PDF 10·11페이지: "등록된 기법별로 생성한 시그/연출 이미지 리스트업 별도 구축~". RefThumbStrip과
// 같은 저장소(directionRefs.js)를 그대로 읽어서 — 미리보기용 4장 미리보기가 아니라 전체를
// 기법별로 쭉 펼쳐 보여주는 용도. 새 이미지 등록도 여기서 바로 할 수 있다(기법명을 직접 입력).
// 2026-10-22 4차 보완 재점검 — "이미지를 먼저 등록 후, 내용설명을 입력하는 방식으로" +
// "이미지 기본정보는 자동생성". 기법 이름만 채우면 파일 선택 즉시 업로드되고(캡션은 빈
// 문자열), 각 썸네일 아래 캡션 칸은 인라인 입력으로 바뀌어 나중에 아무 때나 적을 수 있다
// (PATCH /api/direction-refs로 파일 재업로드 없이 caption만 갱신). 등록일시(addedAt)는
// 서버가 이미 자동으로 기록해두던 값을 "10/22 등록" 같은 읽기 쉬운 형태로 보여준다.
// 2026-10-22 재재점검 — "이미지를 눈으로 본 후, 설명에 도움이 될 수 있어 등록을 누르면
// 일단 이미지부터 먼저 등록" — 기법 이름을 먼저 받지 않는다. 임시 분류("미분류")로 바로
// 올라가고, 각 썸네일에서 기법 이름·설명을 나중에(눈으로 보면서) 채우면 그때 실제 분류로
// 옮긴다(서버 PATCH의 newKey가 파일을 물리적으로 이동시킴 — moveRefImage).
const UNSORTED_KEY = '미분류'
function DirectionRefGallery({ group, refsMap, reload }) {
  const keys = Object.keys(refsMap).filter((k) => (refsMap[k] || []).length > 0)
    .sort((a, b) => (a === UNSORTED_KEY ? -1 : b === UNSORTED_KEY ? 1 : 0)) // 미분류를 맨 위로
  const upload = async (file) => {
    if (!file) return
    const ext = (file.name.match(/\.([a-z0-9]+)$/i)?.[1] || 'jpg').toLowerCase().replace('jpeg', 'jpg')
    await fetch(`${SERVER}/api/direction-refs/upload?group=${group}&key=${encodeURIComponent(UNSORTED_KEY)}&ext=${ext}&caption=`, {
      method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: file,
    })
    reload?.()
  }
  const updateRecord = async (key, filename, { newKey, caption }) => {
    await fetch(`${SERVER}/api/direction-refs`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ group, key, filename, ...(newKey !== undefined ? { newKey } : {}), ...(caption !== undefined ? { caption } : {}) }),
    })
    reload?.()
  }
  const del = async (key, filename) => {
    await fetch(`${SERVER}/api/direction-refs?group=${group}&key=${encodeURIComponent(key)}&filename=${encodeURIComponent(filename)}`, { method: 'DELETE' })
    reload?.()
  }
  const fmtDate = (iso) => {
    if (!iso) return ''
    const d = new Date(iso)
    return Number.isNaN(d.getTime()) ? '' : `${d.getMonth() + 1}/${d.getDate()} 등록`
  }
  return (
    <div>
      <label className={styles.columnAddBtn} style={{ display: 'block', textAlign: 'center', marginBottom: 10, cursor: 'pointer' }}>
        + 이미지 등록(선택하면 바로 올라갑니다 — 기법 이름·설명은 아래서 눈으로 보면서 나중에 입력)
        <input type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => upload(e.target.files[0])} />
      </label>
      {keys.length === 0 && <div className={styles.desc}>아직 등록된 이미지가 없습니다.</div>}
      {keys.map((k) => (
        <div key={k} style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 10.5, color: k === UNSORTED_KEY ? '#f0a050' : '#a78bfa', marginBottom: 4 }}>
            {k === UNSORTED_KEY ? '⚠ 미분류 — 아래 기법 이름을 입력해 분류하세요' : k.replace(/_/g, ' ')}
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {refsMap[k].map((img) => (
              // 2026-10-22 재재점검 — "이미지 리스트업에 등록되는 이미지가 작고 썸네일(정사각
              // 크롭)로 표시된다 — 실제 화면비율로". width만 고정하고 height:auto로 원본 비율
              // 그대로(크롭 없이) 보여준다.
              <div key={img.filename} style={{ width: 170 }}>
                <a href={`${SERVER}${img.url}`} target="_blank" rel="noreferrer">
                  <img src={`${SERVER}${img.url}`} alt="" style={{ width: 170, height: 'auto', display: 'block', borderRadius: 6, border: '1px solid var(--border)' }} />
                </a>
                <div style={{ fontSize: 9, color: '#666', marginTop: 3, textAlign: 'center' }}>{fmtDate(img.addedAt)}</div>
                <input defaultValue={k === UNSORTED_KEY ? '' : k.replace(/_/g, ' ')} placeholder="기법 이름(필수 — 분류됩니다)"
                  style={{ width: '100%', fontSize: 9.5, marginTop: 3, background: '#111', border: '1px solid #333', borderRadius: 4, color: '#ccc', padding: '2px 4px', boxSizing: 'border-box', textAlign: 'center' }}
                  onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== k.replace(/_/g, ' ')) updateRecord(k, img.filename, { newKey: v }) }}
                  onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur() }} />
                <input defaultValue={img.caption || ''} placeholder="에피소드 이름/설명"
                  style={{ width: '100%', fontSize: 9.5, marginTop: 2, background: '#111', border: '1px solid #333', borderRadius: 4, color: '#ccc', padding: '2px 4px', boxSizing: 'border-box', textAlign: 'center' }}
                  onBlur={(e) => { if (e.target.value !== (img.caption || '')) updateRecord(k, img.filename, { caption: e.target.value }) }}
                  onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur() }} />
                <button type="button" onClick={() => del(k, img.filename)}
                  style={{ display: 'block', margin: '2px auto 0', fontSize: 9, color: '#f09595', background: 'none', border: 'none', cursor: 'pointer' }}>삭제</button>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

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
      <TabToolbar
        toolLabel="외부 연출 앱 연동"
        tools={DIRECTION_TOOLS}
        onToolChange={t => alert(`${t} 연동은 아직 준비 중입니다.`)}
      />
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
  // 2026-10-16 보강 — direction-material-bank.md에 카탈로그만 돼 있고 이 피커엔 아직 안 올라와
  // 있던 기법들을 실제로 골라 쓸 수 있게 추가(성준님 피드백: "시그 레퍼런스도 좀더 보강했으면").
  {
    name: '극적 줌아웃 리빌 (지구까지 빠지기)',
    description: '가까운 피사체에서 시작해 카메라가 빠르게 빠지며 지구 전체가 보이는 데까지 이어지는 돌리줌 — 오프닝 훅·엔딩 임팩트용(연출 재료 창고 ①, 2026-10-15 Instagram 레퍼런스)',
    ch: 'extreme continuous dolly-zoom-out starting tight on her face, camera rapidly pulling back and ascending through the atmosphere, speed ramp acceleration, radial motion blur',
    sp: 'OT.ST.NT (시작 공간은 실내외 무관, 카메라가 대기권 밖까지 빠짐)',
    audioMotif: '시네마틱 휩 사운드만, 음악 없이',
  },
  {
    name: '신화적 변신',
    description: '신화 속 존재(여신·정령 등)로 잠깐 변했다가 다시 돌아오는 극적 리빌(연출 재료 창고, 2026-10-13 리서치)',
    ch: 'momentarily transforming into a mythical, ethereal being — glowing light particles, flowing otherworldly fabric, then settling back to her normal self',
    sp: '',
    audioMotif: '신비로운 하프/차임 + 리버스 스웰',
  },
  {
    name: '메이크업 모핑',
    description: '민낯에서 완성 메이크업까지 손 없이 저절로 모핑되는 연출(연출 재료 창고, 2026-10-13 리서치)',
    ch: 'face morphing seamlessly from bare skin to a fully finished glamorous makeup look, no hands touching the face, as if by magic',
    sp: '',
    audioMotif: '반짝이는 차임 상승 + 파우더 펑 소리',
  },
  {
    name: '피규어화',
    description: '순간적으로 피규어/인형처럼 변했다가 다시 사람으로 돌아오는 반전(연출 재료 창고, 2026-10-13 리서치)',
    ch: 'briefly transforming into a collectible figurine on a display base, miniature glossy plastic look, then smoothly transforming back into her real self',
    sp: '',
    audioMotif: '장난감 조립 소리 + 리버스 스냅',
  },
  {
    name: '흑백→컬러 리빌',
    description: '흑백 화면에서 시작해 색이 번지듯 퍼지며 컬러로 전환되는 연출(연출 재료 창고, 2026-10-13 리서치)',
    ch: 'scene begins in black and white, color blooming outward from her like ink spreading until the whole frame is in full color',
    sp: '',
    audioMotif: '정적 → 컬러풀한 신스 스웰',
  },
  {
    name: '무빙워크 체인지',
    description: '공항 무빙워크처럼 걸어 지나가는 동안 의상·배경이 바뀌는 연출(연출 재료 창고, 2026-10-13 리서치)',
    ch: 'walking along a moving walkway, outfit and background seamlessly changing with each step forward',
    sp: 'IN.AIRPORT.NT (또는 유사한 통로형 공간)',
    audioMotif: '리드미컬한 워킹 비트 + 전환마다 스냅',
  },
  {
    name: '콜라주 플라이인',
    description: '여러 장의 사진·오브젝트가 화면 밖에서 날아들어와 콜라주처럼 쌓이는 연출(연출 재료 창고, 2026-10-13 리서치)',
    ch: '(배경/오브젝트 중심 — 여러 사진·오브젝트 조각이 프레임 가장자리에서 날아들어와 콜라주처럼 쌓이는 장면)',
    sp: '',
    audioMotif: '연속 슬라이드 스냅 사운드',
  },
  {
    name: '만화 패널 변환',
    description: '실사에서 순간적으로 만화/웹툰 패널 스타일로 바뀌었다가 돌아오는 연출(연출 재료 창고, 2026-10-13 리서치)',
    ch: 'briefly transforming into a bold comic-panel illustration style with ink outlines and halftone shading, then smoothly returning to photorealistic',
    sp: '',
    audioMotif: '만화 효과음(펑!) + 종이 넘기는 소리',
  },
  {
    name: '컬러 블로킹 변주 (다수 속 하나만 다른 색)',
    description: '같은 색 사물·배경 수십 개 사이에서 서여리(또는 소품) 하나만 다른 색으로 도드라지는 구도 — 썸네일·오프닝 1컷용(연출 재료 창고, 2026-10-15 레퍼런스)',
    ch: 'standing out as the one element in a different color among dozens of identical same-colored objects and background around her',
    sp: '',
    audioMotif: '단순 임팩트 한 방 + 정적',
  },
]

function SignatureRefPanel({ state, dispatch }) {
  const { refsMap: sigImageRefs, reload: reloadSigImageRefs } = useDirectionRefs('signature')
  const [refs, setRefs] = useState([])
  const [loading, setLoading] = useState(false)
  const [editing, setEditing] = useState(null)   // 새로 추가/수정 중인 레퍼런스 초안
  const [editingImageFile, setEditingImageFile] = useState(null) // 2026-10-22 4차 보완 — "+ 새 레퍼런스 추가" 폼에서 같이 등록
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

  const startNew = () => { setEditing({ name: '', description: '', ch: '', lookId: '', sp: '', audioMotif: '' }); setEditingImageFile(null) }
  // 2026-10-22 4차 보완 — "연출재료 창고의 '+' 삭제하고 '+ 새 레퍼런스 추가'로 일원화, 추가
  // 시 이미지 리스트업까지 연결". 저장 직후 이미지가 있으면 같은 이름(key)으로 direction-refs
  // 에 같이 올려서 DirectionRefGallery(이미지 리스트업)에 바로 나타나게 한다.
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
    if (editingImageFile) {
      const ext = (editingImageFile.name.match(/\.([a-z0-9]+)$/i)?.[1] || 'jpg').toLowerCase().replace('jpeg', 'jpg')
      await fetch(`${SERVER}/api/direction-refs/upload?group=signature&key=${encodeURIComponent(editing.name)}&ext=${ext}&caption=`, {
        method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: editingImageFile,
      })
      reloadSigImageRefs()
    }
    setEditing(null)
    setEditingImageFile(null)
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
                onClick={() => { setEditing({ name: p.name, description: p.description, ch: p.ch, lookId: '', sp: p.sp, audioMotif: p.audioMotif }); setEditingImageFile(null) }}>
                <div className={styles.columnItemLabel}>{p.name}</div>
                <div className={styles.columnItemDesc}>{p.description}</div>
                <RefThumbStrip group="signature" itemKey={p.name} images={sigImageRefs[refSlugKey(p.name)]} onUploaded={reloadSigImageRefs} uploadable={false} />
              </div>
            ))}
          </div>
          <div className={styles.desc} style={{ marginTop: 8, fontSize: 10.5 }}>클릭하면 오른쪽 아래 폼을 채워줍니다 — 자유 수정 가능.</div>
          {/* 2026-10-22 재재점검 — "연출재료창고의 '+'를 삭제하고 '+ 새 레퍼런스 추가'를
              추가하자"는 이 열 자체에 입구가 있어야 한다는 뜻이었다(오른쪽 열에만 있던 걸
              여기서도 바로 쓸 수 있게 — 같은 startNew 재사용, 폼은 오른쪽 열에 그대로 뜸). */}
          <button type="button" className={styles.columnAddBtn} style={{ marginTop: 6 }} onClick={startNew}>+ 새 레퍼런스 추가</button>
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
              <label className={styles.columnAddBtn} style={{ display: 'block', textAlign: 'center', marginBottom: 6 }}>
                {editingImageFile ? `🖼 ${editingImageFile.name}` : '🖼 레퍼런스 이미지 첨부(선택)'}
                <input type="file" accept="image/*" style={{ display: 'none' }}
                  onChange={(e) => setEditingImageFile(e.target.files[0] || null)} />
              </label>
              <div style={{ display: 'flex', gap: 6 }}>
                <button className={styles.genBtn} style={{ marginBottom: 0 }} onClick={saveEditing}>저장</button>
                <button className={styles.copyBtn} onClick={() => { setEditing(null); setEditingImageFile(null) }}>취소</button>
              </div>
            </div>
          ) : (
            <button type="button" className={styles.columnAddBtn} style={{ marginTop: 6 }} onClick={startNew}>+ 새 레퍼런스 추가</button>
          )}
        </div>

        <div className={styles.column}>
          <div className={styles.columnHeader}>시그 이미지 리스트업</div>
          <div className={styles.columnList} style={{ maxHeight: 'none' }}>
            <DirectionRefGallery group="signature" refsMap={sigImageRefs} reload={reloadSigImageRefs} />
          </div>
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
  const { refsMap: changeImageRefs, reload: reloadChangeImageRefs } = useDirectionRefs('change')
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

  // 2026-10-22 재재점검(그림3.jpg) — Scene A도 Scene B와 같은 룩 프리셋을 고를 수 있어야
  // 한다("SCENE A,B Look 사전등록" 행). Scene A엔 의상 필드가 없으니(IP가 항상 "전" 모습을
  // 그리는 설계라 포즈/배경/조명만 받음) 프리셋의 환경·조명만 가져온다.
  const applySceneAPreset = (p) => {
    setSceneA((prev) => ({ ...prev, envEn: p.envEn || prev.envEn, lightingEn: p.lightingEn || prev.lightingEn }))
    setBuildResult(null)
  }

  return (
    <>
    {/* 2026-10-22 재재점검 — "Scene A 입력 섹션의 오른쪽 범위가 이미지 리스트업까지 넘어가니,
        그 앞까지로 줄이고 이미지 영역을 아래까지(스크롤되게) 확보해달라" — 전체를 좌(모든
        설정)/우(연출 이미지 리스트업, 전체 높이) 2단 shell로 바꾼다. */}
    <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
    <div style={{ flex: '2 1 600px', minWidth: 320 }}>
      <div className={styles.result} style={{ marginBottom: 14 }}>
        {/* 연출 & VFX — ①트리거, ②VFX만(③Scene B는 아래 "Look 사전등록" 행으로 이동) */}
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
                  {/* 2026-10-22 재재점검 — "트리거 액션의 '+'가 이미지 리스트업과 중복" —
                      업로드 입구를 없애고 썸네일만 참고용으로 남긴다(등록은 리스트업에서). */}
                  <RefThumbStrip group="change" itemKey={t.nameKo} images={changeImageRefs[refSlugKey(t.nameKo)]} onUploaded={reloadChangeImageRefs} uploadable={false} />
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

          {/* 2026-10-22 4차 보완 — 참고자료 3등분 레이아웃: ②VFX·③SceneB를 한 열에 위아래로
              쌓고, 이미지 리스트업을 3열째로 둔다(기존 4개 flat column → 3개). */}
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
        </div>

        {/* SCENE A,B Look 사전등록 — 같은 프리셋 목록(sceneBFashionPresets)을 양쪽에서 쓴다.
            A는 환경/조명만, B는 의상까지 전부 가져온다(기존 ③Scene B 동작 그대로 이동). */}
        <div className={styles.columns} style={{ marginTop: 14 }}>
          <div className={styles.column}>
            <div className={styles.columnHeader}>SCENE A — 변신 "전" 모습(선택)</div>
            <div className={styles.columnList}>
              {options.sceneBFashionPresets.map((p, idx) => (
                <div key={`a-${idx}`} className={styles.columnItem} onClick={() => applySceneAPreset(p)}>
                  <div className={styles.columnItemLabel}>{p.outfit.slice(0, 20)}…</div>
                  <div className={styles.columnItemDesc}>{p.env.slice(0, 26)}…</div>
                </div>
              ))}
            </div>
            <div className={styles.desc} style={{ marginTop: 8, fontSize: 10.5 }}>환경·조명만 Scene A에 반영됩니다(의상은 "전" 모습엔 없음).</div>
          </div>
          <div className={styles.column}>
            <div className={styles.columnHeader}>SCENE B — 리빌될 모습</div>
            <div className={styles.columnList}>
              {options.sceneBFashionPresets.map((p, idx) => (
                <div key={`b-${idx}`} className={styles.columnItem}
                  onClick={() => { setSceneB(p); setBuildResult(null) }}>
                  <div className={styles.columnItemLabel}>{p.outfit.slice(0, 20)}…</div>
                  <div className={styles.columnItemDesc}>{p.env.slice(0, 26)}…</div>
                </div>
              ))}
            </div>
            <div className={styles.desc} style={{ marginTop: 8, fontSize: 10.5 }}>프리셋을 클릭해 채우거나, 아래 입력란에 직접 입력하세요.</div>
          </div>
        </div>

        {/* SCENE A,B 신규 추가 — 그림3.jpg: 두 세트 입력을 좌우로 나란히. "기획단계에서 해당
            내용 설정된 탭과 자동연동"은 범위가 커서 이번엔 입력 레이아웃만 맞추고 보류. */}
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 14 }}>
          <div style={{ flex: '1 1 260px', minWidth: 240 }}>
            {/* 2026-10-15 — "쪼개는 기준": 시작 이미지(IP)는 항상 변신 "전" 모습을 그리고, 영상
                프롬프트(VP)가 트리거→VFX→리빌 전체를 책임진다. IP가 "후" 모습(sceneB)을 그리면
                Veo가 시작 프레임에 고정돼 트리거 동작 자체가 영상에 전혀 안 나온다(IG_R08 CUT4
                실측). Scene A는 비워도 되고, 비우면 서버가 범용 문구로 채운다. */}
            <div className={styles.desc} style={{ fontSize: 10.5, marginBottom: 4, color: '#f0a050' }}>
              Scene A — 변신 "전" 모습(선택) · 시작 이미지(IP)는 항상 이쪽을 그립니다
            </div>
            <input className={styles.textarea} style={{ marginBottom: 6 }} placeholder="전 모습 포즈/동작 (한글, 선택 — 예: 회중시계 태엽을 감는 중)"
              value={sceneA.poseKo} onChange={(e) => { setSceneA({ ...sceneA, poseKo: e.target.value }); setBuildResult(null) }} />
            <input className={styles.textarea} style={{ marginBottom: 6 }} placeholder="Pose/action before the change, in English (optional)"
              value={sceneA.poseEn} onChange={(e) => { setSceneA({ ...sceneA, poseEn: e.target.value }); setBuildResult(null) }} />
            <input className={styles.textarea} style={{ marginBottom: 6 }} placeholder="Environment before the change, in English (optional)"
              value={sceneA.envEn} onChange={(e) => { setSceneA({ ...sceneA, envEn: e.target.value }); setBuildResult(null) }} />
            <input className={styles.textarea} style={{ marginBottom: 10 }} placeholder="Lighting before the change, in English (optional)"
              value={sceneA.lightingEn} onChange={(e) => { setSceneA({ ...sceneA, lightingEn: e.target.value }); setBuildResult(null) }} />
          </div>

          <div style={{ flex: '1 1 260px', minWidth: 240 }}>
            <div className={styles.desc} style={{ fontSize: 10.5, marginBottom: 4 }}>Scene B — 변신 "후" 모습 · 영상 프롬프트(VP)의 리빌 구간에만 쓰입니다</div>
            <input className={styles.textarea} style={{ marginBottom: 6 }} placeholder="의상 (필수, 한글 — 화면 설명용)"
              value={sceneB.outfit} onChange={(e) => { setSceneB({ ...sceneB, outfit: e.target.value }); setBuildResult(null) }} />
            <input className={styles.textarea} style={{ marginBottom: 6 }} placeholder="배경/환경 (한글 — 화면 설명용)"
              value={sceneB.env} onChange={(e) => { setSceneB({ ...sceneB, env: e.target.value }); setBuildResult(null) }} />
            <input className={styles.textarea} style={{ marginBottom: 10 }} placeholder="조명 (한글 — 화면 설명용)"
              value={sceneB.lighting} onChange={(e) => { setSceneB({ ...sceneB, lighting: e.target.value }); setBuildResult(null) }} />
            {/* 2026-10-14: 이미지·영상 프롬프트(IP/VP)는 전부 영문이어야 하는데, 위 한글 입력을
                그대로 꽂아 넣었더니 영문 프롬프트 한가운데 한글이 섞이는 버그가 있었다(IG_R08
                CUT2 실측). 프리셋을 고르면 자동으로 채워지고, 직접 입력할 때도 영문은 따로 받는다. */}
            <div className={styles.desc} style={{ fontSize: 10.5, marginBottom: 4 }}>실제 이미지·영상 프롬프트에 들어가는 영문 설명(필수)</div>
            <input className={styles.textarea} style={{ marginBottom: 6 }} placeholder="Outfit in English (required)"
              value={sceneB.outfitEn} onChange={(e) => { setSceneB({ ...sceneB, outfitEn: e.target.value }); setBuildResult(null) }} />
            <input className={styles.textarea} style={{ marginBottom: 6 }} placeholder="Environment in English"
              value={sceneB.envEn} onChange={(e) => { setSceneB({ ...sceneB, envEn: e.target.value }); setBuildResult(null) }} />
            <input className={styles.textarea} style={{ marginBottom: 10 }} placeholder="Lighting in English"
              value={sceneB.lightingEn} onChange={(e) => { setSceneB({ ...sceneB, lightingEn: e.target.value }); setBuildResult(null) }} />
          </div>
        </div>

        {/* 최종 설정, 조합 프롬프트 생성 */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10, marginTop: 4 }}>
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
    </div>

    <div style={{ flex: '1 1 380px', minWidth: 300 }}>
      <div className={styles.result}>
        <div className={styles.resultLabel}>연출 이미지 리스트업</div>
        <DirectionRefGallery group="change" refsMap={changeImageRefs} reload={reloadChangeImageRefs} />
      </div>
    </div>
    </div>
    </>
  )
}

// ── 프리즈 비트 레퍼런스 라이브러리 — 2026-10-16 보강 ───────────────────────
// 성준님 피드백: "다양한 레퍼런스가 1차적으로 갖춰졌으면 좋겠다 — 여러 상황을 조합해서
// 상상할 수 있고, 그 상상에서 다른 가지를 더 만들 수도 있고, 입력하기도 하고". 한국어
// 문장을 "계기+사물"로 쪼개 자동 합성하면 조사(이/가, 을/를) 처리가 깨지기 쉬워서, 대신
// 두 개의 독립된 축으로 조합한다 — ① 사건(이미 완결된 문장, 안 깨짐) × ② 장소(환경/조명
// 필드만 갈아끼움, 문장에 안 섞여서 안전). "🎲 랜덤 조합"으로 사건×장소를 무작위로 묶어
// 새 상상을 유도하고, 사람이 직접 입력한 조합은 서버에 저장해 다음에도 다시 꺼내 쓸 수
// 있다(server/lib/customChangePresets.js의 listCustomFreezeEvents 등 참고).
const FREEZE_EVENT_LIBRARY = [
  // 물건 파손
  { nameKo: '커피잔 파손', category: '물건 파손', ko: '들고 있던 커피잔이 손에서 미끄러져 바닥에 부딪혀 산산조각 나며 파편과 커피 방울이 사방으로 튄', en: 'a coffee cup slipping from her hand and shattering as it hits the floor, with ceramic shards and coffee droplets frozen mid-explosion all around her' },
  { nameKo: '유리잔 파손', category: '물건 파손', ko: '들고 있던 유리잔을 놓쳐 바닥에 부딪혀 산산조각 나며 날카로운 파편이 사방으로 튄', en: 'a glass tumbler slipping from her hand and shattering on the floor, with sharp glass shards scattering in every direction' },
  { nameKo: '꽃병 쓰러짐', category: '물건 파손', ko: '팔꿈치에 부딪힌 꽃병이 기울어 떨어지며 물과 꽃잎이 사방으로 튄', en: 'a vase knocked over by her elbow, tipping and falling as water and flower petals burst outward' },
  { nameKo: '접시 파손', category: '물건 파손', ko: '설거지하다 놓친 접시가 바닥에 부딪혀 산산조각 나는', en: 'a plate slipping from her soapy hands while washing dishes and shattering on the floor' },
  // 날씨 / 바람
  { nameKo: '서류 돌풍', category: '날씨/바람', ko: '열린 창문으로 갑자기 돌풍이 들이쳐 책상 위 서류 더미가 사방으로 날아올라 허공에 멈춘', en: 'a sudden gust of wind blowing through an open window, scattering a stack of papers off the desk, with dozens of sheets suspended and frozen mid-air around her' },
  { nameKo: '우산 뒤집힘', category: '날씨/바람', ko: '갑작스런 돌풍에 우산이 뒤집히며 살이 꺾이고 빗방울이 튀는', en: 'a sudden gust turning her umbrella inside out, its ribs bending as raindrops splash outward around it' },
  { nameKo: '눈보라', category: '날씨/바람', ko: '눈 쌓인 거리에서 돌풍에 흩날리는 눈송이 사이 멈춰선', en: 'caught amid a flurry of snow suddenly swirling around her in a gust on a snowy street' },
  { nameKo: '벚꽃 흩날림', category: '날씨/바람', ko: '강풍에 머리 위로 벚꽃잎이 소나기처럼 흩날리는', en: 'a gust of wind scattering a shower of cherry blossom petals around her' },
  // 신체반응 / 동작 정지
  { nameKo: '급브레이크+고양이', category: '신체반응', ko: '급브레이크를 밟는 순간 눈앞에 고양이가 튀어나옴', en: 'slamming the brakes as a cat suddenly darts in front of her' },
  { nameKo: '날아온 물건 피함', category: '신체반응', ko: '어디선가 갑자기 날아든 물건을 반사적으로 피함', en: 'reflexively dodging an object suddenly flying toward her from off-frame' },
  { nameKo: '계단 헛디딤', category: '신체반응', ko: '계단에서 발을 헛디뎌 몸이 기울어진 채 공중에 멈춘', en: 'losing her footing on the stairs, her body tipping off-balance and frozen mid-stumble' },
  { nameKo: '점프 정점', category: '신체반응', ko: '신나서 뛰어오른 순간, 머리카락과 옷자락이 떠오른 채 공중에 멈춘', en: 'caught at the peak of a joyful jump, hair and clothing billowing upward, frozen mid-air' },
  { nameKo: '놀라서 폰 떨어뜨림', category: '신체반응', ko: '메시지를 보다 소스라치게 놀라 손에서 폰이 미끄러지는', en: 'startled while reading a message, her phone slipping from her hand mid-air' },
  // 액체 / 음식
  { nameKo: '라떼 쏟아짐', category: '액체/음식', ko: '들고 있던 라떼가 출렁여 쏟아지며 우유 거품이 허공에 튄', en: 'the latte in her hand sloshing and spilling, milk foam splashing into the air' },
  { nameKo: '팝콘 봉지 터짐', category: '액체/음식', ko: '팝콘 봉지가 터지며 알갱이가 사방으로 쏟아지는', en: 'a bag of popcorn bursting open, kernels exploding outward in every direction' },
  { nameKo: '탄산음료 터짐', category: '액체/음식', ko: '흔들었던 탄산음료 캔이 터지며 거품이 분수처럼 솟구치는', en: 'a shaken soda can bursting open, fizz erupting like a fountain around her' },
  // 종이 / 카드
  { nameKo: '폴라로이드 흩날림', category: '종이/카드', ko: '들고 있던 폴라로이드 사진 뭉치를 놓쳐 허공에 흩날리는', en: 'a stack of polaroid photos slipping from her hands, scattering and fluttering through the air' },
  { nameKo: '트럼프 카드 던지기', category: '종이/카드', ko: '카드 뭉치를 허공으로 던져 올린 순간 카드들이 부채처럼 흩어진', en: 'a deck of cards tossed into the air, fanning out and scattering mid-flight' },
]
// 2026-10-22 4차 보완 — "선택 설정을 참고하여 상황개요·평소모습 입력내용이 자동으로
// 채워지도록" — poseKo/poseEn(그 장소에 어울리는 평소 동작)을 각 장소에 추가, applyLocation이
// envEn/lightingEn뿐 아니라 이것도 같이 채운다.
// 2026-10-22 재재점검(그림, PDF 12페이지) — "연출 장소-1(일상)"/"연출 장소-2(번외)" 두 그룹.
// 일상 쪽은 분류 가능하면 분류(성준님: "구분이 가능하면 분류해도 좋겠다") — 실내/실외로.
// 2026-10-22 그림6(4차 재재점검) — "장소군으로 구분 필요시, 유형별로 리스트 분류 적용!!":
// 실내는 신발 유무(맨발로 다니는 사적 공간 vs 신발 신는 공공형 실내), 실외는 공인(누구나
// 아는 공공장소) vs 특정장소(사적·상황적 공간)로 한 단계 더 세분류. 성준님 확인: 코드(ST/CF
// 등)는 나중에, 지금은 이 세부 분류만 먼저 늘려달라고 함 — subtype만 추가하고 code는 보류.
const FREEZE_LOCATION_LIBRARY = [
  { nameKo: '홈 오피스', category: '실내', subtype: '신발X', envEn: 'a cozy home office desk by a window, laptop and a cup of coffee on the desk', lightingEn: 'soft natural daylight from the window', poseKo: '책상 앞에 앉아 작업하는 중', poseEn: 'sitting at the desk working' },
  { nameKo: '거실', category: '실내', subtype: '신발X', envEn: 'a cozy home living room', lightingEn: 'soft warm indoor lighting', poseKo: '소파에 편하게 앉아 있는 중', poseEn: 'sitting comfortably on the couch' },
  { nameKo: '주방', category: '실내', subtype: '신발X', envEn: 'a bright modern kitchen', lightingEn: 'soft daylight through a kitchen window', poseKo: '요리하는 중', poseEn: 'cooking' },
  { nameKo: '침실', category: '실내', subtype: '신발X', envEn: 'a softly lit cozy bedroom', lightingEn: 'warm lamp light', poseKo: '침대에 누워 있는 중', poseEn: 'lying in bed' },
  { nameKo: '카페', category: '실내', subtype: '신발O', envEn: 'a cozy café interior with wooden tables', lightingEn: 'warm ambient café lighting', poseKo: '커피를 마시는 중', poseEn: 'sipping coffee' },
  { nameKo: '사무실', category: '실내', subtype: '신발O', envEn: 'a modern office with desks and glass partitions', lightingEn: 'cool fluorescent office lighting', poseKo: '일하는 중', poseEn: 'working at the office' },
  { nameKo: '교실', category: '실내', subtype: '신발O', envEn: 'a classroom with rows of desks and a chalkboard', lightingEn: 'bright fluorescent classroom lighting', poseKo: '수업 듣는 중', poseEn: 'sitting in class listening' },
  { nameKo: '길거리', category: '실외', subtype: '공인', envEn: 'a city street sidewalk', lightingEn: 'natural daylight', poseKo: '걷는 중', poseEn: 'walking' },
  { nameKo: '공원', category: '실외', subtype: '공인', envEn: 'a public park with trees and a walking path', lightingEn: 'natural daylight filtering through trees', poseKo: '산책하는 중', poseEn: 'walking through the park' },
  { nameKo: '차 안', category: '실외', subtype: '특정장소', envEn: 'the interior of a car, dashboard visible', lightingEn: 'daylight through the windshield', poseKo: '운전하는 중', poseEn: 'driving' },
  { nameKo: '옥상', category: '실외', subtype: '특정장소', envEn: 'a building rooftop with a city skyline view', lightingEn: 'golden hour sunset light', poseKo: '옥상에 서 있는 중', poseEn: 'standing on the rooftop' },
]
// 번외(비일상) 장소 — PDF 12페이지 예시(UW=수중, CLD=구름 위, FUW=미래 세계)만 우선 등록.
// 코드(UW/CLD/FUW)는 참고용으로만 남기고(공간 코드 체계와 충돌 방지 위해 화면엔 이름만 표시).
const FREEZE_LOCATION_LIBRARY_EXTRA = [
  { code: 'UW', nameKo: '수중', envEn: 'fully underwater, surrounded by drifting air bubbles and shafts of sunlight filtering through the water', lightingEn: 'soft blue underwater caustic light', poseKo: '물속에서 유영하는 중', poseEn: 'floating and swimming underwater' },
  { code: 'CLD', nameKo: '구름 위', envEn: 'standing on soft clouds high above the earth, endless sky and horizon around', lightingEn: 'bright golden sunlight above the clouds', poseKo: '구름 위에 서 있는 중', poseEn: 'standing on top of the clouds' },
  { code: 'FUW', nameKo: '미래 세계', envEn: 'a futuristic sci-fi cityscape with neon lights, holograms and flying vehicles', lightingEn: 'cool neon city lighting', poseKo: '미래 도시를 걷는 중', poseEn: 'walking through the futuristic city' },
]
const pickRandomItem = (arr) => arr[Math.floor(Math.random() * arr.length)]

// ── 상황 연출 이미지 생성(2026-10-22 4차 보완) ──────────────────────────────
// PDF 12페이지 우측 패널: "상황 연출 이미지 생성" — 멀티앵글 키프레임이 아니라 실제 결과
// 이미지를 업로드해 쌓아두는 곳. key는 현재 선택된 사건+장소 조합, caption은 "주요 연출기법
// 요약"을 자동으로 채운다(이미지 생성 전 선택한 기법·오빗 각도 등 — 업로드 시 수동 입력 불필요).
function FreezeSituationImagePanel({ freezeRefs, reloadFreezeRefs, actionLabel, selectedLocationName, techniquePresets, techniqueRig, orbitDegrees }) {
  const key = `${actionLabel || '미정'}_${selectedLocationName || '미정'}`
  const techName = techniquePresets.find((p) => p.value === techniqueRig)?.name || '커스텀 기법'
  const summary = `${actionLabel || '상황 미정'} · ${techName} · 카메라 오빗 ${orbitDegrees}도`
  const images = freezeRefs[refSlugKey(key)] || []
  const upload = async (file) => {
    if (!file) return
    const ext = (file.name.match(/\.([a-z0-9]+)$/i)?.[1] || 'jpg').toLowerCase().replace('jpeg', 'jpg')
    await fetch(`${SERVER}/api/direction-refs/upload?group=freeze&key=${encodeURIComponent(key)}&ext=${ext}&caption=${encodeURIComponent(summary)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: file,
    })
    reloadFreezeRefs?.()
  }
  const del = async (filename) => {
    await fetch(`${SERVER}/api/direction-refs?group=freeze&key=${encodeURIComponent(key)}&filename=${encodeURIComponent(filename)}`, { method: 'DELETE' })
    reloadFreezeRefs?.()
  }
  // 2026-10-22 그림6 — "연출 유형별 기법 설정값 표시(연동, 수정기능 필요? 확인!)": 캡션은
  // 업로드 시 현재 기법·오빗 각도로 자동 요약되지만, 지금까지는 고칠 수 없는 고정 텍스트였다.
  // 시그/체인지 쪽 갤러리와 똑같이 onBlur에 PATCH 쳐서 직접 수정 가능하게 맞춘다.
  const updateCaption = async (filename, caption) => {
    await fetch(`${SERVER}/api/direction-refs`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ group: 'freeze', key, filename, caption }),
    })
    reloadFreezeRefs?.()
  }
  return (
    <div className={styles.result}>
      <div className={styles.resultLabel}>상황 연출 이미지 생성</div>
      <div className={styles.desc} style={{ fontSize: 10.5, marginBottom: 8 }}>
        지금 선택된 사건·장소(<b>{actionLabel || '미정'} · {selectedLocationName || '미정'}</b>) 조합으로 만든 결과 이미지를 올려두는 곳입니다.
        업로드하면 지금 설정(기법·오빗 각도)이 자동으로 캡션에 요약되고, 캡션은 아래에서 직접 고칠 수 있습니다.
      </div>
      <label className={styles.columnAddBtn} style={{ display: 'block', textAlign: 'center', marginBottom: 10 }}>
        + 상황 연출 이미지 등록
        <input type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => upload(e.target.files[0])} />
      </label>
      {images.length === 0 && <div className={styles.desc}>아직 등록된 이미지가 없습니다.</div>}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {images.map((img) => (
          <div key={img.filename} style={{ width: 170 }}>
            <a href={`${SERVER}${img.url}`} target="_blank" rel="noreferrer">
              <img src={`${SERVER}${img.url}`} alt="" style={{ width: 170, height: 'auto', display: 'block', borderRadius: 6, border: '1px solid var(--border)' }} />
            </a>
            <input className={styles.textarea} defaultValue={img.caption || summary}
              style={{ fontSize: 9.5, marginTop: 4, padding: '3px 5px' }}
              onBlur={(e) => { if (e.target.value !== (img.caption || summary)) updateCaption(img.filename, e.target.value) }} />
            <button type="button" onClick={() => del(img.filename)}
              style={{ display: 'block', margin: '2px auto 0', fontSize: 9, color: '#f09595', background: 'none', border: 'none', cursor: 'pointer' }}>삭제</button>
          </div>
        ))}
      </div>
    </div>
  )
}

// 2026-10-22 그림6 — "① (아코디언 접이식) 상황 연출 리스트 / ② 동작,소품 연출 리스트,
// 상황조합 = ①×②". 성준님 확인: 기존 6개 카테고리를 두 축으로 쪼개는 게 아니라, 두 그룹으로
// 묶어 아코디언 두 개로 접기만 하면 됨 — 프리셋(예: 급브레이크+고양이)은 그대로 ①쪽에 둔다.
// ①=환경에 벌어지는 사건, ②=몸·소지품에서 비롯되는 사건.
const SITUATION_EVENT_CATS = ['물건 파손', '날씨/바람']
const ACTIONPROP_EVENT_CATS = ['신체반응', '액체/음식', '종이/카드']

function EventAccordionSection({ title, cats, events, freezeRefs, reloadFreezeRefs, applyExample, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen)
  const [filter, setFilter] = useState('전체')
  const pool = events.filter((e) => cats.includes(e.category))
  const visible = filter === '전체' ? pool : pool.filter((e) => e.category === filter)
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 8, marginBottom: 8, overflow: 'hidden' }}>
      <button type="button" onClick={() => setOpen((o) => !o)}
        style={{ width: '100%', textAlign: 'left', padding: '7px 10px', background: 'var(--bg-2, #1a1a24)', border: 'none', color: 'var(--text)', fontSize: 11.5, fontWeight: 600, cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>{title}</span><span style={{ fontSize: 10, color: '#888' }}>{open ? '▲ 접기' : `▼ 펼치기 (${pool.length})`}</span>
      </button>
      {open && (
        <div style={{ padding: 8 }}>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 6 }}>
            {['전체', ...cats].map((c) => (
              <button key={c} className={styles.copyBtn}
                style={filter === c ? { background: 'var(--accent, #7c3aed)', color: '#fff' } : undefined}
                onClick={() => setFilter(c)}>{c}</button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {visible.map((ex) => (
              <div key={ex.id || ex.nameKo} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 6, maxWidth: 160 }}>
                <button className={styles.copyBtn} title={ex.ko} style={{ width: '100%', textAlign: 'left' }} onClick={() => applyExample(ex)}>
                  {ex.custom && '📝 '}{ex.nameKo}
                </button>
                <RefThumbStrip group="freeze" itemKey={ex.nameKo} images={freezeRefs[refSlugKey(ex.nameKo)]} onUploaded={reloadFreezeRefs} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── 프리즈 비트(돌발상황 정지) 패널 — 2026-10-15 ──────────────────────────
// ChangeComboPanel(체인지 생성기)과 달리 트리거 목록·Scene B(의상 리빌)가 없다 — 의상/배경은
// 그대로고 "무슨 돌발상황인지"만 자유 입력. 성준님 피드백: "변신 장면보다, 빠르게 움직이다가
// 돌발상황이 확 펼쳐지는 순간에 멈춰서 효과가 연출되는 장면이 적합" — buildRevealCut()과
// 아키텍처 자체를 분리(server/lib/changeEffects.js buildFreezeBeatCut() 참고).
function FreezeBeatPanel({ state, dispatch }) {
  const { refsMap: freezeRefs, reload: reloadFreezeRefs } = useDirectionRefs('freeze')
  const [actionKo, setActionKo] = useState('')
  const [actionEn, setActionEn] = useState('')
  const [actionLabel, setActionLabel] = useState('')
  const [sceneA, setSceneA] = useState({ poseKo: '', poseEn: '', envEn: '', lightingEn: '' })
  const [durationSec, setDurationSec] = useState(6)
  const [beat, setBeat] = useState('긴장')
  const [cpLine, setCpLine] = useState('')
  const [orbitDegrees, setOrbitDegrees] = useState(120)
  const [openOnCloseUp, setOpenOnCloseUp] = useState(true)
  // 2026-10-22 4차 보완 — "연출 기법 설정값"(불릿타임/3D패럴랙스/1500fps 초슬로모션/셔터 앵글
  // 30도 등, PDF 12페이지)을 편집 가능하게 노출. 서버 changeEffects.js의 FREEZE_RIG가 지금까지
  // 모든 프리즈 비트 컷에 고정으로 박혀 있던 그 값 — 프리셋을 고르거나 직접 고쳐서 그대로
  // 프롬프트에 반영한다(성준님 확인: "수정 가능하게"). 기본값은 기존 FREEZE_RIG와 동일.
  const [techniquePresets, setTechniquePresets] = useState([])
  const [techniqueRig, setTechniqueRig] = useState('')
  useEffect(() => {
    fetch(`${SERVER}/api/change-combo/freeze-technique-presets`).then((r) => r.json())
      .then((d) => {
        setTechniquePresets(d.presets || [])
        if (d.presets?.[0]) setTechniqueRig((cur) => cur || d.presets[0].value)
      }).catch(() => {})
  }, [])
  const [targetCutId, setTargetCutId] = useState('')
  const [buildResult, setBuildResult] = useState(null)
  const [buildError, setBuildError] = useState('')
  const [applyMsg, setApplyMsg] = useState('')
  // 멀티앵글 키프레임(2026-10-16) — API 할당량 0(무료 티어 제외 모델)이라 이미지는 여기서
  // 안 만들고, Gemini 앱(AI Pro 웹)에 수동으로 붙여넣을 각도별 프롬프트 텍스트만 만든다.
  const [keyframes, setKeyframes] = useState(null)
  const [keyframeError, setKeyframeError] = useState('')
  const [copiedAngle, setCopiedAngle] = useState(null)
  const [keyframeUploads, setKeyframeUploads] = useState({}) // { [angleDeg]: { status, url } }

  // 2026-10-16 보강 — 내장 사건 라이브러리(FREEZE_EVENT_LIBRARY) + 사람이 저장해둔 커스텀 사건을
  // 합쳐서 보여준다. 카테고리 필터로 다양한 레퍼런스를 훑어보고, "🎲 랜덤 조합"으로 사건×장소를
  // 무작위로 묶어 새 상상을 유도한다("그 상상에서 다른 가지를 더 만들 수도 있고").
  const [customEvents, setCustomEvents] = useState([])
  const [savingCustom, setSavingCustom] = useState(false)

  const loadCustomEvents = () => {
    fetch(`${SERVER}/api/change-combo/freeze-events`).then((r) => r.json())
      .then((d) => setCustomEvents(d.events || [])).catch(() => {})
  }
  useEffect(() => { loadCustomEvents() }, [])

  const allEvents = [...FREEZE_EVENT_LIBRARY, ...customEvents]

  // 2026-10-22 4차 보완 — "상황개요": 사건×장소 선택을 참고해 자동으로 한글 요약을 써준다.
  // 그냥 참고용 텍스트고 doBuild가 서버에 보내는 실제 요청(action/sceneA)은 안 건드린다 —
  // 사용자가 자유롭게 고칠 수 있는 입력창(자동완성이지 잠금 아님).
  const [selectedLocationName, setSelectedLocationName] = useState('')
  const [locationCategoryFilter, setLocationCategoryFilter] = useState('전체')
  // 2026-10-22 그림6 — 실내는 신발 유무(신발X/신발O), 실외는 공인/특정장소로 한 단계 더
  // 세분류(성준님: "실내-1/2/3·실외-1/2처럼 세부 분류만 먼저 늘려줘"). 대분류(실내/실외)를
  // 바꾸면 소분류 선택은 의미가 없어지므로 같이 초기화한다.
  const [locationSubtypeFilter, setLocationSubtypeFilter] = useState('전체')
  const SUBTYPES_BY_CATEGORY = { 실내: ['신발X', '신발O'], 실외: ['공인', '특정장소'] }
  const [overviewKo, setOverviewKo] = useState('')
  const [overviewEdited, setOverviewEdited] = useState(false)
  useEffect(() => {
    if (overviewEdited) return
    if (!actionLabel && !selectedLocationName) return
    const place = selectedLocationName || '평소 공간'
    const event = actionLabel || '예상치 못한 상황'
    setOverviewKo(`${place}에서 평소처럼 지내다가 갑자기 '${event}' 상황이 터지는 장면`)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actionLabel, selectedLocationName])

  const applyExample = (ex) => { setActionLabel(ex.nameKo); setActionKo(ex.ko); setActionEn(ex.en); setBuildResult(null) }
  const applyLocation = (loc) => {
    setSceneA((p) => ({ ...p, envEn: loc.envEn, lightingEn: loc.lightingEn, poseKo: loc.poseKo || p.poseKo, poseEn: loc.poseEn || p.poseEn }))
    setSelectedLocationName(loc.nameKo)
    setBuildResult(null)
  }
  // 2026-10-22 재재점검 — "랜덤조합 칸을 잘 확인해서 반영" — 번외 장소까지 포함한 전체
  // 풀에서 뽑는다(일상만 뽑히던 걸 번외도 섞이게).
  const randomCombo = () => {
    applyExample(pickRandomItem(allEvents))
    applyLocation(pickRandomItem([...FREEZE_LOCATION_LIBRARY, ...FREEZE_LOCATION_LIBRARY_EXTRA]))
  }
  const saveCustomEvent = async () => {
    if (!actionLabel.trim() || !actionKo.trim() || !actionEn.trim()) return
    setSavingCustom(true)
    try {
      await fetch(`${SERVER}/api/change-combo/freeze-events`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nameKo: actionLabel, ko: actionKo, en: actionEn, category: '직접입력' }),
      })
      loadCustomEvents()
    } finally {
      setSavingCustom(false)
    }
  }

  const doBuild = async () => {
    setBuildError(''); setApplyMsg('')
    if (!actionKo.trim() || !actionEn.trim()) { setBuildError('돌발상황 설명(한글/영문)을 먼저 채워주세요.'); return }
    const r = await fetch(`${SERVER}/api/change-combo/build-freeze`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: { nameKo: actionLabel, ko: actionKo, en: actionEn }, sceneA, durationSec, beat, cpLine, orbitDegrees, openOnCloseUp, techniqueRig }),
    })
    const d = await r.json()
    if (!r.ok) { setBuildError(d.error || '생성 실패'); return }
    setBuildResult(d)
  }

  const doBuildKeyframes = async () => {
    setKeyframeError(''); setKeyframes(null)
    if (!actionKo.trim() || !actionEn.trim()) { setKeyframeError('돌발상황 설명(한글/영문)을 먼저 채워주세요.'); return }
    const r = await fetch(`${SERVER}/api/change-combo/build-freeze-keyframes`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: { nameKo: actionLabel, ko: actionKo, en: actionEn }, sceneA, techniqueRig }),
    })
    const d = await r.json()
    if (!r.ok) { setKeyframeError(d.error || '생성 실패'); return }
    setKeyframes(d.keyframes)
  }

  const copyKeyframe = (angleDeg, text) => {
    navigator.clipboard?.writeText(text)
    setCopiedAngle(angleDeg)
    setTimeout(() => setCopiedAngle((a) => (a === angleDeg ? null : a)), 1500)
  }

  // Gemini 앱에서 수동으로 생성한 각도별 결과 이미지를 다시 가져와 대상 컷의 후보 이미지
  // (cut_NN_a/_b/...) 슬롯으로 저장 — 드래그 배정·스튜디오 탭 업로드와 동일한
  // /api/upload-cut-image 를 그대로 쓴다(2026-10-16).
  const uploadKeyframeImage = async (angleDeg, file) => {
    if (!file || !targetCutId) return
    const cut = (state.cuts || []).find((c) => c.id === targetCutId)
    if (!cut) return
    setKeyframeUploads((p) => ({ ...p, [angleDeg]: { status: 'uploading' } }))
    const ext = (file.name.match(/\.([a-z0-9]+)$/i)?.[1] || 'jpg').toLowerCase().replace('jpeg', 'jpg')
    const instaContent = (state.cuts || []).map((c) => pipelineCodeToInstaContent(c.masterCode?.pl)).find(Boolean)
      || episodeContentTypeToInsta(state.episode?.contentType)
    const instaNum = instaContent ? (state.episode?.instaNum?.trim() || null) : null
    const qs = new URLSearchParams({ ep: state.episode.number, cutNo: cut.no, ext, ...(instaContent && instaNum ? { instaContent, instaNum } : {}) })
    try {
      const res = await fetch(`${SERVER}/api/upload-cut-image?${qs}`, {
        method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: file,
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '업로드 실패')
      setKeyframeUploads((p) => ({ ...p, [angleDeg]: { status: 'done', url: `${SERVER}${data.url}?t=${Date.now()}` } }))
    } catch (err) {
      setKeyframeUploads((p) => ({ ...p, [angleDeg]: { status: 'error', message: err.message } }))
    }
  }

  const commitApply = () => {
    const cut = (state.cuts || []).find((c) => c.id === targetCutId)
    if (!cut || !buildResult?.cutPatch) return
    // 돌발상황 원문(actionKo/En)·평소모습을 cutPatch와 별도 필드로 컷에 같이 저장 — 나중에
    // 이 컷을 다시 대상으로 고를 때(예: 멀티앵글 키프레임) 입력칸을 수동 재입력 없이 복원하기
    // 위함(2026-10-16, "대상 컷 지정해도 키프레임 생성이 안 먹힘" 버그 수정).
    dispatch({
      type: 'UPDATE_CUT', id: cut.id,
      p: { ...buildResult.cutPatch, freezeBeatAction: { nameKo: actionLabel, ko: actionKo, en: actionEn }, freezeBeatSceneA: sceneA },
    })
    setApplyMsg(`✅ CUT${cut.no}에 반영 완료 — G2(이미지 생성)를 돌리면 캐릭터 얼굴 레퍼런스가 자동 첨부됩니다.`)
  }

  // 대상 컷을 고르면, 그 컷에 이미 저장된 돌발상황 설명(freezeBeatAction)이 있을 경우 입력칸에
  // 그대로 불러온다 — 없으면(아직 아무 것도 적용 안 된 새 컷) 현재 입력값은 그대로 둔다.
  const selectTargetCut = (cutId) => {
    setTargetCutId(cutId)
    const cut = (state.cuts || []).find((c) => c.id === cutId)
    if (cut?.freezeBeatAction) {
      setActionLabel(cut.freezeBeatAction.nameKo || '')
      setActionKo(cut.freezeBeatAction.ko || '')
      setActionEn(cut.freezeBeatAction.en || '')
      setSceneA(cut.freezeBeatSceneA || { poseKo: '', poseEn: '', envEn: '', lightingEn: '' })
      setBuildResult(null)
    } else if (cut) {
      // 2026-10-22 그림6 — "에피소드 해당 컷 대본 설정내용 연계! 컷 연출 내용을 반영하여 자동
      // 입력" — 아직 이 컷에 프리즈 비트를 한 번도 적용 안 했으면(freezeBeatAction 없음),
      // 대본에 이미 적힌 "평소 동작"(cut.action/scene)을 끌어와 채운다. 환경·조명(영문)은
      // 대본에 그 형태(영문 묘사)로 없어서, 장소 프리셋으로 채운 값은 그대로 둔다.
      const scriptPose = cut.action || cut.scene || ''
      setSceneA((p) => (p.poseKo ? p : { ...p, poseKo: scriptPose }))
    }
  }

  return (
    // 2026-10-22 4차 보완 — PDF 12페이지: "연출 영역, 이미지 영역으로 2분할 배치!!". 왼쪽은
    // 사건·장소·설정값 등 "연출" 입력 전부, 오른쪽은 멀티앵글 키프레임(실제 이미지가 올라오는
    // 칸)만 따로 — 컷 장면과 동시에 확인하며 작업하기 좋게.
    <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', flexWrap: 'wrap' }}>
    <div style={{ flex: '1 1 480px', minWidth: 320 }}>
      <div className={styles.result} style={{ marginBottom: 14 }}>
        <div className={styles.desc} style={{ fontSize: 10.5, marginBottom: 6 }}>
          레퍼런스에서 고르거나 직접 입력하세요 — 의상·배경은 바뀌지 않고, 이 "사건" 하나만 얼어붙습니다.
          사건(아래)과 장소(그 아래)는 서로 독립이라 자유롭게 조합할 수 있습니다.
        </div>
        <div style={{ marginBottom: 8 }}>
          <button className={styles.genBtn} style={{ width: 'auto', padding: '6px 12px', marginBottom: 8 }} onClick={randomCombo}>🎲 랜덤 조합</button>
          <EventAccordionSection title="① 상황 연출 리스트" cats={SITUATION_EVENT_CATS} events={allEvents}
            freezeRefs={freezeRefs} reloadFreezeRefs={reloadFreezeRefs} applyExample={applyExample} />
          <EventAccordionSection title="② 동작·소품 연출 리스트" cats={ACTIONPROP_EVENT_CATS} events={allEvents}
            freezeRefs={freezeRefs} reloadFreezeRefs={reloadFreezeRefs} applyExample={applyExample} defaultOpen={false} />
        </div>
        {/* 2026-10-22 그림6 재지적 — "여전히 아이콘 모양으로 적용" : pill 버튼(📍 아이콘)을
            전부 걷어내고 그림과 같은 "예시 글 목록 | 장소 리스트박스" 2단 구성으로 다시 짰다.
            오른쪽 "장소 —" 칸이 실제 선택 가능한 목록(리스트박스, 선택 시 행 전체가 칠해짐)이고
            왼쪽 "예시)"는 분류 기준을 설명하는 정적 텍스트다. */}
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 10 }}>
          <div style={{ flex: '1 1 320px', minWidth: 280 }}>
            <div className={styles.desc} style={{ fontSize: 10.5, marginBottom: 4 }}>연출 장소-1(일상) — 사건과 조합해 환경·조명·평소 동작이 바뀝니다</div>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 6 }}>
              {['전체', '실내', '실외'].map((c) => (
                <button key={c} className={styles.copyBtn}
                  style={locationCategoryFilter === c ? { background: 'var(--accent, #7c3aed)', color: '#fff' } : undefined}
                  onClick={() => { setLocationCategoryFilter(c); setLocationSubtypeFilter('전체') }}>{c}</button>
              ))}
              {SUBTYPES_BY_CATEGORY[locationCategoryFilter] && ['전체', ...SUBTYPES_BY_CATEGORY[locationCategoryFilter]].map((s) => (
                <button key={s} className={styles.copyBtn} style={{ fontSize: 10, opacity: 0.85,
                  ...(locationSubtypeFilter === s ? { background: 'var(--accent, #7c3aed)', color: '#fff', opacity: 1 } : {}) }}
                  onClick={() => setLocationSubtypeFilter(s)}>{s}</button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <div style={{ flex: '0 0 120px' }}>
                <div style={{ fontSize: 9.5, color: '#888', marginBottom: 4 }}>예시)</div>
                <ul style={{ margin: 0, padding: '0 0 0 14px', fontSize: 9.5, color: '#888', lineHeight: 1.7 }}>
                  <li>실내-1 (신발 X)</li>
                  <li>실내-2 (신발 O)</li>
                  <li>실외-1 (공인)</li>
                  <li>실외-2 (특정장소)</li>
                </ul>
              </div>
              <div style={{ flex: 1, minWidth: 140 }}>
                <div style={{ fontSize: 9.5, color: '#888', marginBottom: 4 }}>장소 —</div>
                <div style={{ border: '1px solid var(--border)', borderRadius: 6, maxHeight: 190, overflowY: 'auto' }}>
                  {FREEZE_LOCATION_LIBRARY
                    .filter((loc) => locationCategoryFilter === '전체' || loc.category === locationCategoryFilter)
                    .filter((loc) => locationSubtypeFilter === '전체' || loc.subtype === locationSubtypeFilter)
                    .map((loc) => (
                    <div key={loc.nameKo} onClick={() => applyLocation(loc)}
                      style={{ padding: '6px 10px', fontSize: 12, cursor: 'pointer',
                        background: selectedLocationName === loc.nameKo ? 'var(--accent, #7c3aed)' : 'transparent',
                        color: selectedLocationName === loc.nameKo ? '#fff' : 'var(--text)' }}>
                      {loc.nameKo}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
          <div style={{ flex: '1 1 260px', minWidth: 240 }}>
            <div className={styles.desc} style={{ fontSize: 10.5, marginBottom: 4 }}>연출 장소-2(번외)</div>
            <div style={{ display: 'flex', gap: 10 }}>
              <div style={{ flex: '0 0 100px' }}>
                <div style={{ fontSize: 9.5, color: '#888', marginBottom: 4 }}>예시)</div>
                <ul style={{ margin: 0, padding: '0 0 0 14px', fontSize: 9.5, color: '#888', lineHeight: 1.7 }}>
                  <li>일상 범위 밖</li>
                  <li>장소</li>
                </ul>
              </div>
              <div style={{ flex: 1, minWidth: 140 }}>
                <div style={{ fontSize: 9.5, color: '#888', marginBottom: 4 }}>장소 —</div>
                <div style={{ border: '1px solid var(--border)', borderRadius: 6, maxHeight: 190, overflowY: 'auto' }}>
                  {FREEZE_LOCATION_LIBRARY_EXTRA.map((loc) => (
                    <div key={loc.nameKo} onClick={() => applyLocation(loc)}
                      style={{ padding: '6px 10px', fontSize: 12, cursor: 'pointer',
                        background: selectedLocationName === loc.nameKo ? 'var(--accent, #7c3aed)' : 'transparent',
                        color: selectedLocationName === loc.nameKo ? '#fff' : 'var(--text)' }}>
                      {loc.code ? `${loc.code} (${loc.nameKo})` : loc.nameKo}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className={styles.desc} style={{ fontSize: 10.5, margin: '4px 0 4px' }}>상황 개요 — 사건·장소를 고르면 자동으로 채워집니다(직접 고쳐도 됩니다)</div>
        <input className={styles.textarea} style={{ marginBottom: 10 }} placeholder="상황 개요(자동 작성)"
          value={overviewKo} onChange={(e) => { setOverviewKo(e.target.value); setOverviewEdited(true) }} />

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

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
          <label style={{ fontSize: 11, color: '#888' }}>카메라 오빗 각도</label>
          <input className={styles.textarea} style={{ width: 70 }} type="number" min={30} max={360} step={10}
            value={orbitDegrees} onChange={(e) => setOrbitDegrees(Number(e.target.value) || 120)} />
          <label style={{ fontSize: 11, color: '#888', display: 'flex', alignItems: 'center', gap: 4 }}>
            <input type="checkbox" checked={openOnCloseUp} onChange={(e) => setOpenOnCloseUp(e.target.checked)} />
            줌아웃 리빌 오프닝(10/16 실측 추천)
          </label>
        </div>

        <div className={styles.desc} style={{ fontSize: 10.5, margin: '4px 0 4px' }}>연출 기법 설정값 — 고르면 아래 칸을 채우고, 직접 고쳐도 됩니다</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
          {techniquePresets.map((p) => (
            <button key={p.name} className={styles.copyBtn}
              style={techniqueRig === p.value ? { background: 'var(--accent, #7c3aed)', color: '#fff' } : undefined}
              onClick={() => setTechniqueRig(p.value)}>{p.name}</button>
          ))}
        </div>
        <textarea className={styles.textarea} style={{ marginBottom: 10, minHeight: 50 }}
          placeholder="연출 기법 설정값(영문, 프롬프트에 그대로 들어갑니다)"
          value={techniqueRig} onChange={(e) => setTechniqueRig(e.target.value)} />

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {/* 2026-10-22 4차 보완 — "프리즈 비트 생성"은 실제 영상이 아니라 프롬프트 텍스트만
              만든다는 걸 정직하게 드러내려고 라벨만 "프리즈 프롬프트 생성"으로 바꿨다
              (doBuild 함수명·로직은 그대로). */}
          <button className={styles.genBtn} style={{ width: 'auto', padding: '8px 16px' }} onClick={doBuild}>프리즈 프롬프트 생성</button>
          <button className={styles.copyBtn} disabled={!actionLabel.trim() || !actionKo.trim() || !actionEn.trim() || savingCustom} onClick={saveCustomEvent}>
            {savingCustom ? '저장 중…' : '📝 이 사건 레퍼런스로 저장'}
          </button>
        </div>
        {buildError && <div className={styles.error} style={{ marginTop: 8 }}>{buildError}</div>}
      </div>

      {buildResult && (
        <div className={styles.result}>
          <div className={styles.resultLabel}>미리보기</div>
          <pre className={styles.resultText}>{Object.values(buildResult.preview).join('\n')}</pre>
          <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>IP (이미지 프롬프트)</div>
          <pre className={styles.resultText} style={{ fontSize: 11 }}>{buildResult.cutPatch.imagePrompt}</pre>
          <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>VP (영상 프롬프트)</div>
          <pre className={styles.resultText} style={{ fontSize: 11, marginBottom: 10 }}>{buildResult.cutPatch.videoPrompt}</pre>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <select className={styles.textarea} style={{ width: 'auto', minWidth: 220 }} value={targetCutId} onChange={(e) => selectTargetCut(e.target.value)}>
              <option value="">대상 컷 선택…</option>
              {(state.cuts || []).map((c) => <option key={c.id} value={c.id}>CUT{c.no} — {(c.cutTitle || c.scene || '').slice(0, 30)}</option>)}
            </select>
            <button className={styles.genBtn} style={{ width: 'auto', padding: '8px 16px' }} disabled={!targetCutId} onClick={commitApply}>이 컷에 반영</button>
          </div>
          {applyMsg && <div style={{ fontSize: 12, color: '#6ee7b7', marginTop: 8 }}>{applyMsg}</div>}
        </div>
      )}

      {/* 2026-10-22 4차 보완 — "우측은 멀티앵글 키프레임 카드가 아니라(좌측 하단으로 이동),
          상황연출 이미지를 업로드하는 곳" — 이 블록을 좌측(연출 영역) 맨 아래로 옮겼다. */}
      <div className={styles.result} style={{ marginTop: 14 }}>
        <div className={styles.resultLabel}>🎞️ 멀티앵글 키프레임 (8각도 정지 스틸)</div>
        <div className={styles.desc} style={{ fontSize: 10.5, marginBottom: 8 }}>
          1. 아래 버튼으로 각도별 프롬프트 8개 생성 → 2. 카드마다 "복사" → 3. Gemini 앱(AI Pro)에 서여리
          얼굴 레퍼런스 이미지와 함께 붙여넣어 생성 → 4. 받은 이미지를 같은 카드의 "결과 업로드"로 올리면
          대상 컷의 후보 이미지로 바로 저장됩니다(스튜디오 탭 이미지 목록에 그대로 나타남).
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
          <select className={styles.textarea} style={{ width: 'auto', minWidth: 220 }} value={targetCutId} onChange={(e) => selectTargetCut(e.target.value)}>
            <option value="">대상 컷 선택…</option>
            {(state.cuts || []).map((c) => <option key={c.id} value={c.id}>CUT{c.no} — {(c.cutTitle || c.scene || '').slice(0, 30)}</option>)}
          </select>
          <button className={styles.genBtn} style={{ width: 'auto', padding: '8px 16px' }} onClick={doBuildKeyframes}>
            8각도 키프레임 프롬프트 생성
          </button>
        </div>
        {!targetCutId && <div style={{ fontSize: 11, color: '#f0a050', marginBottom: 8 }}>결과 이미지를 저장하려면 대상 컷을 먼저 선택하세요(프롬프트 생성·복사는 선택 없이도 가능).</div>}
        {keyframeError && <div className={styles.error} style={{ marginTop: 8 }}>{keyframeError}</div>}

        {keyframes && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 8, marginTop: 10 }}>
            {keyframes.map((kf) => {
              const up = keyframeUploads[kf.angleDeg]
              return (
                <div key={kf.angleDeg} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                    <span style={{ fontSize: 12, fontWeight: 600 }}>{kf.label}</span>
                    <button className={styles.copyBtn} onClick={() => copyKeyframe(kf.angleDeg, kf.imagePrompt)}>
                      {copiedAngle === kf.angleDeg ? '✓ 복사됨' : '복사'}
                    </button>
                  </div>
                  <pre className={styles.resultText} style={{ fontSize: 10, maxHeight: 90, overflow: 'auto' }}>{kf.imagePrompt}</pre>
                  <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <label className={styles.copyBtn} style={{ cursor: targetCutId ? 'pointer' : 'not-allowed', opacity: targetCutId ? 1 : 0.5 }}>
                      결과 업로드
                      <input type="file" accept="image/*" style={{ display: 'none' }} disabled={!targetCutId}
                        onChange={(e) => uploadKeyframeImage(kf.angleDeg, e.target.files[0])} />
                    </label>
                    {up?.status === 'uploading' && <span style={{ fontSize: 11, color: '#888' }}>업로드 중...</span>}
                    {up?.status === 'done' && <img src={up.url} alt={kf.label} style={{ width: 32, height: 32, objectFit: 'cover', borderRadius: 4 }} />}
                    {up?.status === 'error' && <span style={{ fontSize: 11, color: '#f87171' }}>❌ {up.message}</span>}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>

    <div style={{ flex: '1 1 420px', minWidth: 320 }}>
      <FreezeSituationImagePanel
        freezeRefs={freezeRefs} reloadFreezeRefs={reloadFreezeRefs}
        actionLabel={actionLabel} selectedLocationName={selectedLocationName}
        techniquePresets={techniquePresets} techniqueRig={techniqueRig} orbitDegrees={orbitDegrees}
      />
    </div>
    </div>
  )
}
