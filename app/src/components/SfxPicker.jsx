import { useEffect, useRef, useState } from 'react'
import s from './SfxPicker.module.css'

const YEORI_SERVER = 'http://localhost:3001'

let catalogCache = null
let catalogPromise = null

function loadCatalog() {
  if (catalogCache) return Promise.resolve(catalogCache)
  if (!catalogPromise) {
    catalogPromise = fetch(`${YEORI_SERVER}/api/sfx-catalog`)
      .then(res => res.json())
      .then(data => {
        if (!data.ok) throw new Error(data.error || '카탈로그 로드 실패')
        catalogCache = data.catalog
        return catalogCache
      })
  }
  return catalogPromise
}

// 대본생성/편집메타 탭에서 공용으로 쓰는 효과음 검색·미리듣기·선택 팝업.
// 자유 텍스트였던 "효과음" 필드 옆에 트리거 버튼으로 붙여 쓴다.
export default function SfxPicker({ onSelect }) {
  const [open, setOpen] = useState(false)
  const [catalog, setCatalog] = useState(catalogCache)
  const [error, setError] = useState(null)
  const [query, setQuery] = useState('')
  const [activeCategory, setActiveCategory] = useState('all')
  const [playingId, setPlayingId] = useState(null)
  const audioRef = useRef(null)
  const popRef = useRef(null)

  useEffect(() => {
    if (!open || catalog) return
    loadCatalog().then(setCatalog).catch(e => setError(e.message))
  }, [open, catalog])

  useEffect(() => {
    if (!open) return
    const onClickOutside = (e) => {
      if (popRef.current && !popRef.current.contains(e.target)) close()
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [open])

  const close = () => {
    audioRef.current?.pause()
    setPlayingId(null)
    setOpen(false)
  }

  const play = (item) => {
    if (playingId === item.id) {
      audioRef.current?.pause()
      setPlayingId(null)
      return
    }
    if (!audioRef.current) audioRef.current = new Audio()
    audioRef.current.src = `${YEORI_SERVER}/downloads/${item.path}`
    audioRef.current.play().catch(() => {})
    audioRef.current.onended = () => setPlayingId(null)
    setPlayingId(item.id)
  }

  const pick = (item, category) => {
    onSelect({ ...item, category: category.title, categoryId: category.id })
    close()
  }

  const q = query.trim().toLowerCase()
  const filteredCategories = (catalog?.categories || [])
    .filter(c => activeCategory === 'all' || c.id === activeCategory)
    .map(c => ({
      ...c,
      items: c.items.filter(it =>
        !q || it.filename.toLowerCase().includes(q) || it.purpose.toLowerCase().includes(q) || it.scene.toLowerCase().includes(q)
      ),
    }))
    .filter(c => c.items.length > 0)

  return (
    <>
      <button type="button" className={s.trigger} onClick={() => setOpen(true)} title="효과음 카탈로그에서 선택">
        🔊 카탈로그
      </button>

      {open && (
        <div className={s.overlay}>
          <div className={s.popup} ref={popRef}>
            <div className={s.header}>
              <span className={s.title}>효과음 카탈로그</span>
              <button type="button" className={s.closeBtn} onClick={close}>✕</button>
            </div>

            <div className={s.controls}>
              <input
                className={s.search}
                placeholder="파일명·용도·장면으로 검색"
                value={query}
                onChange={e => setQuery(e.target.value)}
                autoFocus
              />
              <select className={s.categorySelect} value={activeCategory} onChange={e => setActiveCategory(e.target.value)}>
                <option value="all">전체 카테고리</option>
                {(catalog?.categories || []).map(c => (
                  <option key={c.id} value={c.id}>{c.title}</option>
                ))}
              </select>
            </div>

            <div className={s.list}>
              {error && <div className={s.error}>❌ {error}</div>}
              {!catalog && !error && <div className={s.hint}>불러오는 중…</div>}
              {catalog && filteredCategories.length === 0 && <div className={s.hint}>검색 결과가 없습니다.</div>}

              {filteredCategories.map(cat => (
                <div key={cat.id} className={s.categoryBlock}>
                  <div className={s.categoryTitle}>{cat.title}</div>
                  {cat.items.map(item => (
                    <div key={item.id} className={s.item}>
                      <button type="button" className={s.playBtn} onClick={() => play(item)}>
                        {playingId === item.id ? '⏸' : '▶'}
                      </button>
                      <div className={s.itemBody} onClick={() => pick(item, cat)}>
                        <div className={s.itemFilename}>{item.filename}</div>
                        <div className={s.itemMeta}>{item.purpose} · {item.scene}</div>
                      </div>
                      <button type="button" className={s.pickBtn} onClick={() => pick(item, cat)}>선택</button>
                    </div>
                  ))}
                </div>
              ))}
            </div>

            {catalog?.note && <div className={s.note}>{catalog.note}</div>}
          </div>
        </div>
      )}
    </>
  )
}
