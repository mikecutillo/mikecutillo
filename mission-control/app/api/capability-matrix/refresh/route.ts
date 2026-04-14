// POST /api/capability-matrix/refresh
//
// Real filesystem discovery. Scans script dirs, reads projects.json + plans,
// writes a unified `capability-matrix.json` that powers every interactive tab.
//
// v1 scope:
//   - scripts: 4 dirs, *.py + *.sh
//   - projects: reads mission-control/data/projects.json
//   - plans:    reads ~/.claude/plans/*.md
//   - apis:     hardcoded seed (v2: read ~/.openclaw/credentials/ + vault-apis.json)
//   - workflows: hardcoded seed (v2: auto-extract from capability-matrix.html)
//
// Zero tokens. Node-only. Idempotent.

import { NextResponse } from 'next/server'
import fs from 'fs/promises'
import path from 'path'
import os from 'os'
import { getWorkspacePath, writeJSON } from '@/lib/data'

export const dynamic = 'force-dynamic'

type Tier = 'local' | 'bridge' | 'claude'
type Safety = 'safe' | 'confirm' | 'risky'
type Kind = 'script' | 'project' | 'api' | 'workflow'

type Action =
  | { type: 'run'; bin: string; args: string[] }
  | { type: 'open'; url: string }
  | { type: 'reveal'; path: string }
  | { type: 'test'; testScript?: string; testArgs?: string[] }
  | { type: 'copy'; prompt: string }

type Row = {
  id: string
  kind: Kind
  name: string
  description: string
  category: string
  tier: Tier
  safety: Safety
  action: Action
  alt?: Action
  exists?: boolean
  sourcePath?: string
}

type Data = {
  lastUpdated: string
  localModel: { label: string; source: string }
  rows: Row[]
}

// ---------- helpers ----------

