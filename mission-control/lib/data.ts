import fs from 'fs/promises'
import path from 'path'
import { Task, ActivityEntry, CalendarEvent, Project, Doc, TeamMember } from './types'

const DATA_DIR = '/Users/mikecutillo/.openclaw/workspace-shared/mission-control/data'

// ── In-memory TTL cache ─────────────────────────────────────────────────────
const DEFAULT_TTL = 15_000 // 15 seconds
const jsonCache = new Map<string, { data: unknown; ts: number }>()
const fileCache = new Map<string, { data: string; ts: number }>()

export function getDataPath(filename: string): string {
  return path.join(DATA_DIR, filename)
}

export function getWorkspacePath(...parts: string[]): string {
  return path.join('/Users/mikecutillo/.openclaw/workspace-shared', ...parts)
}

export async function readJSON<T>(filename: string, fallback: T, ttl = DEFAULT_TTL): Promise<T> {
  const cached = jsonCache.get(filename)
  if (cached && Date.now() - cached.ts < ttl) return cached.data as T
  try {
    const raw = await fs.readFile(getDataPath(filename), 'utf-8')
    const parsed = JSON.parse(raw) as T
    jsonCache.set(filename, { data: parsed, ts: Date.now() })
    return parsed
  } catch {
    return fallback
  }
}

export async function readFileCached(absPath: string, ttl = DEFAULT_TTL): Promise<string> {
  const cached = fileCache.get(absPath)
  if (cached && Date.now() - cached.ts < ttl) return cached.data
  const raw = await fs.readFile(absPath, 'utf-8')
  fileCache.set(absPath, { data: raw, ts: Date.now() })
  return raw
}

export async function writeJSON(filename: string, data: unknown): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true })
  await fs.writeFile(getDataPath(filename), JSON.stringify(data, null, 2), 'utf-8')
  jsonCache.delete(filename)
}

export function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
}

const now = new Date().toISOString()
const yesterday = new Date(Date.now() - 86400000).toISOString()
const twoDaysAgo = new Date(Date.now() - 172800000).toISOString()

export const SEED_TASKS: Task[] = [
  {
    id: 'task-1',
    title: 'Build Mission Control Dashboard',
    description: 'Full Next.js dashboard with Kanban, Calendar, Memory, Docs, Team, and Office screens.',
    status: 'in-progress',
    priority: 'urgent',
    assignee: 'turbodot',
    tags: ['mission-control', 'frontend'],
    createdAt: twoDaysAgo,
    updatedAt: now,
    projectId: 'proj-1'
  },
  {
    id: 'task-2',
    title: 'Review Memory System Design',
    description: 'Go through lossless-claw architecture and verify it meets our long-session needs.',
    status: 'review',
    priority: 'high',
    assignee: 'mike',
    tags: ['memory', 'architecture'],
    createdAt: yesterday,
    updatedAt: yesterday,
    projectId: 'proj-2'
  },
  {
    id: 'task-3',
    title: 'Set up lossless-claw memory plugin',
    description: 'Install and configure the DAG-based context management plugin for OpenClaw.',
    status: 'done',
    priority: 'high',
    assignee: 'turbodot',
    tags: ['memory', 'plugins'],
    createdAt: yesterday,
    updatedAt: now,
    projectId: 'proj-2'
  },
  {
    id: 'task-4',
    title: 'Plan automation pipeline',
    description: 'Design the heartbeat-driven automation system for background task processing.',
    status: 'backlog',
    priority: 'medium',
    assignee: 'turbodot',
    tags: ['automation', 'planning'],
    createdAt: twoDaysAgo,
    updatedAt: twoDaysAgo,
    projectId: 'proj-3'
  },
  {
    id: 'task-5',
    title: 'Daily email digest setup',
    description: 'Configure morning email summary cron job to surface important messages.',
    status: 'backlog',
    priority: 'low',
    assignee: 'turbodot',
    tags: ['email', 'automation'],
    createdAt: yesterday,
    updatedAt: yesterday,
    projectId: 'proj-3'
  },
  {
    id: 'task-6',
    title: 'Review weekly projects',
    description: 'Weekly check-in on project statuses and update priorities.',
    status: 'backlog',
    priority: 'medium',
    assignee: 'mike',
    tags: ['review', 'projects'],
    createdAt: yesterday,
    updatedAt: yesterday
  },
  {
    id: 'task-7',
    title: 'Office screen pixel art design',
    description: 'Create the 2D pixel art office visualization with animated characters.',
    status: 'in-progress',
    priority: 'medium',
    assignee: 'turbodot',
    tags: ['mission-control', 'design'],
    createdAt: now,
    updatedAt: now,
    projectId: 'proj-1'
  }
]

