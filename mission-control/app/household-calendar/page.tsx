'use client'

import { useEffect, useMemo, useState, useRef } from 'react'
import TopNav from '@/components/top-nav'
import { RefreshCw, Users, Layers3, ChevronLeft, ChevronRight, CalendarDays, Clock3, MapPin, AlignLeft } from 'lucide-react'

type Source = {
  id: string; label: string; provider: string; status: string
  shareMode: string; email: string | null; primary?: boolean
}
type Person = { id: string; name: string; color: string; tag: string; sources: Source[] }
type Tag = { id: string; label: string; color: string }
type EventItem = {
  id: string; title: string; owner: string; calendarId: string
  start: string; end: string; tags: string[]; location: string | null
  status: 'busy' | 'tentative' | 'free'; notes: string; htmlLink: string | null
}
type CalendarData = { generated_at: string; household: Person[]; tags: Tag[]; events: EventItem[] }

const HOUR_START = 7
const HOUR_END = 20
const HOUR_HEIGHT = 60
const ACCENT = '#06b6d4'

function startOfWeek(date: Date) {
  const copy = new Date(date)
  const day = copy.getDay()
  copy.setDate(copy.getDate() - (day === 0 ? 6 : day - 1))
  copy.setHours(0, 0, 0, 0)
  return copy
}
function addDays(date: Date, days: number) {
  const copy = new Date(date); copy.setDate(copy.getDate() + days); return copy
}
function fmtMonth(d: Date) { return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) }
function fmtDayChip(d: Date) {
  return { dow: d.toLocaleDateString('en-US', { weekday: 'short' }), day: d.getDate() }
}
function fmtTime(val: string) {
  if (!val.includes('T')) return 'All day'
  return new Date(val).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}
function fmtTimeShort(val: string) {
  if (!val.includes('T')) return ''
  const d = new Date(val)
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}
function isAllDay(event: EventItem) { return !event.start.includes('T') }
function isToday(date: Date) {
  const now = new Date()
  return date.getDate() === now.getDate() && date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear()
}
function isPast(event: EventItem) {
  return new Date(event.end || event.start) < new Date()
}
function getEventMinutes(event: EventItem) {
  if (isAllDay(event)) return { start: HOUR_START * 60, end: (HOUR_START + 1) * 60 }
  const s = new Date(event.start), e = new Date(event.end)
  return { start: s.getHours() * 60 + s.getMinutes(), end: e.getHours() * 60 + e.getMinutes() }
}
function sourceProvider(event: EventItem) {
  return event.id.startsWith('icloud-') ? 'iCloud' : 'G'
}

