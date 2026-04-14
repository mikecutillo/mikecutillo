'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { Copy, CheckCircle, X, Loader2, ExternalLink, MessageSquare, Zap, Upload } from 'lucide-react'

// ── Types ─────────────────────────────────────────────────────────────────────

interface Job {
  id: string
  company: string
  title: string
  location: string
  remote: boolean
  salary?: string
  salaryRange?: string
  datePosted?: string
  applicantCount?: string
  companyLogoUrl?: string
  quickSummary?: { greenFlag: string; redFlag: string }
  status: 'found' | 'applied' | 'phone-screen' | 'interview' | 'offer' | 'rejected'
  url: string
  description: string
  easyApply: boolean
  matchScore: number
  appliedDate?: string
  notes: string
  resumeVersion?: string
  lane?: string
  tags: string[]
  createdAt: string
  priority: 'hot' | 'good' | 'stretch'
}

interface TailorResult {
  matchedKeywords: string[]
  gaps: string[]
  suggestions: { section: string; original: string; suggested: string }[]
  fitScore: number
  fitSummary: string
  lane?: string
}

interface AnalyzeFitResult {
  lanes: TailorResult[]
  recommendedLane: 'A' | 'B' | 'C' | 'D'
  canMerge: boolean
  mergeCandidates?: ['A' | 'B' | 'C' | 'D', 'A' | 'B' | 'C' | 'D']
  errors?: { lane: string; error: string }[]
}

interface CustomResumeBullet {
  text: string
  sourceLane: 'A' | 'B' | 'C' | 'D' | 'MASTER'
  section?: string
}

interface CustomResumeResult {
  markdown: string
  bullets: CustomResumeBullet[]
  fitScore: number
  provenanceNotes: string[]
  recommendedLane: 'A' | 'B' | 'C' | 'D'
  droppedCount: number
}

/**
 * Live worker task surfaced by /api/job-pipeline/auto-apply/status.
 * Shape mirrors ApplyTask from lib/apply-worker/task-store.ts — keep
 * them in sync if that interface grows.
 */
interface ActiveTask {
  taskId: string
  jobId: string
  status: 'queued' | 'running' | 'needs-answer' | 'needs-sensitive-confirm' | 'applied' | 'failed'
  phase:
    | 'analyzing-fit'
    | 'generating-resume'
    | 'exporting-pdf'
    | 'opening-site'
    | 'filling-form'
    | 'answering-screening'
    | 'submitting'
    | 'done'
    | 'error'
  message?: string
  pendingQuestion?: {
    question: string
    fieldLabel?: string
    fieldType?: string
    candidateAnswer?: string
    similarity?: number
    sensitive?: boolean
  }
  error?: string
  approvalItemId?: string
  startedAt: string
  updatedAt: string
  finishedAt?: string
}

type JobStatus = Job['status']
type JobPriority = Job['priority']

// ── Constants ─────────────────────────────────────────────────────────────────

// 4 lane columns — status is shown as a badge on each card
const COLUMNS: { key: string; label: string; subtitle: string; color: string; bg: string }[] = [
  { key: 'A', label: 'Implementation / PS',    subtitle: 'Sr. Impl. Consultant · PS Consultant · Onboarding', color: '#4F8EF7', bg: 'rgba(79,142,247,0.08)'  },
  { key: 'B', label: 'Solutions / Presales',   subtitle: 'Solutions Consultant · Solutions Eng. · Sales Eng.', color: '#2ECC71', bg: 'rgba(46,204,113,0.08)'  },
  { key: 'C', label: 'AI Customer-Facing',     subtitle: 'AI Solutions Consultant · AI Adoption · AI Impl.',  color: '#F5A623', bg: 'rgba(245,166,35,0.08)'   },
  { key: 'D', label: 'Strategy / Architecture',subtitle: 'Principal Consultant · Enterprise Architect',       color: '#E8453C', bg: 'rgba(232,69,60,0.08)'    },
]

// Status badge config (for pill on each card)
const STATUS_COLORS: Record<JobStatus, string> = {
  'found':        '#6B7280',
  'applied':      '#5E6AD2',
  'phone-screen': '#F5A623',
  'interview':    '#A855F7',
  'offer':        '#2ECC71',
  'rejected':     '#EF4444',
}
const STATUS_LABELS: Record<JobStatus, string> = {
  'found':        'Found',
  'applied':      'Applied',
  'phone-screen': 'Phone Screen',
  'interview':    'Interview',
  'offer':        'Offer',
  'rejected':     'Rejected',
}

const LANE_COLORS: Record<string, string> = {
  A: '#4F8EF7', B: '#2ECC71', C: '#F5A623', D: '#E8453C',
}
const LANE_LABELS: Record<string, string> = {
  A: 'Implementation / PS', B: 'Solutions / Presales',
  C: 'AI Customer-Facing',  D: 'Strategy / Architecture',
}

const PRIORITY_ICONS: Record<JobPriority, string> = { hot: '🔥', good: '✓', stretch: '↑' }
const PRIORITY_COLORS: Record<JobPriority, string> = { hot: '#ef4444', good: '#10b981', stretch: '#8b5cf6' }

// Smooth red→green interpolation across 0–100%
function matchColor(score: number): string {
  const t = Math.max(0, Math.min(100, score)) / 100
  const r = Math.round(232 - (232 - 46)  * t)
  const g = Math.round(69  + (204 - 69)  * t)
  const b = Math.round(60  + (113 - 60)  * t)
  return `rgb(${r},${g},${b})`
}

function formatDate(iso: string) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function getLane(job: Job): string {
  if (job.lane) return job.lane.replace('lane-', '').toUpperCase()
  const tag = job.tags?.find(t => t.startsWith('lane-'))
  return tag ? tag.replace('lane-', '').toUpperCase() : 'A'
}

// Map company names to known domains for Clearbit
const KNOWN_DOMAINS: Record<string, string> = {
  'salesforce': 'salesforce.com',
  'microsoft': 'microsoft.com',
  'google': 'google.com',
  'amazon': 'amazon.com',
  'anthropic': 'anthropic.com',
  'openai': 'openai.com',
  'cohere': 'cohere.com',
  'glean': 'glean.com',
  'moveworks': 'moveworks.com',
  'servicenow': 'servicenow.com',
  'workday': 'workday.com',
  'hubspot': 'hubspot.com',
  'intercom': 'intercom.com',
  'gong': 'gong.io',
  'notion': 'notion.so',
  'rippling': 'rippling.com',
  'lattice': 'lattice.com',
  'writer': 'writer.com',
  'icims': 'icims.com',
  'sap': 'sap.com',
  'oracle': 'oracle.com',
  'zendesk': 'zendesk.com',
  'okta': 'okta.com',
  'slack': 'slack.com',
  'zoom': 'zoom.us',
  'twilio': 'twilio.com',
  'veeva': 'veeva.com',
  'greenhouse': 'greenhouse.io',
  'lever': 'lever.co',
  'medallia': 'medallia.com',
  'qualtrics': 'qualtrics.com',
  'adp': 'adp.com',
  'velocity': 'velocityglobal.com',
  'linkedin': 'linkedin.com',
}

function getLogoUrl(job: Job): string {
  if (job.companyLogoUrl) return job.companyLogoUrl
  const nameLower = (job.company ?? '').toLowerCase()
  if (!nameLower) return ''
  for (const [key, domain] of Object.entries(KNOWN_DOMAINS)) {
    if (nameLower.includes(key)) return `https://logo.clearbit.com/${domain}`
  }
  const slug = nameLower.replace(/[^a-z0-9]/g, '').slice(0, 20)
  return slug ? `https://logo.clearbit.com/${slug}.com` : ''
}

// ── Company Logo ──────────────────────────────────────────────────────────────

function CompanyLogo({ job, size = 32 }: { job: Job; size?: number }) {
  const [err, setErr] = useState(false)
  const logoUrl = getLogoUrl(job)
  const company = job.company ?? 'Unknown'
  const initials = company.split(' ').map(w => w[0] ?? '').join('').slice(0, 2).toUpperCase() || '?'

  if (!logoUrl || err) {
    return (
      <div style={{
        width: size, height: size, borderRadius: '7px', flexShrink: 0,
        background: 'linear-gradient(135deg, #2A2A3A, #1A1A28)',
        border: '1px solid rgba(255,255,255,0.08)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: size * 0.35, fontWeight: '700', color: '#9090A8',
      }}>
        {initials}
      </div>
    )
  }

  return (
    <img
      src={logoUrl}
      alt={job.company}
      onError={() => setErr(true)}
      style={{ width: size, height: size, borderRadius: '7px', objectFit: 'contain', background: '#fff', padding: '2px', flexShrink: 0, border: '1px solid rgba(255,255,255,0.08)' }}
    />
  )
}

