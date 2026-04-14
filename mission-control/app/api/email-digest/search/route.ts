import { NextResponse } from 'next/server'
import { exec } from 'child_process'
import { promisify } from 'util'
import { logAiUsage, estimateCost } from '@/lib/ai-usage-logger'

const execAsync = promisify(exec)

// Inline Python for cross-account search — avoids a separate script file
const SEARCH_SCRIPT = `
import sys, json, os
sys.path.insert(0, '/Users/mikecutillo/.openclaw/workspace-shared/shared')
from google_api import gmail_list_messages, gmail_get_message

ACCOUNTS = [
    "cutillo@gmail.com",
    "erincutillo@gmail.com",
    "erinrameyallen@gmail.com",
]
LABELS = {
    "cutillo@gmail.com": "Mike",
    "erincutillo@gmail.com": "Erin",
    "erinrameyallen@gmail.com": "Erin",
}

query = sys.argv[1] if len(sys.argv) > 1 else ""
results = []
seen = set()

for acct in ACCOUNTS:
    try:
        msgs = gmail_list_messages(acct, q=query, max_results=10)
        for m in msgs:
            mid = m["id"]
            if mid in seen:
                continue
            seen.add(mid)
            full = gmail_get_message(acct, mid, fmt="metadata",
                                     headers=["From","Subject","Date"])
            hdrs = {h["name"].lower(): h["value"]
                    for h in full.get("payload", {}).get("headers", [])}
            results.append({
                "id":            mid,
                "account":       acct,
                "account_label": LABELS[acct],
                "from":          hdrs.get("from",""),
                "subject":       hdrs.get("subject","(no subject)"),
                "date":          hdrs.get("date",""),
                "snippet":       full.get("snippet",""),
            })
    except Exception as e:
        pass

print(json.dumps(results))
`

export async function POST(req: Request) {
  const { query, mode } = (await req.json()) as { query: string; mode: 'search' | 'ask' }

  if (!query?.trim()) {
    return NextResponse.json({ results: [], answer: null })
  }

  // Sanitize query to prevent shell injection
  const safeQuery = query.replace(/['"\\`$]/g, ' ').trim().slice(0, 200)

  try {
    // Run cross-account search
    const { stdout } = await execAsync(
      `python3 -c ${JSON.stringify(SEARCH_SCRIPT)} "${safeQuery}"`,
      { timeout: 30_000, env: { ...process.env } }
    )
    const results = JSON.parse(stdout.trim() || '[]')

    if (mode === 'search' || !results.length) {
      return NextResponse.json({ results, answer: null })
    }

    // Ask mode: send top results to Claude for a plain-English answer
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) {
      return NextResponse.json({ results, answer: null })
    }

    const context = results
      .slice(0, 5)
      .map((r: { account_label: string; subject: string; snippet: string; date: string }) =>
        `[${r.account_label}] ${r.subject}\n${r.snippet}\n(${r.date})`
      )
      .join('\n\n---\n\n')

    const aiPrompt = `Based on these emails, answer the question: "${query}"\n\nEmails:\n${context}\n\nAnswer in 1-3 sentences. Be specific. If you can't determine an answer from the emails, say so.`
    const aiStart = Date.now()
    const claudeResp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 512,
        messages: [{ role: 'user', content: aiPrompt }],
      }),
    })

    const claudeData = (await claudeResp.json()) as {
      content?: Array<{ text: string }>
    }
    const answer = claudeData.content?.[0]?.text ?? null

    logAiUsage({
      route: 'email-digest/search',
      modelId: 'anthropic-claude-haiku-4-5', provider: 'anthropic', modelName: 'claude-haiku-4-5-20251001',
      status: answer ? 'success' : 'failed', durationMs: Date.now() - aiStart,
      inputHint: query.slice(0, 80),
      fallbacksUsed: 0, attempts: [{ modelId: 'anthropic-claude-haiku-4-5', status: answer ? 'success' : 'failed' }],
      costEstimate: estimateCost('claude-haiku-4-5', 'anthropic', aiPrompt.length),
    }).catch(() => {})

    return NextResponse.json({ results, answer })
  } catch (err: unknown) {
    const e = err as { message?: string }
    return NextResponse.json({ error: e.message, results: [], answer: null }, { status: 500 })
  }
}
