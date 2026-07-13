import { useState } from 'react'
import { useApp } from '../context/AppContext'
import styles from './NavBar.module.css'

const TABS = [
  { id: 'script',        label: '대본 생성',        icon: '📝' },
  { id: 'studio',        label: '스튜디오',          icon: '🎬' },
  { id: 'tts',           label: 'ElevenLabs TTS',   icon: '🔊' },
  { id: 'voice',         label: '내 음성 삽입',      icon: '🎙️' },
  { id: 'extract',       label: '추출',              icon: '📤' },
  { id: 'video',         label: '영상 만들기',        icon: '🎞️' },
  { id: 'retention',     label: '리텐션 훅',          icon: '🎯' },
  { id: 'editmeta',      label: '편집 메타',          icon: '🗂️' },
  { id: 'publishing',    label: '퍼블리싱',          icon: '🚀' },
  { id: 'dashboard',     label: '대시보드',           icon: '📊' },
  { id: 'storyarchive',  label: '스토리 아카이브',    icon: '📚' },
]

export default function NavBar() {
  const { state, dispatch, syncStatus } = useApp()
  const [toast, setToast] = useState(null)
  const [statusUpdating, setStatusUpdating] = useState(false)

  const showToast = (message, ok = true) => {
    setToast({ message, ok })
    setTimeout(() => setToast(null), 3000)
  }

  const handleUpdateStatus = async () => {
    setStatusUpdating(true)
    try {
      const res = await fetch('http://localhost:3001/api/update-status', { method: 'POST' })
      const data = await res.json()
      if (!res.ok || !data.ok) throw new Error(data.error || '업데이트 실패')
      showToast('✅ STATUS 업데이트 완료')
    } catch (err) {
      showToast(`❌ STATUS 업데이트 실패: ${err.message}`, false)
    } finally {
      setStatusUpdating(false)
    }
  }

  const syncLabel = {
    synced:  { icon: '🟢', text: '동기화됨' },
    syncing: { icon: '🔄', text: '동기화 중' },
    offline: { icon: '🔴', text: '오프라인' },
    idle:    { icon: '⚪', text: '대기 중' },
  }[syncStatus] ?? { icon: '⚪', text: '' }

  const handleSave = () => {
    dispatch({ type: 'MARK_SAVED' })
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url
    a.download = `${state.projectName || '프로젝트'}.json`; a.click()
    URL.revokeObjectURL(url)
  }

  const handleLoad = () => {
    const input = document.createElement('input')
    input.type = 'file'; input.accept = '.json'
    input.onchange = (e) => {
      const file = e.target.files[0]; if (!file) return
      const reader = new FileReader()
      reader.onload = (ev) => {
        try { dispatch({ type: 'LOAD', p: JSON.parse(ev.target.result) }) }
        catch { alert('파일 형식 오류') }
      }
      reader.readAsText(file)
    }
    input.click()
  }

  return (
    <nav className={styles.nav}>
      <div className={styles.logo}>
        <span className={styles.icon}>✦</span>
        <span className={styles.name}>A Creative Studio</span>
      </div>
      <div className={styles.tabs}>
        {TABS.map(t => (
          <button key={t.id}
            className={`${styles.tab} ${state.activeTab === t.id ? styles.active : ''}`}
            onClick={() => dispatch({ type: 'SET_TAB', p: t.id })}
          >
            <span>{t.icon}</span>
            <span className={styles.label}>{t.label}</span>
          </button>
        ))}
      </div>
      <div className={styles.right}>
        <button className={styles.btn} onClick={handleSave}>💾 저장</button>
        <button className={styles.btn} onClick={handleLoad}>📂 열기</button>
        <div className={styles.status}>
          <span className={`${styles.dot} ${state.savedAt ? styles.green : styles.red}`} />
          <span>{state.savedAt ? '저장됨' : '미저장'}</span>
        </div>
        <div className={styles.status} title={`서버 동기화: ${syncLabel.text}`}
          style={{ marginLeft: 4, opacity: syncStatus === 'idle' ? 0.4 : 1 }}>
          <span style={{ fontSize: 11 }}>{syncLabel.icon}</span>
          <span style={{ fontSize: 11 }}>{syncLabel.text}</span>
        </div>
        <button className={styles.btn} onClick={handleUpdateStatus} disabled={statusUpdating}>
          {statusUpdating ? '⏳ 갱신 중…' : '📋 STATUS 업데이트'}
        </button>
      </div>
      {toast && (
        <div className={`${styles.toast} ${toast.ok ? styles.toastOk : styles.toastError}`}>
          {toast.message}
        </div>
      )}
    </nav>
  )
}
