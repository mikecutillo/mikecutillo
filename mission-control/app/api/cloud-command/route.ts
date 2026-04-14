import { NextResponse } from 'next/server'
import { execSync } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'

const DB_PATH = '/Volumes/ClawBotLoot/.hub-index/incoming.db'
const DUPES_PATH = '/Volumes/ClawBotLoot/.hub-index/dupes_report.json'
const BATCHES_DIR = '/Volumes/ClawBotLoot/.hub-index/deletion-batches'
const MANIFEST_PATH = '/Volumes/ClawBotLoot/.hub-index/reorganize_manifest.json'
const ACCOUNTS_PATH = '/Users/mikecutillo/.openclaw/workspace-shared/mission-control/data/cloud-accounts.json'

// Source → person mapping
const SOURCE_PERSON: Record<string, string> = {
  'cutillo-google': 'mike',
  'cutillo-gphotos': 'mike',
  'cutillo-icloud': 'mike',
  'cutillo-onedrive': 'mike',
  'erincutillo-google': 'erin-c',
  'erincutillo-gphotos': 'erin-c',
  'icloud-erin': 'erin-c',
  'erinrameyallen-google': 'erin-ra',
  'erinrameyallen-gphotos': 'erin-ra',
  'clara-icloud': 'clara',
  'liam-icloud': 'liam',
}

const SOURCE_SERVICE: Record<string, string> = {
  'cutillo-google': 'Google Drive',
  'cutillo-gphotos': 'Google Photos',
  'cutillo-icloud': 'iCloud',
  'cutillo-onedrive': 'OneDrive',
  'erincutillo-google': 'Google Drive',
  'erincutillo-gphotos': 'Google Photos',
  'icloud-erin': 'iCloud',
  'erinrameyallen-google': 'Google Drive',
  'erinrameyallen-gphotos': 'Google Photos',
  'clara-icloud': 'iCloud',
  'liam-icloud': 'iCloud',
}

// Source → ecosystem mapping (Apple / Google / Microsoft)
const SOURCE_ECOSYSTEM: Record<string, string> = {
  'cutillo-icloud': 'apple',
  'icloud-erin': 'apple',
  'clara-icloud': 'apple',
  'liam-icloud': 'apple',
  'cutillo-google': 'google',
  'cutillo-gphotos': 'google',
  'erincutillo-google': 'google',
  'erincutillo-gphotos': 'google',
  'erinrameyallen-google': 'google',
  'erinrameyallen-gphotos': 'google',
  'cutillo-onedrive': 'microsoft',
}

// 60s TTL cache
let cache: { data: unknown; ts: number } | null = null
const TTL = 60_000

function sql(query: string): string {
  try {
    return execSync(`sqlite3 "${DB_PATH}" "${query}"`, {
      encoding: 'utf-8',
      timeout: 10_000,
    }).trim()
  } catch {
    return ''
  }
}

function parseSqlRows(raw: string): string[][] {
  if (!raw) return []
  return raw.split('\n').map(line => line.split('|'))
}

function getDiskFreeGb(volume: string): number | null {
  try {
    const out = execSync(`df -g "${volume}" 2>/dev/null | tail -1`, { encoding: 'utf-8' }).trim()
    const parts = out.split(/\s+/)
    return parts.length >= 4 ? parseInt(parts[3], 10) : null
  } catch {
    return null
  }
}

function getSourceBreakdown() {
  const raw = sql(
    "SELECT source, COUNT(*), printf('%.2f', SUM(size)/1e9) FROM incoming_files GROUP BY source ORDER BY SUM(size) DESC"
  )
  return parseSqlRows(raw).map(([source, count, gb]) => ({
    source,
    person: SOURCE_PERSON[source] ?? 'unknown',
    service: SOURCE_SERVICE[source] ?? source,
    files: parseInt(count, 10),
    sizeGb: parseFloat(gb),
  }))
}