export default function HouseholdCalendarPage() {
  const [data, setData] = useState<CalendarData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [activePeople, setActivePeople] = useState<string[]>([])
  const [activeTags, setActiveTags] = useState<string[]>([])
  const [weekAnchor, setWeekAnchor] = useState(() => startOfWeek(new Date()))
  const [selectedEvent, setSelectedEvent] = useState<EventItem | null>(null)
  const [nowMinutes, setNowMinutes] = useState(() => {
    const n = new Date(); return n.getHours() * 60 + n.getMinutes()
  })
  const gridRef = useRef<HTMLDivElement>(null)

  async function load() {
    setLoading(true); setError(null)
    try {
      const res = await fetch('/api/household-calendar')
      if (!res.ok) throw new Error('Failed to fetch')
      const json = await res.json()
      setData(json)
      if (!activePeople.length) setActivePeople(json.household.map((p: Person) => p.id))
    } catch {
      setError('Could not load calendar. Check credentials.')
    } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])
  useEffect(() => {
    const t = setInterval(() => {
      const n = new Date(); setNowMinutes(n.getHours() * 60 + n.getMinutes())
    }, 60000)
    return () => clearInterval(t)
  }, [])

  // Scroll to current time on load
  useEffect(() => {
    if (data && gridRef.current) {
      const offset = ((nowMinutes - HOUR_START * 60) / 60) * HOUR_HEIGHT - 80
      gridRef.current.scrollTop = Math.max(0, offset)
    }
  }, [data])

  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekAnchor, i)), [weekAnchor])

  const filtered = useMemo(() => {
    if (!data) return []
    return data.events.filter(e => {
      const q = query.trim().toLowerCase()
      const textHit = !q || [e.title, e.location || '', e.notes].join(' ').toLowerCase().includes(q)
      const personHit = activePeople.length === 0 || activePeople.includes(e.owner)
      const tagHit = activeTags.length === 0 || e.tags.some(t => activeTags.includes(t))
      return textHit && personHit && tagHit
    }).sort((a, b) => +new Date(a.start) - +new Date(b.start))
  }, [data, query, activePeople, activeTags])

  const weekKeys = useMemo(() => new Set(weekDays.map(d => d.toISOString().slice(0, 10))), [weekDays])
  const visibleEvents = useMemo(() => filtered.filter(e => weekKeys.has(e.start.slice(0, 10))), [filtered, weekKeys])
  const allDayEvents = useMemo(() => visibleEvents.filter(isAllDay), [visibleEvents])
  const timedEvents = useMemo(() => visibleEvents.filter(e => !isAllDay(e)), [visibleEvents])

  const upcomingEvents = useMemo(() => {
    const now = new Date()
    return filtered
      .filter(e => new Date(e.end || e.start) > now)
      .slice(0, 7)
  }, [filtered])

  const groupedByDay = useMemo(() => weekDays.map(day => ({
    day, key: day.toISOString().slice(0, 10),
    events: timedEvents.filter(e => e.start.slice(0, 10) === day.toISOString().slice(0, 10)),
    allDay: allDayEvents.filter(e => e.start.slice(0, 10) === day.toISOString().slice(0, 10)),
  })), [weekDays, timedEvents, allDayEvents])

  const personColor = (owner: string) => data?.household.find(p => p.id === owner)?.color || '#6b7280'
  const personName = (owner: string) => data?.household.find(p => p.id === owner)?.name || owner

  if (!data && !loading) return (
    <div style={{ minHeight: '100%', background: '#06080d', display: 'flex', flexDirection: 'column' }}>
      <TopNav crumbs={[{ label: 'Cutillo Cloud', href: '/cutillo-cloud' }, { label: 'Household Calendar', active: true }]} />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1, flexDirection: 'column', gap: '12px' }}>
        {error
          ? <><div style={{ color: '#ef4444', fontSize: '13px' }}>{error}</div>
              <button onClick={load} style={{ fontSize: '11px', color: ACCENT, background: `${ACCENT}18`, border: `1px solid ${ACCENT}40`, borderRadius: '8px', padding: '7px 14px', cursor: 'pointer' }}>Retry</button></>
          : <div style={{ color: '#6b7280', fontSize: '13px' }}>Loading…</div>
        }
      </div>
    </div>
  )

  return (
    <div style={{ minHeight: '100%', background: '#06080d', display: 'flex', flexDirection: 'column', color: '#E5E7EE' }}>
      <TopNav crumbs={[{ label: 'Cutillo Cloud', href: '/cutillo-cloud' }, { label: 'Household Calendar', active: true }]} />

      <div style={{ padding: '16px', flex: 1, display: 'grid', gridTemplateColumns: '260px minmax(0,1fr)', gap: '14px', minHeight: 'calc(100vh - 56px)', boxSizing: 'border-box' }}>

        {/* ── LEFT SIDEBAR ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', minWidth: 0 }}>

          {/* Header */}
          <div style={{ background: '#111318', borderRadius: '12px', padding: '12px 14px', border: '1px solid rgba(255,255,255,0.06)', borderTop: `2px solid ${ACCENT}66`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: ACCENT }} />
              <span style={{ fontSize: '12px', fontWeight: 700, color: ACCENT }}>Household Calendar</span>
            </div>
            <button onClick={load} disabled={loading} style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '11px', color: loading ? '#6b7280' : ACCENT, background: `${ACCENT}18`, border: `1px solid ${ACCENT}40`, borderRadius: '8px', padding: '5px 10px', cursor: loading ? 'default' : 'pointer' }}>
              <RefreshCw size={11} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
              {loading ? 'Syncing…' : 'Sync'}
            </button>
          </div>

          {/* Mini calendar */}
          <div style={{ background: '#111318', borderRadius: '12px', padding: '12px 14px', border: '1px solid rgba(255,255,255,0.06)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
              <span style={{ fontSize: '12px', fontWeight: 700 }}>{fmtMonth(weekAnchor)}</span>
              <div style={{ display: 'flex', gap: '4px' }}>
                <button onClick={() => setWeekAnchor(prev => addDays(prev, -7))} style={{ border: 'none', background: 'rgba(255,255,255,0.05)', borderRadius: '6px', color: '#A0AABB', cursor: 'pointer', padding: '3px 5px', display: 'flex' }}><ChevronLeft size={12} /></button>
                <button onClick={() => setWeekAnchor(startOfWeek(new Date()))} style={{ border: 'none', background: `${ACCENT}18`, borderRadius: '6px', color: ACCENT, cursor: 'pointer', padding: '3px 7px', fontSize: '10px', fontWeight: 700 }}>Today</button>
                <button onClick={() => setWeekAnchor(prev => addDays(prev, 7))} style={{ border: 'none', background: 'rgba(255,255,255,0.05)', borderRadius: '6px', color: '#A0AABB', cursor: 'pointer', padding: '3px 5px', display: 'flex' }}><ChevronRight size={12} /></button>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: '2px', fontSize: '9px', color: '#6b7280', marginBottom: '6px', textAlign: 'center' }}>
              {['M','T','W','T','F','S','S'].map((d, i) => <div key={i}>{d}</div>)}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: '2px' }}>
              {Array.from({ length: 35 }, (_, i) => {
                const date = addDays(startOfWeek(new Date(weekAnchor.getFullYear(), weekAnchor.getMonth(), 1)), i)
                const inMonth = date.getMonth() === weekAnchor.getMonth()
                const inWeek = weekDays.some(d => d.toDateString() === date.toDateString())
                const today = isToday(date)
                return (
                  <div key={i} onClick={() => setWeekAnchor(startOfWeek(date))}
                    style={{ height: '24px', borderRadius: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', cursor: 'pointer',
                      color: today ? '#fff' : inMonth ? (inWeek ? '#E5E7EE' : '#A0AABB') : '#4a5568',
                      background: today ? ACCENT : inWeek ? `${ACCENT}22` : 'transparent',
                      fontWeight: today ? 700 : 400,
                    }}>
                    {date.getDate()}
                  </div>
                )
              })}
            </div>
          </div>

          {/* Household toggles */}
          <div style={{ background: '#111318', borderRadius: '12px', padding: '12px 14px', border: '1px solid rgba(255,255,255,0.06)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '10px' }}>
              <div style={{ width: '3px', height: '14px', borderRadius: '2px', background: ACCENT }} />
              <span style={{ fontSize: '11px', fontWeight: 700, color: '#A0AABB', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Household</span>
            </div>
            {data?.household.map(person => {
              const on = activePeople.includes(person.id)
              const count = filtered.filter(e => e.owner === person.id).length
              return (
                <button key={person.id} onClick={() => setActivePeople(prev => on ? prev.filter(x => x !== person.id) : [...prev, person.id])}
                  style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: on ? `${person.color}12` : 'transparent', border: `1px solid ${on ? person.color + '30' : 'rgba(255,255,255,0.04)'}`, borderRadius: '8px', padding: '8px 10px', cursor: 'pointer', marginBottom: '6px', transition: 'all 0.15s' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: on ? person.color : '#4a5568' }} />
                    <span style={{ fontSize: '12px', fontWeight: 600, color: on ? '#E5E7EE' : '#6b7280' }}>{person.name}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    {count > 0 && <span style={{ fontSize: '10px', color: person.color, background: `${person.color}18`, borderRadius: '999px', padding: '1px 6px' }}>{count}</span>}
                    <span style={{ fontSize: '10px', color: on ? '#10b981' : '#6b7280' }}>{on ? 'on' : 'off'}</span>
                  </div>
                </button>
              )
            })}
          </div>

          {/* Upcoming events */}
          <div style={{ background: '#111318', borderRadius: '12px', padding: '12px 14px', border: '1px solid rgba(255,255,255,0.06)', flex: 1, minHeight: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '10px' }}>
              <div style={{ width: '3px', height: '14px', borderRadius: '2px', background: '#8b5cf6' }} />
              <span style={{ fontSize: '11px', fontWeight: 700, color: '#A0AABB', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Upcoming</span>
            </div>
            {upcomingEvents.length === 0
              ? <div style={{ fontSize: '11px', color: '#4a5568', textAlign: 'center', padding: '16px 0' }}>No upcoming events</div>
              : upcomingEvents.map(event => {
                const color = personColor(event.owner)
                const dateStr = new Date(event.start).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                return (
                  <button key={event.id} onClick={() => setSelectedEvent(event)}
                    style={{ width: '100%', display: 'flex', gap: '8px', background: 'transparent', border: 'none', borderLeft: `3px solid ${color}88`, padding: '6px 8px', cursor: 'pointer', marginBottom: '4px', borderRadius: '0 6px 6px 0', textAlign: 'left' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '11px', fontWeight: 600, color: '#E5E7EE', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{event.title}</div>
                      <div style={{ fontSize: '10px', color: '#6b7280', marginTop: '2px' }}>{dateStr} · {fmtTimeShort(event.start) || 'All day'}</div>
                    </div>
                    <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: color, marginTop: '4px', flexShrink: 0 }} />
                  </button>
                )
              })
            }
          </div>

          {/* Categories */}
          <div style={{ background: '#111318', borderRadius: '12px', padding: '12px 14px', border: '1px solid rgba(255,255,255,0.06)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '10px' }}>
              <div style={{ width: '3px', height: '14px', borderRadius: '2px', background: '#f59e0b' }} />
              <span style={{ fontSize: '11px', fontWeight: 700, color: '#A0AABB', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Categories</span>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '10px' }}>
              {data?.tags.map(tag => {
                const on = activeTags.includes(tag.id)
                return (
                  <button key={tag.id} onClick={() => setActiveTags(prev => on ? prev.filter(x => x !== tag.id) : [...prev, tag.id])}
                    style={{ padding: '3px 10px', borderRadius: '999px', fontSize: '10px', fontWeight: 700, cursor: 'pointer', transition: 'all 0.15s',
                      background: on ? `${tag.color}22` : 'rgba(255,255,255,0.04)',
                      border: `1px solid ${on ? tag.color + '60' : 'rgba(255,255,255,0.08)'}`,
                      color: on ? tag.color : '#6b7280',
                    }}>
                    {tag.label}
                  </button>
                )
              })}
            </div>
            <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search events…"
              style={{ width: '100%', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '8px', padding: '7px 10px', color: '#E5E7EE', fontSize: '11px', outline: 'none', boxSizing: 'border-box' }} />
          </div>
        </div>

        {/* ── MAIN CALENDAR ── */}
        <div style={{ background: '#111318', borderRadius: '14px', border: '1px solid rgba(255,255,255,0.06)', borderTop: `2px solid ${ACCENT}44`, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

          {/* Calendar header */}
          <div style={{ padding: '14px 16px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.05)', flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span style={{ fontSize: '22px', fontWeight: 800, letterSpacing: '-0.03em' }}>{fmtMonth(weekAnchor)}</span>
              <button onClick={() => setWeekAnchor(startOfWeek(new Date()))}
                style={{ fontSize: '10px', fontWeight: 700, padding: '4px 10px', borderRadius: '999px', background: `${ACCENT}18`, border: `1px solid ${ACCENT}40`, color: ACCENT, cursor: 'pointer' }}>
                Today
              </button>
              <button onClick={() => setWeekAnchor(prev => addDays(prev, -7))} style={{ border: 'none', background: 'rgba(255,255,255,0.05)', borderRadius: '6px', color: '#A0AABB', cursor: 'pointer', padding: '4px 6px', display: 'flex' }}><ChevronLeft size={14} /></button>
              <button onClick={() => setWeekAnchor(prev => addDays(prev, 7))} style={{ border: 'none', background: 'rgba(255,255,255,0.05)', borderRadius: '6px', color: '#A0AABB', cursor: 'pointer', padding: '4px 6px', display: 'flex' }}><ChevronRight size={14} /></button>
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              {/* KPI chips */}
              {[
                { label: 'Events', value: visibleEvents.length, color: ACCENT },
                { label: 'People', value: activePeople.length, color: '#8b5cf6' },
              ].map(({ label, value, color }) => (
                <div key={label} style={{ background: `${color}12`, border: `1px solid ${color}30`, borderRadius: '8px', padding: '4px 10px', textAlign: 'center' }}>
                  <div style={{ fontSize: '16px', fontWeight: 800, color, lineHeight: 1 }}>{value}</div>
                  <div style={{ fontSize: '9px', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.08em', marginTop: '2px' }}>{label}</div>
                </div>
              ))}
              <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '8px', padding: '4px 10px', textAlign: 'center' }}>
                <div style={{ fontSize: '11px', fontWeight: 700, color: '#10b981', lineHeight: 1.2 }}>
                  {data ? new Date(data.generated_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '—'}
                </div>
                <div style={{ fontSize: '9px', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.08em', marginTop: '2px' }}>Synced</div>
              </div>
            </div>
          </div>

          {/* Day header row */}
          <div style={{ display: 'grid', gridTemplateColumns: '52px repeat(7, minmax(0,1fr))', padding: '8px 12px 6px', gap: '6px', borderBottom: '1px solid rgba(255,255,255,0.04)', flexShrink: 0 }}>
            <div />
            {weekDays.map(day => {
              const chip = fmtDayChip(day)
              const today = isToday(day)
              return (
                <div key={day.toISOString()} style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: '10px', color: today ? ACCENT : '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>{chip.dow}</div>
                  <div style={{ width: '32px', height: '32px', borderRadius: '50%', margin: '3px auto 0', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: today ? ACCENT : 'transparent',
                    border: today ? 'none' : '1px solid rgba(255,255,255,0.06)',
                    fontSize: '15px', fontWeight: today ? 700 : 500,
                    color: today ? '#000' : '#E5E7EE',
                  }}>{chip.day}</div>
                </div>
              )
            })}
          </div>

          {/* All-day row */}
          {allDayEvents.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: '52px repeat(7, minmax(0,1fr))', padding: '4px 12px', gap: '6px', borderBottom: '1px solid rgba(255,255,255,0.04)', flexShrink: 0, minHeight: '28px' }}>
              <div style={{ fontSize: '9px', color: '#4a5568', textAlign: 'right', paddingRight: '8px', paddingTop: '4px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>all day</div>
              {groupedByDay.map(({ key, allDay }) => (
                <div key={key} style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  {allDay.map(event => {
                    const color = personColor(event.owner)
                    return (
                      <button key={event.id} onClick={() => setSelectedEvent(event)}
                        style={{ fontSize: '10px', fontWeight: 600, color: '#000', background: color, borderRadius: '4px', padding: '2px 6px', border: 'none', cursor: 'pointer', textAlign: 'left', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                        {event.title}
                      </button>
                    )
                  })}
                </div>
              ))}
            </div>
          )}

          {/* Time grid */}
          <div ref={gridRef} style={{ flex: 1, overflow: 'auto' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '52px repeat(7, minmax(0,1fr))', padding: '0 12px 12px', gap: '6px', minHeight: `${(HOUR_END - HOUR_START + 1) * HOUR_HEIGHT}px` }}>
              {/* Hour labels */}
              <div style={{ position: 'relative' }}>
                {Array.from({ length: HOUR_END - HOUR_START + 1 }, (_, i) => HOUR_START + i).map(hour => (
                  <div key={hour} style={{ position: 'absolute', top: `${i => i * HOUR_HEIGHT}px`, height: `${HOUR_HEIGHT}px`, width: '100%', display: 'flex', alignItems: 'flex-start', paddingTop: '4px', justifyContent: 'flex-end', paddingRight: '8px' } as React.CSSProperties}>
                    <span style={{ fontSize: '9px', color: '#4a5568', fontWeight: 500 }}>
                      {hour === 12 ? '12pm' : hour < 12 ? `${hour}am` : `${hour - 12}pm`}
                    </span>
                  </div>
                ))}
                {/* Stack the hours using top positioning */}
                {Array.from({ length: HOUR_END - HOUR_START + 1 }, (_, i) => (
                  <div key={i} style={{ height: `${HOUR_HEIGHT}px` }} />
                ))}
              </div>

              {/* Day columns */}
              {groupedByDay.map(({ key, day, events }) => {
                const todayCol = isToday(day)
                const nowTop = todayCol ? ((nowMinutes - HOUR_START * 60) / 60) * HOUR_HEIGHT : null
                return (
                  <div key={key} style={{ position: 'relative', height: `${(HOUR_END - HOUR_START + 1) * HOUR_HEIGHT}px` }}>
                    {/* Hour lines */}
                    {Array.from({ length: HOUR_END - HOUR_START + 1 }, (_, i) => (
                      <div key={i} style={{ position: 'absolute', left: 0, right: 0, top: `${i * HOUR_HEIGHT}px`, borderTop: `1px solid rgba(255,255,255,${i === 0 ? '0' : '0.04'})` }} />
                    ))}
                    {/* Today column tint */}
                    {todayCol && <div style={{ position: 'absolute', inset: 0, background: `${ACCENT}06`, borderRadius: '4px', pointerEvents: 'none' }} />}
                    {/* Now indicator */}
                    {nowTop !== null && nowTop >= 0 && nowTop <= (HOUR_END - HOUR_START + 1) * HOUR_HEIGHT && (
                      <div style={{ position: 'absolute', left: 0, right: 0, top: `${nowTop}px`, zIndex: 10, pointerEvents: 'none' }}>
                        <div style={{ height: '2px', background: '#ef4444', position: 'relative' }}>
                          <div style={{ position: 'absolute', left: '-4px', top: '-4px', width: '8px', height: '8px', borderRadius: '50%', background: '#ef4444' }} />
                        </div>
                      </div>
                    )}
                    {/* Events */}
                    {events.map((event, idx) => {
                      const color = personColor(event.owner)
                      const mins = getEventMinutes(event)
                      const top = Math.max(0, ((mins.start - HOUR_START * 60) / 60) * HOUR_HEIGHT)
                      const rawHeight = ((Math.max(mins.end, mins.start + 30) - mins.start) / 60) * HOUR_HEIGHT
                      const height = Math.max(rawHeight, 28)
                      const past = isPast(event)
                      const provider = sourceProvider(event)
                      return (
                        <button key={event.id} onClick={() => setSelectedEvent(event)}
                          style={{ position: 'absolute', left: `${(idx % 2) * 30}%`, right: 0, top: `${top + 2}px`, height: `${height - 3}px`,
                            background: `${color}20`, border: `1px solid ${color}50`, borderLeft: `3px solid ${color}`,
                            borderRadius: '6px', padding: '4px 6px', cursor: 'pointer', textAlign: 'left', overflow: 'hidden',
                            opacity: past ? 0.45 : 1, zIndex: 2, transition: 'opacity 0.15s',
                          }}>
                          <div style={{ fontSize: '10px', fontWeight: 700, color: '#E5E7EE', lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{event.title}</div>
                          {height > 36 && <div style={{ fontSize: '9px', color: '#A0AABB', marginTop: '2px' }}>{fmtTimeShort(event.start)}</div>}
                          <div style={{ position: 'absolute', bottom: '3px', right: '4px', fontSize: '8px', color: color, fontWeight: 700, opacity: 0.8 }}>{provider}</div>
                        </button>
                      )
                    })}
                  </div>
                )
              })}
            </div>
          </div>

          {/* Sync status bar */}
          <div style={{ padding: '8px 16px', borderTop: '1px solid rgba(255,255,255,0.04)', display: 'flex', alignItems: 'center', gap: '16px', flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
              <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#10b981' }} />
              <span style={{ fontSize: '10px', color: '#6b7280' }}>
                Google Calendar · {data ? new Date(data.generated_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—'}
              </span>
            </div>
            <span style={{ fontSize: '10px', color: '#4a5568' }}>{filtered.length} events loaded · 5min cache</span>
          </div>
        </div>
      </div>

      {/* ── EVENT DETAIL MODAL ── */}
      {selectedEvent && (
        <div onClick={() => setSelectedEvent(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: '#111318', border: `1px solid rgba(255,255,255,0.08)`, borderLeft: `4px solid ${personColor(selectedEvent.owner)}`, borderRadius: '14px', padding: '20px 24px', maxWidth: '420px', width: '100%', boxShadow: '0 24px 64px rgba(0,0,0,0.6)' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '14px' }}>
              <div>
                <div style={{ fontSize: '16px', fontWeight: 800, color: '#E5E7EE', letterSpacing: '-0.02em', marginBottom: '6px' }}>{selectedEvent.title}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: personColor(selectedEvent.owner) }} />
                  <span style={{ fontSize: '11px', color: '#A0AABB' }}>{personName(selectedEvent.owner)}</span>
                  <span style={{ fontSize: '10px', color: '#4a5568', background: 'rgba(255,255,255,0.04)', borderRadius: '999px', padding: '2px 7px' }}>{sourceProvider(selectedEvent)}</span>
                  {selectedEvent.status === 'tentative' && <span style={{ fontSize: '10px', color: '#f59e0b', background: '#f59e0b18', borderRadius: '999px', padding: '2px 7px', border: '1px solid #f59e0b30' }}>Tentative</span>}
                </div>
              </div>
              <button onClick={() => setSelectedEvent(null)} style={{ background: 'rgba(255,255,255,0.05)', border: 'none', borderRadius: '8px', color: '#6b7280', cursor: 'pointer', padding: '6px 8px', fontSize: '12px' }}>✕</button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: '#A0AABB' }}>
                <CalendarDays size={13} color='#6b7280' />
                <span style={{ fontSize: '12px' }}>
                  {new Date(selectedEvent.start).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
                </span>
              </div>
              {!isAllDay(selectedEvent) && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: '#A0AABB' }}>
                  <Clock3 size={13} color='#6b7280' />
                  <span style={{ fontSize: '12px' }}>{fmtTime(selectedEvent.start)} — {fmtTime(selectedEvent.end)}</span>
                </div>
              )}
              {selectedEvent.location && (
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', color: '#A0AABB' }}>
                  <MapPin size={13} color='#6b7280' style={{ marginTop: '2px', flexShrink: 0 }} />
                  <span style={{ fontSize: '12px' }}>{selectedEvent.location}</span>
                </div>
              )}
              {selectedEvent.notes && (
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', color: '#A0AABB' }}>
                  <AlignLeft size={13} color='#6b7280' style={{ marginTop: '2px', flexShrink: 0 }} />
                  <span style={{ fontSize: '12px', lineHeight: 1.5 }}>{selectedEvent.notes}</span>
                </div>
              )}
              {selectedEvent.tags.length > 0 && (
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '4px' }}>
                  {selectedEvent.tags.map(tagId => {
                    const tag = data?.tags.find(t => t.id === tagId)
                    if (!tag) return null
                    return <span key={tagId} style={{ fontSize: '10px', padding: '2px 8px', borderRadius: '999px', background: `${tag.color}18`, border: `1px solid ${tag.color}40`, color: tag.color, fontWeight: 700 }}>{tag.label}</span>
                  })}
                </div>
              )}
            </div>
            {selectedEvent.htmlLink && (
              <div style={{ marginTop: '16px', paddingTop: '14px', borderTop: '1px solid rgba(255,255,255,0.06)', display: 'flex', gap: '8px' }}>
                <a href={selectedEvent.htmlLink} target="_blank" rel="noreferrer"
                  style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', padding: '8px', borderRadius: '8px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: '#A0AABB', fontSize: '11px', fontWeight: 600, textDecoration: 'none', cursor: 'pointer' }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                  Open in Google Calendar
                </a>
              </div>
            )}
          </div>
        </div>
      )}

      <style>{`
        @keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }
      `}</style>
    </div>
  )
}
