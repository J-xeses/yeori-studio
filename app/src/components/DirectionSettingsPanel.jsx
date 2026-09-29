import { useState } from 'react'
import { claudeMessages } from '../lib/api'
import s from './DirectionSettingsPanel.module.css'

// 룰셋 v1.4.5 §②-1 "샷타입별 검증된 프롬프트 템플릿"(2026-09-29 신설, 성준님 실측 테스트로
// 검증된 5개 패턴)을 그대로 코드화한 것. 새 코드값을 여기서 지어내지 말고, 룰셋이 바뀌면
// 이 배열도 함께 갱신할 것 — yeori_ruleset_v1.4.md §②-1 원본과 동기화 유지.
export const SHOT_TEMPLATES = [
  {
    id: 'T01', label: '정지 클로즈업 — 눈빛·표정 강조',
    sh: 'SH_ECU', ca: '', md: '', ac: '',
    phrase: 'extreme close-up shot, eyes and lips fill the frame, only face visible, background fully out of focus, camera locked, no camera movement',
  },
  {
    id: 'T02', label: '와이드 + 좌우 패닝 — 이동 강조',
    sh: 'SH_WS', ca: 'CA_PAN', md: '', ac: '',
    phrase: 'wide shot, full body in frame, generous background space, camera pans horizontally left to right following her movement, smooth steady pan, no shake',
  },
  {
    id: 'T03', label: '몽환 미디엄클로즈업 — 드리미 톤',
    sh: 'SH_MCU', ca: '', md: 'MD_DRM', ac: '',
    phrase: 'medium close-up, dreamy hazy pastel atmosphere throughout, strong bokeh, light bloom effect, minimal body movement, camera locked',
  },
  {
    id: 'T04', label: '측면 트래킹 — 동행 이동(전신 포함)',
    sh: '', ca: 'CA_TR', md: '', ac: 'AT_MW_01',
    phrase: 'upper body to full body in frame, camera tracks alongside her at the same pace, smooth lateral tracking shot, steady movement',
  },
  {
    id: 'T05', label: '줌인 — 미디엄에서 클로즈업으로',
    sh: 'SH_MS', ca: 'CA_ZI', md: '', ac: '',
    phrase: 'starts as medium shot, camera slowly zooms in toward her face, smooth continuous zoom, medium shot → close-up',
  },
]

// 룰셋 §⑬ "샷타입 코드 표준화" — 새 코드값을 여기서 지어내지 말 것, 룰셋과 동기화 유지.
const SH_CODES = [
  ['SH_ECU', '익스트림 클로즈업'], ['SH_CU', '클로즈업'], ['SH_MCU', '미디엄 클로즈업'],
  ['SH_MS', '미디엄샷'], ['SH_MLS', '미디엄롱샷'], ['SH_FS', '풀샷(전신)'], ['SH_WS', '와이드샷'],
]

const SILENT_PHRASE = 'NO dialogue. NO speaking. NO lip movement. MOUTH STAYS CLOSED. SILENT FILM.'

function codeBadges(t) {
  return [
    t.sh && { k: 'SH', v: t.sh },
    t.ca && { k: 'CA', v: t.ca },
    t.md && { k: 'MD', v: t.md },
    t.ac && { k: 'AC', v: t.ac },
  ].filter(Boolean)
}

const TABS = [
  { id: 'intent', label: '🎬 연출의도' },
  { id: 'shot', label: '📐 샷타입' },
  { id: 'look', label: '🎭 LOOK_ID' },
  { id: 'audio', label: '🔊 오디오' },
  { id: 'kr', label: '✅ KR 컨펌본' },
]

