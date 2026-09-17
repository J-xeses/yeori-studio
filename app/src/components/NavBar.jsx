import { useState, useEffect } from 'react'
import { useApp } from '../context/AppContext'
import styles from './NavBar.module.css'

const TABS = [
  { id: 'script',        label: '대본 생성',        icon: '📝' },
  { id: 'studio',        label: '스튜디오',          icon: '🎬' },
  { id: 'tts',           label: 'ElevenLabs TTS',   icon: '🔊' },
  { id: 'voice',         label: '내 음성 삽입',      icon: '🎙️' },
  { id: 'extract',       label: '추출',              icon: '📤' },
  { id: 'making',        label: '메이킹',             icon: '🎬' },
  { id: 'video',         label: '영상 만들기',        icon: '🎞️' },
  { id: 'retention',     label: '리텐션 훅',          icon: '🎯' },
  { id: 'editmeta',      label: '편집 메타',          icon: '🗂️' },
  { id: 'checkup',       label: '체크업',             icon: '✅' },
  { id: 'publishing',    label: '퍼블리싱',          icon: '🚀' },
  { id: 'dashboard',     label: '대시보드',           icon: '📊' },
  { id: 'credits',       label: '일일 크레딧',        icon: '🎟️' },
  { id: 'storyarchive',  label: '스토리 아카이브',    icon: '📚' },
  { id: 'taskqueue',     label: '코드 작업 승인',      icon: '🤖' },
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

  // "Yeori Pipeline Leader"가 떠 있는 채로 컷 파일을 지우면 자동으로 다시 채워 넣는 걸 모르고
  // 있다가 겪은 사고(2026-09-17) — 어디서든 한눈에 확인할 수 있게 전역 네브바에 상태 표시.
  // pipeline-leader.js 자신의 중복실행 락파일(PID+mtime)을 그대로 읽는 엔드포인트를 폴링.
  const [leaderRunning, setLeaderRunning] = useState(null) // null=확인 불가, true/false=실행 여부
  useEffect(() => {
    let stopped = false
    const check = () => {
      fetch('http://localhost:3001/api/pipeline-leader-status')
        .then(r => r.json())
        .then(d => { if (!stopped) setLeaderRunning(!!d.running) })
        .catch(() => { if (!stopped) setLeaderRunning(null) })
    }
    check()
    const id = setInterval(check, 10000)
    return () => { stopped = true; clearInterval(id) }
  }, [])

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
        <div className={styles.status} style={{ marginLeft: 4 }}
          title={leaderRunning == null
            ? '파이프라인 리더 상태를 확인할 수 없습니다'
            : leaderRunning
              ? '파이프라인 리더 실행 중 — 컷 영상/이미지를 지워도 자동으로 다시 채워질 수 있습니다. 작업 전 "Yeori Pipeline Leader" 창을 닫아주세요.'
              : '파이프라인 리더 꺼짐 — 컷 파일을 지우거나 재작업해도 자동으로 다시 채워지지 않습니다'}>
          <span style={{ fontSize: 11 }}>{leaderRunning == null ? '⚪' : leaderRunning ? '🤖🟢' : '🤖⚪'}</span>
          <span style={{ fontSize: 11 }}>{leaderRunning == null ? '리더 확인불가' : leaderRunning ? '리더 실행중' : '리더 꺼짐'}</span>
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
