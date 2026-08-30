import { useState, useEffect } from 'react'
import EpisodeInfoSidebar from '../components/EpisodeInfoSidebar'
import TabToolbar from '../components/TabToolbar'
import s from './TaskQueueTab.module.css'

const YEORI_SERVER = 'http://localhost:3001'

const STATUS_LABEL = {
  pending: { text: '승인 대기', color: '#a78bfa' },
  approved: { text: '승인됨 · 처리 대기', color: '#3b82f6' },
  rejected: { text: '거절됨', color: '#6b7280' },
  done: { text: '완료', color: '#22c55e' },
  failed: { text: '실패', color: '#ef4444' },
}

function fmtTime(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleString('ko-KR', { hour12: false })
}

export default function TaskQueueTab() {
  const [tasks, setTasks] = useState([])
  const [busyId, setBusyId] = useState(null)
  const [error, setError] = useState('')

  const load = async () => {
    try {
      const res = await fetch(`${YEORI_SERVER}/api/code-task-queue`)
      const data = await res.json()
      setTasks((data.tasks || []).slice().reverse())
    } catch (e) {
      setError(`목록을 불러오지 못했습니다: ${e.message}`)
    }
  }

  useEffect(() => {
    load()
    const id = setInterval(load, 2000)
    return () => clearInterval(id)
  }, [])

  const resolve = async (id, action) => {
    setBusyId(id)
    setError('')
    try {
      const res = await fetch(`${YEORI_SERVER}/api/code-task-queue/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '처리 실패')
      await load()
    } catch (e) {
      setError(e.message)
    } finally {
      setBusyId(null)
    }
  }

  const pending = tasks.filter(t => t.status === 'pending')
  const others = tasks.filter(t => t.status !== 'pending')

  return (
    <div className={s.page}>
      <TabToolbar />
      <div className={s.root}>
        <EpisodeInfoSidebar maxStage={0} />
        <div className={s.main}>
          <div className={s.scrollBody}>
            <div className={s.content}>
              <div className={s.header}>
                <div className={s.title}>🤖 코드 작업 승인</div>
                <div className={s.desc}>
                  claude.ai 채팅이 등록한 코드 작업을 여기서 승인/거절합니다. 승인된 작업은
                  Claude Code 세션이 주기적으로 확인해 실제로 처리합니다.
                </div>
              </div>

              {error && <div className={s.errorBox}>{error}</div>}

              <div className={s.card}>
                <div className={s.cardTitle}>승인 대기 중 ({pending.length})</div>
                {pending.length === 0 ? (
                  <div className={s.empty}>대기 중인 작업이 없습니다.</div>
                ) : (
                  <div className={s.list}>
                    {pending.map(t => (
                      <div key={t.id} className={s.item}>
                        <div className={s.itemBody}>
                          <div className={s.itemDesc}>{t.description}</div>
                          <div className={s.itemMeta}>{fmtTime(t.createdAt)}</div>
                        </div>
                        <div className={s.itemActions}>
                          <button
                            className={s.approveBtn}
                            disabled={busyId === t.id}
                            onClick={() => resolve(t.id, 'approve')}
                          >
                            ✓ 승인
                          </button>
                          <button
                            className={s.rejectBtn}
                            disabled={busyId === t.id}
                            onClick={() => resolve(t.id, 'reject')}
                          >
                            ✕ 거절
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className={s.card}>
                <div className={s.cardTitle}>처리 이력 ({others.length})</div>
                {others.length === 0 ? (
                  <div className={s.empty}>기록이 없습니다.</div>
                ) : (
                  <div className={s.list}>
                    {others.map(t => {
                      const st = STATUS_LABEL[t.status] || { text: t.status, color: '#6b7280' }
                      return (
                        <div key={t.id} className={s.item}>
                          <div className={s.itemBody}>
                            <div className={s.itemDesc}>{t.description}</div>
                            <div className={s.itemMeta}>
                              등록 {fmtTime(t.createdAt)}
                              {t.resolvedAt && ` · 승인/거절 ${fmtTime(t.resolvedAt)}`}
                              {t.completedAt && ` · 처리완료 ${fmtTime(t.completedAt)}`}
                            </div>
                            {t.result && <div className={s.itemResult}>{t.result}</div>}
                          </div>
                          <div className={s.badge} style={{ color: st.color, borderColor: st.color }}>
                            {st.text}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