// ── Outreach Modal ────────────────────────────────────────────────────────────

function OutreachModal({ job, onClose }: { job: Job; onClose: () => void }) {
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const draft = async () => {
      setLoading(true)
      try {
        const res = await fetch('/api/job-pipeline/outreach', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ job: {
            company: job.company,
            title: job.title,
            description: job.description,
            lane: job.lane ?? job.tags?.find(t => t.startsWith('lane-')),
            matchScore: job.matchScore,
          }}),
        })
        const data = await res.json()
        if (res.ok) setMessage(data.message)
        else setError(data.error ?? 'Failed to draft outreach')
      } catch { setError('Request failed') }
      finally { setLoading(false) }
    }
    draft()
  }, [])

  const copy = () => {
    navigator.clipboard.writeText(message)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const lane = getLane(job)

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={{ background: '#16161A', border: '1px solid var(--border)', borderRadius: '12px', width: '100%', maxWidth: '540px', boxShadow: '0 20px 60px rgba(0,0,0,0.6)', overflow: 'hidden' }}>

        {/* Header */}
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: '10px' }}>
          <MessageSquare size={15} style={{ color: 'var(--accent)' }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text)' }}>LinkedIn Connection Request</div>
            <div style={{ fontSize: '11px', color: 'var(--muted)' }}>{job.title} @ {job.company}{lane ? ` · Lane ${lane}` : ''}</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', padding: '2px' }}><X size={15} /></button>
        </div>

        {/* Body */}
        <div style={{ padding: '20px' }}>
          {loading ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px', padding: '30px 0', color: 'var(--muted)' }}>
              <Loader2 size={20} style={{ animation: 'spin 1s linear infinite', color: 'var(--accent)' }} />
              <div style={{ fontSize: '12px' }}>Drafting outreach message…</div>
            </div>
          ) : error ? (
            <div style={{ fontSize: '12px', color: '#FCA5A5', padding: '12px', background: 'rgba(239,68,68,0.08)', borderRadius: '7px' }}>{error}</div>
          ) : (
            <>
              <div style={{ fontSize: '11px', color: 'var(--muted)', marginBottom: '10px', textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: '600' }}>Drafted Message</div>
              <textarea
                value={message}
                onChange={e => setMessage(e.target.value)}
                rows={6}
                style={{
                  width: '100%', background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border)',
                  borderRadius: '8px', color: 'var(--text)', fontSize: '13px', lineHeight: '1.7',
                  padding: '12px 14px', outline: 'none', resize: 'vertical', fontFamily: 'inherit',
                  boxSizing: 'border-box',
                }}
              />
              <div style={{ fontSize: '10px', color: '#444455', marginTop: '6px' }}>
                Replace [Name] before sending · Edit freely above before copying
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        {!loading && !error && (
          <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border)', display: 'flex', gap: '8px', justifyContent: 'flex-end', background: 'rgba(255,255,255,0.01)' }}>
            <button onClick={onClose} style={{ padding: '7px 14px', background: 'rgba(255,255,255,0.06)', border: '1px solid var(--border)', borderRadius: '6px', color: 'var(--muted)', fontSize: '12px', cursor: 'pointer' }}>Close</button>
            <button onClick={copy} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '7px 16px', background: copied ? 'rgba(46,204,113,0.15)' : 'var(--accent)', border: copied ? '1px solid rgba(46,204,113,0.3)' : 'none', borderRadius: '6px', color: copied ? '#86EFAC' : '#fff', fontSize: '12px', fontWeight: '500', cursor: 'pointer' }}>
              {copied ? <><CheckCircle size={13} /> Copied!</> : <><Copy size={13} /> Copy to Clipboard</>}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Kanban Card ───────────────────────────────────────────────────────────────

