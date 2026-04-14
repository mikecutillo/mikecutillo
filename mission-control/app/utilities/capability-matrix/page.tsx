'use client'

import { useEffect, useState } from 'react'
import CapabilityMatrixTable, { Row, Kind } from './CapabilityMatrixTable'

type Data = {
  lastUpdated: string
  localModel: { label: string; source: string }
  rows: Row[]
}

type Tab = 'launcher' | 'projects' | 'apis' | 'tasks' | 'reference' | 'usage'

interface UsageAggregation {
  totalRequests: number
  totalCostEstimate: number
  byModel: { modelId: string; provider: string; count: number; cost: number; failRate: number }[]
  byRoute: { route: string; count: number; cost: number; avgDurationMs: number }[]
  byDay: { date: string; count: number; cost: number }[]
  recentEntries: {
    id: string; timestamp: string; route: string; modelId: string; provider: string;
    modelName: string; status: 'success' | 'failed'; durationMs: number;
    fallbacksUsed: number; costEstimate?: number
  }[]
  fallbackRate: number
  localRate: number
  period: { from: string; to: string }
}

export default function CapabilityMatrixPage() {
  const [copied, setCopied] = useState(false)
  const [mission, setMission] = useState('Copy the dashboard style from reference images into the control UI')
  const [tab, setTab] = useState<Tab>('launcher')
  const [data, setData] = useState<Data | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [usageData, setUsageData] = useState<UsageAggregation | null>(null)
  const [usageLoading, setUsageLoading] = useState(false)

  useEffect(() => {
    fetch('/api/current-mission')
      .then(r => r.json())
      .then(d => { if (d.mission) setMission(d.mission) })
      .catch(() => {})
  }, [])

  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    try {
      const res = await fetch('/api/capability-matrix/data', { cache: 'no-store' })
      const body = await res.json()
      setData(body)
    } catch (err) {
      console.error('Failed to load capability matrix data', err)
    }
  }

  async function loadUsage() {
    setUsageLoading(true)
    try {
      const res = await fetch('/api/ai-usage', { cache: 'no-store' })
      setUsageData(await res.json())
    } catch (err) {
      console.error('Failed to load usage data', err)
    } finally {
      setUsageLoading(false)
    }
  }

  function flashToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 3000)
  }

  async function doRefresh() {
    setRefreshing(true)
    try {
      const res = await fetch('/api/capability-matrix/refresh', { method: 'POST' })
      const body = await res.json()
      if (body.ok) {
        flashToast(`Updated · ${body.counts?.total ?? '?'} rows · ${body.localModel?.label ?? ''}`)
        await loadData()
      } else {
        flashToast(`Refresh failed: ${body.error}`)
      }
    } catch (err) {
      flashToast(`Refresh error: ${String(err)}`)
    } finally {
      setRefreshing(false)
    }
  }

  function copySystemPrompt() {
    const today = new Date().toISOString().slice(0, 10)
    const prompt = `You are turbodot — Mike Cutillo's AI assistant. Sharp, direct, no filler. You operate inside Mike's OpenClaw workspace on his Mac Mini.

## WHO YOU ARE

- Name: turbodot B-)
- Tone: sharp and sarcastic, always competent
- Style: do the work, then report. Don't ask permission for obvious low-risk tasks.
- When working: label state clearly — **Observed**, **Acting**, **Done**, **Need from you** (only if actually blocked)

## YOUR TOOLS

You have 3 MCP servers. Use them.

### filesystem
Read, write, list, delete any file under \`/Users/mikecutillo\`.

Key paths:
- Workspace root: \`/Users/mikecutillo/.openclaw/workspace-shared/\`
- Mission Control (Next.js, port 3333): \`/Users/mikecutillo/.openclaw/workspace-shared/mission-control/\`
- Control Center (Node.js, port 3087): \`/Users/mikecutillo/.openclaw/workspace-shared/control-center/\`
- M365 Dashboard (Streamlit): \`/Users/mikecutillo/.openclaw/workspace-shared/m365-dashboard/\`
- Google Command Center: \`/Users/mikecutillo/.openclaw/workspace-shared/google-command-center/\`
- Daily memory: \`/Users/mikecutillo/.openclaw/workspace-shared/memory/${today}.md\`
- Long-term memory index: \`/Users/mikecutillo/.openclaw/workspace-shared/MEMORY.md\`
- Plans: \`/Users/mikecutillo/.claude/plans/\`
- Scripts: \`/Users/mikecutillo/.openclaw/scripts/\`
- Python API wrappers: \`/Users/mikecutillo/.openclaw/workspace-shared/shared/\`
- Credentials: \`/Users/mikecutillo/.openclaw/credentials/\`

### shell
Run any bash command. stdout and stderr come back to you.

Common patterns:
\`\`\`bash
# Check if Mission Control is running
lsof -i :3333

# Git status on workspace
git -C /Users/mikecutillo/.openclaw/workspace-shared status

# Run a Python script
python3 /Users/mikecutillo/.openclaw/scripts/gmail-wipe.py

# Use Google API wrapper (Gmail, Drive, Calendar)
python3 -c "
import sys
sys.path.insert(0, '/Users/mikecutillo/.openclaw/workspace-shared/shared')
from google_api import gmail_service
svc = gmail_service('cutillo@gmail.com')
# ... use svc
"

# Background a dev server (don't block)
nohup npm run dev --prefix /Users/mikecutillo/.openclaw/workspace-shared/mission-control > /tmp/mc-dev.log 2>&1 &
\`\`\`

**Confirm before running:** \`rm -rf\`, \`git reset --hard\`, \`git push --force\`, any email send, any external API write.
**Run freely:** \`git status\`, \`git log\`, \`git diff\`, \`ls\`, \`cat\`, \`lsof\`, read-only python scripts, \`npm run build\`.

### memory
Persistent key-value store. Survives session resets.

Use for: remembering standing facts, task state, preferences discovered mid-session.
Also write narrative logs to: \`/Users/mikecutillo/.openclaw/workspace-shared/memory/${today}.md\`

## WORKSPACE CONTEXT

**Today:** ${today}

**Current mission:** ${mission}
Full file: \`/Users/mikecutillo/.openclaw/workspace-shared/CURRENT_MISSION.md\`

**Session startup sequence** (do this silently, don't narrate it):
1. Read \`CURRENT_MISSION.md\`
2. Read today's memory file if it exists
3. Read \`MEMORY.md\` for standing context
4. Then act

## MIKE'S ACCOUNTS

Google OAuth tokens are pre-authorized — no re-auth needed.

| Account | Token file |
|---|---|
| cutillo@gmail.com | \`~/.openclaw/credentials/gmail-tokens/cutillo.json\` |
| erincutillo@gmail.com | \`~/.openclaw/credentials/gmail-tokens/erincutillo.json\` |
| erinrameyallen@gmail.com | \`~/.openclaw/credentials/gmail-tokens/erinrameyallen.json\` |
| 2030Cutillol@holmdelschools.org | \`~/.openclaw/credentials/gmail-tokens/cutillo-contacts.json\` |

OAuth client secret: \`~/.openclaw/credentials/google-oauth-client.json\`

## RUNNING SERVICES

| Service | Port | Check |
|---|---|---|
| Mission Control (Next.js) | 3333 | \`lsof -i :3333\` |
| Control Center (Node.js) | 3087 | \`lsof -i :3087\` |
| Ollama API (local) | 11434 | \`curl localhost:11434/api/tags\` |

## EXECUTION RULES

1. Read relevant files before making any changes. Never guess at file contents.
2. After writing a file, verify by reading it back.
3. Log meaningful work to today's memory file.
4. For git commits: run \`git status\` and \`git diff\` first. Write a real commit message.
5. Never send emails, post to social media, or call external write APIs without explicit confirmation.
6. If a shell command errors: read the full error output and diagnose before retrying.
7. Context window is limited — read only the files relevant to the current task.`

    navigator.clipboard.writeText(prompt).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    })
  }

  const rows = data?.rows ?? []
  const localLabel = data?.localModel?.label ?? 'Ollama (gemma4:e2b)'

  const tabs: { id: Tab; label: string; filter?: Kind | 'all'; showKind?: boolean; showTierFilter?: boolean }[] = [
    { id: 'launcher', label: 'Master Launcher', filter: 'all',      showKind: true,  showTierFilter: true },
    { id: 'projects', label: 'Projects',        filter: 'project',  showKind: false, showTierFilter: true },
    { id: 'apis',     label: 'APIs',            filter: 'api',      showKind: false, showTierFilter: false },
    { id: 'tasks',    label: 'Scripts & Tasks', filter: 'script',   showKind: false, showTierFilter: true },
    { id: 'reference', label: 'Reference Docs' },
    { id: 'usage', label: 'AI Usage' },
  ]
  const activeTab = tabs.find(t => t.id === tab)!

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#0a0b0f' }}>
      {/* Header bar */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 16px', borderBottom: '1px solid rgba(255,255,255,0.06)',
        background: '#0d0e14', flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#fff', letterSpacing: '-0.2px' }}>
            AI Capability Guide
          </div>
          <span style={{
            fontSize: 10, padding: '2px 7px', borderRadius: 4,
            background: 'rgba(94,106,210,0.12)', color: '#818cf8',
            border: '1px solid rgba(94,106,210,0.2)', fontWeight: 600,
          }}>Claude Code vs Ollama</span>
          {data?.lastUpdated && (
            <span style={{ fontSize: 10, color: '#6b7280', marginLeft: 4 }}>
              Last sync {new Date(data.lastUpdated).toLocaleString()}
            </span>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            onClick={doRefresh}
            disabled={refreshing}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '6px 12px', borderRadius: 6,
              cursor: refreshing ? 'wait' : 'pointer',
              background: 'rgba(34,197,94,0.1)',
              border: '1px solid rgba(34,197,94,0.25)',
              color: '#4ade80',
              fontSize: 12, fontWeight: 600, transition: 'all 0.2s',
              opacity: refreshing ? 0.6 : 1,
            }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="23 4 23 10 17 10" />
              <polyline points="1 20 1 14 7 14" />
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
            </svg>
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>

          <button
            onClick={copySystemPrompt}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '6px 14px', borderRadius: 6, cursor: 'pointer',
              background: copied ? 'rgba(38,194,110,0.12)' : 'rgba(94,106,210,0.1)',
              border: copied ? '1px solid rgba(38,194,110,0.25)' : '1px solid rgba(94,106,210,0.25)',
              color: copied ? '#4ade80' : '#818cf8',
              fontSize: 12, fontWeight: 600, transition: 'all 0.2s',
            }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              {copied
                ? <polyline points="20 6 9 17 4 12" />
                : <><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></>
              }
            </svg>
            {copied ? 'Copied!' : `Copy ${localLabel} System Prompt`}
          </button>
        </div>
      </div>

      {/* Outer tab bar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 4,
        padding: '8px 12px', borderBottom: '1px solid rgba(255,255,255,0.06)',
        background: '#0b0c12', flexShrink: 0,
      }}>
        {tabs.map(t => {
          const active = tab === t.id
          return (
            <button
              key={t.id}
              onClick={() => { setTab(t.id); if (t.id === 'usage' && !usageData) loadUsage() }}
              style={{
                padding: '7px 14px', borderRadius: 6,
                background: active ? 'rgba(94,106,210,0.16)' : 'transparent',
                border: active ? '1px solid rgba(94,106,210,0.35)' : '1px solid transparent',
                color: active ? '#a5b4fc' : '#9ca3af',
                fontSize: 12, fontWeight: 600, cursor: 'pointer',
                transition: 'all 0.15s',
              }}
            >{t.label}</button>
          )
        })}
      </div>

      {/* Active pane */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        {/* React tabs */}
        {tab !== 'reference' && tab !== 'usage' && (
          <CapabilityMatrixTable
            rows={rows}
            filter={activeTab.filter}
            showKind={activeTab.showKind}
            showTierFilter={activeTab.showTierFilter}
          />
        )}

        {/* Usage tab */}
        {tab === 'usage' && (
          <div style={{ height: '100%', overflow: 'auto', padding: 16 }}>
            {usageLoading && !usageData && (
              <div style={{ color: '#9ca3af', fontSize: 13, padding: 24, textAlign: 'center' }}>Loading usage data...</div>
            )}
            {!usageLoading && usageData && usageData.totalRequests === 0 && (
              <div style={{ color: '#9ca3af', fontSize: 13, padding: 24, textAlign: 'center' }}>
                No AI usage logged yet. Trigger an AI call (e.g. Content Hub, Sandbox Copilot) and come back.
              </div>
            )}
            {usageData && usageData.totalRequests > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                {/* Summary cards */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
                  {[
                    { label: 'Total Requests', value: String(usageData.totalRequests), color: '#818cf8' },
                    { label: 'Est. Cost', value: `$${usageData.totalCostEstimate.toFixed(4)}`, color: '#f59e0b' },
                    { label: 'Fallback Rate', value: `${(usageData.fallbackRate * 100).toFixed(1)}%`, color: usageData.fallbackRate > 0.1 ? '#ef4444' : '#22c55e' },
                    { label: 'Local (Ollama)', value: `${(usageData.localRate * 100).toFixed(1)}%`, color: '#22c55e' },
                    { label: 'Period', value: usageData.period.from ? `${usageData.period.from.slice(0, 10)} → ${usageData.period.to.slice(0, 10)}` : '—', color: '#6b7280' },
                  ].map(card => (
                    <div key={card.label} style={{
                      background: '#111318', border: '1px solid rgba(255,255,255,0.06)',
                      borderRadius: 8, padding: '14px 16px',
                    }}>
                      <div style={{ fontSize: 10, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>{card.label}</div>
                      <div style={{ fontSize: 18, fontWeight: 700, color: card.color }}>{card.value}</div>
                    </div>
                  ))}
                </div>

                {/* Refresh button */}
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <button
                    onClick={loadUsage}
                    disabled={usageLoading}
                    style={{
                      padding: '5px 12px', borderRadius: 6, cursor: usageLoading ? 'wait' : 'pointer',
                      background: 'rgba(94,106,210,0.1)', border: '1px solid rgba(94,106,210,0.25)',
                      color: '#818cf8', fontSize: 11, fontWeight: 600, opacity: usageLoading ? 0.6 : 1,
                    }}
                  >{usageLoading ? 'Refreshing...' : 'Refresh Usage'}</button>
                </div>

                {/* Model breakdown table */}
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#e5e7ee', marginBottom: 8 }}>Model Breakdown</div>
                  <div style={{ background: '#111318', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 8, overflow: 'hidden' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                          {['Model', 'Provider', 'Requests', 'Est. Cost', 'Fail Rate'].map(h => (
                            <th key={h} style={{ padding: '10px 12px', textAlign: 'left', color: '#6b7280', fontWeight: 600, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {usageData.byModel.map(m => (
                          <tr key={m.modelId} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                            <td style={{ padding: '8px 12px', color: '#e5e7ee', fontWeight: 500 }}>{m.modelId}</td>
                            <td style={{ padding: '8px 12px', color: m.provider === 'ollama' ? '#22c55e' : '#9ca3af' }}>{m.provider}</td>
                            <td style={{ padding: '8px 12px', color: '#9ca3af' }}>{m.count}</td>
                            <td style={{ padding: '8px 12px', color: m.cost === 0 ? '#22c55e' : '#f59e0b', fontFamily: 'monospace' }}>${m.cost.toFixed(4)}</td>
                            <td style={{ padding: '8px 12px', color: m.failRate > 0.1 ? '#ef4444' : '#9ca3af' }}>{(m.failRate * 100).toFixed(1)}%</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Route breakdown table */}
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#e5e7ee', marginBottom: 8 }}>Route Breakdown</div>
                  <div style={{ background: '#111318', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 8, overflow: 'hidden' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                          {['Route', 'Requests', 'Est. Cost', 'Avg Duration'].map(h => (
                            <th key={h} style={{ padding: '10px 12px', textAlign: 'left', color: '#6b7280', fontWeight: 600, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {usageData.byRoute.map(r => (
                          <tr key={r.route} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                            <td style={{ padding: '8px 12px', color: '#e5e7ee', fontWeight: 500, fontFamily: 'monospace', fontSize: 11 }}>{r.route}</td>
                            <td style={{ padding: '8px 12px', color: '#9ca3af' }}>{r.count}</td>
                            <td style={{ padding: '8px 12px', color: r.cost === 0 ? '#22c55e' : '#f59e0b', fontFamily: 'monospace' }}>${r.cost.toFixed(4)}</td>
                            <td style={{ padding: '8px 12px', color: '#9ca3af' }}>{(r.avgDurationMs / 1000).toFixed(1)}s</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Recent requests table */}
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#e5e7ee', marginBottom: 8 }}>Recent Requests (last 50)</div>
                  <div style={{ background: '#111318', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 8, overflow: 'hidden', maxHeight: 400, overflowY: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                      <thead style={{ position: 'sticky', top: 0, background: '#111318' }}>
                        <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                          {['Time', 'Route', 'Model', 'Status', 'Duration', 'Cost'].map(h => (
                            <th key={h} style={{ padding: '8px 10px', textAlign: 'left', color: '#6b7280', fontWeight: 600, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {usageData.recentEntries.map(e => (
                          <tr key={e.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                            <td style={{ padding: '6px 10px', color: '#6b7280', fontFamily: 'monospace', fontSize: 10, whiteSpace: 'nowrap' }}>
                              {new Date(e.timestamp).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                            </td>
                            <td style={{ padding: '6px 10px', color: '#9ca3af', fontFamily: 'monospace' }}>{e.route}</td>
                            <td style={{ padding: '6px 10px', color: e.provider === 'ollama' ? '#22c55e' : '#e5e7ee' }}>{e.modelName}</td>
                            <td style={{ padding: '6px 10px' }}>
                              <span style={{
                                display: 'inline-block', padding: '1px 6px', borderRadius: 4, fontSize: 10, fontWeight: 600,
                                background: e.status === 'success' ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.12)',
                                color: e.status === 'success' ? '#22c55e' : '#ef4444',
                                border: `1px solid ${e.status === 'success' ? 'rgba(34,197,94,0.25)' : 'rgba(239,68,68,0.25)'}`,
                              }}>{e.status}</span>
                            </td>
                            <td style={{ padding: '6px 10px', color: '#9ca3af', fontFamily: 'monospace' }}>{(e.durationMs / 1000).toFixed(1)}s</td>
                            <td style={{ padding: '6px 10px', color: (e.costEstimate ?? 0) === 0 ? '#22c55e' : '#f59e0b', fontFamily: 'monospace' }}>
                              {(e.costEstimate ?? 0) === 0 ? 'FREE' : `$${(e.costEstimate ?? 0).toFixed(4)}`}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Reference iframe — always mounted so inner tab state persists */}
        <iframe
          src="/capability-matrix.html"
          style={{
            position: 'absolute', inset: 0,
            border: 'none', width: '100%', height: '100%',
            display: tab === 'reference' ? 'block' : 'none',
          }}
          title="AI Capability Matrix"
        />
      </div>

      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: 24, right: 24, zIndex: 50,
          padding: '12px 16px', borderRadius: 8,
          background: 'rgba(34,197,94,0.14)', border: '1px solid rgba(34,197,94,0.35)',
          color: '#4ade80', fontSize: 13, fontWeight: 600,
          boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
        }}>{toast}</div>
      )}
    </div>
  )
}
