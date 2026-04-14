'use client'

import { useState, useEffect, useCallback } from 'react'
import TopNav from '@/components/top-nav'
import {
  Mail, RefreshCw, Search, Zap, AlertCircle, CheckCircle,
  TrendingUp, TrendingDown, Clock, DollarSign, Loader2,
  ChevronDown, Trash2,
} from 'lucide-react'

// ── Types ──────────────────────────────────────────────────────────────────────

interface EmailItem {
  id: string
  account: string
  account_label: string
  from: string
  subject: string
  date: string
  summary: string
  urgency: 'high' | 'medium' | 'low'
  categories: string[]
  financial: FinancialData | null
}

interface FinancialData {
  payee: string
  amount: number | null
  due_date: string | null
  type: string
}

interface BillDue {
  payee: string
  amount: number | null
  due_date: string | null
  urgency: string
  paid: boolean
  account: string
  subject: string
  summary: string
}

interface DigestData {
  generated_at: string | null
  lookback_hours: number
  stats: { total_fetched: number; total_classified: number }
  financials: {
    bills_due: BillDue[]
    recent_charges: BillDue[]
    income: BillDue[]
    month_summary: { in: number; out: number; due_soon: number }
  }
  categories: {
    action_items: EmailItem[]
    bills: EmailItem[]
    family: EmailItem[]
    financial: EmailItem[]
    digest: EmailItem[]
  }
}

interface SearchResult {
  id: string
  account_label: string
  from: string
  subject: string
  date: string
  snippet: string
}

// ── Constants ──────────────────────────────────────────────────────────────────

const TABS = [
  { key: 'action_items', label: 'Action Items', emoji: '🔴' },
  { key: 'bills',        label: 'Bills',        emoji: '💳' },
  { key: 'family',       label: 'Family',       emoji: '🏠' },
  { key: 'digest',       label: 'All Mail',     emoji: '📬' },
  { key: 'search',       label: 'Search',       emoji: '🔍' },
] as const

type TabKey = typeof TABS[number]['key']

const URGENCY_COLORS: Record<string, string> = {
  high:    'var(--error)',
  medium:  'var(--warning)',
  low:     'var(--dim)',
  overdue: 'var(--error)',
  urgent:  'var(--warning)',
  soon:    'var(--warning)',
  normal:  'var(--dim)',
}

const ACCOUNT_COLORS: Record<string, string> = {
  Mike: '#5E6AD2',
  Erin: '#ec4899',
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function AccountBadge({ label }: { label: string }) {
  const color = ACCOUNT_COLORS[label] || 'var(--dim)'
  return (
    <span style={{
      fontSize: '10px', fontWeight: 600, padding: '2px 6px', borderRadius: '4px',
      background: color + '22', color, border: `1px solid ${color}44`,
      textTransform: 'uppercase', letterSpacing: '0.05em',
    }}>
      {label}
    </span>
  )
}

function UrgencyDot({ urgency }: { urgency: string }) {
  const color = URGENCY_COLORS[urgency] || 'var(--dim)'
  return (
    <span style={{
      display: 'inline-block', width: 7, height: 7, borderRadius: '50%',
      background: color, flexShrink: 0, marginTop: 6,
    }} />
  )
}

function EmailCard({ item }: { item: EmailItem }) {
  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 8, padding: '12px 14px', display: 'flex', gap: 10,
    }}>
      <UrgencyDot urgency={item.urgency} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 4 }}>
          <AccountBadge label={item.account_label} />
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 400 }}>
            {item.subject}
          </span>
        </div>
        <p style={{ margin: 0, fontSize: 12, color: 'var(--muted)', lineHeight: 1.5 }}>
          {item.summary}
        </p>
        <p style={{ margin: '4px 0 0', fontSize: 11, color: 'var(--dim)' }}>
          {item.from} · {item.date ? new Date(item.date).toLocaleDateString() : ''}
        </p>
      </div>
    </div>
  )
}