function getContentBreakdown() {
  const raw = sql(
    "SELECT content_category, COUNT(*), printf('%.2f', SUM(size)/1e9) FROM incoming_files GROUP BY content_category ORDER BY SUM(size) DESC"
  )
  return parseSqlRows(raw).map(([category, count, gb]) => ({
    category: category || 'uncategorized',
    files: parseInt(count, 10),
    sizeGb: parseFloat(gb),
  }))
}

function getPerSourceContent() {
  const raw = sql(
    "SELECT source, content_category, COUNT(*), printf('%.2f', SUM(size)/1e9) FROM incoming_files GROUP BY source, content_category ORDER BY source, SUM(size) DESC"
  )
  const result: Record<string, Array<{ category: string; files: number; sizeGb: number }>> = {}
  for (const [source, category, count, gb] of parseSqlRows(raw)) {
    if (!result[source]) result[source] = []
    result[source].push({
      category: category || 'uncategorized',
      files: parseInt(count, 10),
      sizeGb: parseFloat(gb),
    })
  }
  return result
}

function getTotals() {
  const raw = sql("SELECT COUNT(*), printf('%.2f', SUM(size)/1e9) FROM incoming_files")
  const parts = raw.split('|')
  return {
    totalFiles: parseInt(parts[0] ?? '0', 10),
    totalSizeGb: parseFloat(parts[1] ?? '0'),
  }
}

function getDedupData() {
  try {
    if (!fs.existsSync(DUPES_PATH)) return null
    const data = JSON.parse(fs.readFileSync(DUPES_PATH, 'utf-8'))

    // Validated pairs from validations key
    const validations = data.validations ?? {}
    const validatedPairs = Object.entries(validations).map(([key, v]: [string, any]) => ({
      pair: key.replace('__', ' vs '),
      checkedPairs: v.checked_pairs,
      confirmedIdentical: v.confirmed_identical,
      mismatches: v.mismatches_do_not_delete,
      recoverableGb: v.recoverable_gb,
      validatedAt: v.validated_at,
    }))

    // Tier 1 summary from top-level
    const tier1 = data.tier_1_name_size ?? {}
    const sourceCombos = (tier1.source_combinations ?? []).map((c: any) => ({
      sources: c.sources,
      dupeFiles: c.dupe_files,
      recoverableGb: c.recoverable_gb,
    }))

    const totalRecoverableGb = tier1.total_recoverable_gb ?? 0

    return {
      totalRecoverableGb,
      totalGroups: tier1.total_groups ?? 0,
      sourceCombos,
      validatedPairs,
      totalValidatedGb: validatedPairs.reduce((s: number, p: any) => s + (p.recoverableGb ?? 0), 0),
    }
  } catch {
    return null
  }
}

function getBatchData() {
  try {
    if (!fs.existsSync(BATCHES_DIR)) return { ready: 0, batches: [] }
    const files = fs.readdirSync(BATCHES_DIR).filter(f => f.endsWith('.csv') && !f.startsWith('._'))
    const batches = files.map(f => {
      const filePath = path.join(BATCHES_DIR, f)
      const content = fs.readFileSync(filePath, 'utf-8')
      const lines = content.split('\n').filter(l => l.trim())
      const dataLines = lines.slice(1) // skip header
      let totalSize = 0
      for (const line of dataLines) {
        const parts = line.split(',')
        const size = parseInt(parts[4] ?? '0', 10)
        if (!isNaN(size)) totalSize += size
      }
      const pairName = f.replace('batch_', '').replace('.csv', '').replace('__', ' vs ')
      return {
        name: pairName,
        files: dataLines.length,
        sizeGb: parseFloat((totalSize / 1e9).toFixed(2)),
        executed: false,
      }
    })
    return {
      ready: batches.length,
      batches,
      totalFiles: batches.reduce((s, b) => s + b.files, 0),
      totalGb: parseFloat(batches.reduce((s, b) => s + b.sizeGb, 0).toFixed(2)),
    }
  } catch {
    return { ready: 0, batches: [] }
  }
}

