import { NextRequest, NextResponse } from 'next/server'
import {
  getProfile,
  getAllProfiles,
  updateProfile,
  startOnboarding,
  recordOnboardingResponse,
  sendNextQuestion,
  addBmoNote,
  getProfileSummary,
} from '@/lib/family-profiles'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const member = searchParams.get('member')
  const summary = searchParams.get('summary')

  if (member && summary === 'true') {
    const text = await getProfileSummary(member)
    return NextResponse.json({ summary: text })
  }

  if (member) {
    const profile = await getProfile(member)
    if (!profile) return NextResponse.json({ error: 'Member not found' }, { status: 404 })
    return NextResponse.json(profile)
  }

  const profiles = await getAllProfiles()
  return NextResponse.json(profiles)
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { action } = body

  // Start onboarding — send BMO's intro + first question
  if (action === 'start-onboarding') {
    const { memberId } = body
    if (!memberId) return NextResponse.json({ error: 'memberId required' }, { status: 400 })
    const sent = await startOnboarding(memberId)
    return NextResponse.json({ sent, memberId })
  }

  // Record a response to an onboarding question
  if (action === 'respond') {
    const { memberId, response } = body
    if (!memberId || !response) {
      return NextResponse.json({ error: 'memberId and response required' }, { status: 400 })
    }
    const result = await recordOnboardingResponse(memberId, response)
    // If there's a next question, send it
    if (result.nextQuestion) {
      await sendNextQuestion(memberId)
    }
    return NextResponse.json(result)
  }

  // Start onboarding for ALL family members at once
  if (action === 'start-all') {
    const results: Record<string, boolean> = {}
    for (const id of ['mike', 'erin', 'liam', 'clara']) {
      results[id] = await startOnboarding(id)
    }
    return NextResponse.json(results)
  }

  // Add a BMO observation note
  if (action === 'add-note') {
    const { memberId, note } = body
    if (!memberId || !note) {
      return NextResponse.json({ error: 'memberId and note required' }, { status: 400 })
    }
    const ok = await addBmoNote(memberId, note)
    return NextResponse.json({ added: ok })
  }

  // Update profile fields directly
  if (action === 'update') {
    const { memberId, updates } = body
    if (!memberId || !updates) {
      return NextResponse.json({ error: 'memberId and updates required' }, { status: 400 })
    }
    const profile = await updateProfile(memberId, updates)
    if (!profile) return NextResponse.json({ error: 'Member not found' }, { status: 404 })
    return NextResponse.json(profile)
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