function EmptyState({ label }: { label: string }) {
  return (
    <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--dim)' }}>
      <CheckCircle size={28} style={{ marginBottom: 8, opacity: 0.4 }} />
      <p style={{ margin: 0, fontSize: 13 }}>No {label} in the last 24 hours</p>
    </div>
  )
}

function BillChip({ bill }: { bill: BillDue }) {
  const color = URGENCY_COLORS[bill.urgency] || 'var(--dim)'
  const daysLabel = () => {
    if (!bill.due_date) return ''
    const diff = Math.ceil((new Date(bill.due_date).getTime() - Date.now()) / 86400000)
    if (diff < 0)  return 'overdue'
    if (diff === 0) return 'today'
    if (diff === 1) return 'tomorrow'
    return `in ${diff}d`
  }
  return (
    <div style={{
      background: 'var(--surface)', border: `1px solid ${color}44`,
      borderRadius: 8, padding: '10px 14px', minWidth: 160,
    }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', marginBottom: 2 }}>
        {bill.payee}
      </div>
      <div style={{ fontSize: 18, fontWeight: 700, color }}>
        {bill.amount != null ? `$${bill.amount.toFixed(0)}` : '—'}
      </div>
      <div style={{ fontSize: 11, color: 'var(--dim)', marginTop: 2 }}>
        {daysLabel()} {bill.due_date ? `· ${bill.due_date}` : ''}
      </div>
      <div style={{ marginTop: 4 }}>
        <AccountBadge label={ACCOUNT_LABELS_MAP[bill.account] || bill.account} />
      </div>
    </div>
  )
}

const ACCOUNT_LABELS_MAP: Record<string, string> = {
  'cutillo@gmail.com':        'Mike',
  'erincutillo@gmail.com':    'Erin',
  'erinrameyallen@gmail.com': 'Erin',
}

// ── Financial Strip ────────────────────────────────────────────────────────────

function FinancialStrip({ financials }: { financials: DigestData['financials'] }) {
  const { month_summary, bills_due } = financials
  const hasData = month_summary.in > 0 || month_summary.out > 0 || bills_due.length > 0

  if (!hasData) return null

  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 10, padding: '16px 20px', marginBottom: 24,
    }}>
      {/* Summary row */}
      <div style={{ display: 'flex', gap: 32, marginBottom: bills_due.length ? 16 : 0, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <TrendingUp size={16} color="var(--success)" />
          <div>
            <div style={{ fontSize: 11, color: 'var(--dim)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>In</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--success)' }}>
              ${month_summary.in.toFixed(0)}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <TrendingDown size={16} color="var(--error)" />
          <div>
            <div style={{ fontSize: 11, color: 'var(--dim)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Out</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--error)' }}>
              ${month_summary.out.toFixed(0)}
            </div>
          </div>
        </div>
        {month_summary.due_soon > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <AlertCircle size={16} color="var(--warning)" />
            <div>
              <div style={{ fontSize: 11, color: 'var(--dim)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Due Soon</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--warning)' }}>
                ${month_summary.due_soon.toFixed(0)}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Bills due chips */}
      {bills_due.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <div style={{ display: 'flex', gap: 10, paddingBottom: 4 }}>
            {bills_due.map((b, i) => <BillChip key={i} bill={b} />)}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Search Tab ─────────────────────────────────────────────────────────────────

function SearchTab() {
  const [query, setQuery]     = useState('')
  const [mode, setMode]       = useState<'search' | 'ask'>('search')
  const [loading, setLoading] = useState(false)
  const [results, setResults] = useState<SearchResult[]>([])
  const [answer, setAnswer]   = useState<string | null>(null)
  const [error, setError]     = useState<string | null>(null)

  const handleSearch = async () => {
    if (!query.trim()) return
    setLoading(true)
    setError(null)
    setAnswer(null)
    setResults([])
    try {
      const res  = await fetch('/api/email-digest/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, mode }),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setResults(data.results || [])
      setAnswer(data.answer || null)
    } catch (e: unknown) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      {/* Mode toggle */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        {(['search', 'ask'] as const).map(m => (
          <button key={m} onClick={() => setMode(m)} style={{
            padding: '6px 14px', borderRadius: 6, fontSize: 13, fontWeight: 600,
            border: `1px solid ${mode === m ? 'var(--accent)' : 'var(--border)'}`,
            background: mode === m ? 'var(--accent)22' : 'transparent',
            color: mode === m ? 'var(--accent)' : 'var(--muted)',
            cursor: 'pointer',
          }}>
            {m === 'search' ? '🔍 Search' : '🤖 Ask AI'}
          </button>
        ))}
      </div>

      {/* Input */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSearch()}
          placeholder={mode === 'search'
            ? 'Search all inboxes… e.g. "Verizon bill"'
            : 'Ask anything… e.g. "How much was my last Verizon bill?"'}
          style={{
            flex: 1, background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 8, padding: '10px 14px', fontSize: 14, color: 'var(--text)',
            outline: 'none',
          }}
        />
        <button
          onClick={handleSearch}
          disabled={loading || !query.trim()}
          style={{
            padding: '10px 18px', borderRadius: 8, background: 'var(--accent)',
            color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 600,
            fontSize: 13, display: 'flex', alignItems: 'center', gap: 6,
            opacity: loading || !query.trim() ? 0.5 : 1,
          }}
        >
          {loading ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
          {mode === 'search' ? 'Search' : 'Ask'}
        </button>
      </div>

      {/* AI Answer */}
      {answer && (
        <div style={{
          background: 'var(--accent)11', border: '1px solid var(--accent)33',
          borderRadius: 8, padding: '12px 16px', marginBottom: 16,
          display: 'flex', gap: 10, alignItems: 'flex-start',
        }}>
          <Zap size={16} color="var(--accent)" style={{ flexShrink: 0, marginTop: 2 }} />
          <p style={{ margin: 0, fontSize: 14, color: 'var(--text)', lineHeight: 1.6 }}>
            {answer}
          </p>
        </div>
      )}

      {/* Error */}
      {error && (
        <div style={{ color: 'var(--error)', fontSize: 13, marginBottom: 12 }}>
          {error}
        </div>
      )}

      {/* Results */}
      {results.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <p style={{ margin: '0 0 8px', fontSize: 12, color: 'var(--dim)' }}>
            {results.length} result{results.length !== 1 ? 's' : ''} across all accounts
          </p>
          {results.map(r => (
            <div key={r.id} style={{
              background: 'var(--surface)', border: '1px solid var(--border)',
              borderRadius: 8, padding: '12px 14px',
            }}>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4 }}>
                <AccountBadge label={r.account_label} />
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
                  {r.subject}
                </span>
              </div>
              <p style={{ margin: 0, fontSize: 12, color: 'var(--muted)', lineHeight: 1.5 }}>
                {r.snippet}
              </p>
              <p style={{ margin: '4px 0 0', fontSize: 11, color: 'var(--dim)' }}>
                {r.from} · {r.date ? new Date(r.date).toLocaleDateString() : ''}
              </p>
            </div>
          ))}
        </div>
      )}

      {!loading && !results.length && !answer && query && (
        <p style={{ color: 'var(--dim)', fontSize: 13 }}>No results found.</p>
      )}
    </div>
  )
}

// ── Gmail Wipe Stats ──────────────────────────────────────────────────────────

interface WipeCategoryStat { deleted: number; status: string }
interface WipeAccountStat  { categories: Record<string, WipeCategoryStat>; total: number; min_age: string }
interface WipeRun           { run_at: string; accounts: Record<string, WipeAccountStat>; grand_total: number }

const WIPE_CAT_LABELS: Record<string, string> = {
  SPAM: 'Spam', CATEGORY_PROMOTIONS: 'Promotions', CATEGORY_SOCIAL: 'Social', CATEGORY_UPDATES: 'Updates',
}

function GmailWipeStats({ history }: { history: WipeRun[] }) {
  const [open, setOpen] = useState(false)

  if (!history.length) return null

  const latest = history[0]
  const accounts = Object.entries(latest.accounts)
  const maxTotal = Math.max(...accounts.map(([, a]) => a.total), 1)
  const runDate = new Date(latest.run_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 10, marginBottom: 24, overflow: 'hidden',
    }}>
      {/* Toggle header */}
      <button
        onClick={() => setOpen(!open)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 8,
          padding: '10px 16px', background: 'transparent', border: 'none',
          cursor: 'pointer', color: 'var(--text)',
        }}
      >
        <Trash2 size={13} color="var(--accent)" />
        <span style={{ fontSize: 12, fontWeight: 600 }}>Cleanup History</span>
        <span style={{ fontSize: 11, color: 'var(--dim)' }}>{runDate}</span>
        <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--success)', fontWeight: 700 }}>
          {latest.grand_total.toLocaleString()} deleted
        </span>
        <ChevronDown size={13} color="var(--dim)" style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />
      </button>

      {/* Expandable detail */}
      {open && (
        <div style={{ padding: '0 16px 14px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
            {accounts.map(([email, stat]) => {
              const short = email.split('@')[0]
              const barPct = Math.round((stat.total / maxTotal) * 100)
              const cats = Object.entries(stat.categories)
              return (
                <div key={email} style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px' }}>
                  <div style={{ fontSize: 11, color: 'var(--dim)', marginBottom: 4 }}>{short}</div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--text)', marginBottom: 6 }}>{stat.total.toLocaleString()}</div>
                  <div style={{ height: 3, background: 'var(--border)', borderRadius: 2, marginBottom: 8 }}>
                    <div style={{ height: 3, width: `${barPct}%`, background: 'var(--accent)', borderRadius: 2 }} />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    {cats.map(([cat, val]) => (
                      <div key={cat} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--dim)' }}>
                        <span>{WIPE_CAT_LABELS[cat] ?? cat}</span>
                        <span style={{ color: val?.status === 'ok' ? 'var(--text)' : 'var(--error)' }}>{(val?.deleted ?? 0).toLocaleString()}</span>
                      </div>
                    ))}
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--dim)', marginTop: 4 }}>
                    cutoff: &gt;{stat.min_age === '730d' ? '2 yr' : '1 yr'}
                  </div>
                </div>
              )
            })}
          </div>

          {history.length > 1 && (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: 11, color: 'var(--dim)', marginBottom: 4 }}>Previous runs</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {history.slice(1).map((run, i) => (
                  <span key={i} style={{ fontSize: 10, color: 'var(--dim)', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 4, padding: '2px 8px' }}>
                    {new Date(run.run_at).toLocaleDateString('en-US', { month: 'short', year: '2-digit' })}
                    {' · '}{run.grand_total.toLocaleString()}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Main Page ──────────────────────────────────────────────────────────────────

export default function EmailDigestPage() {
  const [data, setData]       = useState<DigestData | null>(null)
  const [tab, setTab]         = useState<TabKey>('action_items')
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [runMsg, setRunMsg]   = useState<string | null>(null)
  const [wipeHistory, setWipeHistory] = useState<WipeRun[]>([])

  const fetchDigest = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/email-digest')
      setData(await res.json())
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchDigest() }, [fetchDigest])

  useEffect(() => {
    fetch('/api/gmail-stats')
      .then(r => r.json())
      .then(d => setWipeHistory(d.history ?? []))
      .catch(() => {})
  }, [])

  const handleRunNow = async () => {
    setRunning(true)
    setRunMsg(null)
    try {
      const res  = await fetch('/api/email-digest/run', { method: 'POST' })
      const body = await res.json()
      if (body.status === 'ok') {
        setRunMsg('Digest complete.')
        await fetchDigest()
      } else {
        setRunMsg(`Error: ${body.message}`)
      }
    } catch (e: unknown) {
      setRunMsg(`Failed: ${(e as Error).message}`)
    } finally {
      setRunning(false)
    }
  }

  const cats = data?.categories
  const items = cats ? (cats[tab as keyof typeof cats] as EmailItem[] | undefined) ?? [] : []

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', color: 'var(--text)' }}>
      <TopNav crumbs={[{ label: 'Cutillo Cloud' }, { label: 'Email Digest', active: true }]} />
      <div style={{ maxWidth: 900, margin: '0 auto', padding: '32px 24px' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Mail size={22} color="var(--accent)" />
            <div>
              <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>Email Digest</h1>
              {data?.generated_at && (
                <p style={{ margin: 0, fontSize: 12, color: 'var(--dim)', marginTop: 2 }}>
                  Last run: {new Date(data.generated_at).toLocaleString()}
                  {data.stats && ` · ${data.stats.total_fetched} emails fetched`}
                </p>
              )}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {runMsg && (
              <span style={{ fontSize: 12, color: runMsg.startsWith('Error') ? 'var(--error)' : 'var(--success)' }}>
                {runMsg}
              </span>
            )}
            <button
              onClick={handleRunNow}
              disabled={running}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '8px 14px', borderRadius: 7,
                background: 'var(--accent)', color: '#fff', border: 'none',
                cursor: running ? 'not-allowed' : 'pointer', fontWeight: 600, fontSize: 13,
                opacity: running ? 0.6 : 1,
              }}
            >
              {running
                ? <><Loader2 size={14} className="animate-spin" /> Running…</>
                : <><RefreshCw size={14} /> Run Now</>
              }
            </button>
          </div>
        </div>

        {/* Financial Strip */}
        {data?.financials && <FinancialStrip financials={data.financials} />}

        {/* Gmail Wipe Stats */}
        <GmailWipeStats history={wipeHistory} />

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 20, borderBottom: '1px solid var(--border)', paddingBottom: 0 }}>
          {TABS.map(t => {
            const count = t.key !== 'search' && cats
              ? (cats[t.key as keyof typeof cats] as EmailItem[])?.length ?? 0
              : null
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                style={{
                  padding: '8px 14px', borderRadius: '6px 6px 0 0', fontSize: 13, fontWeight: 600,
                  border: '1px solid transparent',
                  borderBottom: tab === t.key ? '1px solid var(--bg)' : '1px solid transparent',
                  background: tab === t.key ? 'var(--surface)' : 'transparent',
                  color: tab === t.key ? 'var(--text)' : 'var(--dim)',
                  cursor: 'pointer',
                  marginBottom: -1,
                  display: 'flex', alignItems: 'center', gap: 5,
                }}
              >
                <span>{t.emoji}</span>
                <span>{t.label}</span>
                {count != null && count > 0 && (
                  <span style={{
                    background: 'var(--accent)', color: '#fff',
                    fontSize: 10, fontWeight: 700, borderRadius: 10,
                    padding: '1px 6px', minWidth: 18, textAlign: 'center',
                  }}>
                    {count}
                  </span>
                )}
              </button>
            )
          })}
        </div>

        {/* Tab content */}
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '64px 0' }}>
            <Loader2 size={24} className="animate-spin" color="var(--dim)" />
          </div>
        ) : tab === 'search' ? (
          <SearchTab />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {items.length === 0
              ? <EmptyState label={TABS.find(t => t.key === tab)?.label ?? tab} />
              : items.map(item => <EmailCard key={item.id} item={item} />)
            }
          </div>
        )}
      </div>
    </div>
  )
}