export const SEED_ACTIVITY: ActivityEntry[] = [
  { id: 'act-1', timestamp: new Date(Date.now() - 3600000).toISOString(), type: 'system', icon: '🚀', message: 'Mission Control initialized', color: '#5E6AD2' },
  { id: 'act-2', timestamp: new Date(Date.now() - 3000000).toISOString(), type: 'task', icon: '✅', message: 'Task completed: Set up lossless-claw memory plugin', color: '#26C26E' },
  { id: 'act-3', timestamp: new Date(Date.now() - 2400000).toISOString(), type: 'heartbeat', icon: '💓', message: 'Heartbeat: Checked backlog — 3 tasks pending', color: '#26C26E' },
  { id: 'act-4', timestamp: new Date(Date.now() - 1800000).toISOString(), type: 'task', icon: '📋', message: 'Task moved to In Progress: Build Mission Control Dashboard', color: '#5E6AD2' },
  { id: 'act-5', timestamp: new Date(Date.now() - 1200000).toISOString(), type: 'memory', icon: '🧠', message: 'Memory updated: Long-term context saved', color: '#F59E0B' },
  { id: 'act-6', timestamp: new Date(Date.now() - 600000).toISOString(), type: 'heartbeat', icon: '💓', message: 'Heartbeat: All systems nominal', color: '#26C26E' },
  { id: 'act-7', timestamp: new Date(Date.now() - 300000).toISOString(), type: 'task', icon: '🎨', message: 'Task created: Office screen pixel art design', color: '#5E6AD2' },
  { id: 'act-8', timestamp: now, type: 'system', icon: '🟢', message: 'turbodot online — ready for work', color: '#26C26E' }
]

export const SEED_CALENDAR_EVENTS: CalendarEvent[] = [
  { id: 'cal-1', title: 'Heartbeat Active', date: new Date().toISOString().split('T')[0], type: 'heartbeat', description: 'Continuous background heartbeat every 60s', recurrence: 'every 60 seconds' },
  { id: 'cal-2', title: 'Memory Maintenance', date: new Date().toISOString().split('T')[0], time: '03:00', type: 'cron', description: 'Review and consolidate memory files', recurrence: 'daily' },
  { id: 'cal-3', title: 'Daily Email Check', date: new Date().toISOString().split('T')[0], time: '09:00', type: 'cron', description: 'Check for urgent emails and surface to Mike', recurrence: 'daily' },
  { id: 'cal-4', title: 'Weekly Project Review', date: new Date(Date.now() + 86400000 * 3).toISOString().split('T')[0], time: '10:00', type: 'reminder', description: 'Review all active projects with Mike' },
  { id: 'cal-5', title: 'Mission Control Deploy Check', date: new Date(Date.now() + 86400000).toISOString().split('T')[0], time: '12:00', type: 'task', description: 'Verify Mission Control dashboard is running smoothly' }
]