function JobCard({ job, colColor, selected, onSelect, onClick, onOutreach }: {
  job: Job
  colColor: string
  selected: boolean
  onSelect: (e: React.MouseEvent) => void
  onClick: () => void
  onOutreach: (e: React.MouseEvent) => void
}) {
  const lane = getLane(job)
  const laneColor = LANE_COLORS[lane] ?? '#5E6AD2'
  const status: JobStatus = (job.status ?? 'found') as JobStatus
  const statusColor = STATUS_COLORS[status] ?? '#6B7280'
  const statusLabel = STATUS_LABELS[status] ?? 'Unknown'
  const priority: JobPriority = (job.priority ?? 'good') as JobPriority
  const matchScore = typeof job.matchScore === 'number' ? job.matchScore : 0
  void laneColor

  return (
    <div
      onClick={onClick}
      style={{
        background: selected ? 'rgba(79,142,247,0.08)' : '#111113',
        border: selected ? '1px solid rgba(79,142,247,0.4)' : '1px solid var(--border)',
        borderRadius: '10px',
        borderLeft: `3px solid ${colColor}`,
        cursor: 'pointer', transition: 'all 0.1s',
        overflow: 'hidden',
      }}
      onMouseEnter={e => { if (!selected) e.currentTarget.style.background = 'rgba(255,255,255,0.04)' }}
      onMouseLeave={e => { if (!selected) e.currentTarget.style.background = '#111113' }}
    >
      {/* Header: checkbox + logo + title + priority */}
      <div style={{ padding: '14px 14px 10px', display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
        {/* Multi-select checkbox */}
        <div
          onClick={onSelect}
          style={{
            width: '16px', height: '16px', borderRadius: '4px', flexShrink: 0, marginTop: '2px',
            border: selected ? '2px solid #4F8EF7' : '2px solid rgba(255,255,255,0.15)',
            background: selected ? '#4F8EF7' : 'transparent',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer',
          }}
        >
          {selected && <CheckCircle size={11} style={{ color: '#fff' }} />}
        </div>
        <CompanyLogo job={job} size={38} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '4px' }}>
            <div style={{ fontSize: '13px', fontWeight: '700', color: 'var(--text)', lineHeight: '1.3', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{job.company ?? 'Unknown'}</div>
            <span style={{ fontSize: '14px', flexShrink: 0, marginLeft: '4px' }}>{PRIORITY_ICONS[priority]}</span>
          </div>
          <div style={{ fontSize: '12px', color: '#9090A8', lineHeight: '1.4', marginTop: '3px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{job.title ?? 'Untitled role'}</div>
        </div>
      </div>

      {/* Pill badges */}
      <div style={{ padding: '0 14px 10px', display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
        {/* Status badge */}
        <span style={{ fontSize: '10px', padding: '2px 7px', borderRadius: '4px', background: statusColor + '18', color: statusColor, border: `1px solid ${statusColor}35`, fontWeight: '600', display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: statusColor, flexShrink: 0, display: 'inline-block' }} />
          {statusLabel}
        </span>
        {(job.salaryRange ?? job.salary) && (
          <span style={pillStyle}>💰 {job.salaryRange ?? job.salary}</span>
        )}
        {job.datePosted && (
          <span style={pillStyle}>🕐 {job.datePosted}</span>
        )}
        {job.applicantCount && (
          <span style={{ ...pillStyle, color: job.applicantCount.toLowerCase().includes('over 100') ? '#F5A623' : '#9090A8' }}>
            👥 {job.applicantCount}
          </span>
        )}
        {job.remote && <span style={{ ...pillStyle, color: '#86EFAC' }}>🟢 Remote</span>}
        {!job.remote && job.location && <span style={pillStyle}>📍 {job.location}</span>}
        {job.easyApply && <span style={{ ...pillStyle, color: '#FDE68A' }}>⚡ Easy Apply</span>}
      </div>

      {/* Quick summary: green/red flags — fixed contrast */}
      {job.quickSummary && (
        <div style={{ padding: '0 14px 10px', display: 'flex', flexDirection: 'column', gap: '5px' }}>
          <div style={{ fontSize: '11px', lineHeight: '1.5', color: '#86EFAC', display: 'flex', gap: '5px', background: 'rgba(38,194,110,0.10)', padding: '6px 8px', borderRadius: '6px' }}>
            <span style={{ flexShrink: 0 }}>✅</span>
            <span>{job.quickSummary.greenFlag}</span>
          </div>
          <div style={{ fontSize: '11px', lineHeight: '1.5', color: '#FCA5A5', display: 'flex', gap: '5px', background: 'rgba(239,68,68,0.08)', padding: '6px 8px', borderRadius: '6px' }}>
            <span style={{ flexShrink: 0 }}>⚠️</span>
            <span>{job.quickSummary.redFlag}</span>
          </div>
        </div>
      )}

      {/* Footer: match score + outreach */}
      <div style={{ padding: '10px 14px', borderTop: '1px solid rgba(255,255,255,0.04)', display: 'flex', alignItems: 'center', gap: '6px', background: 'rgba(255,255,255,0.01)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '5px', flex: 1, minWidth: 0 }}>
          <div style={{ flex: 1, height: '3px', background: 'rgba(255,255,255,0.06)', borderRadius: '2px', overflow: 'hidden', maxWidth: '60px' }}>
            <div style={{ height: '100%', width: `${matchScore}%`, background: matchColor(matchScore), borderRadius: '2px' }} />
          </div>
          <span style={{ fontSize: '10px', fontWeight: '700', color: matchColor(matchScore), flexShrink: 0 }}>{matchScore}%</span>
        </div>

        {/* Draft Outreach button */}
        <button
          onClick={onOutreach}
          title="Draft LinkedIn outreach"
          style={{ display: 'flex', alignItems: 'center', gap: '3px', padding: '3px 8px', background: 'rgba(94,106,210,0.12)', border: '1px solid rgba(94,106,210,0.25)', borderRadius: '5px', color: 'var(--accent)', fontSize: '10px', fontWeight: '500', cursor: 'pointer', flexShrink: 0 }}
        >
          <MessageSquare size={10} /> Outreach
        </button>
      </div>
    </div>
  )
}

const pillStyle: React.CSSProperties = {
  fontSize: '11px', padding: '3px 8px', borderRadius: '5px',
  background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)',
  color: '#7070A0', whiteSpace: 'nowrap',
}

// ── Tailor Results Panel ──────────────────────────────────────────────────────

function TailorPanel({ result }: { result: TailorResult }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', padding: '2px 0' }}>
      {/* Fit score */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
          <span style={{ fontSize: '11px', fontWeight: '600', color: '#555570', textTransform: 'uppercase', letterSpacing: '0.6px' }}>Fit Score</span>
          <span style={{ fontSize: '18px', fontWeight: '800', color: matchColor(result.fitScore) }}>{result.fitScore}%</span>
        </div>
        <div style={{ height: '5px', background: 'rgba(255,255,255,0.06)', borderRadius: '3px', overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${result.fitScore}%`, background: matchColor(result.fitScore), borderRadius: '3px', transition: 'width 0.6s ease' }} />
        </div>
        <p style={{ fontSize: '12px', color: '#B0B0C0', lineHeight: '1.6', marginTop: '8px' }}>{result.fitSummary}</p>
      </div>

      {/* Matched keywords */}
      {result.matchedKeywords?.length > 0 && (
        <div>
          <div style={{ fontSize: '11px', fontWeight: '600', color: '#555570', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: '6px' }}>Matched Keywords</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
            {result.matchedKeywords.map(kw => (
              <span key={kw} style={{ fontSize: '11px', padding: '3px 8px', borderRadius: '5px', background: 'rgba(46,204,113,0.12)', color: '#86EFAC', border: '1px solid rgba(46,204,113,0.25)' }}>{kw}</span>
            ))}
          </div>
        </div>
      )}

      {/* Gaps */}
      {result.gaps?.length > 0 && (
        <div>
          <div style={{ fontSize: '11px', fontWeight: '600', color: '#555570', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: '6px' }}>Gaps to Address</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
            {result.gaps.map(g => (
              <span key={g} style={{ fontSize: '11px', padding: '3px 8px', borderRadius: '5px', background: 'rgba(245,166,35,0.12)', color: '#FDE68A', border: '1px solid rgba(245,166,35,0.25)' }}>{g}</span>
            ))}
          </div>
        </div>
      )}

      {/* Bullet suggestions */}
      {result.suggestions?.length > 0 && (
        <div>
          <div style={{ fontSize: '11px', fontWeight: '600', color: '#555570', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: '8px' }}>Bullet Rewrites</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {result.suggestions.map((s, i) => (
              <div key={i} style={{ borderRadius: '7px', border: '1px solid rgba(255,255,255,0.06)', overflow: 'hidden' }}>
                <div style={{ fontSize: '10px', fontWeight: '600', color: '#555570', background: 'rgba(255,255,255,0.02)', padding: '5px 10px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{s.section}</div>
                <div style={{ padding: '8px 10px', borderTop: '1px solid rgba(255,255,255,0.04)', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <div style={{ fontSize: '11px', color: '#FCA5A5', lineHeight: '1.5', textDecoration: 'line-through', opacity: 0.7 }}>{s.original}</div>
                  <div style={{ fontSize: '11px', color: '#86EFAC', lineHeight: '1.5' }}>→ {s.suggested}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Analyze Fit Panel (4-lane comparative view) ──────────────────────────────

function AnalyzePanel({
  result,
  canMerge,
  generating,
  customResume,
  onGenerate,
}: {
  result: AnalyzeFitResult
  canMerge: boolean
  generating: boolean
  customResume: CustomResumeResult | null
  onGenerate: () => void
}) {
  // Sort lanes by fitScore desc so the recommended/best is on top
  const sorted = [...result.lanes].sort((a, b) => b.fitScore - a.fitScore)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', padding: '2px 0' }}>
      <div>
        <div style={{ fontSize: '11px', fontWeight: '600', color: '#555570', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: '8px' }}>
          Lane Fit Comparison
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {sorted.map((lane) => {
            const laneKey = (lane.lane ?? 'A') as 'A' | 'B' | 'C' | 'D'
            const isRec = laneKey === result.recommendedLane
            const laneColor = LANE_COLORS[laneKey] ?? '#555570'
            return (
              <div
                key={laneKey}
                style={{
                  padding: '10px 12px',
                  borderRadius: '7px',
                  border: isRec ? `1px solid ${laneColor}60` : '1px solid rgba(255,255,255,0.06)',
                  background: isRec ? `${laneColor}0D` : 'rgba(255,255,255,0.02)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                  <div style={{ width: '7px', height: '7px', borderRadius: '50%', background: laneColor }} />
                  <span style={{ fontSize: '11px', fontWeight: '700', color: laneColor }}>
                    Lane {laneKey} — {LANE_LABELS[laneKey]}
                  </span>
                  {isRec && (
                    <span style={{ marginLeft: '4px', fontSize: '9px', padding: '1px 6px', borderRadius: '3px', background: `${laneColor}25`, color: laneColor, fontWeight: '700', letterSpacing: '0.5px' }}>
                      RECOMMENDED
                    </span>
                  )}
                  <span style={{ marginLeft: 'auto', fontSize: '13px', fontWeight: '800', color: matchColor(lane.fitScore) }}>
                    {lane.fitScore}%
                  </span>
                </div>
                <div style={{ height: '3px', background: 'rgba(255,255,255,0.06)', borderRadius: '2px', overflow: 'hidden', marginBottom: '6px' }}>
                  <div style={{ height: '100%', width: `${lane.fitScore}%`, background: matchColor(lane.fitScore), borderRadius: '2px', transition: 'width 0.5s ease' }} />
                </div>
                <p style={{ fontSize: '11px', color: '#9090A8', lineHeight: '1.5', margin: 0 }}>{lane.fitSummary}</p>
              </div>
            )
          })}
        </div>
        {result.errors && result.errors.length > 0 && (
          <div style={{ marginTop: '8px', fontSize: '10px', color: '#FCA5A5' }}>
            {result.errors.length} lane error(s): {result.errors.map(e => e.lane).join(', ')}
          </div>
        )}
      </div>

      {/* Merge CTA */}
      <div style={{ padding: '10px 12px', borderRadius: '7px', border: '1px dashed rgba(255,255,255,0.1)', background: canMerge ? 'rgba(46,204,113,0.05)' : 'rgba(255,255,255,0.02)' }}>
        <div style={{ fontSize: '11px', color: canMerge ? '#86EFAC' : '#666680', marginBottom: '6px', lineHeight: '1.5' }}>
          {canMerge
            ? '✨ Two lanes score high and close together — a merged custom resume will combine the strongest bullets from both.'
            : 'Custom merge only unlocks when two lanes both score ≥70 and are within 10 points of each other.'}
        </div>
        <button
          onClick={onGenerate}
          disabled={!canMerge || generating || !!customResume}
          style={{
            width: '100%',
            padding: '7px 12px',
            background: canMerge ? 'rgba(46,204,113,0.15)' : 'rgba(255,255,255,0.04)',
            border: `1px solid ${canMerge ? 'rgba(46,204,113,0.3)' : 'rgba(255,255,255,0.06)'}`,
            borderRadius: '6px',
            color: canMerge ? '#86EFAC' : '#555570',
            fontSize: '12px',
            fontWeight: '600',
            cursor: canMerge && !generating ? 'pointer' : 'not-allowed',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '6px',
          }}
        >
          {generating ? <><Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> Generating custom resume…</>
            : customResume ? '✓ Custom Resume Generated'
            : canMerge ? 'Generate Custom Resume'
            : 'Merge unavailable'}
        </button>
      </div>
    </div>
  )
}

// ── Custom Resume Panel ──────────────────────────────────────────────────────

function CustomResumePanel({ result }: { result: CustomResumeResult }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', padding: '2px 0' }}>
      {/* Fit score header */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
          <span style={{ fontSize: '11px', fontWeight: '600', color: '#555570', textTransform: 'uppercase', letterSpacing: '0.6px' }}>
            Custom Fit Score
          </span>
          <span style={{ fontSize: '18px', fontWeight: '800', color: matchColor(result.fitScore) }}>{result.fitScore}%</span>
        </div>
        <div style={{ height: '5px', background: 'rgba(255,255,255,0.06)', borderRadius: '3px', overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${result.fitScore}%`, background: matchColor(result.fitScore), borderRadius: '3px' }} />
        </div>
      </div>

      {/* Provenance pills — per bullet */}
      {result.bullets.length > 0 && (
        <div>
          <div style={{ fontSize: '11px', fontWeight: '600', color: '#555570', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: '8px' }}>
            Bullet Provenance ({result.bullets.length} kept{result.droppedCount ? ` · ${result.droppedCount} dropped` : ''})
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {result.bullets.map((b, i) => {
              const color = b.sourceLane === 'MASTER' ? '#9D86E9' : (LANE_COLORS[b.sourceLane] ?? '#555570')
              const label = b.sourceLane === 'MASTER' ? 'MASTER' : `Lane ${b.sourceLane} · ${LANE_LABELS[b.sourceLane] ?? ''}`
              return (
                <div key={i} style={{ padding: '6px 9px', borderRadius: '5px', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.04)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '3px' }}>
                    <span style={{ fontSize: '9px', fontWeight: '700', padding: '1px 6px', borderRadius: '3px', background: `${color}20`, color, border: `1px solid ${color}35` }}>
                      {label}
                    </span>
                    {b.section && (
                      <span style={{ fontSize: '9px', color: '#555570' }}>{b.section}</span>
                    )}
                  </div>
                  <div style={{ fontSize: '11px', color: '#B0B0C0', lineHeight: '1.5' }}>{b.text}</div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Provenance notes / warnings */}
      {result.provenanceNotes.length > 0 && (
        <div>
          <div style={{ fontSize: '11px', fontWeight: '600', color: '#555570', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: '6px' }}>
            Provenance Notes
          </div>
          <div style={{ fontSize: '10px', color: '#9090A8', lineHeight: '1.6', background: 'rgba(255,255,255,0.02)', padding: '8px 10px', borderRadius: '5px', whiteSpace: 'pre-wrap' }}>
            {result.provenanceNotes.join('\n')}
          </div>
        </div>
      )}

      {/* Generated markdown preview */}
      <div>
        <div style={{ fontSize: '11px', fontWeight: '600', color: '#555570', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: '6px' }}>
          Generated Markdown
        </div>
        <pre style={{ fontSize: '10px', lineHeight: '1.6', color: '#B0B0C0', whiteSpace: 'pre-wrap', fontFamily: 'ui-monospace, SFMono-Regular, monospace', margin: 0, padding: '10px 12px', background: 'rgba(255,255,255,0.02)', borderRadius: '5px', maxHeight: '280px', overflowY: 'auto' }}>
          {result.markdown}
        </pre>
      </div>
    </div>
  )
}

// ── Apply Task Banner ─────────────────────────────────────────────────────────

/**
 * Live banner that surfaces the active Playwright apply task. The
 * worker runs async; this component shows whatever state the poll
 * endpoint last returned:
 *
 *   - running  → phase/message (informational, no input)
 *   - needs-answer / needs-sensitive-confirm → inline answer form
 *   - applied  → green success line
 *   - failed   → red error line
 */
function ApplyTaskBanner({
  task,
  answerDraft,
  onAnswerChange,
  onSubmitAnswer,
  onCancel,
  submitting,
}: {
  task: ActiveTask
  answerDraft: string
  onAnswerChange: (s: string) => void
  onSubmitAnswer: () => void
  onCancel: () => void
  submitting: boolean
}) {
  const isPaused =
    task.status === 'needs-answer' || task.status === 'needs-sensitive-confirm'
  const isApplied = task.status === 'applied'
  const isFailed = task.status === 'failed'
  const isSensitive = task.status === 'needs-sensitive-confirm' || task.pendingQuestion?.sensitive

  const bg = isApplied
    ? 'rgba(46,204,113,0.08)'
    : isFailed
      ? 'rgba(239,68,68,0.08)'
      : isPaused
        ? 'rgba(245,166,35,0.10)'
        : 'rgba(94,106,210,0.08)'
  const borderColor = isApplied
    ? 'rgba(46,204,113,0.3)'
    : isFailed
      ? 'rgba(239,68,68,0.3)'
      : isPaused
        ? 'rgba(245,166,35,0.35)'
        : 'rgba(94,106,210,0.3)'
  const color = isApplied
    ? '#86EFAC'
    : isFailed
      ? '#FCA5A5'
      : isPaused
        ? '#FDE68A'
        : '#9D86E9'

  const statusLabel = isApplied
    ? '✓ Applied'
    : isFailed
      ? '✗ Failed'
      : isPaused
        ? isSensitive
          ? '⚠ Sensitive question — confirm to continue'
          : '⏸ Waiting for your answer'
        : task.phase.replace('-', ' ')

  return (
    <div
      style={{
        padding: '12px 16px',
        borderTop: `1px solid ${borderColor}`,
        background: bg,
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        {!isApplied && !isFailed && !isPaused && (
          <Loader2
            size={13}
            style={{ color, animation: 'spin 1s linear infinite', flexShrink: 0 }}
          />
        )}
        <span style={{ fontSize: '11px', fontWeight: '700', color, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          {statusLabel}
        </span>
        {task.message && !isPaused && !isFailed && (
          <span style={{ fontSize: '11px', color: '#9090A8', lineHeight: '1.4' }}>
            · {task.message}
          </span>
        )}
      </div>

      {isFailed && task.error && (
        <div style={{ fontSize: '11px', color: '#FCA5A5', lineHeight: '1.5' }}>
          {task.error}
        </div>
      )}

      {isPaused && task.pendingQuestion && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{ fontSize: '12px', color: '#FDE68A', fontWeight: '600', lineHeight: '1.45' }}>
            {task.pendingQuestion.question}
          </div>
          {task.pendingQuestion.candidateAnswer && (
            <div style={{ fontSize: '10px', color: '#9090A8', lineHeight: '1.5', fontStyle: 'italic' }}>
              Suggested: &ldquo;{task.pendingQuestion.candidateAnswer}&rdquo;
              {typeof task.pendingQuestion.similarity === 'number' && (
                <> (similarity {Math.round(task.pendingQuestion.similarity * 100)}%)</>
              )}
            </div>
          )}
          <div style={{ display: 'flex', gap: '6px', alignItems: 'stretch' }}>
            <input
              type="text"
              value={answerDraft}
              onChange={(e) => onAnswerChange(e.target.value)}
              placeholder={
                isSensitive
                  ? 'Confirm or edit (this answer is sensitive)'
                  : 'Your answer (saved permanently)'
              }
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !submitting && answerDraft.trim()) onSubmitAnswer()
              }}
              disabled={submitting}
              style={{
                flex: 1,
                background: 'rgba(0,0,0,0.3)',
                border: '1px solid rgba(245,166,35,0.35)',
                borderRadius: '5px',
                padding: '7px 9px',
                fontSize: '12px',
                color: 'var(--text)',
                outline: 'none',
                fontFamily: 'inherit',
              }}
              autoFocus
            />
            <button
              onClick={onSubmitAnswer}
              disabled={submitting || !answerDraft.trim()}
              style={{
                padding: '7px 14px',
                background: 'rgba(46,204,113,0.2)',
                color: '#86EFAC',
                border: '1px solid rgba(46,204,113,0.35)',
                borderRadius: '5px',
                fontSize: '11px',
                fontWeight: '600',
                cursor: submitting || !answerDraft.trim() ? 'not-allowed' : 'pointer',
                opacity: submitting || !answerDraft.trim() ? 0.6 : 1,
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
              }}
            >
              {submitting ? (
                <>
                  <Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} />
                  Saving…
                </>
              ) : (
                'Save & Resume'
              )}
            </button>
            <button
              onClick={onCancel}
              disabled={submitting}
              style={{
                padding: '7px 10px',
                background: 'rgba(239,68,68,0.12)',
                color: '#FCA5A5',
                border: '1px solid rgba(239,68,68,0.25)',
                borderRadius: '5px',
                fontSize: '11px',
                fontWeight: '500',
                cursor: submitting ? 'not-allowed' : 'pointer',
                opacity: submitting ? 0.6 : 1,
              }}
            >
              Cancel
            </button>
          </div>
          <div style={{ fontSize: '9px', color: '#555570', lineHeight: '1.5' }}>
            Saved answers persist to the bank — the worker won&rsquo;t ask this question again on future applies.
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function JobPipelinePage() {
  const [jobs, setJobs] = useState<Job[]>([])
  const [selectedJob, setSelectedJob] = useState<Job | null>(null)
  const [outreachJob, setOutreachJob] = useState<Job | null>(null)
  const [resumeTab, setResumeTab] = useState<'master' | 'tailored' | 'analyze' | 'custom'>('master')
  const [masterResume, setMasterResume] = useState('')
  const [remoteOnly, setRemoteOnly] = useState(false)
  const [locationFilter, setLocationFilter] = useState<'all' | 'remote' | 'holmdel' | 'nj'>('all')
  const [priorityFilter, setPriorityFilter] = useState<'all' | JobPriority>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [tailoring, setTailoring] = useState(false)
  const [tailorResult, setTailorResult] = useState<TailorResult | null>(null)
  const [tailorError, setTailorError] = useState<string | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [analyzeResult, setAnalyzeResult] = useState<AnalyzeFitResult | null>(null)
  const [analyzeError, setAnalyzeError] = useState<string | null>(null)
  const [generatingCustom, setGeneratingCustom] = useState(false)
  const [customResume, setCustomResume] = useState<CustomResumeResult | null>(null)
  const [customError, setCustomError] = useState<string | null>(null)
  const [savingNotes, setSavingNotes] = useState(false)
  const [localNotes, setLocalNotes] = useState('')
  const [localStatus, setLocalStatus] = useState<JobStatus>('found')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [massApplying, setMassApplying] = useState(false)
  const [massApplyProgress, setMassApplyProgress] = useState<{ current: number; total: number; note: string } | null>(null)
  const [notionSyncing, setNotionSyncing] = useState(false)
  const [notionMsg, setNotionMsg] = useState('')
  // Live apply task (Phase 2 Playwright worker). Replaces the old
  // fire-and-return `autoApplyResult` flow — the worker now runs async,
  // the UI polls the status endpoint, and the task surfaces a pending
  // question banner when it needs Mike to answer something unknown.
  const [activeTask, setActiveTask] = useState<ActiveTask | null>(null)
  const [answerDraft, setAnswerDraft] = useState('')
  const [submittingAnswer, setSubmittingAnswer] = useState(false)

  // Fetch job list once on mount (refreshed after apply actions)
  useEffect(() => {
    let active = true
    fetch('/api/job-pipeline').then(r => r.json()).then(data => {
      if (active) setJobs(Array.isArray(data) ? data : [])
    }).catch(() => {})
    return () => { active = false }
  }, [])

  // Poll the active apply task every 2s until it reaches a terminal
  // state. Stops automatically on `applied`/`failed`, and refreshes the
  // job list once on success so the kanban card flips to Applied.
  useEffect(() => {
    if (!activeTask?.taskId) return
    if (activeTask.status === 'applied' || activeTask.status === 'failed') return
    let cancelled = false
    const tick = async () => {
      try {
        const res = await fetch(`/api/job-pipeline/auto-apply/status?taskId=${activeTask.taskId}`)
        if (!res.ok) return
        const data = await res.json()
        if (cancelled || !data.task) return
        setActiveTask(data.task as ActiveTask)
        if (data.task.status === 'applied') {
          // Refresh jobs so the kanban reflects the new Applied status
          fetch('/api/job-pipeline')
            .then((r) => r.json())
            .then((jobs) => {
              if (Array.isArray(jobs)) setJobs(jobs)
            })
            .catch(() => {})
          // Refresh the selected job from the new list
          setSelectedJob((prev) => {
            if (!prev || prev.id !== data.task.jobId) return prev
            return { ...prev, status: 'applied', appliedDate: new Date().toISOString() }
          })
        }
      } catch {
        // swallow — the next tick will retry
      }
    }
    tick()
    const interval = setInterval(tick, 5000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [activeTask?.taskId, activeTask?.status])

  // Load master resume when a job is selected
  useEffect(() => {
    if (!selectedJob) return
    setLocalNotes(selectedJob.notes)
    setLocalStatus(selectedJob.status)
    setTailorResult(null)
    setTailorError(null)
    setAnalyzeResult(null)
    setAnalyzeError(null)
    setCustomResume(null)
    setCustomError(null)
    setActiveTask(null)
    setAnswerDraft('')
    setResumeTab('master')

    const lane = getLane(selectedJob)
    fetch('/api/resumes').then(r => r.json()).then(data => {
      const resume = data.resumes?.find((r: { lane: string }) => r.lane === lane)
      if (resume) setMasterResume(resume.content)
    }).catch(() => {})
  }, [selectedJob?.id])

  const filtered = jobs.filter(j => {
    if (remoteOnly && !j.remote) return false
    if (locationFilter === 'remote' && !j.remote) return false
    if (locationFilter === 'holmdel' && !j.location?.toLowerCase().includes('holmdel')) return false
    if (locationFilter === 'nj' && !j.location?.toLowerCase().includes('nj') && !j.location?.toLowerCase().includes('new jersey') && !j.remote) return false
    if (priorityFilter !== 'all' && j.priority !== priorityFilter) return false
    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      if (!j.company?.toLowerCase().includes(q) && !j.title?.toLowerCase().includes(q)) return false
    }
    return true
  })

  const runNotionSync = async () => {
    setNotionSyncing(true); setNotionMsg('Syncing to Notion...')
    try {
      const res = await fetch('/api/notion-sync', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: 'job-pipeline' }),
      })
      const json = await res.json()
      if (json.status === 'setup_required') {
        setNotionMsg('Setup needed — configure NOTION_PARENT_PAGE_ID in .env.local')
      } else if (json.status === 'ok' || json.status === 'partial') {
        const r = json.results?.['job-pipeline'] || json
        setNotionMsg(`Synced ${r.synced ?? ''}/${r.total ?? ''} jobs to Notion`)
      } else {
        setNotionMsg(`Error: ${json.message || 'Unknown error'}`)
      }
    } catch { setNotionMsg('Notion sync failed') }
    setNotionSyncing(false)
    setTimeout(() => setNotionMsg(''), 5000)
  }

  async function updateJob(update: Partial<Job>) {
    if (!selectedJob) return
    const updated = { ...selectedJob, ...update }
    const res = await fetch('/api/job-pipeline', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updated),
    })
    const saved = await res.json()
    setJobs(prev => prev.map(j => j.id === saved.id ? saved : j))
    setSelectedJob(saved)
  }

  async function runTailorAgent() {
    if (!selectedJob) return
    setTailoring(true)
    setTailorResult(null)
    setTailorError(null)
    try {
      const res = await fetch('/api/job-pipeline/tailor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobTitle: selectedJob.title,
          company: selectedJob.company,
          description: selectedJob.description,
          lane: getLane(selectedJob),
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Tailor failed')
      setTailorResult(data)
      setResumeTab('tailored')
    } catch (e: unknown) {
      setTailorError(e instanceof Error ? e.message : String(e))
    } finally {
      setTailoring(false)
    }
  }

  async function runAnalyzeFit() {
    if (!selectedJob) return
    setAnalyzing(true)
    setAnalyzeResult(null)
    setAnalyzeError(null)
    setCustomResume(null)
    setCustomError(null)
    try {
      const res = await fetch('/api/job-pipeline/analyze-fit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobTitle: selectedJob.title,
          company: selectedJob.company,
          description: selectedJob.description,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Analyze failed')
      setAnalyzeResult(data)
      setResumeTab('analyze')
    } catch (e: unknown) {
      setAnalyzeError(e instanceof Error ? e.message : String(e))
    } finally {
      setAnalyzing(false)
    }
  }

  async function runCustomResume() {
    if (!selectedJob || !analyzeResult) return
    setGeneratingCustom(true)
    setCustomError(null)
    try {
      const res = await fetch('/api/job-pipeline/custom-resume', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobId: selectedJob.id,
          jobTitle: selectedJob.title,
          company: selectedJob.company,
          description: selectedJob.description,
          recommendedLane: analyzeResult.recommendedLane,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Custom resume failed')
      setCustomResume(data)
      setResumeTab('custom')
    } catch (e: unknown) {
      setCustomError(e instanceof Error ? e.message : String(e))
    } finally {
      setGeneratingCustom(false)
    }
  }

  /**
   * Kick off the Playwright apply worker for a job. The worker runs
   * async — this function returns as soon as the task is queued, and
   * the polling effect below drives live status updates from
   * /api/job-pipeline/auto-apply/status.
   */
  async function runAutoApply(job: Job) {
    setActiveTask(null)
    setAnswerDraft('')
    try {
      const res = await fetch('/api/job-pipeline/auto-apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId: job.id }),
      })
      const data = await res.json()
      if (!res.ok) {
        setActiveTask({
          taskId: '',
          jobId: job.id,
          status: 'failed',
          phase: 'error',
          error: data.error ?? 'Auto-apply request rejected',
          startedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })
        return
      }
      // Bootstrap task shape from the POST response — the poll effect
      // will fill in real status updates within ~2 seconds.
      setActiveTask({
        taskId: data.taskId,
        jobId: job.id,
        status: 'running',
        phase: 'analyzing-fit',
        message: data.note ?? 'Starting worker…',
        startedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
    } catch (e: unknown) {
      setActiveTask({
        taskId: '',
        jobId: job.id,
        status: 'failed',
        phase: 'error',
        error: e instanceof Error ? e.message : 'Auto-apply failed',
        startedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
    }
  }

  /**
   * Submit Mike's answer to a paused worker. Worker persists it to the
   * bank + resumes automatically. The poll effect will pick up the
   * 'running' status flip on the next tick.
   */
  async function submitAnswer() {
    if (!activeTask?.taskId || !answerDraft.trim()) return
    setSubmittingAnswer(true)
    try {
      const res = await fetch('/api/job-pipeline/auto-apply/resume', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId: activeTask.taskId, answer: answerDraft.trim() }),
      })
      const data = await res.json()
      if (!res.ok) {
        setActiveTask((prev) => (prev ? { ...prev, error: data.error ?? 'Failed to resume' } : prev))
      } else {
        setAnswerDraft('')
      }
    } catch (e: unknown) {
      setActiveTask((prev) =>
        prev ? { ...prev, error: e instanceof Error ? e.message : 'Resume request failed' } : prev,
      )
    } finally {
      setSubmittingAnswer(false)
    }
  }

  /** Abort a paused worker without submitting an answer. */
  async function cancelActiveTask() {
    if (!activeTask?.taskId) return
    try {
      await fetch('/api/job-pipeline/auto-apply/resume', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId: activeTask.taskId, cancel: true }),
      })
    } catch {
      // non-fatal — polling will catch the final state
    }
  }

  async function saveNotes() {
    setSavingNotes(true)
    await updateJob({ notes: localNotes, status: localStatus })
    setSavingNotes(false)
  }

  function toggleSelect(id: string, e: React.MouseEvent) {
    e.stopPropagation()
    setSelectedIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  /**
   * Mass apply — queues the Playwright worker for each selected job,
   * one at a time. The plan says "no mass apply" for the happy path,
   * but the button stays available as a bulk-queue action. The worker's
   * cooldown will naturally throttle successive tasks; queued jobs that
   * get blocked show a warning in the progress toast.
   *
   * We no longer wait for each apply to complete — the POST just
   * returns a taskId. Job status updates flow through the normal
   * 12s refresh loop once the worker actually submits.
   */
  async function runMassApply() {
    const targets = filtered.filter((j) => selectedIds.has(j.id) && j.easyApply)
    if (!targets.length) return
    setMassApplying(true)
    let queued = 0
    let blocked = 0
    for (let i = 0; i < targets.length; i++) {
      const job = targets[i]
      setMassApplyProgress({
        current: i + 1,
        total: targets.length,
        note: `Queueing ${job.company}…`,
      })
      try {
        const res = await fetch('/api/job-pipeline/auto-apply', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jobId: job.id }),
        })
        if (res.ok) queued++
        else blocked++
      } catch {
        blocked++
      }
    }
    setMassApplyProgress({
      current: targets.length,
      total: targets.length,
      note: `Queued ${queued}${blocked ? ` (${blocked} blocked)` : ''}`,
    })
    setMassApplying(false)
    setSelectedIds(new Set())
    setTimeout(() => setMassApplyProgress(null), 4000)
  }

  const selectedCount = selectedIds.size
  const easyApplySelected = filtered.filter(j => selectedIds.has(j.id) && j.easyApply).length

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: 'var(--bg)', overflow: 'hidden' }}>

      {/* Outreach modal */}
      {outreachJob && <OutreachModal job={outreachJob} onClose={() => setOutreachJob(null)} />}

      {/* Mass apply progress toast */}
      {massApplyProgress && (
        <div style={{ position: 'fixed', bottom: '24px', left: '50%', transform: 'translateX(-50%)', zIndex: 300, background: '#1A1A2E', border: '1px solid rgba(79,142,247,0.4)', borderRadius: '10px', padding: '12px 20px', display: 'flex', alignItems: 'center', gap: '10px', boxShadow: '0 8px 32px rgba(0,0,0,0.6)', minWidth: '280px' }}>
          {massApplying && <Loader2 size={14} style={{ animation: 'spin 1s linear infinite', color: '#4F8EF7', flexShrink: 0 }} />}
          {!massApplying && <CheckCircle size={14} style={{ color: '#86EFAC', flexShrink: 0 }} />}
          <span style={{ fontSize: '13px', color: 'var(--text)' }}>
            {massApplyProgress.current} / {massApplyProgress.total} — {massApplyProgress.note}
          </span>
        </div>
      )}

      {/* Notion sync toast */}
      {notionMsg && (
        <div style={{ position: 'fixed', bottom: '24px', right: '24px', zIndex: 300, background: notionMsg.includes('Error') || notionMsg.includes('failed') || notionMsg.includes('Setup') ? '#2A1215' : '#122B1A', border: `1px solid ${notionMsg.includes('Error') || notionMsg.includes('failed') || notionMsg.includes('Setup') ? 'rgba(239,68,68,0.4)' : 'rgba(16,185,129,0.4)'}`, borderRadius: '10px', padding: '10px 16px', display: 'flex', alignItems: 'center', gap: '8px', boxShadow: '0 8px 32px rgba(0,0,0,0.6)', maxWidth: '400px' }}>
          <span style={{ fontSize: '12px', color: notionMsg.includes('Error') || notionMsg.includes('failed') || notionMsg.includes('Setup') ? '#ef4444' : '#10b981' }}>{notionMsg}</span>
          <X size={12} style={{ cursor: 'pointer', color: '#8080A0', flexShrink: 0 }} onClick={() => setNotionMsg('')} />
        </div>
      )}

      {/* Filter bar */}
      <div style={{ padding: '10px 20px', background: '#111113', borderBottom: '1px solid var(--border)', display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap', flexShrink: 0 }}>
        <div style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text)' }}>Job Pipeline</div>
        <div style={{ height: '16px', width: '1px', background: 'var(--border)' }} />

        <input type="text" placeholder="Search company / title..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
          style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)', borderRadius: '6px', padding: '5px 10px', fontSize: '12px', color: 'var(--text)', outline: 'none', width: '180px' }}
        />

        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '12px', color: remoteOnly ? '#86EFAC' : '#8080A0' }}>
          <input type="checkbox" checked={remoteOnly} onChange={e => setRemoteOnly(e.target.checked)} style={{ accentColor: '#2ECC71' }} />
          Remote Only
        </label>

        <div style={{ display: 'flex', gap: '4px' }}>
          {(['all', 'remote', 'holmdel', 'nj'] as const).map(l => (
            <button key={l} onClick={() => setLocationFilter(l)} style={{ padding: '3px 10px', borderRadius: '20px', fontSize: '11px', border: 'none', cursor: 'pointer', background: locationFilter === l ? 'rgba(94,106,210,0.2)' : 'rgba(255,255,255,0.04)', color: locationFilter === l ? '#9D86E9' : '#8080A0', fontWeight: locationFilter === l ? '600' : '400' }}>
              {l === 'all' ? 'All' : l === 'holmdel' ? 'Holmdel' : l.toUpperCase()}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', gap: '4px' }}>
          {(['all', 'hot', 'good', 'stretch'] as const).map(p => (
            <button key={p} onClick={() => setPriorityFilter(p)} style={{ padding: '3px 10px', borderRadius: '20px', fontSize: '11px', border: 'none', cursor: 'pointer', background: priorityFilter === p ? `${PRIORITY_COLORS[p as JobPriority] ?? 'rgba(255,255,255,0.12)'}22` : 'rgba(255,255,255,0.04)', color: priorityFilter === p ? (p === 'all' ? 'var(--text)' : PRIORITY_COLORS[p as JobPriority]) : '#8080A0' }}>
              {p === 'all' ? 'All Priority' : `${PRIORITY_ICONS[p as JobPriority]} ${p.charAt(0).toUpperCase() + p.slice(1)}`}
            </button>
          ))}
        </div>

        {/* Mass apply controls */}
        {selectedCount > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginLeft: '8px' }}>
            <span style={{ fontSize: '12px', color: '#9090A8' }}>{selectedCount} selected</span>
            {easyApplySelected > 0 && (
              <button
                onClick={runMassApply}
                disabled={massApplying}
                style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '5px 12px', background: 'rgba(79,142,247,0.15)', border: '1px solid rgba(79,142,247,0.35)', borderRadius: '6px', color: '#4F8EF7', fontSize: '12px', fontWeight: '600', cursor: massApplying ? 'wait' : 'pointer', opacity: massApplying ? 0.7 : 1 }}>
                <Zap size={12} /> Apply {easyApplySelected} Easy Apply
              </button>
            )}
            <button onClick={() => setSelectedIds(new Set())} style={{ padding: '4px 10px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)', borderRadius: '6px', color: '#8080A0', fontSize: '11px', cursor: 'pointer' }}>Clear</button>
          </div>
        )}

        <button onClick={runNotionSync} disabled={notionSyncing}
          style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '5px', padding: '4px 10px', background: notionSyncing ? '#111318' : 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.25)', borderRadius: '5px', color: '#3b82f6', fontSize: '11px', fontWeight: 600, cursor: notionSyncing ? 'wait' : 'pointer' }}>
          <Upload size={11} style={notionSyncing ? { animation: 'spin 1s linear infinite' } : {}} />
          {notionSyncing ? 'Syncing...' : 'Sync to Notion'}
        </button>
        <Link href="/job-pipeline/analytics" style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '4px 10px', background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)', borderRadius: '5px', color: '#8080A0', fontSize: '11px', textDecoration: 'none' }}>
          📊 Analytics
        </Link>
        <div style={{ fontSize: '11px', color: '#555570' }}>{filtered.length} of {jobs.length} jobs</div>
      </div>

      {/* Kanban board — 4 lane columns */}
      <div style={{ flex: 1, overflowX: 'auto', overflowY: 'auto', display: 'flex', padding: '14px 16px', gap: '12px', alignItems: 'flex-start' }}>
        {COLUMNS.map(col => {
          const colJobs = filtered.filter(j => getLane(j) === col.key)

          return (
            <div key={col.key} style={{ minWidth: '300px', width: '300px', display: 'flex', flexDirection: 'column', gap: '8px', flexShrink: 0 }}>
              {/* Column header */}
              <div style={{ padding: '8px 10px', borderRadius: '6px', background: col.bg, flexShrink: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <div style={{ width: '7px', height: '7px', borderRadius: '50%', background: col.color, flexShrink: 0 }} />
                  <span style={{ fontSize: '11px', fontWeight: '700', color: col.color }}>{col.label}</span>
                  <span style={{ fontSize: '11px', color: '#555570', marginLeft: 'auto' }}>{colJobs.length}</span>
                </div>
                <div style={{ fontSize: '10px', color: '#444455', marginTop: '3px', paddingLeft: '13px' }}>{col.subtitle}</div>
              </div>

              {/* Cards */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {colJobs.map(job => (
                  <JobCard
                    key={job.id}
                    job={job}
                    colColor={col.color}
                    selected={selectedIds.has(job.id)}
                    onSelect={e => toggleSelect(job.id, e)}
                    onClick={() => setSelectedJob(job)}
                    onOutreach={e => { e.stopPropagation(); setOutreachJob(job) }}
                  />
                ))}
                {colJobs.length === 0 && (
                  <div style={{ fontSize: '11px', color: '#333345', textAlign: 'center', padding: '20px 0' }}>—</div>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Detail slide-in */}
      {selectedJob && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 100, display: 'flex', justifyContent: 'flex-end' }}
          onClick={e => { if (e.target === e.currentTarget) setSelectedJob(null) }}
        >
          <div style={{ width: '860px', height: '100vh', background: '#0E0E10', borderLeft: '1px solid var(--border)', display: 'flex', flexDirection: 'column', overflow: 'hidden', animation: 'slideIn 0.2s ease-out' }}>
            <style>{`@keyframes slideIn { from { transform: translateX(100%); } to { transform: translateX(0); } } @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>

            {/* Modal header */}
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: '12px', flexShrink: 0 }}>
              <CompanyLogo job={selectedJob} size={40} />
              <div>
                <div style={{ fontSize: '16px', fontWeight: '700', color: 'var(--text)' }}>{selectedJob.company}</div>
                <div style={{ fontSize: '12px', color: '#8080A0' }}>{selectedJob.title}</div>
              </div>
              {/* Lane badge */}
              {(() => {
                const lane = getLane(selectedJob)
                const lc = LANE_COLORS[lane]
                return (
                  <span style={{ fontSize: '10px', fontWeight: '700', padding: '3px 8px', borderRadius: '5px', background: lc + '20', color: lc, border: `1px solid ${lc}40` }}>
                    Lane {lane} — {LANE_LABELS[lane]}
                  </span>
                )
              })()}
              <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                {(selectedJob.salaryRange ?? selectedJob.salary) && (
                  <span style={{ fontSize: '12px', color: '#86EFAC', fontWeight: '600' }}>{selectedJob.salaryRange ?? selectedJob.salary}</span>
                )}
                {selectedJob.datePosted && (
                  <span style={{ fontSize: '11px', color: '#555566' }}>{selectedJob.datePosted}</span>
                )}
                {selectedJob.applicantCount && (
                  <span style={{ fontSize: '11px', color: '#FDE68A' }}>👥 {selectedJob.applicantCount}</span>
                )}
                <button onClick={() => setOutreachJob(selectedJob)} style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '5px 12px', background: 'rgba(94,106,210,0.12)', border: '1px solid rgba(94,106,210,0.25)', borderRadius: '6px', color: 'var(--accent)', fontSize: '12px', cursor: 'pointer' }}>
                  <MessageSquare size={13} /> Draft Outreach
                </button>
                <a href={selectedJob.url} target="_blank" rel="noreferrer" style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '5px 12px', background: 'var(--accent)', border: 'none', borderRadius: '6px', color: '#fff', fontSize: '12px', textDecoration: 'none', fontWeight: '500' }}>
                  <ExternalLink size={13} /> Apply ↗
                </a>
                <button onClick={() => setSelectedJob(null)} style={{ background: 'none', border: 'none', color: '#8080A0', cursor: 'pointer', fontSize: '20px', padding: '0 4px' }}>×</button>
              </div>
            </div>

            {/* Quick summary in modal */}
            {selectedJob.quickSummary && (
              <div style={{ padding: '10px 20px', borderBottom: '1px solid var(--border)', display: 'flex', gap: '16px', flexShrink: 0 }}>
                <div style={{ flex: 1, display: 'flex', gap: '6px', alignItems: 'flex-start' }}>
                  <span style={{ fontSize: '13px', flexShrink: 0 }}>✅</span>
                  <span style={{ fontSize: '12px', color: '#86EFAC', lineHeight: '1.5' }}>{selectedJob.quickSummary.greenFlag}</span>
                </div>
                <div style={{ flex: 1, display: 'flex', gap: '6px', alignItems: 'flex-start' }}>
                  <span style={{ fontSize: '13px', flexShrink: 0 }}>⚠️</span>
                  <span style={{ fontSize: '12px', color: '#FCA5A5', lineHeight: '1.5' }}>{selectedJob.quickSummary.redFlag}</span>
                </div>
              </div>
            )}

            {/* Modal body */}
            <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
              {/* Left: description */}
              <div style={{ flex: 1, borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', fontSize: '11px', fontWeight: '600', color: '#555570', textTransform: 'uppercase', letterSpacing: '0.6px', flexShrink: 0 }}>Job Description</div>
                <div style={{ flex: 1, overflowY: 'auto', padding: '16px', fontSize: '13px', lineHeight: '1.7', color: '#C4C4CC', whiteSpace: 'pre-wrap' }}>{selectedJob.description}</div>
              </div>

              {/* Right: resume + actions */}
              <div style={{ width: '400px', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                <div style={{ padding: '0 16px', borderBottom: '1px solid var(--border)', display: 'flex', flexShrink: 0, overflowX: 'auto' }}>
                  {(['master', 'analyze', 'custom', 'tailored'] as const).map(tab => {
                    const label = tab === 'master' ? 'Master' : tab === 'analyze' ? 'Analyze Fit' : tab === 'custom' ? 'Custom' : 'Tailored'
                    const indicator =
                      tab === 'analyze' ? analyzeResult :
                      tab === 'custom' ? customResume :
                      tab === 'tailored' ? tailorResult : null
                    return (
                      <button key={tab} onClick={() => setResumeTab(tab)} style={{ padding: '10px 12px', background: 'none', border: 'none', borderBottom: resumeTab === tab ? '2px solid var(--accent)' : '2px solid transparent', color: resumeTab === tab ? 'var(--text)' : '#8080A0', cursor: 'pointer', fontSize: '12px', fontWeight: resumeTab === tab ? '600' : '400', marginBottom: '-1px', whiteSpace: 'nowrap' }}>
                        {label}
                        {indicator && <span style={{ marginLeft: '4px', fontSize: '10px', color: '#86EFAC' }}>✓</span>}
                      </button>
                    )
                  })}
                </div>
                <div style={{ flex: 1, overflowY: 'auto', padding: '14px 16px' }}>
                  {resumeTab === 'master' ? (
                    <pre style={{ fontSize: '11px', lineHeight: '1.6', color: '#B0B0C0', whiteSpace: 'pre-wrap', fontFamily: 'ui-monospace, SFMono-Regular, monospace', margin: 0 }}>
                      {masterResume || 'Loading resume…'}
                    </pre>
                  ) : resumeTab === 'analyze' ? (
                    analyzeResult ? (
                      <AnalyzePanel
                        result={analyzeResult}
                        canMerge={analyzeResult.canMerge}
                        generating={generatingCustom}
                        customResume={customResume}
                        onGenerate={runCustomResume}
                      />
                    ) : analyzeError ? (
                      <div style={{ fontSize: '12px', color: '#FCA5A5', padding: '12px', background: 'rgba(239,68,68,0.08)', borderRadius: '7px' }}>{analyzeError}</div>
                    ) : (
                      <div style={{ fontSize: '12px', color: '#555570', padding: '16px 0' }}>→ Click "Analyze Fit" to score this job against all 4 resume lanes in parallel.</div>
                    )
                  ) : resumeTab === 'custom' ? (
                    customResume ? (
                      <CustomResumePanel result={customResume} />
                    ) : customError ? (
                      <div style={{ fontSize: '12px', color: '#FCA5A5', padding: '12px', background: 'rgba(239,68,68,0.08)', borderRadius: '7px' }}>{customError}</div>
                    ) : (
                      <div style={{ fontSize: '12px', color: '#555570', padding: '16px 0' }}>→ Run "Analyze Fit" first. If two lanes both score ≥70, the "Generate Custom Resume" button will unlock.</div>
                    )
                  ) : tailorResult ? (
                    <TailorPanel result={tailorResult} />
                  ) : tailorError ? (
                    <div style={{ fontSize: '12px', color: '#FCA5A5', padding: '12px', background: 'rgba(239,68,68,0.08)', borderRadius: '7px' }}>{tailorError}</div>
                  ) : (
                    <div style={{ fontSize: '12px', color: '#555570', padding: '16px 0' }}>→ Click "Run Tailor Agent" to generate single-lane keyword analysis and bullet rewrites.</div>
                  )}
                </div>

                {/* Live apply task banner — drives zero-touch happy path,
                    surfaces needs-answer pauses, and shows failure state. */}
                {activeTask && activeTask.jobId === selectedJob.id && (
                  <ApplyTaskBanner
                    task={activeTask}
                    answerDraft={answerDraft}
                    onAnswerChange={setAnswerDraft}
                    onSubmitAnswer={submitAnswer}
                    onCancel={cancelActiveTask}
                    submitting={submittingAnswer}
                  />
                )}

                <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)', flexShrink: 0 }}>
                  <div style={{ marginBottom: '8px' }}>
                    <label style={{ fontSize: '10px', fontWeight: '600', color: '#555570', textTransform: 'uppercase', letterSpacing: '0.6px', display: 'block', marginBottom: '4px' }}>Status</label>
                    <select value={localStatus} onChange={e => setLocalStatus(e.target.value as JobStatus)} style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)', borderRadius: '5px', padding: '5px 8px', fontSize: '12px', color: 'var(--text)', outline: 'none', width: '100%' }}>
                      {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={{ fontSize: '10px', fontWeight: '600', color: '#555570', textTransform: 'uppercase', letterSpacing: '0.6px', display: 'block', marginBottom: '4px' }}>Notes</label>
                    <textarea value={localNotes} onChange={e => setLocalNotes(e.target.value)} rows={3} style={{ width: '100%', background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)', borderRadius: '5px', padding: '6px 8px', fontSize: '12px', color: 'var(--text)', outline: 'none', resize: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }} />
                  </div>
                </div>
              </div>
            </div>

            {/* Modal action bar */}
            <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border)', display: 'flex', gap: '8px', background: '#111113', flexShrink: 0, flexWrap: 'wrap', alignItems: 'center' }}>
              <button onClick={() => { setLocalStatus('applied'); updateJob({ status: 'applied', appliedDate: new Date().toISOString() }) }}
                style={{ padding: '7px 14px', background: 'rgba(94,106,210,0.15)', color: '#9D86E9', border: '1px solid rgba(94,106,210,0.25)', borderRadius: '6px', fontSize: '12px', fontWeight: '500', cursor: 'pointer' }}>
                {selectedJob.status === 'applied' ? '✓ Applied' : 'Mark Applied'}
              </button>

              <button onClick={runAnalyzeFit} disabled={analyzing}
                style={{ padding: '7px 14px', background: analyzeResult ? 'rgba(46,204,113,0.15)' : 'rgba(94,106,210,0.15)', color: analyzeResult ? '#86EFAC' : '#9D86E9', border: `1px solid ${analyzeResult ? 'rgba(46,204,113,0.2)' : 'rgba(94,106,210,0.25)'}`, borderRadius: '6px', fontSize: '12px', fontWeight: '600', cursor: analyzing ? 'wait' : 'pointer', opacity: analyzing ? 0.7 : 1, display: 'flex', alignItems: 'center', gap: '5px' }}>
                {analyzing ? <><Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> Analyzing all lanes…</> : analyzeResult ? '✓ Analyzed' : <><Zap size={12} /> Analyze Fit</>}
              </button>

              <button onClick={runTailorAgent} disabled={tailoring}
                style={{ padding: '7px 14px', background: tailorResult ? 'rgba(46,204,113,0.15)' : 'rgba(245,166,35,0.12)', color: tailorResult ? '#86EFAC' : '#F5A623', border: `1px solid ${tailorResult ? 'rgba(46,204,113,0.2)' : 'rgba(245,166,35,0.2)'}`, borderRadius: '6px', fontSize: '12px', fontWeight: '500', cursor: tailoring ? 'wait' : 'pointer', opacity: tailoring ? 0.7 : 1, display: 'flex', alignItems: 'center', gap: '5px' }}>
                {tailoring ? <><Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> Tailoring…</> : tailorResult ? '✓ Resume Tailored!' : <><Zap size={12} /> Run Tailor Agent</>}
              </button>

              {/* One-click Apply — the zero-touch entry point. Shows
                  live phase while the Playwright worker runs. */}
              {(() => {
                const taskForJob =
                  activeTask && activeTask.jobId === selectedJob.id ? activeTask : null
                const running =
                  !!taskForJob &&
                  taskForJob.status !== 'applied' &&
                  taskForJob.status !== 'failed'
                const applied = taskForJob?.status === 'applied' || selectedJob.status === 'applied'
                const label = applied
                  ? '✓ Applied'
                  : running
                    ? `${taskForJob.phase.replace('-', ' ')}…`
                    : '⚡ Apply'
                const color = applied ? '#86EFAC' : running ? '#FDE68A' : '#FDE68A'
                const bg = applied
                  ? 'rgba(46,204,113,0.12)'
                  : running
                    ? 'rgba(245,166,35,0.12)'
                    : 'rgba(245,166,35,0.12)'
                const border = applied
                  ? 'rgba(46,204,113,0.25)'
                  : 'rgba(245,166,35,0.25)'
                return (
                  <button
                    onClick={() => runAutoApply(selectedJob)}
                    disabled={running || applied}
                    style={{
                      padding: '7px 14px',
                      background: bg,
                      color,
                      border: `1px solid ${border}`,
                      borderRadius: '6px',
                      fontSize: '12px',
                      fontWeight: '500',
                      cursor: running || applied ? 'default' : 'pointer',
                      opacity: running ? 0.85 : 1,
                      display: 'flex',
                      alignItems: 'center',
                      gap: '5px',
                    }}
                  >
                    {running ? (
                      <>
                        <Loader2
                          size={12}
                          style={{ animation: 'spin 1s linear infinite' }}
                        />
                        {label}
                      </>
                    ) : (
                      label
                    )}
                  </button>
                )
              })()}

              <button onClick={saveNotes} disabled={savingNotes}
                style={{ padding: '7px 14px', background: 'rgba(255,255,255,0.06)', color: '#B0B0C0', border: '1px solid var(--border)', borderRadius: '6px', fontSize: '12px', fontWeight: '500', cursor: 'pointer', marginLeft: 'auto' }}>
                {savingNotes ? 'Saving…' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
