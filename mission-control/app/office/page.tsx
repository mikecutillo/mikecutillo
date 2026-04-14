'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useVisibilityInterval } from '@/hooks/use-visibility-interval'
import { useRouter } from 'next/navigation'
import TopNav from '@/components/top-nav'
import { Zap, AlertCircle } from 'lucide-react'

type TaskStatus = 'ideas' | 'backlog' | 'in-progress' | 'review' | 'done'
type Priority = 'urgent' | 'high' | 'medium' | 'low'

type Task = {
  id: string
  title: string
  description?: string
  status: TaskStatus
  priority: Priority
  assignee?: string
  tags?: string[]
  dueDate?: string
  projectId?: string
}

type Project = {
  id: string
  name: string
  description?: string
  emoji?: string
  status: 'planning' | 'active' | 'on-hold' | 'complete'
  owner?: string
  tags?: string[]
}

type ActivityItem = {
  id?: string
  type?: string
  icon?: string
  message?: string
  color?: string
  createdAt?: string
  timestamp?: string
}

type Shortcut = {
  id: string
  href: string
  label: string
  hint: string
}

const SHORTCUTS: Shortcut[] = [
  { id: 'tasks', href: '/tasks', label: 'Tasks', hint: 'Queue + execution' },
  { id: 'projects', href: '/projects', label: 'Projects', hint: 'Active workstreams' },
  { id: 'team', href: '/team', label: 'People', hint: 'Operators + owners' },
  { id: 'memory', href: '/memory', label: 'Memory', hint: 'Notes + recall' },
  { id: 'docs', href: '/docs', label: 'Docs', hint: 'Playbooks + specs' },
  { id: 'pipeline', href: '/job-pipeline', label: 'Jobs', hint: 'ResumeBot pipeline' },
  { id: 'studio', href: '/content-hub', label: 'Content', hint: 'Content Hub' },
]

const priorityRank: Record<Priority, number> = { urgent: 0, high: 1, medium: 2, low: 3 }
const statusTone: Record<Project['status'], string> = {
  planning: '#8b5cf6',
  active: '#10b981',
  'on-hold': '#f59e0b',
  complete: '#06b6d4',
}

