'use client'

import React, { useEffect, useState, useCallback } from 'react'
import {
  Wallet, RefreshCw, ArrowUpRight, Plus, Upload, Trash2, ChevronDown,
  DollarSign, AlertTriangle, CheckCircle2, Clock, X, FileText, Search,
} from 'lucide-react'

// ── Types ────────────────────────────────────────────────────────────────────

interface Evidence {
  gmail_id: string
  account: string
  subject: string
  date: string
  snippet: string
  amounts_found: number[]
}

interface Receipt {
  id: string
  type: string
  source_platform: string
  original_filename?: string
  captured_at?: string
  matched_vendor?: string
  matched_amount?: number
}

interface LedgerItem {
  id: string
  vendor: string
  category: string
  sub_category: string
  owner: string
  status: string
  amount: number | null
  billing_cycle: string
  billing_day: number | null
  due_date: string | null
  last_paid_date: string | null
  last_paid_amount: number | null
  monthly_estimate: number | null
  payment_method: string
  confidence: string
  source_accounts: string[]
  sender_email: string
  evidence: Evidence[]
  receipts: Receipt[]
  notion_page_id?: string
  notes?: string
}

interface LedgerData {
  summary: {
    total_items: number
    confirmed_monthly: number
    likely_monthly: number
    by_category: Record<string, { count: number; monthly_total: number }>
    by_owner: Record<string, { count: number; monthly_total: number }>
  }
  items: LedgerItem[]
}

// ── Config ───────────────────────────────────────────────────────────────────

const CATEGORIES = ['recurring_fixed', 'recurring_variable', 'subscription', 'one_time'] as const
const STATUSES = ['auto_pay', 'due_soon', 'paid', 'overdue', 'pending', 'cancelled', 'unknown'] as const
const OWNERS = ['mike', 'erin', 'shared', 'kids', 'bmo'] as const
const BILLING_CYCLES = ['monthly', 'quarterly', 'annual', 'one_time', 'unknown'] as const
const SUB_CATEGORIES = [
  'mortgage', 'auto_loan', 'insurance', 'utility', 'internet', 'phone',
  'streaming', 'ai_tools', 'food_delivery', 'groceries', 'shopping',
  'transfer', 'credit_card', 'banking', 'toll', 'tax', 'other',
] as const
const PAYMENT_METHODS = ['bank_autopay', 'credit_card', 'manual', 'zelle', 'unknown'] as const
const CONFIDENCE = ['confirmed', 'likely', 'unverified'] as const

const CATEGORY_LABELS: Record<string, string> = {
  recurring_fixed: 'Recurring Fixed',
  recurring_variable: 'Recurring Variable',
  subscription: 'Subscription',
  one_time: 'One-Time',
}
const CATEGORY_COLORS: Record<string, string> = {
  recurring_fixed: '#ef4444',
  recurring_variable: '#f97316',
  subscription: '#3b82f6',
  one_time: '#6b7280',
}
const STATUS_COLORS: Record<string, string> = {
  auto_pay: '#10b981',
  due_soon: '#f59e0b',
  paid: '#10b981',
  overdue: '#ef4444',
  pending: '#f97316',
  cancelled: '#6b7280',
  unknown: '#6b7280',
}
const OWNER_COLORS: Record<string, string> = {
  mike: '#3b82f6',
  erin: '#ec4899',
  shared: '#8b5cf6',
  kids: '#10b981',
  bmo: '#f59e0b',
}

