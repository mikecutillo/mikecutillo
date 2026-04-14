import { NextResponse } from 'next/server'
import { readJSON } from '@/lib/data'
import type { AiUsageEntry } from '@/lib/ai-usage-logger'

const FILE = 'ai-usage-log.json'

export async function GET() {
  const log = await readJSON<AiUsageEntry[]>(FILE, [])

  const totalRequests = log.length
  const totalCostEstimate = log.reduce((sum, e) => sum + (e.costEstimate ?? 0), 0)

  // By model
  const modelMap = new Map<string, { provider: string; count: number; cost: number; failures: number }>()
  for (const e of log) {
    const key = e.modelId
    const cur = modelMap.get(key) || { provider: e.provider, count: 0, cost: 0, failures: 0 }
    cur.count++
    cur.cost += e.costEstimate ?? 0
    if (e.status === 'failed') cur.failures++
    modelMap.set(key, cur)
  }
  const byModel = Array.from(modelMap.entries())
    .map(([modelId, v]) => ({
      modelId,
      provider: v.provider,
      count: v.count,
      cost: v.cost,
      failRate: v.count > 0 ? v.failures / v.count : 0,
    }))
    .sort((a, b) => b.count - a.count)

  // By route
  const routeMap = new Map<string, { count: number; cost: number; totalDuration: number }>()
  for (const e of log) {
    const cur = routeMap.get(e.route) || { count: 0, cost: 0, totalDuration: 0 }
    cur.count++
    cur.cost += e.costEstimate ?? 0
    cur.totalDuration += e.durationMs
    routeMap.set(e.route, cur)
  }
  const byRoute = Array.from(routeMap.entries())
    .map(([route, v]) => ({
      route,
      count: v.count,
      cost: v.cost,
      avgDurationMs: v.count > 0 ? Math.round(v.totalDuration / v.count) : 0,
    }))
    .sort((a, b) => b.cost - a.cost)

  // By day
  const dayMap = new Map<string, { count: number; cost: number }>()
  for (const e of log) {
    const day = e.timestamp.slice(0, 10)
    const cur = dayMap.get(day) || { count: 0, cost: 0 }
    cur.count++
    cur.cost += e.costEstimate ?? 0
    dayMap.set(day, cur)
  }
  const byDay = Array.from(dayMap.entries())
    .map(([date, v]) => ({ date, count: v.count, cost: v.cost }))
    .sort((a, b) => b.date.localeCompare(a.date))

  // Fallback + local rates
  const withFallbacks = log.filter(e => e.fallbacksUsed > 0).length
  const localRequests = log.filter(e => e.provider === 'ollama').length

  const period = log.length > 0
    ? { from: log[log.length - 1].timestamp, to: log[0].timestamp }
    : { from: '', to: '' }

  return NextResponse.json({
    totalRequests,
    totalCostEstimate,
    byModel,
    byRoute,
    byDay,
    recentEntries: log.slice(0, 50),
    fallbackRate: totalRequests > 0 ? withFallbacks / totalRequests : 0,
    localRate: totalRequests > 0 ? localRequests / totalRequests : 0,
    period,
  })
}
