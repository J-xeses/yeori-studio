import { useRef, useEffect, useCallback } from 'react'
import styles from './Editor.module.css'

const GENRES = ['드라마', '로맨스', '스릴러', '코미디', '판타지', 'SF', '액션', '호러']

const BLOCK_SHORTCUTS = {
  '# ': 'scene',
  '@ ': 'character',
  '> ': 'action',
  '( ': 'parenthetical',
}

function applyBlockFormat(line) {
  for (const [prefix, cls] of Object.entries(BLOCK_SHORTCUTS)) {
    if (line.startsWith(prefix)) return { text: line.slice(prefix.length), cls }
  }
  return { text: line, cls: 'dialogue' }
}

export default function Editor({ script, onUpdate }) {
  const titleRef = useRef(null)
  const textRef = useRef(null)

  useEffect(() => {
    if (titleRef.current && titleRef.current.value !== script.title) {
      titleRef.current.value = script.title
    }
  }, [script.id, script.title])

  useEffect(() => {
    if (textRef.current && textRef.current.value !== script.content) {
      textRef.current.value = script.content
    }
  }, [script.id, script.content])

  const handleTitleChange = useCallback((e) => {
    onUpdate(script.id, { title: e.target.value || '제목 없음' })
  }, [script.id, onUpdate])

  const handleContentChange = useCallback((e) => {
    onUpdate(script.id, { content: e.target.value })
  }, [script.id, onUpdate])

  const insertBlock = useCallback((prefix) => {
    const ta = textRef.current
    if (!ta) return
    const start = ta.selectionStart
    const val = ta.value
    const lineStart = val.lastIndexOf('\n', start - 1) + 1
    const insert = `\n${prefix}`
    const newVal = val.slice(0, start) + insert + val.slice(start)
    ta.value = newVal
    ta.selectionStart = ta.selectionEnd = start + insert.length
    onUpdate(script.id, { content: newVal })
    ta.focus()
  }, [script.id, onUpdate])

  const words = script.content.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean).length
  const chars = script.content.replace(/\s/g, '').length
  const lines = script.content.split('\n').length

  return (
    <div className={styles.editor}>
      <div className={styles.topBar}>
        <div className={styles.titleRow}>
          <input
            ref={titleRef}
            className={styles.titleInput}
            defaultValue={script.title}
            onBlur={handleTitleChange}
            onKeyDown={e => e.key === 'Enter' && e.currentTarget.blur()}
            placeholder="스크립트 제목"
          />
          <select
            className={styles.genreSelect}
            value={script.genre}
            onChange={e => onUpdate(script.id, { genre: e.target.value })}
          >
            {GENRES.map(g => <option key={g} value={g}>{g}</option>)}
          </select>
        </div>
        <div className={styles.actions}>
          <button className={styles.actionBtn} onClick={() => insertBlock('# ')} title="씬 헤딩 (# )">씬</button>
          <button className={styles.actionBtn} onClick={() => insertBlock('@ ')} title="캐릭터 (@)">캐릭터</button>
          <button className={styles.actionBtn} onClick={() => insertBlock('> ')} title="액션 (>)">액션</button>
          <button className={styles.actionBtn} onClick={() => insertBlock('( ')} title="지문 (()">지문</button>
        </div>
      </div>

      <div className={styles.body}>
        <div className={styles.hint}>
          <span># 씬</span>
          <span>@ 캐릭터</span>
          <span>&gt; 액션</span>
          <span>( 지문</span>
          <span>= 대사</span>
        </div>
        <textarea
          ref={textRef}
          className={styles.textarea}
          defaultValue={script.content}
          onChange={handleContentChange}
          placeholder={'# INT. 카페 - 낮\n\n> 여리가 창가에 앉아 노트북을 열고 있다.\n\n@ 여리\n여기서 처음 쓰는 이야기.'}
          spellCheck={false}
          autoComplete="off"
          autoCorrect="off"
        />
      </div>

      <div className={styles.statusBar}>
        <span>{words.toLocaleString()} 단어</span>
        <span>·</span>
        <span>{chars.toLocaleString()} 자</span>
        <span>·</span>
        <span>{lines.toLocaleString()} 줄</span>
        <span className={styles.spacer} />
        <span className={styles.saved}>자동 저장됨</span>
      </div>
    </div>
  )
}
