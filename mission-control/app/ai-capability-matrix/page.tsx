'use client'

import { useMemo, useState } from 'react'
import TopNav from '@/components/top-nav'
import { Bot, Clipboard, Play, Plus, Sparkles, CheckCircle2 } from 'lucide-react'

type CardTagKey = 'shell' | 'python' | 'google' | 'fs' | 'git' | 'ssh' | 'npm'
type CardTag = { key: CardTagKey; label: string }
type TaskCard = {
  id: string
  title: string
  blurb: string
  tags: CardTag[]
  prompt: string
  buildScope?: string
}

type RunState = {
  loading: boolean
  success?: string
  error?: string
  taskId?: string
}

const TAG_STYLES: Record<CardTagKey, React.CSSProperties> = {
  shell: { background: 'rgba(34,197,94,0.10)', color: '#22c55e', border: '1px solid rgba(34,197,94,0.20)' },
  python: { background: 'rgba(77,166,255,0.10)', color: '#4da6ff', border: '1px solid rgba(77,166,255,0.25)' },
  google: { background: 'rgba(167,139,250,0.10)', color: '#a78bfa', border: '1px solid rgba(167,139,250,0.20)' },
  fs: { background: 'rgba(245,158,11,0.10)', color: '#f59e0b', border: '1px solid rgba(245,158,11,0.20)' },
  git: { background: 'rgba(6,182,212,0.10)', color: '#06b6d4', border: '1px solid rgba(6,182,212,0.20)' },
  ssh: { background: 'rgba(239,68,68,0.10)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.20)' },
  npm: { background: 'rgba(236,72,153,0.10)', color: '#ec4899', border: '1px solid rgba(236,72,153,0.25)' },
}

const TAG_BORDER_COLOR: Record<CardTagKey, string> = {
  shell: '#22c55e',
  python: '#4da6ff',
  google: '#a78bfa',
  fs: '#f59e0b',
  git: '#06b6d4',
  ssh: '#ef4444',
  npm: '#ec4899',
}

const TASK_CARDS: TaskCard[] = [
  {
    id: 'downloads-cleanup',
    title: '🗑️ Clean Up Old Downloads',
    blurb: 'Scans Downloads for files untouched in over 30 days and turns the result into a reviewable cleanup list instead of mysterious file chaos.',
    tags: [{ key: 'shell', label: 'shell' }, { key: 'fs', label: 'filesystem' }],
    prompt: 'Audit ~/Downloads for files older than 30 days, group them by type and size, and produce a safe delete-review list before any destructive step.',
    buildScope: 'safe local cleanup workflow',
  },
  {
    id: 'gmail-digest',
    title: '📬 Gmail Digest',
    blurb: 'Pulls the latest unread email context and turns it into an actually useful summary: who needs attention, what is urgent, and what can wait.',
    tags: [{ key: 'python', label: 'Python script' }, { key: 'google', label: 'Gmail API' }],
    prompt: 'Read the latest unread Gmail messages from the configured accounts and summarize the urgent senders, asks, deadlines, and anything worth acting on today.',
    buildScope: 'gmail summary workflow',
  },
  {
    id: 'git-activity-report',
    title: '📜 Git Activity Report',
    blurb: 'Shows what changed in the last 10 commits so you can stop pretending you remember everything your repo has been up to.',
    tags: [{ key: 'git', label: 'git log' }, { key: 'shell', label: 'shell' }],
    prompt: 'Summarize the last 10 commits in the workspace: touched files, themes, risky changes, and anything unfinished or suspicious.',
    buildScope: 'repo activity report',
  },
  {
    id: 'nas-storage-audit',
    title: '🗄️ NAS Storage Audit',
    blurb: 'SSHes into your NAS and lists the largest files and folders so storage creep gets caught before it becomes a petty little disaster.',
    tags: [{ key: 'ssh', label: 'SSH' }, { key: 'shell', label: 'du / find' }],
    prompt: 'SSH into the configured NAS, find the largest files and directories, sort them by size, and summarize the biggest storage offenders.',
    buildScope: 'nas audit workflow',
  },
  {
    id: 'daily-briefing',
    title: '📓 Daily Briefing',
    blurb: 'Reads the daily memory log plus the current mission and gives you the short version of what matters instead of a wall of historical sludge.',
    tags: [{ key: 'fs', label: 'filesystem' }, { key: 'fs', label: 'memory log' }],
    prompt: 'Read today\'s memory log and CURRENT_MISSION.md, then produce a crisp status briefing: completed, next actions, blockers, and loose ends.',
    buildScope: 'daily context briefing',
  },
  {
    id: 'newsletter-purge',
    title: '🚮 Newsletter Purge',
    blurb: 'Finds newsletter mail by sender and age, shows the count, and turns inbox cleanup into a deliberate operation instead of inbox archaeology.',
    tags: [{ key: 'python', label: 'gmail-wipe.py' }, { key: 'google', label: 'Gmail API' }],
    prompt: 'Prepare a newsletter purge review by identifying old mail from a chosen sender, counting matches, and outlining the delete plan with confirmation built in.',
    buildScope: 'gmail cleanup workflow',
  },
]

