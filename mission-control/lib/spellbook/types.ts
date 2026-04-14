export type CapabilityId =
  | 'open_url'
  | 'copy_to_clipboard'
  | 'create_mc_task'
  | 'save_note'
  | 'save_to_downloads'

export type Directive =
  | 'install'
  | 'update'
  | 'build'
  | 'configure'
  | 'download'
  | 'learn'
  | 'save'
  | 'other'

export interface Capability {
  id: CapabilityId
  label: string
  description: string
  clientSide: boolean
  paramSchema: Record<string, 'string' | 'number' | 'boolean'>
}

export interface Step {
  capability: CapabilityId
  params: Record<string, unknown>
  rationale: string
}

export interface ActionPlan {
  summary: string
  directive: Directive
  steps: Step[]
}

export interface StepResult {
  index: number
  status: 'pending' | 'approved' | 'done' | 'error'
  output?: string
}

export interface Capture {
  id: string
  createdAt: string
  source: { url: string; title: string }
  rawText: string
  plan: ActionPlan
  stepResults: StepResult[]
}

export interface SpellbookSettings {
  capabilities: Record<CapabilityId, { enabled: boolean }>
}
