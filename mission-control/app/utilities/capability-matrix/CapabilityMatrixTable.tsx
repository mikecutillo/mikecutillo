'use client'

import { Fragment, useState } from 'react'

export type Tier = 'local' | 'bridge' | 'claude'
export type Safety = 'safe' | 'confirm' | 'risky'
export type Kind = 'script' | 'project' | 'api' | 'workflow'

export type Action =
  | { type: 'run'; bin: string; args: string[] }
  | { type: 'open'; url: string }
  | { type: 'reveal'; path: string }
  | { type: 'test'; testScript?: string; testArgs?: string[] }
  | { type: 'copy'; prompt: string }

export type Row = {
  id: string
  kind: Kind
  name: string
  description: string
  category: string
  tier: Tier
  safety: Safety
  action: Action
  alt?: Action
  sourcePath?: string
}

type Props = {
  rows: Row[]
  filter?: Kind | 'all'
  showKind?: boolean
  showTierFilter?: boolean
}

type RunResult = {
  ok: boolean
  exitCode?: number
  error?: string
  stdout?: string
  stderr?: string
  durationMs?: number
}

const COLORS = {
  bg: '#0d1117',
  surface: '#111318',
  surface2: '#161b26',
  border: 'rgba(255,255,255,0.07)',
  borderStrong: 'rgba(255,255,255,0.12)',
  text: '#e5e7ee',
  muted: '#6b7280',
  green: '#22c55e',
  amber: '#f59e0b',
  red: '#ef4444',
  blue: '#4da6ff',
  indigo: '#818cf8',
}

const TIER_STYLES: Record<Tier, { bg: string; border: string; fg: string; label: string }> = {
  local:  { bg: 'rgba(34,197,94,0.10)',  border: 'rgba(34,197,94,0.28)',  fg: '#4ade80', label: 'LOCAL · FREE' },
  bridge: { bg: 'rgba(77,166,255,0.10)', border: 'rgba(77,166,255,0.28)', fg: '#60a5fa', label: 'WEB AI · FREE' },
  claude: { bg: 'rgba(245,158,11,0.10)', border: 'rgba(245,158,11,0.30)', fg: '#fbbf24', label: 'CLAUDE · PAID' },
}

const SAFETY_STYLES: Record<Safety, { bg: string; fg: string; label: string }> = {
  safe:    { bg: 'rgba(34,197,94,0.08)',  fg: '#4ade80', label: 'SAFE' },
  confirm: { bg: 'rgba(245,158,11,0.10)', fg: '#fbbf24', label: 'CONFIRM' },
  risky:   { bg: 'rgba(239,68,68,0.12)',  fg: '#f87171', label: 'RISKY' },
}

const KIND_STYLES: Record<Kind, { bg: string; fg: string; label: string }> = {
  script:   { bg: 'rgba(129,140,248,0.12)', fg: '#a5b4fc', label: 'SCRIPT' },
  project:  { bg: 'rgba(94,106,210,0.12)',  fg: '#818cf8', label: 'PROJECT' },
  api:      { bg: 'rgba(77,166,255,0.12)',  fg: '#60a5fa', label: 'API' },
  workflow: { bg: 'rgba(245,158,11,0.12)',  fg: '#fbbf24', label: 'WORKFLOW' },
}

function Pill({ style, text }: { style: { bg: string; fg: string; border?: string }; text: string }) {
  return (
    <span style={{
      display: 'inline-block',
      padding: '2px 8px',
      borderRadius: 4,
      background: style.bg,
      color: style.fg,
      border: style.border ? `1px solid ${style.border}` : '1px solid transparent',
      fontSize: 10,
      fontWeight: 700,
      letterSpacing: '0.3px',
      whiteSpace: 'nowrap',
    }}>{text}</span>
  )
}