export default function AICapabilityMatrixPage() {
  const [search, setSearch] = useState('')
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null)
  const [runState, setRunState] = useState<Record<string, RunState>>({})
  const [customTitle, setCustomTitle] = useState('')
  const [customGoal, setCustomGoal] = useState('')
  const [customFiles, setCustomFiles] = useState('')
  const [customConstraints, setCustomConstraints] = useState('')
  const [generateState, setGenerateState] = useState<RunState>({ loading: false })

  const filteredCards = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return TASK_CARDS
    return TASK_CARDS.filter(card => [card.title, card.blurb, card.prompt, ...card.tags.map(tag => tag.label)].join(' ').toLowerCase().includes(q))
  }, [search])

  const selectedCard = TASK_CARDS.find(card => card.id === selectedCardId) ?? filteredCards[0] ?? TASK_CARDS[0]

  const runCard = async (card: TaskCard) => {
    setRunState(prev => ({ ...prev, [card.id]: { loading: true } }))
    try {
      const res = await fetch('/api/ai-capability-tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'run-card',
          title: card.title.replace(/^\S+\s/, ''),
          description: card.blurb,
          prompt: card.prompt,
          tags: ['lm-studio-card', card.id],
          priority: 'high',
          cardId: card.id,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to queue card')
      setRunState(prev => ({ ...prev, [card.id]: { loading: false, success: data.message, taskId: data.task?.id } }))
    } catch (error) {
      setRunState(prev => ({ ...prev, [card.id]: { loading: false, error: error instanceof Error ? error.message : 'Failed to queue card' } }))
    }
  }

  const copyPrompt = async (card: TaskCard) => {
    await navigator.clipboard.writeText(card.prompt)
    setRunState(prev => ({ ...prev, [card.id]: { ...(prev[card.id] || { loading: false }), success: 'Prompt copied.' } }))
  }

  const generatedPrompt = useMemo(() => {
    const title = customTitle.trim() || 'Untitled build request'
    const goal = customGoal.trim()
    const files = customFiles.trim()
    const constraints = customConstraints.trim()
    return [
      `Build request: ${title}`,
      goal ? `Goal: ${goal}` : 'Goal: Define and build the requested feature end-to-end.',
      files ? `Relevant files / areas: ${files}` : 'Relevant files / areas: Use the best matching workspace area and create new files if needed.',
      constraints ? `Constraints: ${constraints}` : 'Constraints: Keep it actionable, verify the result, and leave a clear next step if follow-up work remains.',
      'Expected outcome: Create or update the implementation, log the work, and return a concise done/blocked summary.',
    ].join('\n')
  }, [customTitle, customGoal, customFiles, customConstraints])

  const queueGeneratedBuild = async () => {
    if (!customTitle.trim()) {
      setGenerateState({ loading: false, error: 'Give the request a title first.' })
      return
    }
    setGenerateState({ loading: true })
    try {
      const res = await fetch('/api/ai-capability-tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'generate',
          title: customTitle.trim(),
          description: customGoal.trim() || 'Custom build request from AI Capability Matrix',
          prompt: generatedPrompt,
          tags: ['generated-build', 'ai-capability-matrix'],
          priority: 'high',
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to generate build task')
      setGenerateState({ loading: false, success: data.message, taskId: data.task?.id })
    } catch (error) {
      setGenerateState({ loading: false, error: error instanceof Error ? error.message : 'Failed to generate build task' })
    }
  }

  return (
    <div style={{ minHeight: '100%', background: '#0A0B0F', display: 'flex', flexDirection: 'column' }}>
      <TopNav crumbs={[{ label: 'Control Center', href: '/office' }, { label: 'AI Capability Matrix', active: true }]} />

      <div style={{ padding: 18, display: 'grid', gap: 16 }}>
        <section style={panelStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <Bot size={15} style={{ color: '#7c8cff' }} />
                <div style={{ fontSize: 12, fontWeight: 700, color: '#7c8cff', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Actionable LM Studio task cards</div>
              </div>
              <div style={{ fontSize: 26, fontWeight: 800, color: '#F8FAFC', letterSpacing: '-0.03em', fontFamily: 'var(--font-display, inherit)' }}>Turn the matrix into a real <span style={{ color: '#7c8cff' }}>launch pad</span></div>
              <div style={{ fontSize: 13, color: '#98A2B3', marginTop: 8, lineHeight: 1.6, maxWidth: 860 }}>
                Click a card to review the exact prompt, copy it into LM Studio, or queue it as work for turbodot. Then create a brand-new request below and hit <strong style={{ color: '#26C26E' }}>Generate</strong> to kick off a real build request instead of more decorative dashboard furniture.
              </div>
            </div>
            <div style={{ minWidth: 280, maxWidth: 340, width: '100%' }}>
              <input
                value={search}
                onChange={event => setSearch(event.target.value)}
                placeholder="Search cards, prompts, tools…"
                style={inputStyle}
              />
            </div>
          </div>
        </section>

        <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 0.9fr', gap: 16, alignItems: 'start' }}>
          <section style={panelStyle}>
            <div style={sectionLabel}><Sparkles size={14} /> Ready-made task cards</div>
            <div style={{ display: 'grid', gap: 12, marginTop: 14 }}>
              {filteredCards.map(card => {
                const state = runState[card.id]
                const active = selectedCard?.id === card.id
                const accentColor = TAG_BORDER_COLOR[card.tags[0]?.key] ?? '#5E6AD2'
                return (
                  <div key={card.id} style={{ ...cardStyle, borderColor: active ? '#5E6AD2' : '#20222A', borderLeft: `3px solid ${accentColor}${active ? 'cc' : '55'}`, background: active ? 'rgba(94,106,210,0.08)' : '#0D0E11' }}>
                    <button onClick={() => setSelectedCardId(card.id)} style={{ background: 'transparent', border: 'none', padding: 0, textAlign: 'left', cursor: 'pointer' }}>
                      <div style={{ fontSize: 19, fontWeight: 800, color: active ? '#F8FAFC' : '#D4D8E8', letterSpacing: '-0.02em' }}>{card.title}</div>
                      <div style={{ fontSize: 13, color: '#AEB6CC', lineHeight: 1.65, marginTop: 8 }}>{card.blurb}</div>
                    </button>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
                      {card.tags.map(tag => (
                        <span key={`${card.id}-${tag.label}`} style={{ ...tagStyle, ...TAG_STYLES[tag.key] }}>{tag.label}</span>
                      ))}
                    </div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 14 }}>
                      <button onClick={() => runCard(card)} disabled={state?.loading} style={primaryButtonStyle}>
                        <Play size={13} /> {state?.loading ? 'Queueing…' : 'Run'}
                      </button>
                      <button onClick={() => copyPrompt(card)} style={secondaryButtonStyle}>
                        <Clipboard size={13} /> Copy prompt
                      </button>
                    </div>
                    {state?.success && (
                      <div style={successStyle}><CheckCircle2 size={13} /> {state.success}{state.taskId ? ` · Task ${state.taskId}` : ''}</div>
                    )}
                    {state?.error && <div style={errorStyle}>{state.error}</div>}
                  </div>
                )
              })}
            </div>
          </section>

          <section style={{ display: 'grid', gap: 16 }}>
            <div style={panelStyle}>
              <div style={sectionLabel}><Clipboard size={14} /> Selected prompt</div>
              <div style={{ fontSize: 18, fontWeight: 800, color: '#E8ECFF', marginTop: 12, fontFamily: 'var(--font-display, inherit)' }}>{selectedCard.title}</div>
              <div style={{ fontSize: 13, color: '#AEB6CC', lineHeight: 1.65, marginTop: 8 }}>{selectedCard.blurb}</div>
              <div style={{ marginTop: 14, border: '1px solid #20222A', borderRadius: 12, background: '#090A0D', padding: 14, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12, lineHeight: 1.7, color: '#DCE2FF', whiteSpace: 'pre-wrap' }}>
                {selectedCard.prompt}
              </div>
              <div style={{ fontSize: 11, color: '#7E869F', marginTop: 10, lineHeight: 1.5 }}>
                Scope: {selectedCard.buildScope}. Use <strong style={{ color: '#5E6AD2' }}>Run</strong> to queue the work for turbodot, or <strong style={{ color: '#5E6AD2' }}>Copy prompt</strong> to fire it directly into LM Studio.
              </div>
            </div>

            <div style={panelStyle}>
              <div style={sectionLabel}><Plus size={14} /> Create a new one</div>
              <div style={{ fontSize: 13, color: '#98A2B3', lineHeight: 1.6, marginTop: 10 }}>
                Describe what you want built. When you click Generate, the page creates an actionable task for turbodot with a structured prompt instead of just leaving your idea to die in a text box.
              </div>
              <div style={{ display: 'grid', gap: 10, marginTop: 14 }}>
                <div>
                  <div style={fieldLabel}>Title</div>
                  <input value={customTitle} onChange={event => setCustomTitle(event.target.value)} placeholder="Example: Add a Gmail triage panel to Mission Control" style={inputStyle} />
                </div>
                <div>
                  <div style={fieldLabel}>What do you want built?</div>
                  <textarea value={customGoal} onChange={event => setCustomGoal(event.target.value)} placeholder="Describe the feature, flow, or tool you want me to build." style={textareaStyle} />
                </div>
                <div>
                  <div style={fieldLabel}>Relevant files / areas</div>
                  <input value={customFiles} onChange={event => setCustomFiles(event.target.value)} placeholder="mission-control/app/..., m365-dashboard/..., or leave blank" style={inputStyle} />
                </div>
                <div>
                  <div style={fieldLabel}>Constraints / notes</div>
                  <textarea value={customConstraints} onChange={event => setCustomConstraints(event.target.value)} placeholder="Any rules, style notes, deadlines, or things to avoid." style={textareaStyle} />
                </div>
                <div style={{ border: '1px solid #20222A', borderRadius: 12, background: '#090A0D', padding: 14 }}>
                  <div style={{ fontSize: 10, color: '#7E869F', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>Generated build brief</div>
                  <div style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12, lineHeight: 1.7, color: '#DCE2FF', whiteSpace: 'pre-wrap' }}>{generatedPrompt}</div>
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button onClick={queueGeneratedBuild} disabled={generateState.loading} style={primaryButtonStyle}>
                    <Sparkles size={13} /> {generateState.loading ? 'Generating…' : 'Generate'}
                  </button>
                  <button onClick={() => navigator.clipboard.writeText(generatedPrompt)} style={secondaryButtonStyle}>
                    <Clipboard size={13} /> Copy brief
                  </button>
                </div>
                {generateState.success && (
                  <div style={successStyle}><CheckCircle2 size={13} /> {generateState.success}{generateState.taskId ? ` · Task ${generateState.taskId}` : ''}</div>
                )}
                {generateState.error && <div style={errorStyle}>{generateState.error}</div>}
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}

const panelStyle: React.CSSProperties = {
  background: '#111318',
  border: '1px solid #20222A',
  borderRadius: 14,
  padding: 16,
}

const sectionLabel: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  fontSize: 11,
  fontWeight: 700,
  color: '#7c8cff',
  textTransform: 'uppercase',
  letterSpacing: '0.1em',
}

const cardStyle: React.CSSProperties = {
  border: '1px solid #20222A',
  borderRadius: 14,
  padding: 16,
  display: 'flex',
  flexDirection: 'column',
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  background: '#090A0D',
  border: '1px solid #20222A',
  borderRadius: 10,
  color: '#E7ECF7',
  padding: '10px 12px',
  fontSize: 13,
  outline: 'none',
  boxSizing: 'border-box',
}

const textareaStyle: React.CSSProperties = {
  ...inputStyle,
  minHeight: 92,
  resize: 'vertical',
  lineHeight: 1.6,
}

const fieldLabel: React.CSSProperties = {
  fontSize: 11,
  color: '#7E869F',
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  marginBottom: 6,
}

const tagStyle: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  padding: '3px 8px',
  borderRadius: 999,
}

const primaryButtonStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  background: '#26C26E',
  color: '#fff',
  border: 'none',
  borderRadius: 10,
  padding: '10px 14px',
  fontSize: 13,
  fontWeight: 700,
  cursor: 'pointer',
}

const secondaryButtonStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  background: '#111318',
  color: '#DCE2FF',
  border: '1px solid #20222A',
  borderRadius: 10,
  padding: '10px 14px',
  fontSize: 13,
  fontWeight: 700,
  cursor: 'pointer',
}

const successStyle: React.CSSProperties = {
  marginTop: 10,
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  color: '#26C26E',
  fontSize: 12,
  fontWeight: 600,
}

const errorStyle: React.CSSProperties = {
  marginTop: 10,
  color: '#ef4444',
  fontSize: 12,
  fontWeight: 600,
}
