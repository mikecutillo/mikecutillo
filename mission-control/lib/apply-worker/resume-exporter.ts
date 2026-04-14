/**
 * resume-exporter — markdown → PDF with content-hash caching.
 *
 * The Phase 1 custom-resume endpoint writes cleaned markdown to
 * `resumes/generated/{jobId}.md`. Phase 2's worker needs a PDF to
 * upload to LinkedIn Easy Apply (and generic adapters). We run the
 * markdown through `md-to-pdf` (Chromium-backed), cache by SHA-256
 * of the markdown, and return the cached path whenever the same
 * content has been rendered before.
 *
 * The cache lives in `resumes/generated-pdf/{hash}.pdf` — rebuilding
 * when the job's content changes is automatic because the hash
 * changes, but identical content across multiple jobs hits the cache.
 */

import crypto from 'crypto'
import fs from 'fs/promises'
import path from 'path'

const RESUMES_ROOT = '/Users/mikecutillo/.openclaw/workspace-shared/resumes'
const GENERATED_DIR = path.join(RESUMES_ROOT, 'generated')
const PDF_CACHE_DIR = path.join(RESUMES_ROOT, 'generated-pdf')
const MASTER_PDF_CACHE = path.join(PDF_CACHE_DIR, 'master.pdf')
const MASTER_PDF_KEY = path.join(PDF_CACHE_DIR, 'master.key.txt')

async function ensureDir(p: string): Promise<void> {
  await fs.mkdir(p, { recursive: true })
}

function hashOf(s: string): string {
  return crypto.createHash('sha256').update(s).digest('hex').slice(0, 16)
}

/**
 * Convert markdown → PDF using md-to-pdf. The package renders via
 * Chromium under the hood and supports CSS theming. We keep it simple:
 * default A4, modest margins, a readable sans-serif stack.
 *
 * md-to-pdf is a runtime-only ESM-ish module that Next.js trips over
 * at build time if imported statically. We dynamic-import it so this
 * module loads cleanly in the Next dev server.
 */
async function renderPdf(markdown: string, dest: string): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mod = (await import('md-to-pdf')) as unknown as { mdToPdf: (src: any, cfg: any) => Promise<any> }
  const css = `
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; color: #111; font-size: 11pt; line-height: 1.35; }
    h1 { font-size: 20pt; margin: 0 0 2pt 0; border-bottom: 2px solid #111; padding-bottom: 4pt; }
    h2 { font-size: 13pt; margin: 14pt 0 4pt 0; color: #111; text-transform: uppercase; letter-spacing: 0.05em; border-bottom: 1px solid #888; padding-bottom: 2pt; }
    h3 { font-size: 11pt; margin: 10pt 0 2pt 0; color: #111; }
    p { margin: 0 0 6pt 0; }
    ul { margin: 4pt 0 8pt 18pt; padding: 0; }
    li { margin: 2pt 0; }
    a { color: #0066cc; text-decoration: none; }
    strong { color: #000; }
  `
  await mod.mdToPdf(
    { content: markdown },
    {
      dest,
      css,
      stylesheet_encoding: 'utf-8',
      pdf_options: {
        format: 'Letter',
        margin: { top: '0.5in', bottom: '0.5in', left: '0.6in', right: '0.6in' },
        printBackground: true,
      },
    },
  )
}

/**
 * Export a PDF for a custom job resume (Phase 1 output). Reads
 * `resumes/generated/{jobId}.md`, hashes, caches, returns the PDF
 * path. Throws if the markdown isn't there.
 */
export async function exportJobResumePdf(jobId: string): Promise<string> {
  const mdPath = path.join(GENERATED_DIR, `${jobId}.md`)
  const markdown = await fs.readFile(mdPath, 'utf-8')
  const h = hashOf(markdown)
  const pdfPath = path.join(PDF_CACHE_DIR, `${h}.pdf`)
  await ensureDir(PDF_CACHE_DIR)
  try {
    await fs.access(pdfPath)
    return pdfPath
  } catch {
    // cache miss → render
  }
  await renderPdf(markdown, pdfPath)
  return pdfPath
}

/**
 * Fallback path: render `MASTER_RESUME.md` directly. Used when Phase 1
 * didn't produce a custom resume (e.g. only one lane scored high
 * enough that `canMerge === false`) and the worker needs *something*
 * to upload.
 */
export async function exportMasterResumePdf(): Promise<string> {
  await ensureDir(PDF_CACHE_DIR)
  const masterPath = path.join(RESUMES_ROOT, 'MASTER_RESUME.md')
  const markdown = await fs.readFile(masterPath, 'utf-8')
  const h = hashOf(markdown)

  // Check if the master hash matches what we cached last time.
  try {
    const cachedKey = await fs.readFile(MASTER_PDF_KEY, 'utf-8')
    if (cachedKey.trim() === h) {
      await fs.access(MASTER_PDF_CACHE)
      return MASTER_PDF_CACHE
    }
  } catch {
    // no cached key / no cached pdf — fall through
  }
  await renderPdf(markdown, MASTER_PDF_CACHE)
  await fs.writeFile(MASTER_PDF_KEY, h, 'utf-8')
  return MASTER_PDF_CACHE
}

/**
 * Render a specific lane resume (A/B/C/D). Used when fit analysis
 * pinpoints a single strong lane and there's no cross-lane merge
 * to do.
 */
export async function exportLaneResumePdf(lane: 'A' | 'B' | 'C' | 'D'): Promise<string> {
  const LANE_FILES: Record<'A' | 'B' | 'C' | 'D', string> = {
    A: 'RESUME_A_IMPLEMENTATION.md',
    B: 'RESUME_B_SOLUTIONS.md',
    C: 'RESUME_C_AI_CUSTOMER_FACING.md',
    D: 'RESUME_D_STRATEGY.md',
  }
  await ensureDir(PDF_CACHE_DIR)
  const laneMdPath = path.join(RESUMES_ROOT, LANE_FILES[lane])
  const markdown = await fs.readFile(laneMdPath, 'utf-8')
  const h = hashOf(markdown)
  const pdfPath = path.join(PDF_CACHE_DIR, `lane_${lane}_${h}.pdf`)
  try {
    await fs.access(pdfPath)
    return pdfPath
  } catch {
    // cache miss
  }
  await renderPdf(markdown, pdfPath)
  return pdfPath
}
