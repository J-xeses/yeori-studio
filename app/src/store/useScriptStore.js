import { useState, useCallback } from 'react'
import { useLocalStorage } from '../hooks/useLocalStorage'

const DEFAULT_SCRIPT = {
  id: '1',
  title: '새 스크립트',
  content: '',
  genre: '드라마',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
}

export function useScriptStore() {
  const [scripts, setScripts] = useLocalStorage('yeori-scripts', [DEFAULT_SCRIPT])
  const [activeId, setActiveId] = useLocalStorage('yeori-active-id', '1')
  const [sidebarOpen, setSidebarOpen] = useState(true)

  const activeScript = scripts.find(s => s.id === activeId) || scripts[0]

  const createScript = useCallback(() => {
    const id = Date.now().toString()
    const newScript = {
      id,
      title: '새 스크립트',
      content: '',
      genre: '드라마',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    setScripts(prev => [newScript, ...prev])
    setActiveId(id)
  }, [setScripts, setActiveId])

  const updateScript = useCallback((id, changes) => {
    setScripts(prev => prev.map(s =>
      s.id === id ? { ...s, ...changes, updatedAt: new Date().toISOString() } : s
    ))
  }, [setScripts])

  const deleteScript = useCallback((id) => {
    setScripts(prev => {
      const filtered = prev.filter(s => s.id !== id)
      if (filtered.length === 0) {
        const fallback = { ...DEFAULT_SCRIPT, id: Date.now().toString() }
        setActiveId(fallback.id)
        return [fallback]
      }
      if (activeId === id) {
        setActiveId(filtered[0].id)
      }
      return filtered
    })
  }, [activeId, setScripts, setActiveId])

  const duplicateScript = useCallback((id) => {
    const target = scripts.find(s => s.id === id)
    if (!target) return
    const newId = Date.now().toString()
    const copy = { ...target, id: newId, title: `${target.title} (복사본)`, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
    setScripts(prev => [copy, ...prev])
    setActiveId(newId)
  }, [scripts, setScripts, setActiveId])

  return {
    scripts,
    activeScript,
    activeId,
    setActiveId,
    sidebarOpen,
    setSidebarOpen,
    createScript,
    updateScript,
    deleteScript,
    duplicateScript,
  }
}
