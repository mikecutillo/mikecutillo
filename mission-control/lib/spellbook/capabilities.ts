import fs from 'fs/promises'
import path from 'path'
import { readJSON, writeJSON, generateId } from '@/lib/data'
import { Capability, CapabilityId, SpellbookSettings } from './types'
import { Task } from '@/lib/types'

const CAPABILITIES: Capability[] = [
  {
    id: 'open_url',
    label: 'Open URL',
    description: 'Opens a URL in a new browser tab',
    clientSide: true,
    paramSchema: { url: 'string' },
  },
  {
    id: 'copy_to_clipboard',
    label: 'Copy to Clipboard',
    description: 'Copies text to the clipboard',
    clientSide: true,
    paramSchema: { text: 'string' },
  },
  {
    id: 'create_mc_task',
    label: 'Create Task',
    description: 'Creates a new task in Mission Control backlog',
    clientSide: false,
    paramSchema: { title: 'string', notes: 'string' },
  },
  {
    id: 'save_note',
    label: 'Save Note',
    description: 'Appends a timestamped note to today\'s memory file',
    clientSide: false,
    paramSchema: { text: 'string' },
  },
  {
    id: 'save_to_downloads',
    label: 'Save to Downloads',
    description: 'Saves a text file to ~/Downloads/spellbook/',
    clientSide: false,
    paramSchema: { filename: 'string', content: 'string' },
  },
]

const DEFAULT_SETTINGS: SpellbookSettings = {
  capabilities: {
    open_url: { enabled: true },
    copy_to_clipboard: { enabled: true },
    create_mc_task: { enabled: true },
    save_note: { enabled: true },
    save_to_downloads: { enabled: true },
  },
}

export function getAllCapabilities(): Capability[] {
  return CAPABILITIES
}

export async function getSettings(): Promise<SpellbookSettings> {
  return readJSON<SpellbookSettings>('spellbook-settings.json', DEFAULT_SETTINGS)
}

export async function updateSettings(settings: SpellbookSettings): Promise<void> {
  await writeJSON('spellbook-settings.json', settings)
}

export async function getEnabledCapabilities(): Promise<Capability[]> {
  const settings = await getSettings()
  return CAPABILITIES.filter((c) => settings.capabilities[c.id]?.enabled !== false)
}

export function getCapabilityById(id: CapabilityId): Capability | undefined {
  return CAPABILITIES.find((c) => c.id === id)
}

/** Build capability descriptions for the brain's system prompt */
export function buildCapabilityPrompt(capabilities: Capability[]): string {
  return capabilities
    .map(
      (c) =>
        `- ${c.id}: ${c.description}. Parameters: ${Object.entries(c.paramSchema)
          .map(([k, v]) => `${k} (${v})`)
          .join(', ')}`
    )
    .join('\n')
}

// ── Server-side capability handlers ──

export async function executeCapability(
  capabilityId: CapabilityId,
  params: Record<string, unknown>
): Promise<{ success: boolean; output: string }> {
  switch (capabilityId) {
    case 'create_mc_task':
      return handleCreateTask(params)
    case 'save_note':
      return handleSaveNote(params)
    case 'save_to_downloads':
      return handleSaveToDownloads(params)
    case 'open_url':
    case 'copy_to_clipboard':
      return { success: true, output: 'Client-side capability — handled by extension' }
    default:
      return { success: false, output: `Unknown capability: ${capabilityId}` }
  }
}

async function handleCreateTask(
  params: Record<string, unknown>
): Promise<{ success: boolean; output: string }> {
  const title = String(params.title || 'SpellBook task')
  const notes = String(params.notes || '')
  const tasks = await readJSON<Task[]>('tasks.json', [])
  const newTask: Task = {
    id: generateId(),
    title,
    description: notes,
    status: 'backlog',
    priority: 'medium',
    assignee: 'turbodot',
    tags: ['spellbook'],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
  tasks.push(newTask)
  await writeJSON('tasks.json', tasks)
  return { success: true, output: `Task created: "${title}" (id: ${newTask.id})` }
}

async function handleSaveNote(
  params: Record<string, unknown>
): Promise<{ success: boolean; output: string }> {
  const text = String(params.text || '')
  const today = new Date().toISOString().split('T')[0]
  const memoryDir = '/Users/mikecutillo/.openclaw/workspace-shared/memory'
  const filePath = path.join(memoryDir, `${today}.md`)
  const timestamp = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
  const entry = `\n- **${timestamp}** (SpellBook) ${text}\n`
  try {
    await fs.appendFile(filePath, entry, 'utf-8')
  } catch {
    await fs.writeFile(filePath, `# ${today}\n${entry}`, 'utf-8')
  }
  return { success: true, output: `Note appended to memory/${today}.md` }
}

async function handleSaveToDownloads(
  params: Record<string, unknown>
): Promise<{ success: boolean; output: string }> {
  const filename = String(params.filename || 'spellbook-output.txt')
  const content = String(params.content || '')
  const dir = path.join(process.env.HOME || '/Users/mikecutillo', 'Downloads', 'spellbook')
  await fs.mkdir(dir, { recursive: true })
  const filePath = path.join(dir, filename)
  await fs.writeFile(filePath, content, 'utf-8')
  return { success: true, output: `Saved to ~/Downloads/spellbook/${filename}` }
}