function actionButtonLabel(row: Row): { text: string; fg: string; bg: string; border: string } {
  const a = row.action
  if (a.type === 'run') {
    return row.tier === 'local'
      ? { text: 'FREE · Run', fg: '#4ade80', bg: 'rgba(34,197,94,0.12)', border: 'rgba(34,197,94,0.3)' }
      : { text: 'Run', fg: '#fbbf24', bg: 'rgba(245,158,11,0.12)', border: 'rgba(245,158,11,0.3)' }
  }
  if (a.type === 'open')   return { text: 'Open',            fg: '#4ade80', bg: 'rgba(34,197,94,0.12)',  border: 'rgba(34,197,94,0.3)' }
  if (a.type === 'reveal') return { text: 'Reveal in Finder', fg: '#a5b4fc', bg: 'rgba(129,140,248,0.12)', border: 'rgba(129,140,248,0.3)' }
  if (a.type === 'test')   return { text: 'Test',            fg: '#60a5fa', bg: 'rgba(77,166,255,0.12)', border: 'rgba(77,166,255,0.3)' }
  if (a.type === 'copy')   return { text: 'Copy → AI',       fg: '#60a5fa', bg: 'rgba(77,166,255,0.12)', border: 'rgba(77,166,255,0.3)' }
  return { text: 'Run', fg: COLORS.text, bg: COLORS.surface2, border: COLORS.border }
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

export default function CapabilityMatrixTable({
  rows,
  filter = 'all',
  showKind = false,
  showTierFilter = false,
}: Props) {
  const [tierFilter, setTierFilter] = useState<'all' | Tier>('all')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [running, setRunning] = useState<Set<string>>(new Set())
  const [results, setResults] = useState<Record<string, RunResult>>({})
  const [toast, setToast] = useState<string | null>(null)

  const visible = rows
    .filter(r => filter === 'all' || r.kind === filter)
    .filter(r => tierFilter === 'all' || r.tier === tierFilter)

  function flashToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 2500)
  }

  function markRunning(id: string, v: boolean) {
    setRunning(prev => {
      const next = new Set(prev)
      if (v) next.add(id)
      else next.delete(id)
      return next
    })
  }

  async function doAction(row: Row) {
    const a = row.action

    // Copy to clipboard
    if (a.type === 'copy') {
      try {
        await navigator.clipboard.writeText(a.prompt)
        flashToast(`Copied prompt: ${row.name}`)
      } catch {
        flashToast('Clipboard blocked — see console')
      }
      return
    }

    // Open / reveal
    if (a.type === 'open' || a.type === 'reveal') {
      markRunning(row.id, true)
      try {
        const res = await fetch('/api/capability-matrix/open', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rowId: row.id }),
        })
        const body = await res.json()
        if (body.ok) flashToast(a.type === 'open' ? `Opened ${row.name}` : 'Revealed in Finder')
        else flashToast(`Open failed: ${body.error}`)
      } catch (err) {
        flashToast(`Open error: ${String(err)}`)
      } finally {
        markRunning(row.id, false)
      }
      return
    }

    // Test
    if (a.type === 'test') {
      markRunning(row.id, true)
      setExpanded(row.id)
      try {
        const res = await fetch('/api/capability-matrix/test', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rowId: row.id }),
        })
        const body: RunResult = await res.json()
        setResults(r => ({ ...r, [row.id]: body }))
      } catch (err) {
        setResults(r => ({ ...r, [row.id]: { ok: false, error: String(err) } }))
      } finally {
        markRunning(row.id, false)
      }
      return
    }

    // Run
    if (a.type === 'run') {
      // Safety gate (client-side confirm + server also enforces)
      if (row.safety !== 'safe') {
        const verb = row.safety === 'risky' ? 'DESTRUCTIVE' : 'non-trivial'
        const ok = window.confirm(
          `Run "${row.name}"?\n\nThis is a ${verb} action.\nCommand: ${a.bin} ${a.args.join(' ')}`
        )
        if (!ok) return
      }
      markRunning(row.id, true)
      setExpanded(row.id)
      try {
        const res = await fetch('/api/capability-matrix/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rowId: row.id, confirmed: row.safety !== 'safe' }),
        })
        const body: RunResult = await res.json()
        setResults(r => ({ ...r, [row.id]: body }))
      } catch (err) {
        setResults(r => ({ ...r, [row.id]: { ok: false, error: String(err) } }))
      } finally {
        markRunning(row.id, false)
      }
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', position: 'relative' }}>
      {/* Tier filter bar */}
      {showTierFilter && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px',
          borderBottom: `1px solid ${COLORS.border}`, background: COLORS.surface, flexShrink: 0,
        }}>
          <span style={{ color: COLORS.muted, fontSize: 11, fontWeight: 600, marginRight: 4, letterSpacing: '0.4px' }}>
            FILTER BY COST
          </span>
          {(['all', 'local', 'bridge', 'claude'] as const).map(t => {
            const active = tierFilter === t
            const label = t === 'all' ? 'All'
              : t === 'local' ? 'Local · Free'
              : t === 'bridge' ? 'Free Web AI'
              : 'Claude · Paid'
            return (
              <button
                key={t}
                onClick={() => setTierFilter(t)}
                style={{
                  padding: '5px 12px', borderRadius: 14, cursor: 'pointer',
                  background: active ? 'rgba(94,106,210,0.18)' : 'transparent',
                  border: active ? `1px solid rgba(94,106,210,0.4)` : `1px solid ${COLORS.border}`,
                  color: active ? COLORS.indigo : COLORS.muted,
                  fontSize: 11, fontWeight: 600, transition: 'all 0.15s',
                }}
              >{label}</button>
            )
          })}
          <span style={{ marginLeft: 'auto', color: COLORS.muted, fontSize: 11 }}>
            {visible.length} row{visible.length === 1 ? '' : 's'}
          </span>
        </div>
      )}

      {/* Table */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        <table style={{
          width: '100%', borderCollapse: 'collapse', fontSize: 13, color: COLORS.text,
        }}>
          <thead style={{ position: 'sticky', top: 0, background: COLORS.surface, zIndex: 1 }}>
            <tr>
              {showKind && <th style={thStyle}>Kind</th>}
              <th style={thStyle}>Name</th>
              <th style={thStyle}>Category</th>
              <th style={thStyle}>Tier</th>
              <th style={thStyle}>Safety</th>
              <th style={{ ...thStyle, textAlign: 'right', width: 180 }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && (
              <tr>
                <td
                  colSpan={showKind ? 6 : 5}
                  style={{ padding: '40px 16px', textAlign: 'center', color: COLORS.muted, fontSize: 13 }}
                >
                  No rows. Click Refresh to discover.
                </td>
              </tr>
            )}
            {visible.map(row => {
              const btn = actionButtonLabel(row)
              const isRunning = running.has(row.id)
              const isExpanded = expanded === row.id
              const result = results[row.id]

              return (
                <Fragment key={row.id}>
                  <tr
                    style={{
                      borderBottom: `1px solid ${COLORS.border}`,
                      transition: 'background 0.1s',
                    }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.02)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                  >
                    {showKind && (
                      <td style={tdStyle}>
                        <Pill style={KIND_STYLES[row.kind]} text={KIND_STYLES[row.kind].label} />
                      </td>
                    )}
                    <td style={{ ...tdStyle, minWidth: 280 }}>
                      <div style={{ fontWeight: 600, color: COLORS.text, marginBottom: 2 }}>
                        {row.name}
                      </div>
                      <div style={{ color: COLORS.muted, fontSize: 12, lineHeight: 1.4 }}>
                        {row.description}
                      </div>
                      {row.sourcePath && (
                        <div style={{ color: '#4b5563', fontSize: 10, marginTop: 3, fontFamily: 'ui-monospace, monospace' }}>
                          {row.sourcePath.replace('/Users/mikecutillo', '~')}
                        </div>
                      )}
                    </td>
                    <td style={{ ...tdStyle, color: COLORS.muted, fontSize: 12 }}>{row.category}</td>
                    <td style={tdStyle}>
                      <Pill style={TIER_STYLES[row.tier]} text={TIER_STYLES[row.tier].label} />
                    </td>
                    <td style={tdStyle}>
                      <Pill style={SAFETY_STYLES[row.safety]} text={SAFETY_STYLES[row.safety].label} />
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        {(row.action.type === 'run' || row.action.type === 'test') && result && (
                          <button
                            onClick={() => setExpanded(isExpanded ? null : row.id)}
                            style={{
                              padding: '5px 8px', borderRadius: 6, cursor: 'pointer',
                              background: 'transparent', border: `1px solid ${COLORS.border}`,
                              color: COLORS.muted, fontSize: 11, fontWeight: 600,
                            }}
                            title={isExpanded ? 'Hide output' : 'Show output'}
                          >{isExpanded ? '▲' : '▼'}</button>
                        )}
                        <button
                          onClick={() => doAction(row)}
                          disabled={isRunning}
                          style={{
                            padding: '6px 12px', borderRadius: 6,
                            cursor: isRunning ? 'wait' : 'pointer',
                            background: btn.bg,
                            border: `1px solid ${btn.border}`,
                            color: btn.fg,
                            fontSize: 11, fontWeight: 700, letterSpacing: '0.2px',
                            opacity: isRunning ? 0.6 : 1,
                            transition: 'all 0.15s',
                            minWidth: 110,
                          }}
                        >
                          {isRunning ? 'Running…' : btn.text}
                        </button>
                      </div>
                    </td>
                  </tr>
                  {isExpanded && result && (
                    <tr>
                      <td colSpan={showKind ? 6 : 5} style={{ padding: 0, background: '#0a0b0f' }}>
                        <div style={{
                          padding: '12px 16px',
                          borderBottom: `1px solid ${COLORS.border}`,
                          fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
                          fontSize: 12,
                        }}>
                          <div style={{
                            color: result.ok ? COLORS.green : COLORS.red,
                            marginBottom: 8, fontWeight: 600,
                          }}>
                            {result.ok ? '✓' : '✗'} exit {result.exitCode ?? (result.ok ? 0 : '—')}
                            {result.durationMs != null && ` · ${(result.durationMs / 1000).toFixed(2)}s`}
                            {result.stdout != null && ` · ${formatBytes(result.stdout.length)}`}
                            {result.error && ` · ${result.error}`}
                          </div>
                          {result.stdout && (
                            <pre style={{
                              margin: 0, padding: 10, borderRadius: 6,
                              background: '#050608', color: '#86efac',
                              maxHeight: 240, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                            }}>{result.stdout}</pre>
                          )}
                          {result.stderr && (
                            <pre style={{
                              margin: '8px 0 0', padding: 10, borderRadius: 6,
                              background: '#050608', color: '#fca5a5',
                              maxHeight: 180, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                            }}>{result.stderr}</pre>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Toast */}
      {toast && (
        <div style={{
          position: 'absolute', bottom: 16, right: 16, zIndex: 10,
          padding: '10px 14px', borderRadius: 8,
          background: 'rgba(34,197,94,0.14)', border: '1px solid rgba(34,197,94,0.35)',
          color: '#4ade80', fontSize: 12, fontWeight: 600,
          boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
        }}>{toast}</div>
      )}
    </div>
  )
}

const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '10px 14px',
  borderBottom: `1px solid ${COLORS.borderStrong}`,
  color: COLORS.muted,
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: '0.4px',
  textTransform: 'uppercase',
}

const tdStyle: React.CSSProperties = {
  padding: '12px 14px',
  verticalAlign: 'middle',
}
