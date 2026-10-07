import { useState } from 'react'
import { claudeMessages } from '../lib/api'
import CodeGloss from './CodeGloss'
import { useCodebook, refOptions, refGroups, lookDetail, tokensOf, koreanFor, hasUnknown, labelOf, JOINER,
  spPresets, spScreens, spLocations, spTimes, spLights, spIos, parseSp, composeSp, spKorean } from '../lib/codeRef'
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

const SILENT_PHRASE = 'NO dialogue. NO speaking. NO lip movement. MOUTH STAYS CLOSED. SILENT FILM.'

function codeBadges(t) {
  return [
    t.sh && { k: 'SH', v: t.sh },
    t.ca && { k: 'CA', v: t.ca },
    t.md && { k: 'MD', v: t.md },
    t.ac && { k: 'AC', v: t.ac },
  ].filter(Boolean)
}

// 탭 순서 = 메인 "씬 설명" 코드 · "KR 컨펌본" 항목 순서(SP → CH → SH → CA → AC → MD). 연출의도·오디오는
// 부가 설정이라 뒤쪽(2026-10-07 성준님 요청). 요소 탭 하나에 "코드 + KR 컨펌 문구 + 레퍼런스 선택지"가 같이 있다.
const MAIN_TABS = [
  { id: 'sp', label: '📍 장소 SP' },
  { id: 'ch', label: '👤 캐릭터·룩 CH' },
  { id: 'sh', label: '📐 샷 SH' },
  { id: 'ca', label: '🎥 카메라 CA' },
  { id: 'ac', label: '🏃 동작 AC' },
  { id: 'md', label: '💗 감정 MD' },
]
const SUB_TABS = [
  { id: 'intent', label: '🎬 연출의도' },
  { id: 'audio', label: '🔊 오디오' },
]
const ELEMENT = {
  sh: { name: '샷', ph: 'SH_MCU', multi: 'append' },
  ca: { name: '카메라', ph: 'CA_ST', multi: 'append' },
  ac: { name: '동작', ph: 'AT_SD_01', multi: 'toggle' },
  md: { name: '감정', ph: 'MD_JOY', multi: 'single' },
}

