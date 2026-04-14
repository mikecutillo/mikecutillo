import { readJSON, writeJSON } from './data'

export interface GoalCheckpoint {
  date: string
  target: number
  actual: number | null
}

export interface FamilyGoal {
  id: string
  category: 'financial' | 'subscriptions' | 'screen-time' | 'family' | 'education' | 'health'
  title: string
  description: string
  target: string
  metric: string
  dataSource: string
  startValue: number
  targetValue: number
  currentValue: number | null
  unit: string
  direction: 'increase' | 'decrease'
  status: 'proposed' | 'approved' | 'in-progress' | 'completed' | 'paused'
  proposedBy: string   // 'mike', 'erin', or 'bmo' — anyone can propose
  proposedAt: string
  approvedBy: string[]
  visibility: 'parents' | 'family'
  checkpoints: GoalCheckpoint[]
}

interface GoalData {
  version: string
  generated_at: string
  goals: FamilyGoal[]
}

const FILE = 'family-goals.json'

export async function getGoals(): Promise<FamilyGoal[]> {
  const data = await readJSON<GoalData>(FILE, { version: '1.0', generated_at: '', goals: [] })
  return data.goals
}

export async function getGoalById(id: string): Promise<FamilyGoal | undefined> {
  const goals = await getGoals()
  return goals.find(g => g.id === id)
}

export async function getGoalsByCategory(category: string): Promise<FamilyGoal[]> {
  const goals = await getGoals()
  return goals.filter(g => g.category === category)
}

export async function getGoalsByVisibility(visibility: 'parents' | 'family'): Promise<FamilyGoal[]> {
  const goals = await getGoals()
  if (visibility === 'family') return goals.filter(g => g.visibility === 'family')
  return goals // parents see all
}

export async function approveGoal(goalId: string, userId: string): Promise<FamilyGoal | null> {
  const data = await readJSON<GoalData>(FILE, { version: '1.0', generated_at: '', goals: [] })
  const idx = data.goals.findIndex(g => g.id === goalId)
  if (idx === -1) return null

  if (!data.goals[idx].approvedBy.includes(userId)) {
    data.goals[idx].approvedBy.push(userId)
  }
  // Both parents approved → mark in-progress
  if (data.goals[idx].approvedBy.includes('mike') && data.goals[idx].approvedBy.includes('erin')) {
    data.goals[idx].status = 'in-progress'
  } else if (data.goals[idx].status === 'proposed') {
    data.goals[idx].status = 'approved'
  }

  await writeJSON(FILE, data)
  return data.goals[idx]
}

export async function updateGoalProgress(goalId: string, currentValue: number): Promise<FamilyGoal | null> {
  const data = await readJSON<GoalData>(FILE, { version: '1.0', generated_at: '', goals: [] })
  const idx = data.goals.findIndex(g => g.id === goalId)
  if (idx === -1) return null

  data.goals[idx].currentValue = currentValue

  // Check if goal is completed
  const goal = data.goals[idx]
  if (goal.direction === 'decrease' && currentValue <= goal.targetValue) {
    goal.status = 'completed'
  } else if (goal.direction === 'increase' && currentValue >= goal.targetValue) {
    goal.status = 'completed'
  }

  await writeJSON(FILE, data)
  return data.goals[idx]
}

/**
 * Add a new goal. Any admin (Mike or Erin) or BMO can propose goals.
 * Both parents must approve before a goal becomes in-progress.
 */
export async function addGoal(
  goal: Omit<FamilyGoal, 'id' | 'proposedAt' | 'approvedBy' | 'status' | 'proposedBy'>,
  proposedBy: string = 'bmo'
): Promise<FamilyGoal> {
  const data = await readJSON<GoalData>(FILE, { version: '1.0', generated_at: '', goals: [] })
  const newGoal: FamilyGoal = {
    ...goal,
    id: `goal_${Date.now()}`,
    proposedBy,
    proposedAt: new Date().toISOString(),
    approvedBy: [],
    status: 'proposed',
  }
  data.goals.push(newGoal)
  await writeJSON(FILE, data)
  return newGoal
}

/** Generate a summary for the weekly brief */
export async function getGoalSummary(): Promise<string> {
  const goals = await getGoals()
  const active = goals.filter(g => g.status === 'in-progress' || g.status === 'approved')
  const proposed = goals.filter(g => g.status === 'proposed')
  const completed = goals.filter(g => g.status === 'completed')

  const lines: string[] = []

  if (completed.length > 0) {
    lines.push(`**Completed (${completed.length}):** ${completed.map(g => g.title).join(', ')}`)
  }
  if (active.length > 0) {
    lines.push(`**Active (${active.length}):**`)
    for (const g of active) {
      const progress = g.currentValue !== null
        ? g.direction === 'decrease'
          ? Math.round(((g.startValue - g.currentValue) / (g.startValue - g.targetValue)) * 100)
          : Math.round(((g.currentValue - g.startValue) / (g.targetValue - g.startValue)) * 100)
        : 0
      lines.push(`- ${g.title}: ${Math.max(0, Math.min(100, progress))}% complete`)
    }
  }
  if (proposed.length > 0) {
    lines.push(`**Pending Approval (${proposed.length}):** ${proposed.map(g => g.title).join(', ')}`)
  }

  return lines.join('\n')
}
