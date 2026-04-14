import fs from 'fs/promises'
import { getDataPath } from '@/lib/data'
import { Capture } from './types'

const JOURNAL_FILE = 'SPELLBOOK_JOURNAL.md'

export async function appendJournalEntry(capture: Capture): Promise<void> {
  const journalPath = getDataPath(JOURNAL_FILE)
  const date = new Date(capture.createdAt).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
  const time = new Date(capture.createdAt).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
  })

  const completedSteps = capture.stepResults
    .filter((r) => r.status === 'done')
    .map((r) => {
      const step = capture.plan.steps[r.index]
      if (!step) return null
      return `  - **${step.capability}**: ${step.rationale}${r.output ? ` → ${r.output}` : ''}`
    })
    .filter(Boolean)

  if (completedSteps.length === 0) return

  const entry = `
### ${date} at ${time}

- **Source:** [${capture.source.title}](${capture.source.url})
- **Directive:** \`${capture.plan.directive}\`
- **Summary:** ${capture.plan.summary}
- **Actions taken:**
${completedSteps.join('\n')}

---
`

  try {
    const existing = await fs.readFile(journalPath, 'utf-8')
    await fs.writeFile(journalPath, existing + entry, 'utf-8')
  } catch {
    const header = `# SpellBook Journal

A log of every page captured and every action executed through SpellBook.

---
`
    await fs.writeFile(journalPath, header + entry, 'utf-8')
  }
}