export default function OfficePage() {
  const router = useRouter()
  const [tasks, setTasks] = useState<Task[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [activity, setActivity] = useState<ActivityItem[]>([])
  const [now, setNow] = useState('')
  const [diskRunning, setDiskRunning] = useState(false)
  const [diskError, setDiskError] = useState<string | null>(null)
  const [diskConfirmOpen, setDiskConfirmOpen] = useState(false)

  const handleDiskCleanup = async () => {
    setDiskRunning(true)
    setDiskError(null)
    setDiskConfirmOpen(false)
    try {
      const res = await fetch('/api/cleanup-disk?run=true')
      if (!res.ok) {
        setDiskError('Cleanup failed')
      } else {
        setTimeout(() => setDiskRunning(false), 1500)
      }
    } catch (err) {
      setDiskError(err instanceof Error ? err.message : 'Error')
      setDiskRunning(false)
    }
  }

  const openDiskConfirm = () => {
    setDiskConfirmOpen(true)
  }

  const closeDiskConfirm = () => {
    setDiskConfirmOpen(false)
  }

  const loadOfficeData = useCallback(async () => {
    try {
      const [tasksRes, projectsRes, activityRes] = await Promise.all([
        fetch('/api/tasks').then(r => r.json()).catch(() => ({ tasks: [] })),
        fetch('/api/projects').then(r => r.json()).catch(() => ({ projects: [] })),
        fetch('/api/activity').then(r => r.json()).catch(() => ({ activities: [] })),
      ])

      setTasks(Array.isArray(tasksRes.tasks) ? tasksRes.tasks : [])
      setProjects(Array.isArray(projectsRes.projects) ? projectsRes.projects : [])
      setActivity(
        Array.isArray(activityRes.activities)
          ? activityRes.activities
          : Array.isArray(activityRes.activity)
            ? activityRes.activity
            : []
      )
    } catch {
      setTasks([])
      setProjects([])
      setActivity([])
    }
  }, [])

  useEffect(() => { loadOfficeData() }, [loadOfficeData])
  useVisibilityInterval(loadOfficeData, 60_000)

  useEffect(() => {
    const updateClock = () => {
      setNow(
        new Intl.DateTimeFormat('en-US', {
          hour: 'numeric',
          minute: '2-digit',
          month: 'short',
          day: 'numeric',
        }).format(new Date())
      )
    }
    updateClock()
    const interval = setInterval(updateClock, 30000)
    return () => clearInterval(interval)
  }, [])

  const inProgress = tasks.filter(task => task.status === 'in-progress')
  const urgent = tasks.filter(task => task.priority === 'urgent' && task.status !== 'done')
  const review = tasks.filter(task => task.status === 'review')
  const doneTodayCount = tasks.filter(task => task.status === 'done').length
  const activeProjects = projects.filter(project => project.status === 'active')

  const missionQueue = useMemo(() => {
    return [...tasks]
      .filter(task => task.status !== 'done')
      .sort((a, b) => {
        const statusWeight = (task: Task) => (task.status === 'in-progress' ? 0 : task.status === 'review' ? 1 : task.status === 'backlog' ? 2 : 3)
        const statusDiff = statusWeight(a) - statusWeight(b)
        if (statusDiff !== 0) return statusDiff
        return priorityRank[a.priority] - priorityRank[b.priority]
      })
      .slice(0, 7)
  }, [tasks])

  const projectSnapshots = useMemo(() => {
    return projects.slice(0, 5).map(project => {
      const linkedTasks = tasks.filter(task => task.projectId === project.id)
      const completed = linkedTasks.filter(task => task.status === 'done').length
      const progress = linkedTasks.length ? Math.round((completed / linkedTasks.length) * 100) : 0
      return { project, linkedTasks, progress }
    })
  }, [projects, tasks])

  const recentActivity = activity.slice(0, 6)
  const blockers = missionQueue.filter(task => task.priority === 'urgent' || task.status === 'review').slice(0, 4)
  const upcomingDeadlines = tasks
    .filter(task => task.dueDate && task.status !== 'done')
    .sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)))
    .slice(0, 4)
  const focusTags = Array.from(new Set(tasks.flatMap(task => task.tags || []))).slice(0, 6)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100%', background: '#06080d', color: '#F3F5F7' }}>
      <TopNav crumbs={[{ label: 'Control Center', active: true }]} />

      <div style={{ padding: '10px 14px 12px', borderBottom: '1px solid rgba(255,255,255,0.05)', background: 'linear-gradient(180deg, #090c12 0%, #080b11 100%)' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.4fr) auto', gap: '12px', alignItems: 'end' }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '6px' }}>
              <span style={pillStyle('#74d7a7', true)}>Live</span>
              <span style={metaKickerStyle}>Office route</span>
              <span style={metaKickerStyle}>Operational dashboard</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px', flexWrap: 'wrap' }}>
              <h1 style={{ margin: 0, fontSize: '32px', lineHeight: 0.95, letterSpacing: '-0.04em', fontWeight: 800, fontFamily: 'var(--font-display, inherit)' }}>Office <span style={{ color: '#7c8cff' }}>Board</span></h1>
              <span style={{ fontSize: '11px', color: '#7d8594', textTransform: 'uppercase', letterSpacing: '0.12em' }}>tighter control view</span>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <QuickAction label="Open tasks" onClick={() => router.push('/tasks')} />
            <QuickAction label="Projects" onClick={() => router.push('/projects')} />
            <QuickAction label="Docs" onClick={() => router.push('/docs')} />
          </div>
        </div>
      </div>

      <div style={{ padding: '10px 14px 0', background: '#06080d' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: '8px' }}>
          <StripMetric label="Active" value={String(inProgress.length)} note="in progress" accent="#4F8EF7" />
          <StripMetric label="Urgent" value={String(urgent.length)} note="need attention" accent="#F5A623" />
          <StripMetric label="Review" value={String(review.length)} note="awaiting pass" accent="#B074FF" />
          <StripMetric label="Projects" value={String(activeProjects.length)} note="status active" accent="#2ECC71" />
          <StripMetric label="Clock" value={now || '—'} note="local sync" accent="#7C7F93" compact />
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, padding: '10px 14px 14px', overflow: 'auto', background: 'linear-gradient(180deg, #06080d 0%, #05070b 100%)' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '220px minmax(0, 1fr) 300px', gap: '10px', minHeight: '100%' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <Panel title="Sections" eyebrow="Navigation" accent="#4da6ff">
              <div style={{ display: 'grid', gap: '6px' }}>
                {SHORTCUTS.map(shortcut => (
                  <button
                    key={shortcut.id}
                    onClick={() => router.push(shortcut.href)}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr auto',
                      alignItems: 'center',
                      gap: '8px',
                      width: '100%',
                      padding: '9px 10px',
                      borderRadius: '6px',
                      border: '1px solid rgba(255,255,255,0.06)',
                      background: '#0b0f15',
                      color: '#E9EDF2',
                      cursor: 'pointer',
                      textAlign: 'left',
                    }}
                  >
                    <div>
                      <div style={{ fontSize: '12px', fontWeight: 700 }}>{shortcut.label}</div>
                      <div style={{ fontSize: '10px', color: '#7f8897', marginTop: '2px' }}>{shortcut.hint}</div>
                    </div>
                    <div style={{ fontSize: '11px', color: '#677086' }}>↗</div>
                  </button>
                ))}
                {/* Disk Cleanup */}
                <button
                  onClick={openDiskConfirm}
                  disabled={diskRunning}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr auto',
                    alignItems: 'center',
                    gap: '8px',
                    width: '100%',
                    padding: '9px 10px',
                    borderRadius: '6px',
                    border: '1px solid rgba(16,185,129,0.2)',
                    background: diskError ? '#1a0d0d' : '#0a1815',
                    color: diskError ? '#fca5a5' : '#d1fae5',
                    cursor: diskRunning ? 'not-allowed' : 'pointer',
                    textAlign: 'left',
                    opacity: diskRunning ? 0.7 : 1,
                  }}
                >
                  <div>
                    <div style={{ fontSize: '12px', fontWeight: 700 }}>Disk Cleanup</div>
                    <div style={{ fontSize: '10px', color: diskError ? '#fca5a5' : '#86efac', marginTop: '2px' }}>
                      {diskError ? 'Failed' : diskRunning ? 'Running…' : 'Free up space'}
                    </div>
                  </div>
                  <div style={{ fontSize: '14px' }}>{diskRunning ? '⟳' : <Zap size={14} />}</div>
                </button>

                {/* Confirmation Modal */}
                {diskConfirmOpen && (
                  <div style={{
                    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50
                  }}>
                    <div style={{
                      background: '#0b0e14', border: '1px solid rgba(16,185,129,0.3)', borderRadius: '8px', padding: '20px', maxWidth: '360px', boxShadow: '0 20px 60px rgba(0,0,0,0.8)'
                    }}>
                      <div style={{ fontSize: '16px', fontWeight: 700, marginBottom: '8px', color: '#E9EDF2' }}>Run Disk Cleanup?</div>
                      <div style={{ fontSize: '13px', color: '#A0AABB', lineHeight: '1.5', marginBottom: '16px' }}>
                        This will delete caches, build artifacts, and old package downloads. This is safe and frees up disk space.
                      </div>
                      <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                        <button
                          onClick={closeDiskConfirm}
                          style={{
                            padding: '8px 14px', borderRadius: '4px', border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.04)', color: '#A0AABB', fontSize: '12px', fontWeight: 600, cursor: 'pointer'
                          }}
                        >
                          Cancel
                        </button>
                        <button
                          onClick={handleDiskCleanup}
                          style={{
                            padding: '8px 14px', borderRadius: '4px', border: '1px solid rgba(16,185,129,0.3)', background: '#0a3f2e', color: '#d1fae5', fontSize: '12px', fontWeight: 700, cursor: 'pointer'
                          }}
                        >
                          Run Cleanup
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </Panel>

            <Panel title="Mission" eyebrow="Current focus" accent="#10b981">
              <div style={{ display: 'grid', gap: '10px' }}>
                <div style={{ fontSize: '13px', fontWeight: 600, lineHeight: 1.4 }}>
                  Push `/office` closer to the reference dashboards: flatter chrome, denser structure, faster scan.
                </div>
                <div style={{ fontSize: '11px', color: '#7f8897', lineHeight: 1.5 }}>
                  Decorative softness is out. Rectangular framing, stronger hierarchy, cleaner rails, and more dashboard than dribbble cosplay.
                </div>
                <div style={{ display: 'grid', gap: '6px' }}>
                  <MiniRow label="Mode" value="Acting now" tone="#2ECC71" />
                  <MiniRow label="Route" value="/office" tone="#4F8EF7" />
                  <MiniRow label="Verify" value="Live after edits" tone="#F5A623" />
                </div>
              </div>
            </Panel>

            <Panel title="Signals" eyebrow="Focus tags" accent="#8b5cf6">
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                {focusTags.length === 0 ? (
                  <EmptyState text="No task tags loaded yet." />
                ) : focusTags.map(tag => (
                  <span key={tag} style={tagStyle}>
                    {tag}
                  </span>
                ))}
              </div>
            </Panel>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', minWidth: 0 }}>
            <Panel title="Mission queue" eyebrow="Priority work" accent="#f59e0b" action={<span style={{ color: '#7f8897', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Top 7</span>}>
              <div style={{ display: 'grid', gap: '6px' }}>
                {missionQueue.length === 0 ? (
                  <EmptyState text="No queued work. Suspicious, honestly." />
                ) : missionQueue.map(task => (
                  <div key={task.id} style={queueRowStyle}>
                    <div style={{ display: 'grid', gridTemplateColumns: '8px minmax(0, 1fr)', gap: '10px', alignItems: 'start', minWidth: 0 }}>
                      <div style={{ width: '8px', height: '8px', borderRadius: '999px', marginTop: '5px', background: priorityColor(task.priority) }} />
                      <div style={{ minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, flexWrap: 'wrap' }}>
                          <div style={{ fontSize: '13px', fontWeight: 700, color: '#F4F7FB', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>{task.title}</div>
                          <span style={tinyCapsStyle}>{task.status.replace('-', ' ')}</span>
                          <span style={{ ...tinyCapsStyle, color: priorityColor(task.priority), borderColor: `${priorityColor(task.priority)}35` }}>{task.priority}</span>
                        </div>
                        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '5px', fontSize: '11px', color: '#7f8897' }}>
                          {task.assignee && <span>{task.assignee}</span>}
                          {task.projectId && <span>project linked</span>}
                          {task.dueDate && <span>due {task.dueDate}</span>}
                        </div>
                        {task.description && (
                          <div style={{ marginTop: '6px', fontSize: '11px', color: '#9098a6', lineHeight: 1.45, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' as const }}>
                            {task.description}
                          </div>
                        )}
                      </div>
                    </div>
                    <button onClick={() => router.push('/tasks')} style={ghostButtonStyle}>Open</button>
                  </div>
                ))}
              </div>
            </Panel>

            <div style={{ display: 'grid', gridTemplateColumns: '1.25fr 0.95fr', gap: '10px' }}>
              <Panel title="Activity stream" eyebrow="Recent changes" accent="#ec4899">
                <div style={{ display: 'grid', gap: '0' }}>
                  {recentActivity.length === 0 ? (
                    <EmptyState text="No activity items loaded yet." />
                  ) : recentActivity.map((item, index) => (
                    <div key={`${item.id || item.message || index}`} style={{ display: 'grid', gridTemplateColumns: '26px minmax(0, 1fr)', gap: '10px', alignItems: 'start', padding: '10px 0', borderBottom: index === recentActivity.length - 1 ? 'none' : '1px solid rgba(255,255,255,0.05)' }}>
                      <div style={{ width: '26px', height: '26px', borderRadius: '6px', background: item.color || '#141a24', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px' }}>
                        {item.icon || '•'}
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: '12px', color: '#E7ECF3', lineHeight: 1.45 }}>{item.message || 'Untitled activity'}</div>
                        <div style={{ fontSize: '10px', color: '#6F7890', marginTop: '4px' }}>{item.createdAt || item.timestamp || 'pending timestamp'}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </Panel>

              <Panel title="Blockers" eyebrow="Watch list" accent="#ef4444">
                <div style={{ display: 'grid', gap: '6px' }}>
                  {blockers.length === 0 ? (
                    <EmptyState text="No explicit blockers surfaced from tasks." />
                  ) : blockers.map(task => (
                    <div key={task.id} style={{ padding: '9px 10px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.06)', background: '#0b0f15' }}>
                      <div style={{ fontSize: '12px', fontWeight: 700, color: '#F2F5F8' }}>{task.title}</div>
                      <div style={{ fontSize: '10px', color: '#8A93A5', marginTop: '4px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                        {task.status.replace('-', ' ')} · {task.priority}
                      </div>
                    </div>
                  ))}
                </div>
              </Panel>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <Panel title="Project snapshots" eyebrow="Context rail" accent="#3b82f6">
              <div style={{ display: 'grid', gap: '6px' }}>
                {projectSnapshots.length === 0 ? (
                  <EmptyState text="No projects loaded." />
                ) : projectSnapshots.map(({ project, linkedTasks, progress }) => (
                  <div key={project.id} style={{ padding: '10px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.06)', background: '#0b0f15' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', alignItems: 'center' }}>
                      <div style={{ fontSize: '12px', fontWeight: 700, color: '#F3F5F7' }}>{project.emoji || '📁'} {project.name}</div>
                      <span style={{ fontSize: '10px', color: statusTone[project.status], textTransform: 'uppercase', letterSpacing: '0.06em' }}>{project.status}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', marginTop: '6px', fontSize: '10px', color: '#7f8897', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      <span>{linkedTasks.length} tasks</span>
                      <span>{progress}% complete</span>
                    </div>
                    <div style={{ marginTop: '8px', height: '4px', background: '#141922', borderRadius: '999px', overflow: 'hidden' }}>
                      <div style={{ width: `${progress}%`, height: '100%', background: statusTone[project.status] }} />
                    </div>
                  </div>
                ))}
              </div>
            </Panel>

            <Panel title="Reminders" eyebrow="Deadlines" accent="#f97316">
              <div style={{ display: 'grid', gap: '6px' }}>
                {upcomingDeadlines.map(task => (
                  <div key={task.id} style={{ padding: '9px 10px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.06)', background: '#0b0f15' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', alignItems: 'center' }}>
                      <div style={{ fontSize: '12px', fontWeight: 700 }}>{task.title}</div>
                      <span style={{ fontSize: '10px', color: priorityColor(task.priority), textTransform: 'uppercase', letterSpacing: '0.06em' }}>{task.priority}</span>
                    </div>
                    <div style={{ fontSize: '11px', color: '#8A93A5', marginTop: '4px' }}>Due {task.dueDate}</div>
                  </div>
                ))}
                {upcomingDeadlines.length === 0 && <EmptyState text="No dated tasks sitting in the queue." />}
              </div>
            </Panel>

            <Panel title="Notes" eyebrow="Ops memory">
              <div style={{ display: 'grid', gap: '6px' }}>
                <NoteCard title="Design direction" body="Flatter panels, lower radius, louder numbers, tighter rails, less bubbly drift." />
                <NoteCard title="Verification rule" body="This pass only counts if `/office` still returns 200 and the page visibly holds the denser dashboard shell." />
              </div>
            </Panel>
          </div>
        </div>
      </div>
    </div>
  )
}

function Panel({ title, eyebrow, children, action, accent }: { title: string; eyebrow?: string; children: React.ReactNode; action?: React.ReactNode; accent?: string }) {
  return (
    <section style={{ background: '#090d13', border: '1px solid rgba(255,255,255,0.06)', borderTop: accent ? `2px solid ${accent}55` : '1px solid rgba(255,255,255,0.06)', borderRadius: '6px', padding: '10px', boxShadow: 'none' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px', marginBottom: '8px' }}>
        <div>
          {eyebrow && <div style={{ fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.1em', color: accent || '#6F7890', marginBottom: '4px', opacity: 0.85 }}>{eyebrow}</div>}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            {accent && <div style={{ width: '3px', height: '14px', borderRadius: '2px', background: accent, flexShrink: 0 }} />}
            <div style={{ fontSize: '13px', fontWeight: 700, color: '#F3F5F7' }}>{title}</div>
          </div>
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}

function StripMetric({ label, value, note, accent, compact }: { label: string; value: string; note: string; accent: string; compact?: boolean }) {
  return (
    <div style={{ background: '#090d13', border: '1px solid rgba(255,255,255,0.06)', borderTop: `2px solid ${accent}66`, borderRadius: '6px', padding: compact ? '8px 10px' : '9px 10px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', alignItems: 'start' }}>
        <div>
          <div style={{ fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.1em', color: accent, opacity: 0.7 }}>{label}</div>
          <div style={{ fontSize: compact ? '18px' : '24px', lineHeight: 1, fontWeight: 800, color: accent, marginTop: '8px', letterSpacing: compact ? '-0.03em' : '-0.04em', fontFamily: 'var(--font-display, inherit)' }}>{value}</div>
        </div>
        <div style={{ width: '8px', height: '8px', borderRadius: '999px', background: accent, marginTop: '3px' }} />
      </div>
      <div style={{ fontSize: '10px', color: '#7f8897', marginTop: '8px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{note}</div>
    </div>
  )
}

function MiniRow({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', alignItems: 'center', padding: '7px 9px', borderRadius: '6px', background: '#0b0f15', border: '1px solid rgba(255,255,255,0.06)' }}>
      <span style={{ fontSize: '10px', color: '#8A93A5', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</span>
      <span style={{ fontSize: '11px', fontWeight: 700, color: tone }}>{value}</span>
    </div>
  )
}

function QuickAction({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '8px 12px',
        borderRadius: '6px',
        border: '1px solid rgba(255,255,255,0.08)',
        background: '#10151d',
        color: '#E9EDF2',
        fontSize: '11px',
        fontWeight: 700,
        letterSpacing: '0.03em',
        cursor: 'pointer',
        textTransform: 'uppercase',
      }}
    >
      {label}
    </button>
  )
}

function EmptyState({ text }: { text: string }) {
  return <div style={{ fontSize: '11px', color: '#6F7890', padding: '4px 0' }}>{text}</div>
}

function NoteCard({ title, body }: { title: string; body: string }) {
  return (
    <div style={{ padding: '9px 10px', borderRadius: '6px', background: '#0b0f15', border: '1px solid rgba(255,255,255,0.06)' }}>
      <div style={{ fontSize: '12px', fontWeight: 700, color: '#F3F5F7' }}>{title}</div>
      <div style={{ fontSize: '11px', color: '#8A93A5', marginTop: '4px', lineHeight: 1.45 }}>{body}</div>
    </div>
  )
}

function priorityColor(priority: Priority) {
  if (priority === 'urgent') return '#ef4444'
  if (priority === 'high') return '#f59e0b'
  if (priority === 'medium') return '#3b82f6'
  return '#6b7280'
}

function pillStyle(color: string, filled?: boolean): React.CSSProperties {
  return {
    padding: '4px 8px',
    borderRadius: '999px',
    border: `1px solid ${filled ? color + '30' : color + '20'}`,
    background: filled ? `${color}16` : 'transparent',
    color,
    fontSize: '10px',
    fontWeight: 700,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
  }
}

const metaKickerStyle: React.CSSProperties = {
  fontSize: '10px',
  color: '#6f7890',
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
}

const tagStyle: React.CSSProperties = {
  padding: '4px 8px',
  borderRadius: '999px',
  background: 'rgba(79,142,247,0.12)',
  border: '1px solid rgba(79,142,247,0.18)',
  color: '#9FC2FF',
  fontSize: '10px',
  fontWeight: 700,
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
}

const tinyCapsStyle: React.CSSProperties = {
  padding: '3px 6px',
  borderRadius: '999px',
  border: '1px solid rgba(255,255,255,0.08)',
  color: '#9aa2b0',
  fontSize: '9px',
  fontWeight: 700,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
}

const queueRowStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) auto',
  gap: '10px',
  alignItems: 'center',
  padding: '10px',
  borderRadius: '6px',
  border: '1px solid rgba(255,255,255,0.06)',
  background: '#0b0f15',
}

const ghostButtonStyle: React.CSSProperties = {
  padding: '7px 10px',
  borderRadius: '6px',
  border: '1px solid rgba(255,255,255,0.08)',
  background: 'transparent',
  color: '#C7D0DF',
  fontSize: '10px',
  fontWeight: 700,
  cursor: 'pointer',
  flexShrink: 0,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
}