function getPipelineStatus() {
  // Check extraction status
  const erinGphotosFiles = sql("SELECT COUNT(*) FROM incoming_files WHERE source='erincutillo-gphotos'")
  const extractionDone = parseInt(erinGphotosFiles, 10) > 10_000 // expect ~220K after extraction

  // Check if NAS volumes are mounted
  const clawbotMounted = fs.existsSync('/Volumes/ClawBotLoot')
  const pictureCloudMounted = fs.existsSync('/Volumes/Picture Cloud Sync')

  // Check quick_hash coverage
  const hashCoverage = sql("SELECT COUNT(*) FROM incoming_files WHERE quick_hash IS NOT NULL")

  return {
    pull: { label: 'Pull', pct: 95, note: 'Erin C Takeout extraction in progress' },
    index: { label: 'Index', pct: 100, note: '455K files indexed' },
    dedup: { label: 'Dedup', pct: 80, note: `${parseInt(hashCoverage, 10).toLocaleString()} files hash-validated` },
    organize: { label: 'Organize', pct: 30, note: 'Manifest generated, awaiting execution' },
    delete: { label: 'Delete', pct: 0, note: extractionDone ? '4 batches ready' : 'Blocked: extraction incomplete' },
    pushBack: { label: 'Push Back', pct: 0, note: 'Pending cleanup completion' },
    extractionDone,
    clawbotMounted,
    pictureCloudMounted,
  }
}

function getEcosystemBreakdown() {
  const raw = sql(
    "SELECT source, COUNT(*), printf('%.2f', SUM(size)/1e9) FROM incoming_files GROUP BY source"
  )
  const ecosystems: Record<string, { files: number; sizeGb: number; sources: string[] }> = {
    apple: { files: 0, sizeGb: 0, sources: [] },
    google: { files: 0, sizeGb: 0, sources: [] },
    microsoft: { files: 0, sizeGb: 0, sources: [] },
    pc_local: { files: 0, sizeGb: 0, sources: [] },
    shared: { files: 0, sizeGb: 0, sources: [] },
  }
  for (const [source, count, gb] of parseSqlRows(raw)) {
    const eco = SOURCE_ECOSYSTEM[source] ?? 'shared'
    if (!ecosystems[eco]) ecosystems[eco] = { files: 0, sizeGb: 0, sources: [] }
    ecosystems[eco].files += parseInt(count, 10)
    ecosystems[eco].sizeGb += parseFloat(gb)
    ecosystems[eco].sources.push(source)
  }
  // Round values
  for (const eco of Object.values(ecosystems)) {
    eco.sizeGb = parseFloat(eco.sizeGb.toFixed(2))
  }
  return ecosystems
}

// Where data physically lives
function getLocationBreakdown() {
  // All indexed data is currently on ClawBotLoot
  const totals = getTotals()
  // Check if Picture Cloud Sync has any data
  let pcsFiles = 0
  let pcsSizeGb = 0
  try {
    const pcsBase = '/Volumes/Picture Cloud Sync/Family Backup'
    if (fs.existsSync(pcsBase)) {
      const out = execSync(`find "${pcsBase}" -type f 2>/dev/null | wc -l`, {
        encoding: 'utf-8', timeout: 5000,
      }).trim()
      pcsFiles = parseInt(out, 10) || 0
    }
  } catch { /* ignore */ }

  return {
    clawbot: { label: 'ClawBotLoot (NAS)', files: totals.totalFiles, sizeGb: totals.totalSizeGb },
    pictureCloud: { label: 'Picture Cloud Sync', files: pcsFiles, sizeGb: pcsSizeGb },
    pcLocal: { label: 'PC Local (not yet indexed)', files: 0, sizeGb: 0 },
  }
}

