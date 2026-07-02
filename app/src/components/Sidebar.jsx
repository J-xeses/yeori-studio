import { useState } from 'react'
import styles from './Sidebar.module.css'

const GENRES = ['드라마', '로맨스', '스릴러', '코미디', '판타지', 'SF', '액션', '호러']

function formatDate(iso) {
  const d = new Date(iso)
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
}

function wordCount(text) {
  return text.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean).length
}

export default function Sidebar({ scripts, activeId, onSelect, onCreate, onDelete, onDuplicate }) {
  const [menuId, setMenuId] = useState(null)
  const [search, setSearch] = useState('')

  const filtered = scripts.filter(s =>
    s.title.toLowerCase().includes(search.toLowerCase()) ||
    s.genre.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <aside className={styles.sidebar}>
      <div className={styles.header}>
        <div className={styles.logo}>
          <span className={styles.logoIcon}>✦</span>
          <span className={styles.logoText}>여리 Studio</span>
        </div>
        <button className={styles.newBtn} onClick={onCreate} title="새 스크립트">
          <span>+</span>
        </button>
      </div>

      <div className={styles.searchWrap}>
        <input
          className={styles.search}
          placeholder="스크립트 검색..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      <div className={styles.list}>
        {filtered.length === 0 && (
          <div className={styles.empty}>검색 결과 없음</div>
        )}
        {filtered.map(script => (
          <div
            key={script.id}
            className={`${styles.item} ${script.id === activeId ? styles.active : ''}`}
            onClick={() => onSelect(script.id)}
            onContextMenu={e => { e.preventDefault(); setMenuId(menuId === script.id ? null : script.id) }}
          >
            <div className={styles.itemTop}>
              <span className={styles.itemTitle}>{script.title}</span>
              <button
                className={styles.menuBtn}
                onClick={e => { e.stopPropagation(); setMenuId(menuId === script.id ? null : script.id) }}
              >⋯</button>
            </div>
            <div className={styles.itemMeta}>
              <span className={styles.genre}>{script.genre}</span>
              <span className={styles.dot}>·</span>
              <span>{wordCount(script.content)} 단어</span>
              <span className={styles.dot}>·</span>
              <span>{formatDate(script.updatedAt)}</span>
            </div>

            {menuId === script.id && (
              <div className={styles.menu} onClick={e => e.stopPropagation()}>
                <button onClick={() => { onDuplicate(script.id); setMenuId(null) }}>복사본 만들기</button>
                <button
                  className={styles.danger}
                  onClick={() => { onDelete(script.id); setMenuId(null) }}
                >삭제</button>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className={styles.footer}>
        <span>{scripts.length}개의 스크립트</span>
      </div>
    </aside>
  )
}
