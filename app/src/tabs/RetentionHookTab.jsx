// src/tabs/RetentionHookTab.jsx
// yeori-studio에 그대로 붙여넣기 가능한 파일
// 위치: src/tabs/RetentionHookTab.jsx

import { useState } from 'react'
import { useApp } from '../context/AppContext'
import styles from './RetentionHookTab.module.css'

const HOOK_CONFIG = [
  { key: 'opening', label: '오프닝 훅',    time: '0:00 ~ 0:30', color: '#534AB7', emotions: ['궁금증','충격','공감','호기심'],   placeholder: '질문 또는 갈등을 제시하세요...' },
  { key: 'mid1',    label: '1차 리텐션 훅', time: '2분 ~ 3분',  color: '#0F6E56', emotions: ['반전','예고','긴장감','놀람'],     placeholder: '반전 또는 예고를 입력하세요...' },
  { key: 'mid2',    label: '2차 리텐션 훅', time: '6분 ~ 7분',  color: '#0F6E56', emotions: ['감동','공감','피크','울컥'],       placeholder: '감정 피크 순간을 입력하세요...' },
  { key: 'closing', label: '클로징 CTA',    time: '마지막 2분', color: '#3B6D11', emotions: ['떡밥','예고','구독유도','기대감'], placeholder: '다음 화 예고 또는 구독 유도...' },
]

export default function RetentionHookTab() {
  const { state } = useApp()
  const [hooks, setHooks] = useState(
    Object.fromEntries(HOOK_CONFIG.map(h => [h.key, { text: '', emotions: [] }]))
  )
  const [loading, setLoading] = useState(false)
  const [result, setResult]   = useState('')
  const [error, setError]     = useState('')

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
    <div className={styles.wrap}>
      <div className={styles.header}>
        <h2 className={styles.title}>리텐션 훅 설계</h2>
        <p className={styles.desc}>4구간 훅을 설정하면 서여리 말투로 CUT 스크립트를 자동 생성합니다</p>
      </div>

      <div className={styles.grid}>
        {HOOK_CONFIG.map(h => (
          <div key={h.key} className={styles.card} style={{ borderLeftColor: h.color }}>
            <div className={styles.cardLabel}>{h.label}</div>
            <div className={styles.cardTime}>{h.time}</div>
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
    </div>
  )
}