// 대본 만들기 탭 "KR 컨펌본" 카드 아래에 붙는 접이식(아코디언) 패널 — 팝업이 아님(2026-09-29
// 성준님 요청으로 ShotTemplatePicker 팝업에서 전환). 컷의 연출/설정 요소를 한 곳에 모아
// 초안에서 부적절한 값을 빠르게 훑어보고 고칠 수 있게 한다. 아래 각 필드는 전부 메인
// 편집기와 "같은" state/setter를 그대로 쓰므로 — 여기서 고치면 즉시 반영되고, 닫아도
// 별도 동기화가 필요 없다(따로 보관했다가 닫을 때 합치는 방식이 아님 — 그 방식은 두 곳의
// 값이 어긋나는 사고를 만들기 쉬움).
export default function DirectionSettingsPanel({ apiKey, cut, cuts, mc, audio, kr, mcField, audioField, krField, mcPatch, onApplyTemplate }) {
  const cb = useCodebook()
  const [expanded, setExpanded] = useState(false)
  const [tab, setTab] = useState('sp')
  const [openLook, setOpenLook] = useState(null)   // 펼쳐 보고 있는 의상 코드
  const [append, setAppend] = useState(false)   // 샷·카메라: 고른 코드를 앞 값 뒤에 "→" 로 이어 붙이기
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
  const usedLookIds = [...new Set((cuts || []).map(c => tokensOf('lookId', c.masterCode?.lookId)[0]).filter(Boolean))]

  // 레퍼런스에서 고르면 코드와 KR 컨펌 문구를 한 번에 메인 설정에 반영한다(둘이 어긋나지 않게).
  const pickCode = (kind, code) => {
    const cur = String(mc[kind] || '').trim()
    const mode = ELEMENT[kind].multi
    let next = code
    if (mode === 'toggle') {
      const toks = tokensOf(kind, cur)
      next = (toks.includes(code) ? toks.filter(t => t !== code) : [...toks, code]).join(JOINER[kind])
    } else if (mode === 'append' && append && cur && !tokensOf(kind, cur).includes(code)) {
      next = `${cur}${JOINER[kind]}${code}`
    }
    mcPatch({ [kind]: next, kr: { [kind]: koreanFor(cb, kind, next) } })
  }
  const pickSp = (code) => mcPatch({ sp: code, kr: { sp: spKorean(cb, code).text } })
  const sp = parseSp(mc.sp)
  const setSpPart = (key, val) => {
    const next = { io: sp.io || 'IN', loc: sp.loc, time: sp.time, light: sp.light, [key]: val }
    // 실내외 ↔ 그래픽 화면을 바꾸면 장소 목록이 달라지므로 장소 칸을 비운다. 그래픽 화면은 시간·조명이 없다.
    if (key === 'io' && (val === 'GR') !== (sp.io === 'GR')) next.loc = ''
    if (next.io === 'GR') { next.time = ''; next.light = '' }
    pickSp(composeSp(next))
  }
  // lookId: "LOOK_CS" 또는 "LOOK_CS (상반신)" — krText 가 있으면 KR 컨펌 문구(CH)도 그 구성으로 바꾼다
  const pickLook = (lookId, krText) => {
    const code = (String(lookId).match(/LOOK[A-Z0-9_]*/) || [lookId])[0]
    const ch = String(mc.ch || '')
    const nextCh = /LOOK[A-Z0-9_]*/.test(ch) ? ch.replace(/LOOK[A-Z0-9_]*/, code) : (ch.trim() ? ch : `서여리 / ${code}`)
    const text = krText || labelOf(cb, 'lookId', code)
    mcPatch({ lookId, ch: nextCh, ...(text ? { kr: { ch: text } } : {}) })
  }
  const curLook = (tokensOf('lookId', mc.lookId)[0]) || ''
  const lookRef = refOptions(cb, 'lookId')
  const lookExtra = usedLookIds.filter(c => /^LOOK/.test(c) && !lookRef.some(o => o.code === c))
  const warnTab = { sp: hasUnknown(cb, 'sp', mc.sp), ch: hasUnknown(cb, 'lookId', mc.lookId), sh: hasUnknown(cb, 'sh', mc.sh), ca: hasUnknown(cb, 'ca', mc.ca), ac: hasUnknown(cb, 'ac', mc.ac), md: hasUnknown(cb, 'md', mc.md) }
  const chip = (on) => `${s.chip} ${on ? s.chipOn : ''}`

  return (
    <div className={s.panel}>
      <button type="button" className={s.header} onClick={() => setExpanded(v => !v)}>
        <span className={s.chevron}>{expanded ? '▾' : '▸'}</span>
        <span className={s.title}>🔍 설정 점검 — 장소 · 캐릭터 · 샷 · 카메라 · 동작 · 감정</span>
        <span className={s.hint}>초안 설정을 확인하고 레퍼런스에서 고르면 위 씬 설명·KR 컨펌본에 바로 반영됩니다</span>
      </button>

      {expanded && (
        <div className={s.body}>
          <div className={s.tabs}>
            {MAIN_TABS.map(t => (
              <button key={t.id} type="button" className={`${s.tabBtn} ${tab === t.id ? s.tabBtnOn : ''}`} onClick={() => setTab(t.id)}
                title={warnTab[t.id] ? '레퍼런스(코드북)에 없는 코드가 있습니다' : undefined}>
                {t.label}{warnTab[t.id] && <span style={{ color: '#f59e0b' }}> ⚠</span>}
              </button>
            ))}
            <span style={{ alignSelf: 'center', fontSize: 11, color: 'var(--text-3)', margin: '0 2px 0 8px' }}>부가</span>
            {SUB_TABS.map(t => (
              <button key={t.id} type="button" className={`${s.tabBtn} ${tab === t.id ? s.tabBtnOn : ''}`} onClick={() => setTab(t.id)}>
                {t.label}
              </button>
            ))}
          </div>

          {tab === 'sp' && (
            <div className={s.tabBody}>
              <div className={s.v3SubGrid}>
                <div className={s.v3MiniField}>
                  <label>SP 코드 (장소)</label>
                  <input value={mc.sp || ''} onChange={e => mcField('sp', e.target.value)} placeholder="OT.CF.TZ_AF.LT_WM" />
                  <CodeGloss cb={cb} kind="sp" value={mc.sp} />
                </div>
                <div className={s.v3MiniField}>
                  <label>KR 컨펌 문구 — SP(장소)</label>
                  <textarea rows={2} value={kr.sp || ''} onChange={e => krField('sp', e.target.value)} />
                </div>
              </div>
              <div className={s.refTitle}>레퍼런스 — 자주 쓰는 장소</div>
              <div className={s.chipRow}>
                {spPresets(cb).map(o => (
                  <button key={o.code} type="button" className={chip(sp.code === o.code)} onClick={() => pickSp(o.code)} title={o.code}>
                    {o.code} <span className={s.chipDesc}>({o.label})</span>
                  </button>
                ))}
              </div>
              <div className={s.refTitle}>레퍼런스 — 화면 종류 (실제 장소가 아닌 컷)</div>
              <div className={s.chipRow}>
                {spScreens(cb).map(o => (
                  <button key={o.code} type="button" className={chip(sp.code === `GR.${o.code}`)} onClick={() => pickSp(`GR.${o.code}`)}>
                    GR.{o.code} <span className={s.chipDesc}>({o.label})</span>
                  </button>
                ))}
              </div>
              <div className={s.refTitle}>직접 조합 — 실내외 · 장소 · 시간 · 조명</div>
              <div className={s.spRow}>
                {[['io', spIos(), '실내외'], ['loc', spLocations(cb, sp.io), sp.io === 'GR' ? '화면 종류' : '장소'], ['time', spTimes(cb), '시간'], ['light', spLights(cb), '조명']].map(([key, opts, name]) => (
                  <select key={key} value={sp[key] || ''} onChange={e => setSpPart(key, e.target.value)}>
                    <option value="">{name} —</option>
                    {sp[key] && !opts.some(o => o.code === sp[key]) && <option value={sp[key]}>{sp[key]} (레퍼런스에 없음)</option>}
                    {opts.map(o => <option key={o.code} value={o.code}>{o.code} ({o.label})</option>)}
                  </select>
                ))}
              </div>
            </div>
          )}

          {tab === 'ch' && (
            <div className={s.tabBody}>
              <div className={s.v3SubGrid}>
                <div className={s.v3MiniField}>
                  <label>CH 코드 (캐릭터·룩)</label>
                  <input value={mc.ch || ''} onChange={e => mcField('ch', e.target.value)} placeholder="서여리 / LOOK_CS" />
                  <CodeGloss cb={cb} kind="ch" value={mc.ch} />
                </div>
                <div className={s.v3MiniField}>
                  <label>LOOK_ID</label>
                  <input value={mc.lookId || ''} onChange={e => mcField('lookId', e.target.value)} placeholder="LOOK_CS" />
                  <CodeGloss cb={cb} kind="lookId" value={mc.lookId} />
                </div>
              </div>
              <div className={s.v3MiniField}>
                <label>KR 컨펌 문구 — CH(캐릭터)</label>
                <textarea rows={2} value={kr.ch || ''} onChange={e => krField('ch', e.target.value)} />
              </div>
              <div className={s.refTitle}>레퍼런스 — 등록된 의상 (▸ 펼치면 구성과 상황별 설정)</div>
              {refGroups(cb, 'lookId').map(g => (
                <div key={g.group} className={s.refGroup}>
                  <div className={s.refGroupName}>{g.group || '기타'}</div>
                  <div className={s.lookList}>
                    {g.items.map(o => {
                      const d = lookDetail(cb, o.code)
                      const open = openLook === o.code
                      return (
                        <div key={o.code} className={`${s.lookItem} ${curLook === o.code ? s.lookItemOn : ''}`}>
                          <div className={s.lookHead}>
                            <button type="button" className={s.lookToggle} onClick={() => setOpenLook(open ? null : o.code)}>
                              {open ? '▾' : '▸'} {o.code} <span className={s.chipDesc}>({o.label})</span>
                              {d?.base && <span className={s.chipDesc}> ← {d.base} 변형</span>}
                            </button>
                            <button type="button" className={s.chip} onClick={() => pickLook(o.code, d?.framings[0]?.text)}>전신으로 선택</button>
                          </div>
                          {open && d && (
                            <div className={s.lookBody}>
                              {d.summary.code && (
                                <div className={s.lookSummary}>요약 코드 <b>{d.summary.code}</b> <span className={s.chipDesc}>({d.summary.ko})</span></div>
                              )}
                              <div className={s.lookParts}>
                                {d.partRows.map(r => (
                                  <div key={r.key} className={s.lookPart}>
                                    <span>{r.name}</span>{r.text}
                                    {r.code && <em> {r.code}({r.codeLabel})</em>}
                                  </div>
                                ))}
                              </div>
                              <div className={s.refGroupName}>화면에 잡히는 범위</div>
                              {d.framings.map(f => (
                                <button key={f.lookId} type="button" className={`${s.lookOpt} ${mc.lookId === f.lookId ? s.chipOn : ''}`} onClick={() => pickLook(f.lookId, f.text)}>
                                  <b>{f.name}</b> {f.text}
                                </button>
                              ))}
                              {d.situations.length > 0 && (<>
                                <div className={s.refGroupName}>상황별</div>
                                {d.situations.map(f => (
                                  <button key={f.lookId} type="button" className={`${s.lookOpt} ${mc.lookId === f.lookId ? s.chipOn : ''}`} onClick={() => pickLook(f.lookId, f.text)}>
                                    <b>{f.name}</b> {f.text}
                                  </button>
                                ))}
                              </>)}
                              {!d.hasPrompt && <div className={s.note}>영어 의상 문장(프롬프트용)이 아직 등록되지 않은 의상입니다.</div>}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}
              {lookExtra.length > 0 && (<>
                <div className={s.refTitle}>이 에피소드 다른 컷에서 쓴 룩 (레퍼런스 미등록)</div>
                <div className={s.chipRow}>
                  {lookExtra.map(code => (
                    <button key={code} type="button" className={chip(curLook === code)} onClick={() => pickLook(code)}>{code}</button>
                  ))}
                </div>
              </>)}
            </div>
          )}

          {ELEMENT[tab] && (() => {
            const el = ELEMENT[tab]
            const KEY = tab === 'ac' ? 'AC' : tab.toUpperCase()
            const cur = tokensOf(tab, mc[tab])
            return (
              <div className={s.tabBody}>
                <div className={s.v3SubGrid}>
                  <div className={s.v3MiniField}>
                    <label>{KEY} 코드 ({el.name})</label>
                    <input value={mc[tab] || ''} onChange={e => mcField(tab, e.target.value)} placeholder={el.ph} />
                    <CodeGloss cb={cb} kind={tab} value={mc[tab]} sep={JOINER[tab]} />
                  </div>
                  <div className={s.v3MiniField}>
                    <label>KR 컨펌 문구 — {KEY}({el.name})</label>
                    <textarea rows={2} value={kr[tab] || ''} onChange={e => krField(tab, e.target.value)} />
                  </div>
                </div>
                <div className={s.refTitle}>
                  레퍼런스 — {el.multi === 'toggle' ? '여러 개 선택 가능(다시 누르면 해제)' : '누르면 바로 반영'}
                  {el.multi === 'append' && (
                    <label className={s.checkboxRow} style={{ marginLeft: 12, display: 'inline-flex' }}>
                      <input type="checkbox" checked={append} onChange={e => setAppend(e.target.checked)} />
                      앞 값 뒤에 이어 붙이기 (→ 전환)
                    </label>
                  )}
                </div>
                {refGroups(cb, tab).map(g => (
                  <div key={g.group} className={s.refGroup}>
                    <div className={s.refGroupName}>{g.group || '기타'}</div>
                    <div className={s.chipRow} style={{ marginTop: 0 }}>
                      {g.items.map(o => (
                        <button key={o.code} type="button" className={chip(cur.includes(o.code))} onClick={() => pickCode(tab, o.code)}>
                          {o.code} <span className={s.chipDesc}>({o.label})</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )
          })()}

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
        </div>
      )}
    </div>
  )
}
