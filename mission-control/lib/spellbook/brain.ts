import OpenAI from 'openai'
import { ActionPlan, Capability, CapabilityId, Directive, Step } from './types'
import { buildCapabilityPrompt } from './capabilities'

const VALID_CAPABILITIES: Set<string> = new Set<string>([
  'open_url',
  'copy_to_clipboard',
  'create_mc_task',
  'save_note',
  'save_to_downloads',
])

const VALID_DIRECTIVES: Set<string> = new Set<string>([
  'install',
  'update',
  'build',
  'configure',
  'download',
  'learn',
  'save',
  'other',
])

export async function generateActionPlan(
  url: string,
  title: string,
  text: string,
  enabledCapabilities: Capability[]
): Promise<ActionPlan> {
  const capabilityPrompt = buildCapabilityPrompt(enabledCapabilities)
  const truncatedText = text.slice(0, 8000)

  const client = new OpenAI()
  const msg = await client.chat.completions.create({
    model: 'gpt-4.1',
    max_tokens: 1500,
    messages: [
      {
        role: 'system',
        content: `You are SpellBook, an AI assistant that analyzes web pages and generates structured action plans.

Given a web page's URL, title, and text content, produce a JSON action plan that extracts what the page is telling the user to DO (install, download, configure, learn, etc.) and maps those actions to the available capabilities.

AVAILABLE CAPABILITIES:
${capabilityPrompt}

IMPORTANT RULES:
- Only emit steps whose "capability" matches one of the listed capabilities EXACTLY
- Each step must have valid parameters matching the capability's schema
- The "directive" field classifies the OVERALL intent of the page: install, update, build, configure, download, learn, save, or other
- Keep the summary to 1-2 sentences
- Keep rationale for each step to 1 sentence
- If the page has no actionable content for these capabilities, return an empty steps array
- Return ONLY valid JSON, no markdown fences, no explanation

Return this exact JSON shape:
{
  "summary": "What this page is about and what actions are available",
  "directive": "install",
  "steps": [
    {
      "capability": "open_url",
      "params": { "url": "https://example.com" },
      "rationale": "Why this step is needed"
    }
  ]
}`,
      },
      {
        role: 'user',
        content: `PAGE:\nURL: ${url}\nTitle: ${title}\nContent:\n${truncatedText}`,
      },
    ],
  })

  const raw = msg.choices[0]?.message?.content || ''
  const parsed = JSON.parse(raw) as {
    summary?: string
    directive?: string
    steps?: Array<{ capability?: string; params?: Record<string, unknown>; rationale?: string }>
  }

  // Validate and filter steps to only known capabilities
  const validSteps: Step[] = (parsed.steps || [])
    .filter((s) => s.capability && VALID_CAPABILITIES.has(s.capability))
    .filter((s) => enabledCapabilities.some((c) => c.id === s.capability))
    .map((s) => ({
      capability: s.capability as CapabilityId,
      params: s.params || {},
      rationale: s.rationale || '',
    }))

  const directive: Directive = VALID_DIRECTIVES.has(parsed.directive || '')
    ? (parsed.directive as Directive)
    : 'other'

  return {
    summary: parsed.summary || 'No summary available.',
    directive,
    steps: validSteps,
  }
}
