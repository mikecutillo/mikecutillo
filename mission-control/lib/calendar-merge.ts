import type { CalEvent } from './google-calendar'

export type { CalEvent }

export type Source = {
  id: string
  label: string
  provider: string
  status: string
  shareMode: string
  email: string | null
  primary?: boolean
}

export type Person = {
  id: string
  name: string
  color: string
  tag: string
  sources: Source[]
}

export type Tag = {
  id: string
  label: string
  color: string
}

export type CalendarData = {
  generated_at: string
  household: Person[]
  tags: Tag[]
  events: CalEvent[]
}

export const HOUSEHOLD: Person[] = [
  {
    id: 'mike',
    name: 'Mike',
    color: '#5E6AD2',
    tag: 'mike',
    sources: [
      { id: 'cutillo@gmail.com', label: 'Mike Cutillo', provider: 'google', status: 'connected', shareMode: 'owner', email: 'cutillo@gmail.com', primary: true },
    ],
  },
  {
    id: 'erin',
    name: 'Erin',
    color: '#10b981',
    tag: 'erin',
    sources: [
      { id: 'erincutillo@gmail.com', label: 'Erin (Google)', provider: 'google', status: 'connected', shareMode: 'owner', email: 'erincutillo@gmail.com', primary: true },
      { id: 'erinrameyallen@gmail.com', label: 'Erin Ramey Allen', provider: 'google', status: 'connected', shareMode: 'owner', email: 'erinrameyallen@gmail.com' },
      { id: 'erin-icloud', label: 'Erin (iCloud)', provider: 'icloud', status: 'connected', shareMode: 'owner', email: null },
    ],
  },
  {
    id: 'liam',
    name: 'Liam',
    color: '#f59e0b',
    tag: 'liam',
    sources: [
      { id: 'liam-icloud', label: 'Liam (iCloud)', provider: 'icloud', status: 'connected', shareMode: 'owner', email: null },
    ],
  },
  {
    id: 'clara',
    name: 'Clara',
    color: '#ec4899',
    tag: 'clara',
    sources: [
      { id: 'clara-icloud', label: 'Clara (iCloud)', provider: 'icloud', status: 'connected', shareMode: 'owner', email: null },
    ],
  },
]

export const TAGS: Tag[] = [
  { id: 'mike', label: 'Mike', color: '#5E6AD2' },
  { id: 'erin', label: 'Erin', color: '#10b981' },
  { id: 'liam', label: 'Liam', color: '#f59e0b' },
  { id: 'clara', label: 'Clara', color: '#ec4899' },
  { id: 'kids', label: 'Kids', color: '#f97316' },
  { id: 'shared', label: 'Shared', color: '#8b5cf6' },
  { id: 'work', label: 'Work', color: '#6366f1' },
  { id: 'school', label: 'School', color: '#14b8a6' },
  { id: 'bills', label: 'Bills', color: '#f59e0b' },
]

// Deduplicate events:
// 1. Same owner + title + start → exact duplicate from multiple accounts
// 2. Same title + start across different owners → shared/invited event; keep first, add 'shared' tag
export function mergeAndDedup(eventArrays: CalEvent[][]): CalEvent[] {
  const merged = eventArrays.flat()

  // Pass 1: exact per-owner dedup
  const seenOwner = new Set<string>()
  const deduped = merged.filter((event) => {
    const key = `${event.owner}::${event.title.toLowerCase().trim()}::${event.start.slice(0, 16)}`
    if (seenOwner.has(key)) return false
    seenOwner.add(key)
    return true
  })

  // Pass 2: cross-owner shared event collapse (same title + start = same event on multiple calendars)
  const seenShared = new Map<string, CalEvent>()
  const result: CalEvent[] = []
  for (const event of deduped) {
    const key = `${event.title.toLowerCase().trim()}::${event.start.slice(0, 16)}`
    if (seenShared.has(key)) {
      // Already have this event — mark original as shared if not already
      const existing = seenShared.get(key)!
      if (!existing.tags.includes('shared')) {
        existing.tags = [...existing.tags, 'shared']
      }
    } else {
      seenShared.set(key, event)
      result.push(event)
    }
  }

  return result.sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())
}