// 대본 만들기 탭 "KR 컨펌본" 카드 아래에 붙는 접이식(아코디언) 패널 — 팝업이 아님(2026-09-29
// 성준님 요청으로 ShotTemplatePicker 팝업에서 전환). 컷의 연출/설정 요소를 한 곳에 모아
// 초안에서 부적절한 값을 빠르게 훑어보고 고칠 수 있게 한다. 아래 각 필드는 전부 메인
// 편집기와 "같은" state/setter를 그대로 쓰므로 — 여기서 고치면 즉시 반영되고, 닫아도
// 별도 동기화가 필요 없다(따로 보관했다가 닫을 때 합치는 방식이 아님 — 그 방식은 두 곳의
// 값이 어긋나는 사고를 만들기 쉬움).
export default function DirectionSettingsPanel({ apiKey, cut, cuts, mc, audio, kr, mcField, audioField, krField, onApplyTemplate }) {
  const [expanded, setExpanded] = useState(false)
  const [tab, setTab] = useState('intent')
  const [recommended, setRecommended] = useState(null)
  const [aiLoading, setAiLoading] = useState(false)
  const [aiError, setAiError] = useState('')
  const [silent, setSilent] = useState(false)

  const askAI = async () => {
    if (!apiKey) { setAiError('Claude API 키가 필요합니다 (상단 API 바)'); return }
    setAiLoading(true); setAiError('')
    try {
      const cutBrief = [
        cut?.scene && `씬: ${cut.scene}`,
        cut?.action && `액션: ${cut.action}`,
        cut?.dialogue && !/^없음$/.test(cut.dialogue) && `대사: ${cut.dialogue}`,
        cut?.narration && !/^없음$/.test(cut.narration) && `나레이션: ${cut.narration}`,
      ].filter(Boolean).join('\n') || '(컷 내용 미입력)'

      const catalog = SHOT_TEMPLATES.map(t => `${t.id}: ${t.label} — ${t.phrase}`).join('\n')
      const res = await claudeMessages(apiKey, {
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 200,
        messages: [{
          role: 'user',
          content: `다음은 검증된 샷/카메라 템플릿 5개입니다:\n${catalog}\n\n아래 컷 내용에 가장 잘 어울리는 템플릿 하나를 고르세요:\n${cutBrief}\n\nJSON만 출력하세요(다른 텍스트 금지): {"id":"T01","reason":"한 줄 이유(한글)"}`,
        }],
      })
      const data = await res.json()
      const text = (data.content || []).find(b => b.type === 'text')?.text || ''
      const parsed = JSON.parse(text.replace(/```json|```/g, '').trim())
      if (!SHOT_TEMPLATES.find(t => t.id === parsed.id)) throw new Error('알 수 없는 템플릿 id')
      setRecommended(parsed)
    } catch (e) {
      setAiError('AI 추천 실패: ' + e.message)
    } finally {
      setAiLoading(false)
    }
  }

  const applyTemplate = (t) => {
    onApplyTemplate({
      sh: t.sh || undefined, ca: t.ca || undefined, md: t.md || undefined, ac: t.ac || undefined,
      phrase: silent ? `${t.phrase}\n${SILENT_PHRASE}` : t.phrase,
    })
  }

  // 이 에피소드 다른 컷들이 이미 쓴 LOOK_ID — 전역 고정 목록이 없어(에피소드마다 자유 의상이라
  // §⑥ 원칙), 같은 에피소드 안에서 일관되게 재사용하도록 후보로 보여준다(오타로 인한 컷간
  // 룩 불일치 방지 목적).
  const usedLookIds = [...new Set((cuts || []).map(c => c.masterCode?.lookId).filter(Boolean))]

  return (
    <div className={s.panel}>
      <button type="button" className={s.header} onClick={() => setExpanded(v => !v)}>
        <span className={s.chevron}>{expanded ? '▾' : '▸'}</span>
        <span className={s.title}>🔍 설정 점검 — 연출의도 · 샷타입 · LOOK_ID · 오디오 · KR 컨펌본</span>
        <span className={s.hint}>초안에 부적절한 값이 있는지 훑어보고 여기서 바로 고치세요</span>
      </button>

      {expanded && (
        <div className={s.body}>
          <div className={s.tabs}>
            {TABS.map(t => (
              <button key={t.id} type="button" className={`${s.tabBtn} ${tab === t.id ? s.tabBtnOn : ''}`} onClick={() => setTab(t.id)}>
                {t.label}
              </button>
            ))}
          </div>

          {tab === 'intent' && (
            <div className={s.tabBody}>
              <div className={s.controls}>
                <button type="button" className={s.aiBtn} onClick={askAI} disabled={aiLoading}>
                  {aiLoading ? '추천 중...' : '✨ 이 컷에 AI 추천받기'}
                </button>
                <label className={s.checkboxRow}>
                  <input type="checkbox" checked={silent} onChange={e => setSilent(e.target.checked)} />
                  무발화 컷(나레이션) 문구 추가
                </label>
              </div>
              {aiError && <div className={s.error}>{aiError}</div>}
              <div className={s.list}>
                {SHOT_TEMPLATES.map(t => {
                  const isRec = recommended?.id === t.id
                  return (
                    <div key={t.id} className={`${s.card} ${isRec ? s.cardRecommended : ''}`}>
                      <div className={s.cardHeader}>
                        <span className={s.cardLabel}>{t.id} · {t.label}</span>
                        {isRec && <span className={s.recBadge}>✨ AI 추천</span>}
                      </div>
                      <div className={s.codeBadges}>
                        {codeBadges(t).map(b => <span key={b.k} className={s.badge}>{b.k}: {b.v}</span>)}
                      </div>
                      <div className={s.phrase}>{t.phrase}</div>
                      {isRec && recommended.reason && <div className={s.reason}>💡 {recommended.reason}</div>}
                      <button type="button" className={s.applyBtn} onClick={() => applyTemplate(t)}>이 템플릿 적용</button>
                    </div>
                  )
                })}
              </div>
              <div className={s.note}>적용 시 SH/CA/MD/AC의 빈 필드만 채우고(기존 값 보존), 핵심 문구는 VP 앞에 삽입됩니다.</div>
            </div>
          )}

          {tab === 'shot' && (
            <div className={s.tabBody}>
              <div className={s.v3MiniField}>
                <label>SH (샷타입) — 현재값</label>
                <input value={mc.sh || ''} onChange={e => mcField('sh', e.target.value)} placeholder="SH_MCU" />
              </div>
              <div className={s.chipRow}>
                {SH_CODES.map(([code, desc]) => (
                  <button key={code} type="button" className={`${s.chip} ${mc.sh === code ? s.chipOn : ''}`} onClick={() => mcField('sh', code)} title={desc}>
                    {code} <span className={s.chipDesc}>{desc}</span>
                  </button>
                ))}
              </div>
              <div className={s.note}>룰셋 §⑬ 표준 샷타입 7종(칩 클릭으로 바로 반영).</div>
            </div>
          )}

          {tab === 'look' && (
            <div className={s.tabBody}>
              <div className={s.v3MiniField}>
                <label>LOOK_ID — 현재값</label>
                <input value={mc.lookId || ''} onChange={e => mcField('lookId', e.target.value)} placeholder="LOOK_CS" />
              </div>
              {usedLookIds.length > 0 ? (
                <>
                  <div className={s.chipRow}>
                    {usedLookIds.map(code => (
                      <button key={code} type="button" className={`${s.chip} ${mc.lookId === code ? s.chipOn : ''}`} onClick={() => mcField('lookId', code)}>
                        {code}
                      </button>
                    ))}
                  </div>
                  <div className={s.note}>이 에피소드 다른 컷들이 쓴 LOOK_ID입니다 — 오타로 컷 사이 의상·룩이 어긋나지 않게 같은 코드를 재사용하세요.</div>
                </>
              ) : (
                <div className={s.note}>아직 다른 컷에 LOOK_ID가 없습니다. 이 컷이 처음이면 자유롭게 정하세요(예: LOOK_CS, LOOK_AUT).</div>
              )}
            </div>
          )}

          {tab === 'audio' && (
            <div className={s.tabBody}>
              <div className={s.v3SubGrid}>
                <div className={s.v3MiniField}><label>BGM</label><input placeholder="밝은 오프닝 BGM 잔잔하게" value={audio.bgm || ''} onChange={e => audioField('bgm', e.target.value)} /></div>
                <div className={s.v3MiniField}><label>음성</label><input placeholder="★립싱크 여부·톤" value={audio.voice || ''} onChange={e => audioField('voice', e.target.value)} /></div>
                <div className={s.v3MiniField}><label>효과음</label><input placeholder="힐 소리" value={audio.sfx || ''} onChange={e => audioField('sfx', e.target.value)} /></div>
                <div className={s.v3MiniField}><label>앰비언스</label><input placeholder="카페 환경음" value={audio.ambience || ''} onChange={e => audioField('ambience', e.target.value)} /></div>
              </div>
            </div>
          )}

          {tab === 'kr' && (
            <div className={s.tabBody}>
              <div className={s.v3SubGrid}>
                <div className={s.v3MiniField}><label>SP(장소)</label><textarea rows={2} value={kr.sp || ''} onChange={e => krField('sp', e.target.value)} /></div>
                <div className={s.v3MiniField}><label>CH(캐릭터)</label><textarea rows={2} value={kr.ch || ''} onChange={e => krField('ch', e.target.value)} /></div>
                <div className={s.v3MiniField}><label>SH(샷)</label><textarea rows={2} value={kr.sh || ''} onChange={e => krField('sh', e.target.value)} /></div>
                <div className={s.v3MiniField}><label>CA(카메라)</label><textarea rows={2} value={kr.ca || ''} onChange={e => krField('ca', e.target.value)} /></div>
                <div className={s.v3MiniField}><label>AC(동작)</label><textarea rows={2} value={kr.ac || ''} onChange={e => krField('ac', e.target.value)} /></div>
                <div className={s.v3MiniField}><label>MD(감정)</label><textarea rows={2} value={kr.md || ''} onChange={e => krField('md', e.target.value)} /></div>
              </div>
              <div className={s.note}>DL/NR/CP는 좌측 "씬 설명" 값을 그대로 미러링합니다(여기선 수정 불가 — 원본에서 고치세요).</div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
