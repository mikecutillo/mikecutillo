import { NextResponse } from 'next/server'
import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)
const SCRIPT = '/Users/mikecutillo/.openclaw/workspace-shared/scripts/notion-sync.py'

const VALID_SOURCES = ['financial-ledger', 'job-pipeline', 'news-intel', 'content-hub', 'subscriptions', 'all']

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}))
    const source = body.source || 'financial-ledger'

    if (!VALID_SOURCES.includes(source)) {
      return NextResponse.json(
        { status: 'error', message: `Invalid source: ${source}. Valid: ${VALID_SOURCES.join(', ')}` },
        { status: 400 }
      )
    }

    const { stdout, stderr } = await execAsync(
      `python3 ${SCRIPT} --source ${source}`,
      { timeout: 300_000, env: { ...process.env } }
    )

    // The script prints JSON summary as the last line of stdout
    const lines = stdout.trim().split('\n')
    const lastLine = lines[lines.length - 1]
    let result = { status: 'ok', output: stdout.slice(-2000) }
    try {
      const parsed = JSON.parse(lastLine)
      result = { ...parsed, output: stdout.slice(-2000) }
    } catch {
      // not JSON, just return raw output
    }

    return NextResponse.json({
      ...result,
      errors: stderr ? stderr.slice(-500) : null,
    })
  } catch (err: unknown) {
    const e = err as { message?: string; stderr?: string }
    const msg = e.message || 'Unknown error'

    // Parse friendly error messages from the script
    if (msg.includes('NOTION_PARENT_PAGE_ID not set')) {
      return NextResponse.json({
        status: 'setup_required',
        message: 'Notion parent page not configured',
        setup: {
          steps: [
            'Create a page in Notion (e.g. "TurboDot Hub")',
            'Share it with your Notion integration (••• → Connections)',
            'Copy the page ID from the URL (32-char hex at end)',
            'Add to .env.local: NOTION_PARENT_PAGE_ID=<your-page-id>',
            'Restart the dev server',
          ]
        },
      }, { status: 422 })
    }

    return NextResponse.json(
      { status: 'error', message: msg, errors: e.stderr?.slice(-500) },
      { status: 500 }
    )
  }
}

export async function GET() {
  return NextResponse.json({
    sources: VALID_SOURCES.filter(s => s !== 'all'),
    usage: 'POST with { "source": "financial-ledger" | "job-pipeline" | "news-intel" | "content-hub" | "subscriptions" | "all" }',
  })
}
