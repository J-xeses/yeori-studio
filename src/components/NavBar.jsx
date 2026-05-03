import { useApp } from '../context/AppContext'
import styles from './NavBar.module.css'

const TABS = [
  { id: 'script',    label: '대본 생성',        icon: '📝' },
  { id: 'studio',   label: '스튜디오',           icon: '🎬' },
  { id: 'tts',      label: 'ElevenLabs TTS',    icon: '🔊' },
  { id: 'voice',    label: '내 음성 삽입',       icon: '🎙️' },
  { id: 'extract',  label: '추출',               icon: '📤' },
  { id: 'video',    label: '영상 만들기',         icon: '🎞️' },
  { id: 'thumbnail',label: '썸네일',             icon: '🖼️' },
  { id: 'dashboard',label: '대시보드',            icon: '📊' },
  { id: 'retention', label: '리텐션 훅', icon: '🎯' },
  { id: 'editmeta',  label: '편집 메타', icon: '🗂️' },
]

export default function NavBar() {
  const { state, dispatch } = useApp()

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
      </div>
    </nav>
  )
}
