import { useState } from 'react'
import { claudeMessages } from '../lib/api'
import s from './ShotTemplatePicker.module.css'

// 룰셋 v1.4.5 §②-1 "샷타입별 검증된 프롬프트 템플릿" (2026-09-29 신설, 성준님 실측 테스트로
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

const SILENT_PHRASE = 'NO dialogue. NO speaking. NO lip movement. MOUTH STAYS CLOSED. SILENT FILM.'

function codeBadges(t) {
  return [
    t.sh && { k: 'SH', v: t.sh },
    t.ca && { k: 'CA', v: t.ca },
    t.md && { k: 'MD', v: t.md },
    t.ac && { k: 'AC', v: t.ac },
  ].filter(Boolean)
}

// 대본 만들기 탭 컷 편집기의 SH/CA/MD/AC 필드 옆에 붙는 "연출 세부설정 반자동화" 팝업.
// 완전 자동 적용이 아니라 — 사람이 5개 검증된 템플릿 중 직접 고르거나(항상 가능, API 불필요),
// "AI 추천"으로 이 컷 내용에 맞는 템플릿을 한 번 추천받은 뒤에도 반드시 "적용" 버튼을
// 눌러야 실제 필드에 반영된다(2026-09-29, 문제3 요구사항 — 완전자동 금지, 최종 확인은 사람).
export default function ShotTemplatePicker({ apiKey, cut, onApply }) {
  const [open, setOpen] = useState(false)
  const [recommended, setRecommended] = useState(null) // { id, reason }
  const [aiLoading, setAiLoading] = useState(false)
  const [aiError, setAiError] = useState('')
  const [silent, setSilent] = useState(false)

  const close = () => { setOpen(false); setRecommended(null); setAiError('') }

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

  const apply = (t) => {
    onApply({
      sh: t.sh || undefined,
      ca: t.ca || undefined,
      md: t.md || undefined,
      ac: t.ac || undefined,
      phrase: silent ? `${t.phrase}\n${SILENT_PHRASE}` : t.phrase,
    })
    close()
  }

  return (
    <>
      <button type="button" className={s.trigger} onClick={() => setOpen(true)} title="룰셋 §②-1 검증된 샷/카메라 템플릿에서 선택">
        🎬 연출 템플릿
      </button>

      {open && (
        <div className={s.overlay} onMouseDown={e => e.target === e.currentTarget && close()}>
          <div className={s.popup}>
            <div className={s.header}>
              <span className={s.title}>연출 템플릿 (룰셋 §②-1 검증됨)</span>
              <button type="button" className={s.closeBtn} onClick={close}>✕</button>
            </div>

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
                    <button type="button" className={s.applyBtn} onClick={() => apply(t)}>이 템플릿 적용</button>
                  </div>
                )
              })}
            </div>

            <div className={s.note}>
              적용 시 SH/CA/MD/AC 필드는 템플릿 값으로 채워지고(빈 값은 건드리지 않음), 핵심 문구는 VP(영상 프롬프트) 앞에 삽입됩니다 — 적용 후에도 자유롭게 수정 가능합니다.
            </div>
          </div>
        </div>
      )}
    </>
  )
}
