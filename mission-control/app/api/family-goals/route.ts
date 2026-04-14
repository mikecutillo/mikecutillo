import { NextRequest, NextResponse } from 'next/server'
import {
  getGoals,
  getGoalById,
  getGoalsByCategory,
  getGoalsByVisibility,
  approveGoal,
  updateGoalProgress,
  addGoal,
  getGoalSummary,
} from '@/lib/goal-tracker'
import { postToDiscord, DISCORD_COLORS } from '@/lib/discord-dispatch'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  const category = searchParams.get('category')
  const visibility = searchParams.get('visibility') as 'parents' | 'family' | null
  const summary = searchParams.get('summary')

  if (summary === 'true') {
    const text = await getGoalSummary()
    return NextResponse.json({ summary: text })
  }

  if (id) {
    const goal = await getGoalById(id)
    if (!goal) return NextResponse.json({ error: 'Goal not found' }, { status: 404 })
    return NextResponse.json(goal)
  }

  if (category) {
    const goals = await getGoalsByCategory(category)
    return NextResponse.json(goals)
  }

  if (visibility) {
    const goals = await getGoalsByVisibility(visibility)
    return NextResponse.json(goals)
  }

  const goals = await getGoals()
  return NextResponse.json(goals)
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { action } = body

  if (action === 'approve') {
    const { goalId, userId } = body
    if (!goalId || !userId) {
      return NextResponse.json({ error: 'goalId and userId required' }, { status: 400 })
    }
    const goal = await approveGoal(goalId, userId)
    if (!goal) return NextResponse.json({ error: 'Goal not found' }, { status: 404 })

    // Notify Discord when goal becomes in-progress (both parents approved)
    if (goal.status === 'in-progress') {
      postToDiscord('announcements', {
        title: 'Goal Approved',
        description: `**${goal.title}** is now active! Both parents approved.`,
        color: DISCORD_COLORS.family,
        fields: [
          { name: 'Target', value: goal.target, inline: true },
          { name: 'Category', value: goal.category, inline: true },
        ],
      }).catch(() => {})
    }

    return NextResponse.json(goal)
  }

  if (action === 'update-progress') {
    const { goalId, currentValue } = body
    if (!goalId || currentValue === undefined) {
      return NextResponse.json({ error: 'goalId and currentValue required' }, { status: 400 })
    }
    const goal = await updateGoalProgress(goalId, currentValue)
    if (!goal) return NextResponse.json({ error: 'Goal not found' }, { status: 404 })

    if (goal.status === 'completed') {
      postToDiscord('announcements', {
        title: 'Goal Completed!',
        description: `**${goal.title}** has been achieved!`,
        color: DISCORD_COLORS.family,
        fields: [
          { name: 'Final Value', value: `${currentValue} ${goal.unit}`, inline: true },
          { name: 'Target', value: `${goal.targetValue} ${goal.unit}`, inline: true },
        ],
      }).catch(() => {})
    }

    return NextResponse.json(goal)
  }

  // Default: add a new goal (Mike, Erin, or BMO can propose)
  const { proposedBy, ...goalData } = body
  const goal = await addGoal(goalData, proposedBy || 'bmo')

  postToDiscord(goal.visibility === 'family' ? 'announcements' : 'bills', {
    title: 'New Goal Proposed',
    description: `**${goal.title}**\n${goal.description}`,
    color: DISCORD_COLORS.finance,
    fields: [
      { name: 'Target', value: goal.target, inline: true },
      { name: 'Category', value: goal.category, inline: true },
      { name: 'Status', value: 'Awaiting approval from both parents', inline: false },
    ],
  }).catch(() => {})

  return NextResponse.json(goal, { status: 201 })
}
