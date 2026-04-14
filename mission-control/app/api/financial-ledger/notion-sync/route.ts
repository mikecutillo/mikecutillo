import { NextResponse } from 'next/server'

// Redirect to unified notion-sync API
export async function POST(request: Request) {
  const origin = new URL(request.url).origin
  const res = await fetch(`${origin}/api/notion-sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source: 'financial-ledger' }),
  })
  const data = await res.json()
  return NextResponse.json(data, { status: res.status })
}