const fmt = (n: number | null | undefined) =>
  n != null ? `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : ''

// ── Inline Select ────────────────────────────────────────────────────────────

function InlineSelect({ value, options, colors, onChange }: {
  value: string
  options: readonly string[]
  colors?: Record<string, string>
  onChange: (v: string) => void
}) {
  const [open, setOpen] = useState(false)
  const color = colors?.[value] || '#6b7280'
  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          padding: '2px 8px', borderRadius: '999px', cursor: 'pointer',
          background: `${color}18`, border: `1px solid ${color}40`, color,
          fontSize: '11px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '3px',
          whiteSpace: 'nowrap',
        }}
      >
        {value?.replace(/_/g, ' ') || '—'}
        <ChevronDown size={10} />
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, zIndex: 50, marginTop: '4px',
          background: '#1a1d24', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px',
          padding: '4px', minWidth: '140px', boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
        }}>
          {options.map(opt => {
            const c = colors?.[opt] || '#A0AABB'
            return (
              <button key={opt} onClick={() => { onChange(opt); setOpen(false) }}
                style={{
                  display: 'block', width: '100%', textAlign: 'left', padding: '5px 10px',
                  background: opt === value ? `${c}20` : 'transparent', border: 'none',
                  color: c, fontSize: '11px', fontWeight: 500, cursor: 'pointer', borderRadius: '4px',
                }}
              >
                {opt.replace(/_/g, ' ')}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Inline Editable Text ─────────────────────────────────────────────────────

function InlineEdit({ value, type, onChange }: {
  value: string | number | null
  type?: 'text' | 'number' | 'date'
  onChange: (v: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(String(value ?? ''))
  if (!editing) {
    return (
      <span
        onClick={() => { setDraft(String(value ?? '')); setEditing(true) }}
        style={{ cursor: 'pointer', minWidth: '40px', display: 'inline-block' }}
      >
        {type === 'number' ? fmt(value as number | null) : (String(value ?? '') || '—')}
      </span>
    )
  }
  return (
    <input
      autoFocus
      type={type || 'text'}
      value={draft}
      onChange={e => setDraft(e.target.value)}
      onBlur={() => { onChange(draft); setEditing(false) }}
      onKeyDown={e => { if (e.key === 'Enter') { onChange(draft); setEditing(false) } if (e.key === 'Escape') setEditing(false) }}
      style={{
        background: '#1a1d24', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '4px',
        color: '#E5E7EE', fontSize: '12px', padding: '2px 6px', width: type === 'number' ? '90px' : '120px',
        outline: 'none',
      }}
    />
  )
}

// ── Status Pill ──────────────────────────────────────────────────────────────

function Pill({ label, color }: { label: string; color: string }) {
  return (
    <span style={{
      padding: '3px 8px', borderRadius: '999px', fontSize: '10px', fontWeight: 700,
      background: `${color}18`, border: `1px solid ${color}40`, color,
    }}>
      {label.replace(/_/g, ' ')}
    </span>
  )
}

// ── KPI Card ─────────────────────────────────────────────────────────────────

function KPI({ label, value, color, sub }: { label: string; value: string; color: string; sub?: string }) {
  return (
    <div style={{
      background: '#111318', borderRadius: '10px', padding: '14px 18px', flex: 1, minWidth: '150px',
      border: '1px solid rgba(255,255,255,0.06)', borderTop: `2px solid ${color}66`,
    }}>
      <div style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#A0AABB', marginBottom: '6px' }}>
        {label}
      </div>
      <div style={{ fontSize: '22px', fontWeight: 800, color, letterSpacing: '-0.04em' }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: '11px', color: '#6b7280', marginTop: '2px' }}>{sub}</div>}
    </div>
  )
}

// ── Main Page ────────────────────────────────────────────────────────────────

export default function FinancialLedgerPage() {
  const [data, setData] = useState<LedgerData | null>(null)
  const [loading, setLoading] = useState(true)
  const [scanning, setScanning] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [scanMsg, setScanMsg] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [filterCat, setFilterCat] = useState<string>('all')
  const [filterOwner, setFilterOwner] = useState<string>('all')
  const [filterStatus, setFilterStatus] = useState<string>('all')
  const [searchQ, setSearchQ] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [showAdd, setShowAdd] = useState(false)
  const [newVendor, setNewVendor] = useState('')
  const [newAmount, setNewAmount] = useState('')

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('/api/financial-ledger')
      const json = await res.json()
      setData(json)
    } catch { /* noop */ }
    setLoading(false)
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  const updateItem = async (id: string, updates: Record<string, unknown>) => {
    await fetch('/api/financial-ledger', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, updates }),
    })
    fetchData()
  }

  const deleteItem = async (id: string) => {
    await fetch('/api/financial-ledger', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    setSelected(null)
    fetchData()
  }

  const addItem = async () => {
    if (!newVendor.trim()) return
    await fetch('/api/financial-ledger', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        item: {
          vendor: newVendor.trim(),
          amount: newAmount ? parseFloat(newAmount) : null,
          category: 'recurring_fixed',
          sub_category: 'other',
          owner: 'mike',
          status: 'unknown',
          billing_cycle: 'monthly',
          confidence: 'unverified',
          payment_method: 'unknown',
        },
      }),
    })
    setNewVendor(''); setNewAmount(''); setShowAdd(false)
    fetchData()
  }

  const runScan = async () => {
    setScanning(true); setScanMsg('Scanning Gmail...')
    try {
      const res = await fetch('/api/financial-ledger/scan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ days: 90, merge: true }) })
      const json = await res.json()
      setScanMsg(json.status === 'ok' ? 'Scan complete' : `Error: ${json.message}`)
      fetchData()
    } catch { setScanMsg('Scan failed') }
    setScanning(false)
  }

  const runNotionSync = async () => {
    setSyncing(true); setScanMsg('Syncing to Notion...')
    try {
      const res = await fetch('/api/notion-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: 'financial-ledger' }),
      })
      const json = await res.json()
      if (json.status === 'setup_required') {
        setScanMsg(`Setup needed: ${json.setup?.steps?.[0] || 'Configure NOTION_PARENT_PAGE_ID in .env.local'}`)
      } else if (json.status === 'ok') {
        const r = json.results?.['financial-ledger'] || json
        setScanMsg(`Synced ${r.synced ?? ''}/${r.total ?? ''} items to Notion`)
        fetchData()
      } else {
        setScanMsg(`Error: ${json.message || 'Unknown error'}`)
      }
    } catch { setScanMsg('Notion sync failed — check server logs') }
    setSyncing(false)
  }

  const bulkUpdate = async (field: string, value: string) => {
    for (const id of selectedIds) {
      await updateItem(id, { [field]: value })
    }
    setSelectedIds(new Set())
  }

  // ── Filter items ─────────────────────────────────────────────────────────

  const items = data?.items ?? []
  const filtered = items.filter(i => {
    if (filterCat !== 'all' && i.category !== filterCat) return false
    if (filterOwner !== 'all' && i.owner !== filterOwner) return false
    if (filterStatus !== 'all' && i.status !== filterStatus) return false
    if (searchQ && !i.vendor.toLowerCase().includes(searchQ.toLowerCase())) return false
    return true
  })

  // Group by category
  const grouped: Record<string, LedgerItem[]> = {}
  for (const item of filtered) {
    const cat = item.category || 'other'
    if (!grouped[cat]) grouped[cat] = []
    grouped[cat].push(item)
  }

  const selectedItem = items.find(i => i.id === selected) ?? null

  const summary = data?.summary

  // ── Render ───────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div style={{ background: '#06080d', minHeight: '100vh', color: '#E5E7EE', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <RefreshCw size={20} style={{ animation: 'spin 1s linear infinite' }} />
      </div>
    )
  }

  return (
    <div style={{ background: '#06080d', minHeight: '100vh', color: '#E5E7EE' }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div style={{ padding: '24px 32px 0' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <Wallet size={22} color="#f59e0b" />
            <h1 style={{ fontSize: '24px', fontWeight: 800, letterSpacing: '-0.04em', margin: 0 }}>
              Financial Ledger
            </h1>
            <span style={{ fontSize: '11px', color: '#6b7280' }}>
              {items.length} items
            </span>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={runScan} disabled={scanning}
              style={{
                padding: '7px 14px', borderRadius: '6px', fontSize: '12px', fontWeight: 600, cursor: 'pointer',
                background: scanning ? '#111318' : '#f59e0b20', border: '1px solid #f59e0b40',
                color: '#f59e0b', display: 'flex', alignItems: 'center', gap: '6px',
              }}
            >
              <RefreshCw size={13} style={scanning ? { animation: 'spin 1s linear infinite' } : {}} />
              {scanning ? 'Scanning...' : 'Scan Gmail'}
            </button>
            <button onClick={runNotionSync} disabled={syncing}
              style={{
                padding: '7px 14px', borderRadius: '6px', fontSize: '12px', fontWeight: 600, cursor: 'pointer',
                background: syncing ? '#111318' : '#3b82f620', border: '1px solid #3b82f640',
                color: '#3b82f6', display: 'flex', alignItems: 'center', gap: '6px',
              }}
            >
              <Upload size={13} style={syncing ? { animation: 'spin 1s linear infinite' } : {}} />
              {syncing ? 'Syncing...' : 'Sync to Notion'}
            </button>
            <button onClick={() => setShowAdd(true)}
              style={{
                padding: '7px 14px', borderRadius: '6px', fontSize: '12px', fontWeight: 600, cursor: 'pointer',
                background: '#10b98120', border: '1px solid #10b98140', color: '#10b981',
                display: 'flex', alignItems: 'center', gap: '6px',
              }}
            >
              <Plus size={13} /> Add Entry
            </button>
          </div>
        </div>

        {scanMsg && (
          <div style={{
            padding: '8px 14px', borderRadius: '6px', fontSize: '12px', marginBottom: '12px',
            background: scanMsg.includes('Error') || scanMsg.includes('failed') ? '#ef444420' : '#10b98120',
            border: `1px solid ${scanMsg.includes('Error') || scanMsg.includes('failed') ? '#ef444440' : '#10b98140'}`,
            color: scanMsg.includes('Error') || scanMsg.includes('failed') ? '#ef4444' : '#10b981',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}>
            {scanMsg}
            <X size={12} style={{ cursor: 'pointer' }} onClick={() => setScanMsg('')} />
          </div>
        )}

        {/* ── KPI Strip ─────────────────────────────────────────────────── */}
        {summary && (
          <div style={{ display: 'flex', gap: '10px', marginBottom: '20px', flexWrap: 'wrap' }}>
            <KPI
              label="Monthly Estimated"
              value={fmt(summary.likely_monthly)}
              color="#f59e0b"
              sub={`${summary.total_items} tracked items`}
            />
            {Object.entries(summary.by_category).map(([cat, d]) => (
              <KPI
                key={cat}
                label={CATEGORY_LABELS[cat] || cat}
                value={fmt(d.monthly_total)}
                color={CATEGORY_COLORS[cat] || '#6b7280'}
                sub={`${d.count} items`}
              />
            ))}
            <KPI
              label="Due Soon"
              value={String(items.filter(i => i.status === 'due_soon').length)}
              color="#ef4444"
              sub="next 7 days"
            />
          </div>
        )}

        {/* ── Owner Breakdown ───────────────────────────────────────────── */}
        {summary && (
          <div style={{ display: 'flex', gap: '10px', marginBottom: '20px', flexWrap: 'wrap' }}>
            {Object.entries(summary.by_owner).map(([owner, d]) => (
              <div key={owner} style={{
                background: '#111318', borderRadius: '8px', padding: '10px 16px',
                border: '1px solid rgba(255,255,255,0.06)',
                borderLeft: `3px solid ${OWNER_COLORS[owner] || '#6b7280'}88`,
                display: 'flex', alignItems: 'center', gap: '12px',
              }}>
                <span style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', color: OWNER_COLORS[owner] || '#A0AABB' }}>
                  {owner}
                </span>
                <span style={{ fontSize: '14px', fontWeight: 700, color: '#E5E7EE' }}>
                  {fmt(d.monthly_total)}
                </span>
                <span style={{ fontSize: '10px', color: '#6b7280' }}>
                  {d.count} items
                </span>
              </div>
            ))}
          </div>
        )}

        {/* ── Filters ───────────────────────────────────────────────────── */}
        <div style={{ display: 'flex', gap: '10px', marginBottom: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <Search size={13} style={{ position: 'absolute', left: '10px', color: '#6b7280' }} />
            <input
              placeholder="Search vendors..."
              value={searchQ}
              onChange={e => setSearchQ(e.target.value)}
              style={{
                background: '#111318', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '6px',
                color: '#E5E7EE', fontSize: '12px', padding: '7px 10px 7px 30px', width: '200px', outline: 'none',
              }}
            />
          </div>

          {[
            { label: 'Category', val: filterCat, set: setFilterCat, opts: ['all', ...CATEGORIES], colors: CATEGORY_COLORS },
            { label: 'Owner', val: filterOwner, set: setFilterOwner, opts: ['all', ...OWNERS], colors: OWNER_COLORS },
            { label: 'Status', val: filterStatus, set: setFilterStatus, opts: ['all', ...STATUSES], colors: STATUS_COLORS },
          ].map(f => (
            <select key={f.label} value={f.val} onChange={e => f.set(e.target.value)}
              style={{
                background: '#111318', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '6px',
                color: '#A0AABB', fontSize: '12px', padding: '7px 10px', outline: 'none', cursor: 'pointer',
              }}
            >
              {f.opts.map(o => <option key={o} value={o}>{o === 'all' ? `All ${f.label}` : o.replace(/_/g, ' ')}</option>)}
            </select>
          ))}

          {selectedIds.size > 0 && (
            <div style={{ display: 'flex', gap: '6px', alignItems: 'center', marginLeft: '12px' }}>
              <span style={{ fontSize: '11px', color: '#f59e0b' }}>{selectedIds.size} selected</span>
              <select onChange={e => { if (e.target.value) bulkUpdate('owner', e.target.value); e.target.value = '' }}
                style={{ background: '#111318', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '4px', color: '#A0AABB', fontSize: '11px', padding: '4px 8px' }}
              >
                <option value="">Set Owner...</option>
                {OWNERS.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
              <select onChange={e => { if (e.target.value) bulkUpdate('status', e.target.value); e.target.value = '' }}
                style={{ background: '#111318', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '4px', color: '#A0AABB', fontSize: '11px', padding: '4px 8px' }}
              >
                <option value="">Set Status...</option>
                {STATUSES.map(o => <option key={o} value={o}>{o.replace(/_/g, ' ')}</option>)}
              </select>
              <select onChange={e => { if (e.target.value) bulkUpdate('category', e.target.value); e.target.value = '' }}
                style={{ background: '#111318', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '4px', color: '#A0AABB', fontSize: '11px', padding: '4px 8px' }}
              >
                <option value="">Set Category...</option>
                {CATEGORIES.map(o => <option key={o} value={o}>{o.replace(/_/g, ' ')}</option>)}
              </select>
            </div>
          )}
        </div>
      </div>

      {/* ── Add Entry Modal ──────────────────────────────────────────── */}
      {showAdd && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(0,0,0,0.6)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }} onClick={() => setShowAdd(false)}>
          <div onClick={e => e.stopPropagation()} style={{
            background: '#111318', borderRadius: '12px', padding: '24px', width: '380px',
            border: '1px solid rgba(255,255,255,0.08)',
          }}>
            <h3 style={{ margin: '0 0 16px', fontSize: '16px', fontWeight: 700 }}>Add Manual Entry</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <input placeholder="Vendor name" value={newVendor} onChange={e => setNewVendor(e.target.value)}
                style={{
                  background: '#06080d', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px',
                  color: '#E5E7EE', fontSize: '13px', padding: '10px 12px', outline: 'none',
                }}
              />
              <input placeholder="Amount (optional)" type="number" value={newAmount} onChange={e => setNewAmount(e.target.value)}
                style={{
                  background: '#06080d', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px',
                  color: '#E5E7EE', fontSize: '13px', padding: '10px 12px', outline: 'none',
                }}
              />
              <div style={{ display: 'flex', gap: '8px', marginTop: '6px' }}>
                <button onClick={addItem} style={{
                  flex: 1, padding: '10px', borderRadius: '6px', background: '#10b981', border: 'none',
                  color: '#fff', fontSize: '13px', fontWeight: 700, cursor: 'pointer',
                }}>
                  Add
                </button>
                <button onClick={() => setShowAdd(false)} style={{
                  padding: '10px 16px', borderRadius: '6px', background: '#1a1d24', border: '1px solid rgba(255,255,255,0.1)',
                  color: '#A0AABB', fontSize: '13px', cursor: 'pointer',
                }}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Table + Detail Split ─────────────────────────────────────── */}
      <div style={{ display: 'flex', padding: '0 32px 32px', gap: '20px' }}>
        {/* ── Table ────────────────────────────────────────────────────── */}
        <div style={{ flex: 1, overflow: 'auto' }}>
          {Object.entries(grouped).sort(([a], [b]) => CATEGORIES.indexOf(a as typeof CATEGORIES[number]) - CATEGORIES.indexOf(b as typeof CATEGORIES[number])).map(([cat, catItems]) => {
            const catColor = CATEGORY_COLORS[cat] || '#6b7280'
            const catTotal = catItems.reduce((s, i) => s + (i.amount || i.monthly_estimate || 0), 0)
            return (
              <div key={cat} style={{ marginBottom: '24px' }}>
                {/* Category header */}
                <div style={{
                  display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px',
                  borderBottom: `2px solid ${catColor}44`, paddingBottom: '8px',
                }}>
                  <div style={{ width: '3px', height: '14px', borderRadius: '2px', background: catColor }} />
                  <span style={{ fontSize: '13px', fontWeight: 700, color: catColor }}>
                    {CATEGORY_LABELS[cat] || cat}
                  </span>
                  <span style={{ fontSize: '11px', color: '#6b7280' }}>
                    {catItems.length} items
                  </span>
                  <span style={{ fontSize: '12px', fontWeight: 700, color: catColor, marginLeft: 'auto' }}>
                    {fmt(catTotal)}/mo
                  </span>
                </div>

                {/* Table header */}
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: '28px 1fr 100px 90px 80px 90px 80px 90px 70px',
                  gap: '0', fontSize: '10px', fontWeight: 700, textTransform: 'uppercase',
                  letterSpacing: '0.08em', color: '#6b7280', padding: '6px 8px',
                  borderBottom: '1px solid rgba(255,255,255,0.04)',
                }}>
                  <span></span>
                  <span>Vendor</span>
                  <span>Amount</span>
                  <span>Due</span>
                  <span>Owner</span>
                  <span>Status</span>
                  <span>Cycle</span>
                  <span>Sub-Cat</span>
                  <span>Conf.</span>
                </div>

                {/* Rows */}
                {catItems.map(item => {
                  const isSelected = item.id === selected
                  const isChecked = selectedIds.has(item.id)
                  return (
                    <div key={item.id}
                      onClick={() => setSelected(isSelected ? null : item.id)}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '28px 1fr 100px 90px 80px 90px 80px 90px 70px',
                        gap: '0', padding: '8px 8px', alignItems: 'center', cursor: 'pointer',
                        background: isSelected ? '#111318' : 'transparent',
                        borderBottom: '1px solid rgba(255,255,255,0.03)',
                        borderLeft: isSelected ? `3px solid ${catColor}` : '3px solid transparent',
                        transition: 'background 0.15s',
                      }}
                      onMouseEnter={e => { if (!isSelected) (e.currentTarget as HTMLDivElement).style.background = '#0d0f14' }}
                      onMouseLeave={e => { if (!isSelected) (e.currentTarget as HTMLDivElement).style.background = 'transparent' }}
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onClick={e => e.stopPropagation()}
                        onChange={() => {
                          const next = new Set(selectedIds)
                          if (isChecked) next.delete(item.id); else next.add(item.id)
                          setSelectedIds(next)
                        }}
                        style={{ accentColor: catColor }}
                      />
                      <div>
                        <InlineEdit value={item.vendor} onChange={v => updateItem(item.id, { vendor: v })} />
                        {item.notion_page_id && (
                          <ArrowUpRight size={10} style={{ color: '#3b82f6', marginLeft: '4px', verticalAlign: 'middle' }} />
                        )}
                      </div>
                      <div onClick={e => e.stopPropagation()}>
                        <InlineEdit value={item.amount || item.monthly_estimate} type="number"
                          onChange={v => updateItem(item.id, { amount: v ? parseFloat(v) : null })} />
                      </div>
                      <div style={{ fontSize: '12px', color: '#A0AABB' }}>
                        {item.due_date || (item.billing_day ? `Day ${item.billing_day}` : '—')}
                      </div>
                      <div onClick={e => e.stopPropagation()}>
                        <InlineSelect value={item.owner} options={OWNERS} colors={OWNER_COLORS}
                          onChange={v => updateItem(item.id, { owner: v })} />
                      </div>
                      <div onClick={e => e.stopPropagation()}>
                        <InlineSelect value={item.status} options={STATUSES} colors={STATUS_COLORS}
                          onChange={v => updateItem(item.id, { status: v })} />
                      </div>
                      <div onClick={e => e.stopPropagation()}>
                        <InlineSelect value={item.billing_cycle} options={BILLING_CYCLES}
                          onChange={v => updateItem(item.id, { billing_cycle: v })} />
                      </div>
                      <div onClick={e => e.stopPropagation()}>
                        <InlineSelect value={item.sub_category} options={SUB_CATEGORIES}
                          onChange={v => updateItem(item.id, { sub_category: v })} />
                      </div>
                      <div>
                        <Pill label={item.confidence} color={
                          item.confidence === 'confirmed' ? '#10b981' : item.confidence === 'likely' ? '#f59e0b' : '#6b7280'
                        } />
                      </div>
                    </div>
                  )
                })}
              </div>
            )
          })}

          {filtered.length === 0 && (
            <div style={{ textAlign: 'center', padding: '60px 0', color: '#6b7280' }}>
              <Wallet size={32} style={{ marginBottom: '12px', opacity: 0.3 }} />
              <div style={{ fontSize: '14px' }}>No items match your filters</div>
              <div style={{ fontSize: '12px', marginTop: '4px' }}>Try adjusting filters or run a Gmail scan</div>
            </div>
          )}
        </div>

        {/* ── Detail / Evidence Panel ─────────────────────────────────── */}
        {selectedItem && (
          <div style={{
            width: '340px', flexShrink: 0, background: '#111318', borderRadius: '12px',
            border: '1px solid rgba(255,255,255,0.06)', padding: '20px', alignSelf: 'flex-start',
            position: 'sticky', top: '20px', maxHeight: 'calc(100vh - 40px)', overflowY: 'auto',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 700 }}>{selectedItem.vendor}</h3>
              <X size={16} style={{ cursor: 'pointer', color: '#6b7280' }} onClick={() => setSelected(null)} />
            </div>

            {/* Details grid */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '20px' }}>
              {[
                { label: 'Amount', value: fmt(selectedItem.amount || selectedItem.monthly_estimate) },
                { label: 'Last Paid', value: selectedItem.last_paid_date || '—' },
                { label: 'Last Amount', value: fmt(selectedItem.last_paid_amount) },
                { label: 'Payment', value: selectedItem.payment_method?.replace(/_/g, ' ') || '—' },
                { label: 'Billing Day', value: selectedItem.billing_day ? `Day ${selectedItem.billing_day}` : '—' },
                { label: 'Due Date', value: selectedItem.due_date || '—' },
              ].map(d => (
                <div key={d.label}>
                  <div style={{ fontSize: '10px', color: '#6b7280', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '2px' }}>
                    {d.label}
                  </div>
                  <div style={{ fontSize: '13px', color: '#E5E7EE' }}>{d.value || '—'}</div>
                </div>
              ))}
            </div>

            {/* Source accounts */}
            {selectedItem.source_accounts?.length > 0 && (
              <div style={{ marginBottom: '16px' }}>
                <div style={{ fontSize: '10px', color: '#6b7280', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '6px' }}>
                  Source Accounts
                </div>
                {selectedItem.source_accounts.map(a => (
                  <Pill key={a} label={a.split('@')[0]} color="#3b82f6" />
                ))}
              </div>
            )}

            {/* Notes */}
            <div style={{ marginBottom: '16px' }}>
              <div style={{ fontSize: '10px', color: '#6b7280', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '4px' }}>
                Notes
              </div>
              <InlineEdit value={selectedItem.notes || ''} onChange={v => updateItem(selectedItem.id, { notes: v })} />
            </div>

            {/* Evidence */}
            {selectedItem.evidence?.length > 0 && (
              <div style={{ marginBottom: '16px' }}>
                <div style={{
                  fontSize: '10px', color: '#6b7280', fontWeight: 700, textTransform: 'uppercase',
                  letterSpacing: '0.08em', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px',
                }}>
                  <FileText size={11} /> Email Evidence ({selectedItem.evidence.length})
                </div>
                {selectedItem.evidence.slice(0, 5).map((ev, i) => (
                  <div key={i} style={{
                    background: '#06080d', borderRadius: '6px', padding: '8px 10px', marginBottom: '6px',
                    border: '1px solid rgba(255,255,255,0.04)',
                  }}>
                    <div style={{ fontSize: '11px', fontWeight: 600, color: '#E5E7EE', marginBottom: '2px' }}>
                      {ev.subject}
                    </div>
                    <div style={{ fontSize: '10px', color: '#6b7280' }}>
                      {ev.account} &middot; {new Date(ev.date).toLocaleDateString()}
                    </div>
                    {ev.snippet && (
                      <div style={{ fontSize: '10px', color: '#4a5568', marginTop: '4px', lineHeight: '1.4' }}>
                        {ev.snippet.slice(0, 120)}...
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Receipts */}
            <div style={{ marginBottom: '16px' }}>
              <div style={{
                fontSize: '10px', color: '#6b7280', fontWeight: 700, textTransform: 'uppercase',
                letterSpacing: '0.08em', marginBottom: '8px',
              }}>
                Receipts ({selectedItem.receipts?.length || 0})
              </div>
              {(selectedItem.receipts || []).map(r => (
                <div key={r.id} style={{
                  background: '#06080d', borderRadius: '6px', padding: '6px 10px', marginBottom: '4px',
                  border: '1px solid rgba(255,255,255,0.04)', display: 'flex', justifyContent: 'space-between',
                  alignItems: 'center', fontSize: '11px',
                }}>
                  <span style={{ color: '#A0AABB' }}>{r.original_filename || r.type}</span>
                  <Trash2 size={11} style={{ color: '#ef4444', cursor: 'pointer' }}
                    onClick={async () => {
                      await fetch('/api/financial-ledger/receipts', {
                        method: 'DELETE',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ ledger_item_id: selectedItem.id, receipt_id: r.id }),
                      })
                      fetchData()
                    }}
                  />
                </div>
              ))}
            </div>

            {/* Notion link */}
            {selectedItem.notion_page_id && (
              <a href={`https://notion.so/${selectedItem.notion_page_id.replace(/-/g, '')}`}
                target="_blank" rel="noopener noreferrer"
                style={{
                  display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px',
                  color: '#3b82f6', textDecoration: 'none', marginBottom: '16px',
                }}
              >
                <ArrowUpRight size={12} /> View in Notion
              </a>
            )}

            {/* Delete */}
            <button onClick={() => deleteItem(selectedItem.id)}
              style={{
                width: '100%', padding: '8px', borderRadius: '6px', fontSize: '12px', fontWeight: 600,
                background: '#ef444420', border: '1px solid #ef444440', color: '#ef4444', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
              }}
            >
              <Trash2 size={12} /> Remove Item
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
