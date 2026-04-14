'use client'

import { useEffect, useMemo, useState } from 'react'
import { Plus, Pencil, Trash2, Check, X, ScanLine, RefreshCw, AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react'
import TopNav from '@/components/top-nav'
import BrandLogo from '@/components/brand-logo'

// ─── Types ────────────────────────────────────────────────────────────────────
type Account = {
  id: string; service: string; icon: string; email: string
  plan: string; plan_cost: string | null; billing_day: number | null
  used_gb: number | null; total_gb: number | null
  status: 'active' | 'warning' | 'unknown' | 'inactive'
  rclone_remote: string | null; notes: string
}
type Person  = { id: string; name: string; color: string; accounts: Account[] }
type CloudData = { people: Person[]; last_scanned: string; scan_source: string }

type Sub     = { id: string; name: string; brand: string; category: string; cost_monthly: number | null; billing_day: number | null; status: string; notes: string }
type SubData = { subscriptions: Sub[]; last_scanned: string }
type BillEntry = { subject: string; date: string | null; prices: string[]; snippet: string; purchase_items: string[] }
type BillVendor = { vendor: string; sender: string; account: string; entries: BillEntry[] }
type NormalizedBillVendor = BillVendor & { vendor_normalized: string; kind: 'recurring' | 'likely_recurring' | 'one_off'; ownerTag?: string; confirmedRecurring?: boolean; monthlyEstimate?: string | null }
type NormalizedBillsData = {
  generated_at: string
  window_days: number
  topRecurring: { vendor: string; account: string; entryCount: number; sender: string; latestDate: string | null; prices: string[] }[]
  rollups?: { vendor: string; account: string; ownerTag: string; monthlyEstimate: string | null; entryCount: number }[]
  tagPalette?: Record<string, string>
  accounts: Record<string, {
    recurring: NormalizedBillVendor[]
    likely_recurring: NormalizedBillVendor[]
    one_off: NormalizedBillVendor[]
  }>
}

type PaymentItem = {
  id: string
  source: 'subscription' | 'bill'
  vendor: string
  brand: string
  category: string
  ownerTag: string | null
  sourceAccount: string
  confidence: 'recurring' | 'likely_recurring' | 'one_off'
  confirmedRecurring: boolean
  monthlyEstimate: number | null
  latestAmount: string | null
  latestDate: string | null
  billingDay: number | null
  entryCount: number
  evidence: BillEntry[]
  sender: string | null
  notes: string
}

// ─── Config ───────────────────────────────────────────────────────────────────
const STATUS_CFG = {
  active:   { color: '#10b981', label: 'Active'   },
  warning:  { color: '#f59e0b', label: 'Warning'  },
  unknown:  { color: '#6b7280', label: 'TBD'      },
  inactive: { color: '#ef4444', label: 'Inactive' },
}

const CAT_COLOR: Record<string, string> = {
  AI: '#8b5cf6', Entertainment: '#ec4899', Gaming: '#f59e0b', Food: '#10b981', Automotive: '#3b82f6', Other: '#6b7280',
}

const CONF_COLOR: Record<string, string> = {
  recurring: '#10b981',
  likely_recurring: '#f59e0b',
  one_off: '#6b7280',
}

const CONF_LABEL: Record<string, string> = {
  recurring: 'Recurring',
  likely_recurring: 'Likely',
  one_off: 'One-off',
}

const TAG_PALETTE: Record<string, string> = { mike: '#5E6AD2', erin: '#10b981', kids: '#f59e0b', shared: '#ec4899' }

const SUB_CATEGORIES = ['AI', 'Entertainment', 'Gaming', 'Food', 'Automotive', 'Other']

const EMPTY_ACCOUNT: Omit<Account, 'id'> = { service: '', icon: 'google', email: '', plan: '', plan_cost: null, billing_day: null, used_gb: null, total_gb: null, status: 'unknown', rclone_remote: null, notes: '' }
const EMPTY_SUB: Omit<Sub, 'id'> = { name: '', brand: 'google', category: 'Other', cost_monthly: null, billing_day: null, status: 'unknown', notes: '' }

function fmt(gb: number | null) { return gb === null ? '—' : gb >= 1024 ? `${(gb / 1024).toFixed(1)} TB` : `${gb} GB` }
function pct(used: number | null, total: number | null) { return (!used || !total) ? null : Math.round((used / total) * 100) }

// ─── Input helper ─────────────────────────────────────────────────────────────
const inp: React.CSSProperties = { width: '100%', background: '#0a0e14', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '6px', padding: '5px 8px', color: '#E5E7EE', fontSize: '11px' }
const lbl: React.CSSProperties = { fontSize: '10px', color: '#6b7280', display: 'block', marginBottom: '3px' }

// ─── Data merger ──────────────────────────────────────────────────────────────
function unifyPayments(subData: SubData | null, bills: NormalizedBillsData | null): PaymentItem[] {
  const items: PaymentItem[] = []

  subData?.subscriptions.forEach(s => {
    items.push({
      id: s.id,
      source: 'subscription',
      vendor: s.name,
      brand: s.brand,
      category: s.category,
      ownerTag: null,
      sourceAccount: '',
      confidence: 'recurring',
      confirmedRecurring: s.status === 'active',
      monthlyEstimate: s.cost_monthly,
      latestAmount: s.cost_monthly ? `$${s.cost_monthly.toFixed(2)}` : null,
      latestDate: null,
      billingDay: s.billing_day,
      entryCount: 0,
      evidence: [],
      sender: null,
      notes: s.notes,
    })
  })

  Object.values(bills?.accounts ?? {}).forEach(groups => {
    const allVendors: NormalizedBillVendor[] = [
      ...groups.recurring,
      ...groups.likely_recurring,
      ...groups.one_off,
    ]
    allVendors.forEach(v => {
      const sorted = v.entries.slice().sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
      const latest = sorted[0]
      const prices = latest?.prices ?? []
      const est = v.monthlyEstimate ? parseFloat(v.monthlyEstimate.replace(/[^0-9.]/g, '')) : null
      items.push({
        id: `bill-${v.account}-${v.vendor_normalized}`,
        source: 'bill',
        vendor: v.vendor_normalized,
        brand: v.vendor_normalized.toLowerCase().replace(/\s+/g, ''),
        category: 'Other',
        ownerTag: v.ownerTag ?? null,
        sourceAccount: v.account,
        confidence: v.kind,
        confirmedRecurring: !!v.confirmedRecurring,
        monthlyEstimate: est,
        latestAmount: prices[0] ?? null,
        latestDate: latest?.date ?? null,
        billingDay: null,
        entryCount: v.entries.length,
        evidence: v.entries,
        sender: v.sender,
        notes: '',
      })
    })
  })

  const subNames = new Set(subData?.subscriptions.map(s => s.name.toLowerCase()) ?? [])
  return items.filter(item => item.source === 'subscription' || !subNames.has(item.vendor.toLowerCase()))
}

export default function CloudAccountsPage() {
  const [tab, setTab]           = useState<'accounts' | 'payments'>('accounts')
  const [acctData, setAcctData] = useState<CloudData | null>(null)
  const [subData, setSubData]   = useState<SubData | null>(null)
  const [normalizedBills, setNormalizedBills] = useState<NormalizedBillsData | null>(null)

  // Account state
  const [editAcctId, setEditAcctId]   = useState<string | null>(null)
  const [acctDraft, setAcctDraft]     = useState<Partial<Account>>({})
  const [addingTo, setAddingTo]       = useState<string | null>(null)
  const [newAcct, setNewAcct]         = useState<Omit<Account,'id'>>({ ...EMPTY_ACCOUNT })

  // Sub state
  const [editSubId, setEditSubId]     = useState<string | null>(null)
  const [subDraft, setSubDraft]       = useState<Partial<Sub>>({})
  const [addingSub, setAddingSub]     = useState(false)
  const [newSub, setNewSub]           = useState<Omit<Sub,'id'>>({ ...EMPTY_SUB })
  const [saving, setSaving]           = useState(false)

  // Payments filter + UI state
  const [payQuery, setPayQuery]           = useState('')
  const [payOwner, setPayOwner]           = useState<'all' | 'mike' | 'erin' | 'kids' | 'shared'>('all')
  const [payCategory, setPayCategory]     = useState('all')
  const [payConfidence, setPayConfidence] = useState<'all' | 'recurring' | 'likely_recurring' | 'one_off'>('all')
  const [expandedPayId, setExpandedPayId] = useState<string | null>(null)
  const [payVendorOverrides, setPayVendorOverrides] = useState<Record<string, string>>({})

  async function loadAccts() {
    const r = await fetch('/api/cloud-accounts')
    setAcctData(await r.json())
  }
  async function loadSubs() {
    const r = await fetch('/api/cloud-subscriptions')
    setSubData(await r.json())
  }
  async function loadBills() {
    const nr = await fetch('/api/cloud-bills-normalized')
    setNormalizedBills(await nr.json())
  }

  useEffect(() => { loadAccts(); loadSubs(); loadBills() }, [])

  // ─── Account CRUD ────────────────────────────────────────────────────────────
  async function saveAcct(personId: string, accountId: string) {
    setSaving(true)
    await fetch('/api/cloud-accounts', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ personId, accountId, updates: acctDraft }) })
    setSaving(false); setEditAcctId(null); setAcctDraft({}); loadAccts()
  }
  async function deleteAcct(personId: string, accountId: string) {
    if (!confirm('Remove this account?')) return
    await fetch('/api/cloud-accounts', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ personId, accountId }) })
    loadAccts()
  }
  async function addAcct(personId: string) {
    setSaving(true)
    await fetch('/api/cloud-accounts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ personId, account: newAcct }) })
    setSaving(false); setAddingTo(null); setNewAcct({ ...EMPTY_ACCOUNT }); loadAccts()
  }

  // ─── Sub CRUD ─────────────────────────────────────────────────────────────────
  async function saveSub(id: string) {
    setSaving(true)
    await fetch('/api/cloud-subscriptions', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, updates: subDraft }) })
    setSaving(false); setEditSubId(null); setSubDraft({}); loadSubs()
  }
  async function deleteSub(id: string) {
    if (!confirm('Remove?')) return
    await fetch('/api/cloud-subscriptions', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) })
    loadSubs()
  }
  async function addSubFn() {
    setSaving(true)
    await fetch('/api/cloud-subscriptions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subscription: newSub }) })
    setSaving(false); setAddingSub(false); setNewSub({ ...EMPTY_SUB }); loadSubs()
  }

  // ─── Promote bill → subscription ─────────────────────────────────────────────
  async function promoteToRecurring(item: PaymentItem) {
    setSaving(true)
    const vendorName = payVendorOverrides[item.id] ?? item.vendor
    const sub: Omit<Sub, 'id'> = {
      name: vendorName,
      brand: item.brand,
      category: item.category !== 'Other' ? item.category : 'Other',
      cost_monthly: item.monthlyEstimate,
      billing_day: null,
      status: 'active',
      notes: item.sender ? `from ${item.sender}` : '',
    }
    await fetch('/api/cloud-subscriptions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subscription: sub }) })
    setSaving(false)
    loadSubs()
  }

  const loading = !acctData || !subData || !normalizedBills

  // ─── Unified payments ────────────────────────────────────────────────────────
  const allPayments = useMemo(() => unifyPayments(subData, normalizedBills), [subData, normalizedBills])

  const filteredPayments = useMemo(() => {
    const q = payQuery.trim().toLowerCase()
    return allPayments.filter(p => {
      if (payOwner !== 'all' && p.ownerTag !== payOwner) return false
      if (payCategory !== 'all' && p.category !== payCategory) return false
      if (payConfidence !== 'all' && p.confidence !== payConfidence) return false
      if (q) {
        const text = [p.vendor, p.sourceAccount, p.sender ?? '', p.notes,
          ...p.evidence.map(e => `${e.subject} ${e.snippet}`)].join(' ').toLowerCase()
        if (!text.includes(q)) return false
      }
      return true
    })
  }, [allPayments, payQuery, payOwner, payCategory, payConfidence])

  const confirmedMonthly = allPayments
    .filter(p => p.confirmedRecurring && p.monthlyEstimate)
    .reduce((s, p) => s + (p.monthlyEstimate ?? 0), 0)

  const likelyMonthly = allPayments
    .filter(p => !p.confirmedRecurring && p.confidence !== 'one_off' && p.monthlyEstimate)
    .reduce((s, p) => s + (p.monthlyEstimate ?? 0), 0)

  const tbdCount = allPayments.filter(p => !p.monthlyEstimate).length

  const assignableVendors = useMemo(() => {
    const names = new Set<string>()
    subData?.subscriptions.forEach(s => names.add(s.name))
    allPayments.filter(p => p.source === 'bill').forEach(p => names.add(p.vendor))
    return Array.from(names).sort()
  }, [subData, allPayments])

  if (loading) return (
    <div style={{ minHeight: '100%', background: '#06080d', display: 'flex', flexDirection: 'column' }}>
      <TopNav crumbs={[{ label: 'Cutillo Cloud', href: '/cutillo-cloud' }, { label: 'Accounts', active: true }]} />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1, color: '#4a5568', fontSize: '13px' }}>Loading…</div>
    </div>
  )

  const tagPalette = normalizedBills?.tagPalette ?? TAG_PALETTE

  return (
    <div style={{ minHeight: '100%', background: '#06080d', display: 'flex', flexDirection: 'column' }}>
      <TopNav crumbs={[{ label: 'Cutillo Cloud', href: '/cutillo-cloud' }, { label: 'Accounts', active: true }]} />

      {/* ── Tab bar ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px', borderBottom: '1px solid rgba(255,255,255,0.05)', background: '#06080d' }}>
        <div style={{ display: 'flex' }}>
          {(['accounts', 'payments'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)} style={{
              padding: '10px 18px', fontSize: '12px', fontWeight: tab === t ? 700 : 500,
              color: tab === t ? '#E5E7EE' : '#6b7280',
              background: 'none', border: 'none', cursor: 'pointer',
              borderBottom: tab === t ? '2px solid #5E6AD2' : '2px solid transparent',
              marginBottom: '-1px',
            }}>
              {t === 'accounts' ? '☁️ Cloud Accounts' : `💳 Payments${confirmedMonthly > 0 ? ` · $${confirmedMonthly.toFixed(2)}/mo` : ''}`}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ fontSize: '10px', color: '#4a5568' }}>
            {tab === 'accounts' ? `scanned ${acctData!.last_scanned}` : `scanned ${normalizedBills!.generated_at.slice(0, 10)}`}
          </span>
          <button onClick={() => { loadAccts(); loadSubs(); loadBills() }} style={{ display: 'flex', alignItems: 'center', gap: '3px', fontSize: '10px', color: '#6b7280', background: 'none', border: 'none', cursor: 'pointer' }}>
            <RefreshCw size={10} /> Refresh
          </button>
        </div>
      </div>

      {/* ── ACCOUNTS TAB ── */}
      {tab === 'accounts' && (
        <div style={{ padding: '12px 16px', flex: 1, display: 'flex', flexDirection: 'column', gap: '10px', overflow: 'auto' }}>

          {acctData!.people.some(p => p.accounts.some(a => a.status === 'warning')) && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'rgba(245,158,11,0.07)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: '7px', padding: '7px 12px', color: '#f59e0b', fontSize: '12px' }}>
              <AlertTriangle size={12} /> Eirin&apos;s Google is 86.5% full — Drive is the main culprit (13.2 GB).
            </div>
          )}

          {acctData!.people.map(person => (
            <div key={person.id} style={{ background: '#111318', border: `1px solid ${person.color}22`, borderRadius: '10px', overflow: 'hidden' }}>
              {/* Person header */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '9px 14px', borderBottom: '1px solid rgba(255,255,255,0.04)', background: `${person.color}08` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: `${person.color}20`, border: `1.5px solid ${person.color}66`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px', fontWeight: 700, color: person.color }}>
                    {person.name[0]}
                  </div>
                  <div>
                    <span style={{ fontSize: '14px', fontWeight: 700, color: '#E5E7EE' }}>{person.name}</span>
                    <span style={{ fontSize: '10px', color: '#6b7280', marginLeft: '8px' }}>{person.accounts.length} accounts</span>
                  </div>
                </div>
                <button onClick={() => { setAddingTo(person.id); setNewAcct({ ...EMPTY_ACCOUNT }) }}
                  style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', padding: '4px 10px', borderRadius: '6px', background: 'rgba(94,106,210,0.12)', border: '1px solid rgba(94,106,210,0.3)', color: '#8b9cf4', cursor: 'pointer', fontWeight: 600 }}>
                  <Plus size={11} /> Add
                </button>
              </div>

              {/* Accounts */}
              <div>
                {person.accounts.map((acct, i) => {
                  const sc  = STATUS_CFG[acct.status] ?? STATUS_CFG.unknown
                  const p   = pct(acct.used_gb, acct.total_gb)
                  const isE = editAcctId === acct.id

                  if (isE) return (
                    <div key={acct.id} style={{ padding: '10px 14px', borderTop: i > 0 ? '1px solid rgba(255,255,255,0.04)' : undefined, background: '#0a0e14' }}>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '7px', marginBottom: '8px' }}>
                        {[['Plan','plan','text'],['Cost','plan_cost','text'],['Used GB','used_gb','number'],['Total GB','total_gb','number'],['rclone','rclone_remote','text'],['Email','email','text'],['Billing Day','billing_day','number']].map(([l,k,t]) => (
                          <div key={k}>
                            <label style={lbl}>{l}</label>
                            <input type={t} defaultValue={(acct[k as keyof Account] as string) ?? ''}
                              onChange={e => setAcctDraft(d => ({ ...d, [k]: t === 'number' ? (e.target.value ? +e.target.value : null) : e.target.value || null }))}
                              style={inp} />
                          </div>
                        ))}
                        <div>
                          <label style={lbl}>Status</label>
                          <select defaultValue={acct.status} onChange={e => setAcctDraft(d => ({ ...d, status: e.target.value as Account['status'] }))}
                            style={{ ...inp, width: '100%' }}>
                            {Object.keys(STATUS_CFG).map(s => <option key={s} value={s}>{s}</option>)}
                          </select>
                        </div>
                        <div style={{ gridColumn: '1/-1' }}>
                          <label style={lbl}>Notes</label>
                          <input type="text" defaultValue={acct.notes} onChange={e => setAcctDraft(d => ({ ...d, notes: e.target.value }))} style={inp} />
                        </div>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '6px' }}>
                        <button onClick={() => { setEditAcctId(null); setAcctDraft({}) }} style={{ display: 'flex', alignItems: 'center', gap: '3px', background: 'transparent', border: '1px solid rgba(255,255,255,0.07)', color: '#6b7280', borderRadius: '5px', padding: '4px 10px', fontSize: '11px', cursor: 'pointer' }}><X size={10} /> Cancel</button>
                        <button onClick={() => saveAcct(person.id, acct.id)} disabled={saving} style={{ display: 'flex', alignItems: 'center', gap: '3px', background: '#5E6AD2', border: 'none', color: '#fff', borderRadius: '5px', padding: '4px 10px', fontSize: '11px', fontWeight: 600, cursor: 'pointer' }}><Check size={10} /> Save</button>
                      </div>
                    </div>
                  )

                  return (
                    <div key={acct.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 14px', borderTop: i > 0 ? '1px solid rgba(255,255,255,0.03)' : undefined }}
                      onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.02)')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                    >
                      {/* Logo */}
                      <div style={{ width: '34px', height: '34px', borderRadius: '8px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <BrandLogo brand={acct.icon} size={20} />
                      </div>
                      {/* Info */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '2px' }}>
                          <span style={{ fontSize: '13px', fontWeight: 600, color: '#E5E7EE' }}>{acct.service}</span>
                          <span style={{ fontSize: '10px', fontWeight: 600, padding: '1px 6px', borderRadius: '8px', color: sc.color, background: `${sc.color}18` }}>{sc.label}</span>
                          {acct.plan_cost && <span style={{ fontSize: '10px', color: '#6b7280' }}>{acct.plan_cost}</span>}
                          {acct.billing_day && <span style={{ fontSize: '10px', color: '#4a5568' }}>bills {acct.billing_day}th</span>}
                        </div>
                        <div style={{ fontSize: '11px', color: '#4a5568', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {acct.plan}{acct.email ? ` · ${acct.email}` : ''}{acct.rclone_remote ? ` · ${acct.rclone_remote}` : ''}
                        </div>
                        {acct.notes && <div style={{ fontSize: '10px', color: '#374151', marginTop: '1px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{acct.notes}</div>}
                      </div>
                      {/* Storage bar */}
                      {p !== null && (
                        <div style={{ width: '110px', flexShrink: 0 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: '#4a5568', marginBottom: '3px' }}>
                            <span>{fmt(acct.used_gb)}</span><span>{fmt(acct.total_gb)}</span>
                          </div>
                          <div style={{ height: '4px', borderRadius: '2px', background: '#1a2030' }}>
                            <div style={{ width: `${p}%`, height: '100%', borderRadius: '2px', background: p > 80 ? '#f59e0b' : p > 60 ? '#3b82f6' : '#10b981' }} />
                          </div>
                          <div style={{ fontSize: '10px', color: '#4a5568', textAlign: 'right', marginTop: '2px' }}>{p}%</div>
                        </div>
                      )}
                      {/* Actions */}
                      <div style={{ display: 'flex', gap: '3px', flexShrink: 0 }}>
                        <button onClick={() => { setEditAcctId(acct.id); setAcctDraft({}) }} style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '5px', padding: '4px', cursor: 'pointer', color: '#6b7280', display: 'flex' }} title="Edit"><Pencil size={12} /></button>
                        <button onClick={() => deleteAcct(person.id, acct.id)} style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '5px', padding: '4px', cursor: 'pointer', color: '#6b7280', display: 'flex' }} title="Delete"><Trash2 size={12} /></button>
                      </div>
                    </div>
                  )
                })}

                {/* Add account form */}
                {addingTo === person.id && (
                  <div style={{ padding: '10px 14px', borderTop: '1px solid rgba(255,255,255,0.04)', background: '#0a0e14' }}>
                    <div style={{ fontSize: '11px', fontWeight: 600, color: '#5E6AD2', marginBottom: '8px' }}>New Account</div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '7px', marginBottom: '8px' }}>
                      {[['Service','service','text'],['Email','email','text'],['Plan','plan','text'],['Cost','plan_cost','text'],['Used GB','used_gb','number'],['Total GB','total_gb','number']].map(([l,k,t]) => (
                        <div key={k}>
                          <label style={lbl}>{l}</label>
                          <input type={t} placeholder={l as string}
                            onChange={e => setNewAcct(a => ({ ...a, [k]: t === 'number' ? (e.target.value ? +e.target.value : null) : e.target.value }))}
                            style={inp} />
                        </div>
                      ))}
                      <div>
                        <label style={lbl}>Icon</label>
                        <select onChange={e => setNewAcct(a => ({ ...a, icon: e.target.value }))} style={{ ...inp, width: '100%' }}>
                          {['google','microsoft','apple','icloud','openai','dropbox'].map(b => <option key={b} value={b}>{b}</option>)}
                        </select>
                      </div>
                      <div>
                        <label style={lbl}>Status</label>
                        <select onChange={e => setNewAcct(a => ({ ...a, status: e.target.value as Account['status'] }))} style={{ ...inp, width: '100%' }}>
                          <option value="active">active</option><option value="unknown">unknown</option><option value="inactive">inactive</option>
                        </select>
                      </div>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '6px' }}>
                      <button onClick={() => setAddingTo(null)} style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.07)', color: '#6b7280', borderRadius: '5px', padding: '4px 10px', fontSize: '11px', cursor: 'pointer' }}>Cancel</button>
                      <button onClick={() => addAcct(person.id)} disabled={!newAcct.service || saving} style={{ background: '#5E6AD2', border: 'none', color: '#fff', borderRadius: '5px', padding: '4px 12px', fontSize: '11px', fontWeight: 600, cursor: 'pointer' }}>Add</button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── PAYMENTS TAB ── */}
      {tab === 'payments' && (
        <div style={{ padding: '12px 16px', flex: 1, display: 'flex', flexDirection: 'column', gap: '12px', overflow: 'auto' }}>

          {/* Analytics header */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px' }}>
            <div style={{ background: '#111318', border: '1px solid rgba(16,185,129,0.2)', borderRadius: '9px', padding: '12px 16px' }}>
              <div style={{ fontSize: '10px', color: '#6b7280', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Confirmed monthly</div>
              <div style={{ fontSize: '22px', fontWeight: 700, color: '#10b981' }}>${confirmedMonthly.toFixed(2)}</div>
            </div>
            <div style={{ background: '#111318', border: '1px solid rgba(245,158,11,0.2)', borderRadius: '9px', padding: '12px 16px' }}>
              <div style={{ fontSize: '10px', color: '#6b7280', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Likely monthly</div>
              <div style={{ fontSize: '22px', fontWeight: 700, color: '#f59e0b' }}>~${likelyMonthly.toFixed(2)}</div>
            </div>
            <div style={{ background: '#111318', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '9px', padding: '12px 16px' }}>
              <div style={{ fontSize: '10px', color: '#6b7280', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>TBD / no estimate</div>
              <div style={{ fontSize: '22px', fontWeight: 700, color: '#6b7280' }}>{tbdCount}</div>
            </div>
          </div>

          {/* Filter bar */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <input value={payQuery} onChange={e => setPayQuery(e.target.value)} placeholder="Search vendors, senders, receipts…" style={{ width: '240px', background: '#0a0e14', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '6px', padding: '7px 9px', color: '#E5E7EE', fontSize: '11px' }} />
            <select value={payOwner} onChange={e => setPayOwner(e.target.value as typeof payOwner)} style={{ background: '#0a0e14', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '6px', padding: '7px 9px', color: '#E5E7EE', fontSize: '11px' }}>
              <option value="all">all owners</option>
              <option value="mike">Mike</option>
              <option value="erin">Erin</option>
              <option value="kids">Kids</option>
              <option value="shared">Shared</option>
            </select>
            <select value={payCategory} onChange={e => setPayCategory(e.target.value)} style={{ background: '#0a0e14', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '6px', padding: '7px 9px', color: '#E5E7EE', fontSize: '11px' }}>
              <option value="all">all categories</option>
              {SUB_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <select value={payConfidence} onChange={e => setPayConfidence(e.target.value as typeof payConfidence)} style={{ background: '#0a0e14', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '6px', padding: '7px 9px', color: '#E5E7EE', fontSize: '11px' }}>
              <option value="all">all confidence</option>
              <option value="recurring">Recurring</option>
              <option value="likely_recurring">Likely recurring</option>
              <option value="one_off">One-off</option>
            </select>
            <div style={{ marginLeft: 'auto' }}>
              <button onClick={() => { setAddingSub(true); setNewSub({ ...EMPTY_SUB }) }}
                style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', padding: '7px 12px', borderRadius: '6px', background: '#5E6AD2', border: 'none', color: '#fff', fontWeight: 600, cursor: 'pointer' }}>
                <Plus size={11} /> Add Subscription
              </button>
            </div>
          </div>

          {/* Add subscription form */}
          {addingSub && (
            <div style={{ background: '#111318', border: '1px solid #5E6AD2', borderRadius: '9px', padding: '12px' }}>
              <div style={{ fontSize: '11px', fontWeight: 600, color: '#5E6AD2', marginBottom: '8px' }}>New Subscription</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6,1fr)', gap: '7px', marginBottom: '8px' }}>
                {[['Name','name','text'],['Brand','brand','text'],['Cost/mo','cost_monthly','number'],['Bill Day','billing_day','number']].map(([l,k,t]) => (
                  <div key={k}>
                    <label style={lbl}>{l}</label>
                    <input type={t} placeholder={l as string}
                      onChange={e => setNewSub(s => ({ ...s, [k]: t === 'number' ? (e.target.value ? +e.target.value : null) : e.target.value }))}
                      style={inp} />
                  </div>
                ))}
                <div>
                  <label style={lbl}>Category</label>
                  <select value={newSub.category} onChange={e => setNewSub(s => ({ ...s, category: e.target.value }))} style={{ ...inp, width: '100%' }}>
                    {SUB_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label style={lbl}>Status</label>
                  <select value={newSub.status} onChange={e => setNewSub(s => ({ ...s, status: e.target.value }))} style={{ ...inp, width: '100%' }}>
                    <option value="active">active</option><option value="unknown">TBD</option><option value="inactive">inactive</option>
                  </select>
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '6px' }}>
                <button onClick={() => setAddingSub(false)} style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.07)', color: '#6b7280', borderRadius: '5px', padding: '4px 10px', fontSize: '11px', cursor: 'pointer' }}>Cancel</button>
                <button onClick={addSubFn} disabled={!newSub.name || saving} style={{ background: '#5E6AD2', border: 'none', color: '#fff', borderRadius: '5px', padding: '4px 12px', fontSize: '11px', fontWeight: 600, cursor: 'pointer' }}>Add</button>
              </div>
            </div>
          )}

          {/* Payment card grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '10px' }}>
            {filteredPayments.map(item => {
              const isExpanded   = expandedPayId === item.id
              const isEditingSub = editSubId === item.id
              const catColor     = CAT_COLOR[item.category] ?? '#6b7280'
              const confColor    = CONF_COLOR[item.confidence]
              const confLabel    = CONF_LABEL[item.confidence]
              const tagColor     = item.ownerTag ? (tagPalette[item.ownerTag] ?? '#6b7280') : null
              const displayVendor = payVendorOverrides[item.id] ?? item.vendor

              return (
                <div key={item.id} style={{ background: '#111318', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '10px', overflow: 'hidden' }}>

                  {/* Edit mode (subscriptions only) */}
                  {isEditingSub ? (
                    <div style={{ padding: '10px' }}>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '5px', marginBottom: '7px' }}>
                        {[['Name','name','text'],['Cost/mo','cost_monthly','number'],['Bill Day','billing_day','number']].map(([l,k,t]) => {
                          const sub = subData!.subscriptions.find(s => s.id === item.id)!
                          return (
                            <div key={k}>
                              <label style={lbl}>{l}</label>
                              <input type={t} defaultValue={(sub[k as keyof Sub] as string) ?? ''}
                                onChange={e => setSubDraft(d => ({ ...d, [k]: t === 'number' ? (e.target.value ? +e.target.value : null) : e.target.value }))}
                                style={inp} />
                            </div>
                          )
                        })}
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '5px' }}>
                        <button onClick={() => { setEditSubId(null); setSubDraft({}) }} style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.07)', color: '#6b7280', borderRadius: '5px', padding: '3px 8px', fontSize: '10px', cursor: 'pointer' }}>Cancel</button>
                        <button onClick={() => saveSub(item.id)} disabled={saving} style={{ background: '#5E6AD2', border: 'none', color: '#fff', borderRadius: '5px', padding: '3px 8px', fontSize: '10px', fontWeight: 600, cursor: 'pointer' }}>Save</button>
                      </div>
                    </div>
                  ) : (
                    <div style={{ padding: '10px' }}>

                      {/* Top row: logo + name + edit controls */}
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', marginBottom: '8px' }}>
                        <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                          <BrandLogo brand={item.brand} size={18} />
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: '13px', fontWeight: 700, color: '#E5E7EE', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{displayVendor}</div>
                          <div style={{ fontSize: '10px', color: '#4a5568', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {item.sourceAccount || (item.billingDay ? `bills ${item.billingDay}th` : '')}
                          </div>
                        </div>
                        {item.source === 'subscription' && (
                          <div style={{ display: 'flex', gap: '2px', flexShrink: 0 }}>
                            <button onClick={() => { setEditSubId(item.id); setSubDraft({}) }} style={{ background: 'transparent', border: 'none', borderRadius: '4px', padding: '3px', cursor: 'pointer', color: '#4a5568', display: 'flex' }}><Pencil size={11} /></button>
                            <button onClick={() => deleteSub(item.id)} style={{ background: 'transparent', border: 'none', borderRadius: '4px', padding: '3px', cursor: 'pointer', color: '#4a5568', display: 'flex' }}><Trash2 size={11} /></button>
                          </div>
                        )}
                      </div>

                      {/* Badges */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexWrap: 'wrap', marginBottom: '8px' }}>
                        {item.category !== 'Other' && (
                          <span style={{ fontSize: '9px', padding: '2px 6px', borderRadius: '999px', background: `${catColor}20`, color: catColor, fontWeight: 600 }}>{item.category}</span>
                        )}
                        <span style={{ fontSize: '9px', padding: '2px 6px', borderRadius: '999px', background: `${confColor}20`, color: confColor, fontWeight: 600 }}>{confLabel}</span>
                        {item.confirmedRecurring && (
                          <span style={{ fontSize: '9px', padding: '2px 6px', borderRadius: '999px', background: 'rgba(16,185,129,0.14)', color: '#10b981', fontWeight: 600 }}>confirmed</span>
                        )}
                        {tagColor && (
                          <span style={{ fontSize: '9px', padding: '2px 6px', borderRadius: '999px', background: `${tagColor}22`, color: tagColor }}>{item.ownerTag}</span>
                        )}
                      </div>

                      {/* Monthly estimate */}
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: '5px', marginBottom: '6px' }}>
                        <span style={{ fontSize: '20px', fontWeight: 700, color: item.monthlyEstimate ? '#E5E7EE' : '#374151' }}>
                          {item.monthlyEstimate ? `$${item.monthlyEstimate.toFixed(2)}` : '—'}
                        </span>
                        {item.monthlyEstimate && <span style={{ fontSize: '10px', color: '#6b7280' }}>/mo</span>}
                      </div>

                      {/* Latest charge + signal count */}
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '10px', color: '#4a5568' }}>
                        <span>
                          {item.latestAmount && `Latest: ${item.latestAmount}`}
                          {item.latestDate && ` · ${item.latestDate.slice(0, 10)}`}
                        </span>
                        {item.entryCount > 0 && <span>{item.entryCount} signal{item.entryCount === 1 ? '' : 's'}</span>}
                      </div>

                      {/* Sender */}
                      {item.sender && (
                        <div style={{ fontSize: '10px', color: '#374151', marginTop: '3px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.sender}</div>
                      )}

                      {/* Action row */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '8px', borderTop: '1px solid rgba(255,255,255,0.04)', paddingTop: '8px', flexWrap: 'wrap' }}>
                        {item.evidence.length > 0 && (
                          <button onClick={() => setExpandedPayId(isExpanded ? null : item.id)}
                            style={{ display: 'flex', alignItems: 'center', gap: '3px', fontSize: '10px', color: '#6b7280', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                            {isExpanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                            {isExpanded ? 'Hide' : 'Details'}
                          </button>
                        )}
                        {item.confidence === 'likely_recurring' && !item.confirmedRecurring && (
                          <>
                            <button onClick={() => promoteToRecurring(item)} disabled={saving}
                              style={{ display: 'flex', alignItems: 'center', gap: '3px', fontSize: '10px', color: '#10b981', background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.2)', borderRadius: '4px', padding: '2px 7px', cursor: 'pointer', marginLeft: 'auto' }}>
                              <Check size={10} /> Mark recurring
                            </button>
                            <select
                              value={payVendorOverrides[item.id] ?? ''}
                              onChange={e => setPayVendorOverrides(v => ({ ...v, [item.id]: e.target.value }))}
                              style={{ background: '#0a0e14', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '4px', padding: '2px 5px', color: '#6b7280', fontSize: '10px' }}>
                              <option value="">assign vendor…</option>
                              {assignableVendors.map(v => <option key={v} value={v}>{v}</option>)}
                            </select>
                          </>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Expanded evidence */}
                  {isExpanded && item.evidence.length > 0 && (
                    <div style={{ borderTop: '1px solid rgba(255,255,255,0.05)', padding: '8px 10px', background: '#0c1018', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      {item.evidence.slice(0, 5).map((entry, idx) => (
                        <div key={idx} style={{ borderTop: idx > 0 ? '1px solid rgba(255,255,255,0.04)' : undefined, paddingTop: idx > 0 ? '6px' : 0 }}>
                          <div style={{ fontSize: '11px', color: '#E5E7EE', fontWeight: 600, marginBottom: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.subject}</div>
                          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '2px' }}>
                            {entry.date && <span style={{ fontSize: '10px', color: '#6b7280' }}>{entry.date.slice(0, 10)}</span>}
                            {entry.prices?.slice(0, 3).map((pr, pi) => <span key={pi} style={{ fontSize: '10px', color: '#f59e0b' }}>{pr}</span>)}
                          </div>
                          {entry.purchase_items?.length > 0 && (
                            <div style={{ fontSize: '10px', color: '#8b9cf4', marginBottom: '2px' }}>Bought: {entry.purchase_items.slice(0, 2).join(' · ')}</div>
                          )}
                          <div style={{ fontSize: '10px', color: '#4a5568', lineHeight: 1.45, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.snippet}</div>
                        </div>
                      ))}
                      {item.evidence.length > 5 && (
                        <div style={{ fontSize: '10px', color: '#4a5568', paddingTop: '4px' }}>+{item.evidence.length - 5} more</div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {filteredPayments.length === 0 && (
            <div style={{ textAlign: 'center', padding: '40px', color: '#4a5568', fontSize: '13px' }}>
              No payments match your filters.
            </div>
          )}
        </div>
      )}
    </div>
  )
}
