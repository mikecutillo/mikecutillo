import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs/promises'
import path from 'path'
const IBA_DIR = '/Users/mikecutillo/.openclaw/workspace-shared/iba'
export async function GET(req: NextRequest) {
  const file = req.nextUrl.searchParams.get('file')
  if (!file) return NextResponse.json({ error: 'Missing file' }, { status: 400 })
  const full = path.join(IBA_DIR, path.basename(file))
  try {
    const content = await fs.readFile(full, 'utf-8')
    return NextResponse.json({ file: path.basename(file), content })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 404 })
  }
}
