import { NextRequest, NextResponse } from 'next/server'
import { exec } from 'child_process'
import { promisify } from 'util'
import fs from 'fs/promises'
import path from 'path'

const execAsync = promisify(exec)

const SCRIPT = '/Users/mikecutillo/.openclaw/workspace-shared/scripts/cleanup-disk.sh'
const HISTORY_FILE = path.join(process.cwd(), 'data', 'cleanup-history.json')

type CleanupItem = {
  label: string
  path: string
  category: string
  bytes: number
  action: 'freed' | 'would_free'
}

type CleanupResult = {
  timestamp: string
  dry_run: boolean
  disk: {
    total_gb: number
    before: { used_gb: number; free_gb: number; used_pct: number }
    after:  { used_gb: number; free_gb: number; used_pct: number }
  }
  total_freed_bytes: number
  total_freed_gb: number
  items: CleanupItem[]
}

// Map script categories → history-file categories used by the dashboard.
const CATEGORY_MAP: Record<string, string> = {
  backups:         'cache',
  build:           'cache',
  package_cache:   'cache',
  system_cache:    'cache',
  claude_versions: 'app_data',
}
const HISTORY_CATEGORIES = ['project', 'cloud', 'cache', 'app_data'] as const

async function runScript(dryRun: boolean): Promise<CleanupResult> {
  const args = ['--json', dryRun ? '--dry-run' : ''].filter(Boolean).join(' ')
  // Generous buffer — cleanup output stays small (JSON only) but be safe.
  const { stdout } = await execAsync(`bash "${SCRIPT}" ${args}`, {
    maxBuffer: 10 * 1024 * 1024,
    timeout: 5 * 60 * 1000,
  })
  return JSON.parse(stdout) as CleanupResult
}

// GET /api/cleanup-disk           → preview (dry-run)
// GET /api/cleanup-disk?run=true  → execute and append to history
export async function GET(req: NextRequest) {
  const run = req.nextUrl.searchParams.get('run') === 'true'
  try {
    const result = await runScript(!run)
    if (run && result.total_freed_bytes > 0) {
      await appendToHistory(result)
    }
    return NextResponse.json(result)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

// POST /api/cleanup-disk → execute (always real, never dry-run)
export async function POST() {
  try {
    const result = await runScript(false)
    if (result.total_freed_bytes > 0) {
      await appendToHistory(result)
    }
    return NextResponse.json(result)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

// Append a real cleanup run to data/cleanup-history.json
async function appendToHistory(result: CleanupResult) {
  let history: {
    summary: {
      total_operations: number
      total_freed_gb: number
      cumulative_freed_gb: number
      first_cleanup?: string
      last_cleanup: string
    }
    operations: Array<{
      id: string
      date: string
      label: string
      triggered_by: string
      archive_root: string
      total_freed_gb: number
      cumulative_freed_gb: number
      items: Array<{ name: string; category: string; size_gb: number; original_path: string; status: string }>
      by_category: Record<string, number>
    }>
  }
  try {
    const raw = await fs.readFile(HISTORY_FILE, 'utf-8')
    history = JSON.parse(raw)
  } catch {
    history = {
      summary: { total_operations: 0, total_freed_gb: 0, cumulative_freed_gb: 0, last_cleanup: '' },
      operations: [],
    }
  }

  // Aggregate by mapped category
  const by_category: Record<string, number> = {}
  for (const c of HISTORY_CATEGORIES) by_category[c] = 0
  for (const item of result.items) {
    if (item.bytes <= 0) continue
    const cat = CATEGORY_MAP[item.category] ?? 'cache'
    by_category[cat] = (by_category[cat] ?? 0) + item.bytes / 1024 / 1024 / 1024
  }

  const date = new Date(result.timestamp)
  const dateStr = date.toISOString().slice(0, 10)
  const cumulativeBefore = history.summary.cumulative_freed_gb
  const cumulative = +(cumulativeBefore + result.total_freed_gb).toFixed(3)

  const op = {
    id: `cleanup-${date.getTime()}`,
    date: result.timestamp,
    label: `${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} Cleanup`,
    triggered_by: 'Mission Control',
    archive_root: '(no archive — caches/builds only)',
    total_freed_gb: +result.total_freed_gb.toFixed(3),
    cumulative_freed_gb: cumulative,
    items: result.items
      .filter(i => i.bytes > 0)
      .map(i => ({
        name: i.label,
        category: CATEGORY_MAP[i.category] ?? 'cache',
        size_gb: +(i.bytes / 1024 / 1024 / 1024).toFixed(3),
        original_path: i.path,
        status: 'deleted',
      })),
    by_category: Object.fromEntries(
      Object.entries(by_category).map(([k, v]) => [k, +v.toFixed(3)])
    ),
  }

  history.operations.push(op)
  history.summary = {
    total_operations: history.operations.length,
    total_freed_gb: +(history.summary.total_freed_gb + result.total_freed_gb).toFixed(3),
    cumulative_freed_gb: cumulative,
    first_cleanup: history.summary.first_cleanup ?? dateStr,
    last_cleanup: dateStr,
  }

  await fs.writeFile(HISTORY_FILE, JSON.stringify(history, null, 2) + '\n', 'utf-8')
}