function humanize(filename: string): string {
  return filename
    .replace(/\.(py|sh|md)$/i, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
    .trim()
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

async function safeReadDir(dir: string): Promise<string[]> {
  try {
    return await fs.readdir(dir)
  } catch {
    return []
  }
}

async function safeReadFile(p: string): Promise<string | null> {
  try {
    return await fs.readFile(p, 'utf-8')
  } catch {
    return null
  }
}

function extractDescription(src: string): string {
  const lines = src.split('\n').slice(0, 30)
  // Python docstring: find first `"""` block
  const docStart = lines.findIndex(l => l.trim().startsWith('"""') || l.trim().startsWith("'''"))
  if (docStart !== -1) {
    const after = lines[docStart].replace(/^\s*("""|''')/, '').trim()
    if (after && !after.endsWith('"""') && !after.endsWith("'''")) return after
    for (let i = docStart + 1; i < lines.length; i++) {
      const l = lines[i].trim()
      if (l && !l.startsWith('"""') && !l.startsWith("'''")) return l
      if (l.endsWith('"""') || l.endsWith("'''")) break
    }
  }
  // Shell / comment header: first non-shebang, non-empty comment
  for (const l of lines) {
    const t = l.trim()
    if (!t) continue
    if (t.startsWith('#!')) continue
    if (t.startsWith('#')) {
      const txt = t.replace(/^#+\s*/, '').trim()
      if (txt && !txt.toLowerCase().includes('usage')) return txt
    }
  }
  return ''
}

function detectTier(src: string): Tier {
  const lower = src.toLowerCase()
  if (/openai_api_key|anthropic_api_key|import\s+openai|import\s+anthropic|from\s+openai|from\s+anthropic/.test(lower)) {
    return 'claude'
  }
  return 'local'
}

function detectSafety(filename: string): Safety {
  const n = filename.toLowerCase()
  if (/(wipe|delete|purge|drop|remove|destroy)/.test(n)) return 'risky'
  if (/(clean|migrate|sync|prune|rotate|backup|restore)/.test(n)) return 'confirm'
  return 'safe'
}

function detectBin(src: string, filename: string): string {
  const firstLine = src.split('\n')[0] ?? ''
  if (filename.endsWith('.py')) return 'python3'
  if (/python/i.test(firstLine)) return 'python3'
  if (filename.endsWith('.sh')) {
    if (/zsh/.test(firstLine)) return '/bin/zsh'
    return '/bin/bash'
  }
  return '/bin/bash'
}

function categoryForScript(filename: string, dir: string): string {
  const n = filename.toLowerCase()
  if (n.includes('gmail') || n.includes('contact')) return 'google'
  if (n.includes('cleanup') || n.includes('disk')) return 'maintenance'
  if (n.includes('backup')) return 'backup'
  if (n.includes('classroom')) return 'google'
  if (n.includes('screenshot')) return 'utility'
  if (n.includes('claude') || n.includes('digest')) return 'claude'
  if (dir.includes('photo-library')) return 'photos'
  if (dir.includes('google-command-center')) return 'google'
  return 'utility'
}

// ---------- discovery ----------

async function discoverLocalModel(): Promise<{ label: string; source: string }> {
  const src = getWorkspacePath('MODELS_UPDATE.md')
  const text = await safeReadFile(src)
  if (text) {
    const m = text.match(/ollama\/([\w\-.:]+)/i)
    if (m) return { label: `Ollama (${m[1]})`, source: 'MODELS_UPDATE.md' }
  }
  return { label: 'Ollama (gemma4:e2b)', source: 'default' }
}

const SCRIPT_DIRS = [
  path.join(os.homedir(), '.openclaw', 'scripts'),
  getWorkspacePath('scripts'),
  getWorkspacePath('photo-library'),
  getWorkspacePath('google-command-center'),
]

async function discoverScripts(): Promise<Row[]> {
  const out: Row[] = []
  for (const dir of SCRIPT_DIRS) {
    const entries = await safeReadDir(dir)
    for (const entry of entries) {
      if (!/\.(py|sh)$/i.test(entry)) continue
      const abs = path.join(dir, entry)
      let stat
      try {
        stat = await fs.stat(abs)
      } catch {
        continue
      }
      if (!stat.isFile()) continue
      const src = (await safeReadFile(abs)) ?? ''
      const name = humanize(entry)
      const description = extractDescription(src) || `Script at ${path.relative(os.homedir(), abs)}`
      const bin = detectBin(src, entry)
      out.push({
        id: `script-${slugify(entry)}`,
        kind: 'script',
        name,
        description,
        category: categoryForScript(entry, dir),
        tier: detectTier(src),
        safety: detectSafety(entry),
        action: { type: 'run', bin, args: [abs] },
        alt: { type: 'reveal', path: abs },
        exists: true,
        sourcePath: abs,
      })
    }
  }
  return out
}

async function discoverProjects(): Promise<Row[]> {
  const pjPath = path.join(
    getWorkspacePath('mission-control', 'data', 'projects.json')
  )
  const raw = await safeReadFile(pjPath)
  if (!raw) return []
  let arr: Array<{
    id: string
    name: string
    description?: string
    emoji?: string
    tags?: string[]
    status?: string
  }>
  try {
    arr = JSON.parse(raw)
  } catch {
    return []
  }
  return arr.map(p => {
    const portMatch = p.description?.match(/port\s+(\d{2,5})/i)
    const port = portMatch ? portMatch[1] : null
    const rowId = `proj-${slugify(p.id || p.name)}`
    const action: Action = port
      ? { type: 'open', url: `http://localhost:${port}` }
      : { type: 'reveal', path: getWorkspacePath(slugify(p.name)) }
    return {
      id: rowId,
      kind: 'project' as Kind,
      name: `${p.emoji ? p.emoji + ' ' : ''}${p.name}`.trim(),
      description: p.description ?? '',
      category: (p.tags?.[0] as string) ?? 'project',
      tier: 'local' as Tier,
      safety: 'safe' as Safety,
      action,
    }
  })
}

async function discoverPlans(): Promise<Row[]> {
  const dir = path.join(os.homedir(), '.claude', 'plans')
  const entries = await safeReadDir(dir)
  const out: Row[] = []
  for (const entry of entries) {
    if (!entry.endsWith('.md')) continue
    const abs = path.join(dir, entry)
    const src = (await safeReadFile(abs)) ?? ''
    const firstHeader = src.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? humanize(entry)
    const firstPara = src
      .split('\n')
      .slice(1)
      .find(l => l.trim() && !l.startsWith('#'))
      ?.trim()
      .slice(0, 160) ?? ''
    out.push({
      id: `plan-${slugify(entry)}`,
      kind: 'project',
      name: firstHeader,
      description: firstPara || 'Claude Code plan document.',
      category: 'plan',
      tier: 'claude',
      safety: 'safe',
      action: { type: 'reveal', path: abs },
      sourcePath: abs,
    })
  }
  return out
}

function seedApis(): Row[] {
  return [
    {
      id: 'api-gmail',
      kind: 'api',
      name: 'Gmail API',
      description: 'Google Workspace Gmail read/search/label across all connected accounts.',
      category: 'google',
      tier: 'local',
      safety: 'safe',
      action: {
        type: 'test',
        testScript: path.join(os.homedir(), '.openclaw', 'scripts', 'gmail-auth.py'),
        testArgs: ['--status'],
      },
    },
    {
      id: 'api-google-drive',
      kind: 'api',
      name: 'Google Drive API',
      description: 'Drive file search, read, upload across connected accounts.',
      category: 'google',
      tier: 'local',
      safety: 'safe',
      action: { type: 'test' },
    },
    {
      id: 'api-google-calendar',
      kind: 'api',
      name: 'Google Calendar API',
      description: 'Calendar read/write for event monitoring and scheduling.',
      category: 'google',
      tier: 'local',
      safety: 'safe',
      action: { type: 'test' },
    },
    {
      id: 'api-microsoft-graph',
      kind: 'api',
      name: 'Microsoft Graph',
      description: 'M365 Outlook, Teams, OneDrive, SharePoint via Graph.',
      category: 'microsoft',
      tier: 'local',
      safety: 'safe',
      action: { type: 'test' },
    },
    {
      id: 'api-ollama',
      kind: 'api',
      name: 'Ollama (local LLM)',
      description: 'Local LLM API on port 11434. Zero-cost inference with gemma4:e2b.',
      category: 'ai',
      tier: 'local',
      safety: 'safe',
      action: { type: 'open', url: 'http://localhost:11434/api/tags' },
    },
    {
      id: 'api-openai',
      kind: 'api',
      name: 'OpenAI API',
      description: 'gpt-4o-mini (default) and gpt-5.4 (hard decisions). Paid, billed per token.',
      category: 'ai',
      tier: 'claude',
      safety: 'safe',
      action: { type: 'test' },
    },
    {
      id: 'api-anthropic',
      kind: 'api',
      name: 'Anthropic API',
      description: 'Claude Sonnet/Opus via API. Paid. Used by Claude Code itself.',
      category: 'ai',
      tier: 'claude',
      safety: 'safe',
      action: { type: 'test' },
    },
  ]
}

function seedWorkflows(): Row[] {
  return [
    {
      id: 'wf-resume-variant',
      kind: 'workflow',
      name: 'Tailor resume to a job spec',
      description: 'Paste into Claude.ai with a job description; returns a tailored variant.',
      category: 'content',
      tier: 'bridge',
      safety: 'safe',
      action: {
        type: 'copy',
        prompt:
          "You are Mike Cutillo's resume coach. I'll paste a job description below. " +
          'Return a single-page resume variant tailored to it, keeping every bullet truthful ' +
          "to my background. Emphasize the most relevant experience and skills, and trim anything that doesn't land.\n\n" +
          'JOB DESCRIPTION:\n<paste job here>',
      },
    },
    {
      id: 'wf-linkedin-post',
      kind: 'workflow',
      name: 'Generate a LinkedIn post from a raw idea',
      description: 'Paste into Claude.ai with a one-line idea; returns a polished post with hook.',
      category: 'content',
      tier: 'bridge',
      safety: 'safe',
      action: {
        type: 'copy',
        prompt:
          'You are ContentBot for Charles Sacco CFP. I will paste a raw idea. ' +
          "Return a LinkedIn post: strong hook, 3-4 short paragraphs, a takeaway, no emoji spam. Match Charles's practical-advisor tone.\n\n" +
          'RAW IDEA:\n<paste idea here>',
      },
    },
    {
      id: 'wf-code-review',
      kind: 'workflow',
      name: 'Quick code review (non-critical)',
      description: 'Paste a diff or file into Gemini/ChatGPT for a free second opinion before Claude Code.',
      category: 'engineering',
      tier: 'bridge',
      safety: 'safe',
      action: {
        type: 'copy',
        prompt:
          'Review the following code. Identify bugs, missing error handling, and style issues. ' +
          'Be specific and brief. If the code is fine, say so in one sentence.\n\n<paste code here>',
      },
    },
    {
      id: 'wf-summarize-doc',
      kind: 'workflow',
      name: 'Summarize a long doc',
      description: 'Drop a PDF or long text into Claude.ai (free tier) to get a structured summary.',
      category: 'research',
      tier: 'bridge',
      safety: 'safe',
      action: {
        type: 'copy',
        prompt:
          'Summarize the attached document in this format:\n' +
          '1. **Core thesis** (1 sentence)\n' +
          '2. **Key claims** (bullets)\n' +
          '3. **Evidence / sources cited** (bullets)\n' +
          '4. **What it misses or glosses over** (bullets)\n' +
          '5. **My next action** (1 line)',
      },
    },
  ]
}

// ---------- merge & write ----------

function mergeById(groups: Row[][]): Row[] {
  const map = new Map<string, Row>()
  for (const group of groups) {
    for (const row of group) {
      if (!map.has(row.id)) map.set(row.id, row)
    }
  }
  return Array.from(map.values())
}

export async function POST() {
  try {
    const [localModel, scripts, projects, plans] = await Promise.all([
      discoverLocalModel(),
      discoverScripts(),
      discoverProjects(),
      discoverPlans(),
    ])
    const apis = seedApis()
    const workflows = seedWorkflows()

    const rows = mergeById([scripts, projects, plans, apis, workflows])

    const data: Data = {
      lastUpdated: new Date().toISOString(),
      localModel,
      rows,
    }

    await writeJSON('capability-matrix.json', data)

    return NextResponse.json({
      ok: true,
      counts: {
        scripts: scripts.length,
        projects: projects.length + plans.length,
        apis: apis.length,
        workflows: workflows.length,
        total: rows.length,
      },
      localModel,
      lastUpdated: data.lastUpdated,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