function getAccountMeta() {
  try {
    if (!fs.existsSync(ACCOUNTS_PATH)) return null
    return JSON.parse(fs.readFileSync(ACCOUNTS_PATH, 'utf-8'))
  } catch {
    return null
  }
}

function buildResponse() {
  const totals = getTotals()
  const sourceBreakdown = getSourceBreakdown()
  const contentBreakdown = getContentBreakdown()
  const perSourceContent = getPerSourceContent()
  const dedup = getDedupData()
  const batches = getBatchData()
  const pipeline = getPipelineStatus()
  const accounts = getAccountMeta()

  const clawbotFreeGb = getDiskFreeGb('/Volumes/ClawBotLoot')
  const pictureCloudFreeGb = getDiskFreeGb('/Volumes/Picture Cloud Sync')
  const ecosystem = getEcosystemBreakdown()
  const location = getLocationBreakdown()

  return {
    generatedAt: new Date().toISOString(),
    index: {
      ...totals,
      sourceBreakdown,
      contentBreakdown,
      perSourceContent,
    },
    ecosystem,
    location,
    dedup,
    batches,
    nas: {
      clawbotFreeGb,
      pictureCloudFreeGb,
      clawbotMounted: pipeline.clawbotMounted,
      pictureCloudMounted: pipeline.pictureCloudMounted,
    },
    pipeline,
    accounts,
  }
}

// POST: Ingest PC index data into incoming.db
export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { source, files } = body as {
      source: string
      files: Array<{ rel_path: string; filename: string; extension: string; size: number; mtime: number }>
    }
    if (!source || !files?.length) {
      return NextResponse.json({ error: 'Missing source or files' }, { status: 400 })
    }

    // Register the source in our mappings if it's a PC source
    if (!SOURCE_PERSON[source]) {
      // Auto-detect person from source name pattern
      // e.g. "pc-mike-documents", "pc-mike-photos"
      const personMatch = source.match(/^pc-(\w+)/)
      if (personMatch) {
        SOURCE_PERSON[source] = personMatch[1]
        SOURCE_SERVICE[source] = 'PC Local'
        SOURCE_ECOSYSTEM[source] = 'pc_local'
      }
    }

    // Write files to DB via sqlite3 CLI in batches
    const batchSize = 500
    let inserted = 0
    for (let i = 0; i < files.length; i += batchSize) {
      const batch = files.slice(i, i + batchSize)
      const values = batch.map(f => {
        const relPath = f.rel_path.replace(/'/g, "''")
        const filename = f.filename.replace(/'/g, "''")
        const ext = (f.extension || '').replace(/'/g, "''")
        return `('${source}','${relPath}','${filename}','${ext}',${f.size},${f.mtime})`
      }).join(',')

      try {
        execSync(
          `sqlite3 "${DB_PATH}" "INSERT OR REPLACE INTO incoming_files (source, rel_path, filename, extension, size, mtime) VALUES ${values};"`,
          { encoding: 'utf-8', timeout: 30_000 }
        )
        inserted += batch.length
      } catch (e) {
        return NextResponse.json(
          { error: 'DB insert failed', inserted, detail: String(e) },
          { status: 500 }
        )
      }
    }

    // Bust cache so next GET reflects new data
    cache = null

    return NextResponse.json({ ok: true, source, inserted })
  } catch (e) {
    return NextResponse.json(
      { error: 'Ingest failed', detail: String(e) },
      { status: 500 }
    )
  }
}

export async function GET() {
  try {
    const now = Date.now()
    if (cache && now - cache.ts < TTL) {
      return NextResponse.json(cache.data)
    }
    const data = buildResponse()
    cache = { data, ts: now }
    return NextResponse.json(data)
  } catch (e) {
    return NextResponse.json(
      { error: 'Failed to build cloud command data', detail: String(e) },
      { status: 500 }
    )
  }
}
