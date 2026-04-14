'use client'

import { useEffect, useState, useCallback } from 'react'
import { useVisibilityInterval } from '@/hooks/use-visibility-interval'
import TopNav from '@/components/top-nav'
import KanbanBoard from '@/components/kanban-board'
import ActivityFeed from '@/components/activity-feed'
import { Task, TaskStatus, Priority, Assignee } from '@/lib/types'
import { Plus, X, Zap, Copy, CheckCircle, Loader2, Send } from 'lucide-react'

const FILTERS_ASSIGNEE: { value: 'all' | Assignee; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'turbodot', label: 'turbodot' },
  { value: 'mike', label: 'Mike' },
]

const PRIORITY_OPTS: Priority[] = ['urgent', 'high', 'medium', 'low']

interface NewTaskForm {
  title: string
  description: string
  status: TaskStatus
  priority: Priority
  assignee: Assignee
  tags: string
  dueDate: string
  projectId: string
}

const DEFAULT_FORM: NewTaskForm = {
  title: '',
  description: '',
  status: 'backlog',
  priority: 'medium',
  assignee: 'turbodot',
  tags: '',
  dueDate: '',
  projectId: '',
}

export default function TasksPage() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [assigneeFilter, setAssigneeFilter] = useState<'all' | Assignee>('all')
  const [priorityFilter, setPriorityFilter] = useState<'all' | Priority>('all')
  const [showNewTask, setShowNewTask] = useState(false)
  const [newTaskStatus, setNewTaskStatus] = useState<TaskStatus>('backlog')
  const [form, setForm] = useState<NewTaskForm>(DEFAULT_FORM)
  const [editTask, setEditTask] = useState<Task | null>(null)
  const [saving, setSaving] = useState(false)
  const [expandedPrompt, setExpandedPrompt] = useState<string | null>(null)
  const [expanding, setExpanding] = useState(false)
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [copied, setCopied] = useState(false)

  const fetchTasks = useCallback(async () => {
    try {
      const res = await fetch('/api/tasks')
      const data = await res.json()
      if (res.ok && Array.isArray(data.tasks)) {
        setTasks(data.tasks)
      } else {
        setTasks([])
      }
    } catch {
      setTasks([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchTasks() }, [fetchTasks])
  useVisibilityInterval(async () => {
    try {
      await fetch('/api/heartbeat', { method: 'POST' })
      fetchTasks()
    } catch { /* ignore */ }
  }, 60_000)

  const handleTaskMove = async (taskId: string, newStatus: TaskStatus) => {
    const task = tasks.find(t => t.id === taskId)
    if (!task || task.status === newStatus) return
    // Optimistic update
    setTasks(prev => prev.map(t => t.id === taskId ? { ...t, status: newStatus } : t))
    try {
      await fetch('/api/tasks', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: taskId, status: newStatus }),
      })
    } catch {
      fetchTasks()
    }
  }

  const handleExpandPrompt = async () => {
    if (!form.title.trim()) return
    setExpanding(true)
    setExpandedPrompt(null)
    setSent(false)
    try {
      const res = await fetch('/api/tasks/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'expand',
          task: {
            title: form.title,
            description: form.description,
            priority: form.priority,
            tags: form.tags.split(',').map(t => t.trim()).filter(Boolean),
            status: form.status,
            dueDate: form.dueDate,
          },
        }),
      })
      const data = await res.json()
      setExpandedPrompt(data.prompt)
    } catch {}
    finally { setExpanding(false) }
  }

  const handleSendToTurbodot = async () => {
    if (!expandedPrompt) return
    setSending(true)
    try {
      await fetch('/api/tasks/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'send',
          task: {
            title: form.title,
            description: expandedPrompt, // send the expanded version
            priority: form.priority,
            tags: form.tags.split(',').map(t => t.trim()).filter(Boolean),
            status: form.status,
            dueDate: form.dueDate,
          },
        }),
      })
      setSent(true)
      setTimeout(() => setSent(false), 4000)
    } catch {}
    finally { setSending(false) }
  }

  const handleCopyPrompt = () => {
    if (!expandedPrompt) return
    navigator.clipboard.writeText(expandedPrompt)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleTaskClick = (task: Task) => {
    setExpandedPrompt(null)
    setSent(false)
    setEditTask(task)
    setForm({
      title: task.title,
      description: task.description || '',
      status: task.status,
      priority: task.priority,
      assignee: task.assignee,
      tags: task.tags.join(', '),
      dueDate: task.dueDate || '',
      projectId: task.projectId || '',
    })
    setShowNewTask(true)
  }

  const handleAddTask = (status: TaskStatus) => {
    setEditTask(null)
    setForm({ ...DEFAULT_FORM, status })
    setNewTaskStatus(status)
    setShowNewTask(true)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.title.trim()) return
    setSaving(true)
    try {
      const payload = {
        ...form,
        tags: form.tags.split(',').map(t => t.trim()).filter(Boolean),
      }
      if (editTask) {
        await fetch('/api/tasks', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: editTask.id, ...payload }),
        })
      } else {
        await fetch('/api/tasks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
      }
      setShowNewTask(false)
      setEditTask(null)
      setForm(DEFAULT_FORM)
      fetchTasks()
    } catch {
      // ignore
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!editTask) return
    if (!confirm('Delete this task?')) return
    try {
      await fetch(`/api/tasks?id=${editTask.id}`, { method: 'DELETE' })
      setShowNewTask(false)
      setEditTask(null)
      fetchTasks()
    } catch {
      // ignore
    }
  }

  const filteredTasks = tasks.filter(t => {
    if (assigneeFilter !== 'all' && t.assignee !== assigneeFilter) return false
    if (priorityFilter !== 'all' && t.priority !== priorityFilter) return false
    return true
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <TopNav crumbs={[{ label: 'Control Center', href: '/office' }, { label: 'Tasks', active: true }]} />

      {/* Filters */}
      <div style={{
        padding: '10px 24px',
        borderBottom: '1px solid var(--border)',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        background: 'var(--surface)',
        flexShrink: 0,
      }}>
        <span style={{ fontSize: '11px', color: 'var(--muted)', marginRight: '4px' }}>Assignee:</span>
        {FILTERS_ASSIGNEE.map(f => (
          <button
            key={f.value}
            onClick={() => setAssigneeFilter(f.value)}
            style={{
              padding: '4px 10px',
              borderRadius: '20px',
              border: '1px solid',
              borderColor: assigneeFilter === f.value ? 'var(--accent)' : 'var(--border)',
              background: assigneeFilter === f.value ? 'rgba(94,106,210,0.15)' : 'transparent',
              color: assigneeFilter === f.value ? 'var(--accent)' : 'var(--muted)',
              fontSize: '11px',
              fontWeight: '500',
              cursor: 'pointer',
            }}
          >
            {f.label}
          </button>
        ))}
        <div style={{ width: '1px', height: '16px', background: 'var(--border)', margin: '0 4px' }} />
        <span style={{ fontSize: '11px', color: 'var(--muted)', marginRight: '4px' }}>Priority:</span>
        <button
          onClick={() => setPriorityFilter('all')}
          style={{
            padding: '4px 10px',
            borderRadius: '20px',
            border: '1px solid',
            borderColor: priorityFilter === 'all' ? 'var(--accent)' : 'var(--border)',
            background: priorityFilter === 'all' ? 'rgba(94,106,210,0.15)' : 'transparent',
            color: priorityFilter === 'all' ? 'var(--accent)' : 'var(--muted)',
            fontSize: '11px',
            fontWeight: '500',
            cursor: 'pointer',
          }}
        >
          All
        </button>
        {PRIORITY_OPTS.map(p => (
          <button
            key={p}
            onClick={() => setPriorityFilter(p)}
            style={{
              padding: '4px 10px',
              borderRadius: '20px',
              border: '1px solid',
              borderColor: priorityFilter === p ? 'var(--accent)' : 'var(--border)',
              background: priorityFilter === p ? 'rgba(94,106,210,0.15)' : 'transparent',
              color: priorityFilter === p ? 'var(--accent)' : 'var(--muted)',
              fontSize: '11px',
              fontWeight: '500',
              cursor: 'pointer',
              textTransform: 'capitalize',
            }}
          >
            {p}
          </button>
        ))}
      </div>

      {/* Main */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* Kanban */}
        <div style={{ flex: 1, padding: '16px 20px', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          {loading ? (
            <div style={{ color: 'var(--muted)', fontSize: '14px', padding: '40px', textAlign: 'center' }}>
              Loading tasks…
            </div>
          ) : (
            <div style={{ flex: 1, overflow: 'hidden' }}>
              <KanbanBoard
                tasks={filteredTasks}
                onTaskMove={handleTaskMove}
                onTaskClick={handleTaskClick}
                onAddTask={handleAddTask}
              />
            </div>
          )}
        </div>

        {/* Activity Feed */}
        <ActivityFeed />
      </div>

      {/* Modal */}
      {showNewTask && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.7)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
        }}>
          <div style={{
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: '12px',
            width: '520px',
            maxHeight: '90vh',
            overflow: 'auto',
            padding: '24px',
          }} className="animate-fade-in">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
              <h2 style={{ fontSize: '16px', fontWeight: '600', color: 'var(--text)' }}>
                {editTask ? 'Edit Task' : 'New Task'}
              </h2>
              <button
                onClick={() => { setShowNewTask(false); setEditTask(null) }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)' }}
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSubmit}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                <div>
                  <label style={labelStyle}>Title *</label>
                  <input
                    value={form.title}
                    onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                    placeholder="Task title"
                    required
                    style={inputStyle}
                    autoFocus
                  />
                </div>

                <div>
                  <label style={labelStyle}>Description</label>
                  <textarea
                    value={form.description}
                    onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                    placeholder="Optional description…"
                    rows={3}
                    style={{ ...inputStyle, resize: 'vertical' }}
                  />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                  <div>
                    <label style={labelStyle}>Status</label>
                    <select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value as TaskStatus }))} style={selectStyle}>
                      <option value="ideas">💡 Ideas</option>
                      <option value="backlog">📥 Backlog</option>
                      <option value="in-progress">⚡ In Progress</option>
                      <option value="review">👁 Review</option>
                      <option value="done">✅ Done</option>
                    </select>
                  </div>
                  <div>
                    <label style={labelStyle}>Priority</label>
                    <select value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value as Priority }))} style={selectStyle}>
                      <option value="urgent">🔴 Urgent</option>
                      <option value="high">🟡 High</option>
                      <option value="medium">🔵 Medium</option>
                      <option value="low">⚪ Low</option>
                    </select>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                  <div>
                    <label style={labelStyle}>Assignee</label>
                    <select value={form.assignee} onChange={e => setForm(f => ({ ...f, assignee: e.target.value as Assignee }))} style={selectStyle}>
                      <option value="turbodot">turbodot</option>
                      <option value="mike">Mike</option>
                    </select>
                  </div>
                  <div>
                    <label style={labelStyle}>Due Date</label>
                    <input
                      type="date"
                      value={form.dueDate}
                      onChange={e => setForm(f => ({ ...f, dueDate: e.target.value }))}
                      style={inputStyle}
                    />
                  </div>
                </div>

                <div>
                  <label style={labelStyle}>Tags (comma-separated)</label>
                  <input
                    value={form.tags}
                    onChange={e => setForm(f => ({ ...f, tags: e.target.value }))}
                    placeholder="frontend, bug, urgent"
                    style={inputStyle}
                  />
                </div>

                {/* ── Run Task / Prompt Expander ── */}
                <div style={{ borderTop: '1px solid var(--border)', paddingTop: '14px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                    <div>
                      <div style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <Zap size={13} style={{ color: 'var(--accent)' }} />
                        Run Task
                      </div>
                      <div style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '2px' }}>
                        Expand shorthand notes into a full prompt for turbodot
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={handleExpandPrompt}
                      disabled={!form.title.trim() || expanding}
                      style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '7px 14px', background: form.title.trim() && !expanding ? 'var(--accent)' : 'rgba(94,106,210,0.25)', border: 'none', borderRadius: '6px', color: '#fff', fontSize: '12px', fontWeight: '500', cursor: form.title.trim() && !expanding ? 'pointer' : 'default' }}
                    >
                      {expanding ? <><Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> Expanding…</> : <><Zap size={12} /> Expand Prompt</>}
                    </button>
                  </div>

                  {expandedPrompt && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      <textarea
                        value={expandedPrompt}
                        onChange={e => setExpandedPrompt(e.target.value)}
                        rows={10}
                        style={{ ...inputStyle, fontFamily: 'JetBrains Mono, Fira Code, monospace', fontSize: '11px', lineHeight: '1.65', resize: 'vertical' }}
                      />
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button type="button" onClick={handleCopyPrompt} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '5px', padding: '7px', background: 'rgba(255,255,255,0.06)', border: '1px solid var(--border)', borderRadius: '6px', color: copied ? '#26C26E' : 'var(--muted)', fontSize: '12px', cursor: 'pointer' }}>
                          {copied ? <><CheckCircle size={12} /> Copied!</> : <><Copy size={12} /> Copy Prompt</>}
                        </button>
                        <button type="button" onClick={handleSendToTurbodot} disabled={sending || sent} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '5px', padding: '7px', background: sent ? 'rgba(38,194,110,0.15)' : 'var(--accent)', border: sent ? '1px solid rgba(38,194,110,0.3)' : 'none', borderRadius: '6px', color: sent ? '#26C26E' : '#fff', fontSize: '12px', fontWeight: '500', cursor: sending || sent ? 'default' : 'pointer' }}>
                          {sent ? <><CheckCircle size={12} /> Sent to turbodot!</> : sending ? <><Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> Sending…</> : <><Send size={12} /> Send to turbodot</>}
                        </button>
                      </div>
                      {sent && (
                        <div style={{ fontSize: '11px', color: '#26C26E', padding: '7px 10px', background: 'rgba(38,194,110,0.07)', borderRadius: '6px', border: '1px solid rgba(38,194,110,0.2)' }}>
                          ✓ Written to <code style={{ fontSize: '10px' }}>TASK_PROMPT.md</code> — I&apos;ll pick it up on the next heartbeat or you can paste it directly into chat.
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <div style={{ display: 'flex', gap: '10px', justifyContent: 'space-between', marginTop: '6px' }}>
                  {editTask && (
                    <button
                      type="button"
                      onClick={handleDelete}
                      style={{
                        padding: '8px 16px',
                        background: 'rgba(239,68,68,0.1)',
                        color: '#EF4444',
                        border: '1px solid rgba(239,68,68,0.3)',
                        borderRadius: '6px',
                        fontSize: '13px',
                        cursor: 'pointer',
                      }}
                    >
                      Delete
                    </button>
                  )}
                  <div style={{ display: 'flex', gap: '10px', marginLeft: 'auto' }}>
                    <button
                      type="button"
                      onClick={() => { setShowNewTask(false); setEditTask(null) }}
                      style={{
                        padding: '8px 16px',
                        background: 'transparent',
                        color: 'var(--muted)',
                        border: '1px solid var(--border)',
                        borderRadius: '6px',
                        fontSize: '13px',
                        cursor: 'pointer',
                      }}
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={saving}
                      style={{
                        padding: '8px 20px',
                        background: 'var(--accent)',
                        color: '#fff',
                        border: 'none',
                        borderRadius: '6px',
                        fontSize: '13px',
                        fontWeight: '500',
                        cursor: saving ? 'not-allowed' : 'pointer',
                        opacity: saving ? 0.7 : 1,
                      }}
                    >
                      {saving ? 'Saving…' : editTask ? 'Save Changes' : 'Create Task'}
                    </button>
                  </div>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '11px',
  fontWeight: '500',
  color: 'var(--muted)',
  marginBottom: '6px',
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 12px',
  background: 'rgba(255,255,255,0.04)',
  border: '1px solid var(--border)',
  borderRadius: '6px',
  color: 'var(--text)',
  fontSize: '13px',
  outline: 'none',
}

const selectStyle: React.CSSProperties = {
  ...inputStyle,
  cursor: 'pointer',
}
