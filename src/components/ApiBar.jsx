import { useState } from 'react'
import { useApp } from '../context/AppContext'
import { elUser, claudeMessages } from '../lib/api'
import styles from './ApiBar.module.css'

export default function ApiBar() {
  const { state, dispatch } = useApp()
  const { apiKeys, vertexAI, elevenLabsStatus } = state
  const [checking, setChecking] = useState({})

  const checkElevenLabs = async () => {
    if (!apiKeys.elevenLabs) return
    setChecking(c => ({ ...c, el: true }))
    try {
      const res = await elUser(apiKeys.elevenLabs)
      const data = await res.json()
      if (res.ok) {
        // GET /v1/user 응답: { subscription: { character_count, character_limit } }
        const sub = data.subscription ?? {}
        const limit = sub.character_limit ?? 0
        const used  = sub.character_count  ?? 0
        dispatch({ type: 'SET_EL_STATUS', p: {
          connected: true,
          remainingChars: limit - used,
        }})
      } else {
        dispatch({ type: 'SET_EL_STATUS', p: { connected: false, remainingChars: 0 }})
        const msg = data?.detail?.message ?? data?.detail ?? 'API 키를 확인하세요'
        alert(`ElevenLabs 연동 실패: ${msg}`)
      }
    } catch (err) {
      dispatch({ type: 'SET_EL_STATUS', p: { connected: false, remainingChars: 0 }})
      alert(`프록시 서버 연결 실패 — npm run dev 가 실행 중인지 확인하세요.\n${err.message}`)
    } finally {
      setChecking(c => ({ ...c, el: false }))
    }
  }

  const checkClaude = async () => {
    if (!apiKeys.claude) return
    setChecking(c => ({ ...c, claude: true }))
    try {
      const res = await claudeMessages(apiKeys.claude, {
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 10,
        messages: [{ role: 'user', content: 'hi' }],
      })
      if (res.ok) alert('✅ Claude API 연결 성공! (프록시 경유)')
      else { const e = await res.json(); alert('❌ Claude API 키 오류: ' + (e.error?.message || res.status)) }
    } catch (err) { alert('❌ 프록시 서버 연결 실패\nserver/proxy.js가 실행 중인지 확인하세요.\n' + err.message) }
    finally { setChecking(c => ({ ...c, claude: false })) }
  }

  return (
    <div className={styles.bar}>
      <div className={styles.group}>
        <span className={styles.label}>GEMINI</span>
        <input className={styles.input} type="password" placeholder="API 키 입력"
          value={apiKeys.gemini}
          onChange={e => dispatch({ type: 'SET_API_KEY', key: 'gemini', val: e.target.value })} />
        <button className={styles.checkBtn}>확인</button>
      </div>

      <div className={styles.divider} />

      <div className={styles.group}>
        <span className={styles.label}>Vertex AI</span>
        <button
          className={`${styles.toggle} ${vertexAI ? styles.on : ''}`}
          onClick={() => dispatch({ type: 'TOGGLE_VERTEX' })}
        >
          <span className={styles.toggleThumb} />
        </button>
        <span className={styles.toggleLabel}>{vertexAI ? 'ON' : 'OFF'}</span>
      </div>

      <div className={styles.divider} />

      <button className={styles.googleBtn}>
        <svg width="14" height="14" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
        구글 로그인
      </button>

      <div className={styles.divider} />

      <div className={styles.group}>
        <span className={styles.label}>ELEVENLABS</span>
        <div className={`${styles.elStatus} ${elevenLabsStatus.connected ? styles.connected : ''}`}>
          <span className={styles.statusDot} />
          {elevenLabsStatus.connected
            ? `연결됨 · ${elevenLabsStatus.remainingChars.toLocaleString()}자 남음`
            : '미연결'}
        </div>
        <input className={styles.input} type="password" placeholder="API 키"
          value={apiKeys.elevenLabs}
          onChange={e => dispatch({ type: 'SET_API_KEY', key: 'elevenLabs', val: e.target.value })} />
        <button className={styles.checkBtn} onClick={checkElevenLabs} disabled={checking.el}>
          {checking.el ? '확인중…' : '연동'}
        </button>
      </div>

      <div className={styles.divider} />

      <div className={styles.group}>
        <span className={styles.label}>CLAUDE</span>
        <input className={styles.input} type="password" placeholder="API 키 입력"
          value={apiKeys.claude}
          onChange={e => dispatch({ type: 'SET_API_KEY', key: 'claude', val: e.target.value })} />
        <button className={styles.checkBtn} onClick={checkClaude} disabled={checking.claude}>
          {checking.claude ? '확인중…' : '확인'}
        </button>
      </div>
    </div>
  )
}