export const SEED_PROJECTS: Project[] = [
  { id: 'proj-1', name: 'Mission Control', description: "Building turbodot's personal dashboard — a Linear-inspired control center for tracking tasks, memory, docs, and agent activity.", emoji: '🚀', status: 'active', owner: 'turbodot', tags: ['frontend', 'dashboard', 'priority'], createdAt: twoDaysAgo, updatedAt: now },
  { id: 'proj-2', name: 'Memory & Context System', description: 'Implementing lossless-claw DAG-based memory so turbodot never forgets during long coding sessions. Includes daily journal and long-term memory management.', emoji: '🧠', status: 'active', owner: 'turbodot', tags: ['memory', 'plugins', 'architecture'], createdAt: yesterday, updatedAt: now },
  { id: 'proj-3', name: 'Automation Pipeline', description: 'Designing a heartbeat-driven system for background task processing, email digests, calendar monitoring, and proactive assistance.', emoji: '⚡', status: 'planning', owner: 'turbodot', tags: ['automation', 'cron', 'background'], createdAt: yesterday, updatedAt: yesterday }
]

export const SEED_DOCS: Doc[] = [
  { id: 'doc-1', title: 'Mission Control Architecture', content: '# Mission Control Architecture\n\n## Overview\n\nMission Control is a Next.js 14 dashboard serving as turbodot\'s personal control center.\n\n## Tech Stack\n\n- **Frontend:** Next.js 14, TypeScript, Tailwind CSS\n- **Drag & Drop:** @dnd-kit\n- **Markdown:** marked\n- **Icons:** lucide-react\n\n## Key Design Decisions\n\n### Linear-inspired Dark Mode\nThe UI closely mirrors Linear\'s clean, minimal aesthetic with a custom dark color palette centered around #5E6AD2 accent purple.\n\n### File-based Persistence\nData is stored as JSON files in the workspace data directory, keeping everything local and portable.\n\n### Heartbeat System\nA client-side interval fires every 60 seconds, calling `/api/heartbeat` to process tasks assigned to turbodot in the backlog.\n\n## Screens\n1. Tasks (Kanban)\n2. Calendar\n3. Projects\n4. Memory\n5. Docs\n6. Team\n7. Office (Pixel Art)', category: 'architecture', tags: ['mission-control', 'architecture'], createdAt: now, updatedAt: now },
  { id: 'doc-2', title: 'Automation Pipeline Planning', content: '# Automation Pipeline Planning\n\n## Goals\n\nBuild a robust system for turbodot to work autonomously on background tasks.\n\n## Heartbeat System\n\nThe heartbeat fires every 60 seconds and:\n1. Checks the task backlog for items assigned to turbodot\n2. Moves the oldest task to In Progress\n3. Logs the action to the activity feed\n\n## Future Automations\n\n- Daily email digest at 9am\n- Weekly project review reminders\n- Memory consolidation at 3am\n- Calendar event monitoring\n\n## Implementation Notes\n\nUse OpenClaw\'s cron system for scheduled tasks rather than client-side intervals for reliability.', category: 'planning', tags: ['automation', 'planning'], createdAt: yesterday, updatedAt: yesterday },
  { id: 'doc-3', title: 'turbodot Weekly Update #1', content: '# turbodot Weekly Update #1\n\n**Week of March 22, 2026**\n\n## What I Did This Week\n\n- ✅ Installed and configured lossless-claw memory plugin\n- 🚧 Built Mission Control dashboard (in progress)\n- 📋 Planned automation pipeline\n- 🧠 Set up memory maintenance routines\n\n## Key Decisions Made\n\n1. Chose Next.js 14 App Router for the dashboard\n2. Linear-inspired design system for consistency\n3. File-based JSON persistence for portability\n\n## Next Week\n\n- Complete all Mission Control screens\n- Deploy and verify the dashboard\n- Set up email digest cron job\n- Begin automation pipeline implementation', category: 'newsletter', tags: ['weekly-update', 'newsletter'], createdAt: now, updatedAt: now }
]

export const SEED_TEAM: TeamMember[] = [
  { id: 'member-1', name: 'turbodot', role: 'Personal AI Assistant', type: 'ai', status: 'online', device: "Mike's Mac mini", model: 'claude-sonnet-4-6', currentTask: 'Building Mission Control dashboard' },
  { id: 'member-2', name: 'Mike', role: 'Owner & Human', type: 'human', status: 'online', device: 'Mac', currentTask: 'Reviewing Mission Control progress' }
]
