'use client'

import { useEffect, useState, useCallback } from 'react'
import { useVisibilityInterval } from '@/hooks/use-visibility-interval'
import TopNav from '@/components/top-nav'
import { RefreshCcw } from 'lucide-react'
import KpiRow from '@/components/cloud-command/KpiRow'
import PersonDashboard from '@/components/cloud-command/PersonDashboard'
import MigrationPipeline from '@/components/cloud-command/MigrationPipeline'
import ContentExplorer from '@/components/cloud-command/ContentExplorer'
import OperationsPanel from '@/components/cloud-command/OperationsPanel'

type CloudCommandData = {
  generatedAt: string
  index: {
    totalFiles: number
    totalSizeGb: number
    sourceBreakdown: Array<{ source: string; person: string; service: string; files: number; sizeGb: number }>
    contentBreakdown: Array<{ category: string; files: number; sizeGb: number }>
    perSourceContent: Record<string, Array<{ category: string; files: number; sizeGb: number }>>
  }
  dedup: {
    totalRecoverableGb: number
    totalGroups: number
    sourceCombos: Array<{ sources: string[]; dupeFiles: number; recoverableGb: number }>
    validatedPairs: Array<{ pair: string; checkedPairs: number; confirmedIdentical: number; mismatches: number; recoverableGb: number; validatedAt: string }>
    totalValidatedGb: number
  } | null
  batches: {
    ready: number
    batches: Array<{ name: string; files: number; sizeGb: number; executed: boolean }>
    totalFiles: number
    totalGb: number
  }
  nas: {
    clawbotFreeGb: number | null
    pictureCloudFreeGb: number | null
    clawbotMounted: boolean
    pictureCloudMounted: boolean
  }
  pipeline: {
    pull: { label: string; pct: number; note: string }
    index: { label: string; pct: number; note: string }
    dedup: { label: string; pct: number; note: string }
    organize: { label: string; pct: number; note: string }
    delete: { label: string; pct: number; note: string }
    pushBack: { label: string; pct: number; note: string }
    extractionDone: boolean
    clawbotMounted: boolean
    pictureCloudMounted: boolean
  }
  accounts: unknown
}

const PEOPLE = [
  { id: 'mike', name: 'Mike', color: '#4DA6FF' },
  { id: 'erin-c', name: 'Erin C', color: '#A78BFA' },
  { id: 'erin-ra', name: 'Erin RA', color: '#F97316' },
  { id: 'clara', name: 'Clara', color: '#F472B6' },
  { id: 'liam', name: 'Liam', color: '#22C55E' },
]

export default function CloudCommand() {
  const [data, setData] = useState<CloudCommandData | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [lastRefresh, setLastRefresh] = useState<string | null>(null)

  const loadData = useCallback(async () => {
    try {
      const res = await fetch(`/api/cloud-command?ts=${Date.now()}`, { cache: 'no-store' })
      const json = await res.json()
      setData(json)
      setLastRefresh(new Date().toLocaleTimeString())
    } catch {
      // ignore
    }
  }, [])

  useEffect(() => { loadData() }, [loadData])
  useVisibilityInterval(loadData, 30_000)

  if (!data) {
    return (
      <div style={{ minHeight: '100%', background: '#06080d', display: 'flex', flexDirection: 'column' }}>
        <TopNav crumbs={[{ label: 'Cutillo Cloud', href: '/cutillo-cloud' }, { label: 'Cloud Command', active: true }]} />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1, color: '#4a5568', fontSize: '13px' }}>Loading...</div>
      </div>
    )
  }

  const pipelinePhases = [
    data.pipeline.pull,
    data.pipeline.index,
    data.pipeline.dedup,
    data.pipeline.organize,
    data.pipeline.delete,
    data.pipeline.pushBack,
  ]

  return (
    <div style={{ minHeight: '100%', background: '#06080d', display: 'flex', flexDirection: 'column' }}>
      <TopNav crumbs={[{ label: 'Cutillo Cloud', href: '/cutillo-cloud' }, { label: 'Cloud Command', active: true }]} />

      <div style={{ padding: '12px 16px', flex: 1, display: 'flex', flexDirection: 'column', gap: '12px', overflow: 'auto' }}>
        {/* Header row with refresh */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: '10px', color: '#4a5568' }}>
            {lastRefresh ? `Last updated ${lastRefresh} / auto-refresh 30s` : ''}
          </div>
          <button
            onClick={async () => {
              setRefreshing(true)
              await loadData()
              setRefreshing(false)
            }}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: '6px',
              border: '1px solid rgba(255,255,255,0.08)',
              background: 'rgba(255,255,255,0.03)',
              color: '#cbd5e1', borderRadius: '8px',
              padding: '7px 10px', fontSize: '11px', fontWeight: 600, cursor: 'pointer',
            }}
          >
            <RefreshCcw size={12} style={{ opacity: refreshing ? 0.5 : 1, transform: refreshing ? 'rotate(180deg)' : 'none', transition: 'transform 160ms ease' }} />
            {refreshing ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>

        {/* KPI Row */}
        <KpiRow
          totalFiles={data.index.totalFiles}
          totalSizeGb={data.index.totalSizeGb}
          totalValidatedGb={data.dedup?.totalValidatedGb ?? 0}
          validatedPairs={data.dedup?.validatedPairs?.length ?? 0}
          batchesReady={data.batches.ready}
          batchTotalGb={data.batches.totalGb ?? 0}
          clawbotFreeGb={data.nas.clawbotFreeGb}
          pictureCloudFreeGb={data.nas.pictureCloudFreeGb}
        />

        {/* Migration Pipeline */}
        <MigrationPipeline phases={pipelinePhases} />

        {/* Two-column layout: People + Content */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 380px', gap: '12px' }}>
          {/* Per-Person Dashboard */}
          <PersonDashboard
            people={PEOPLE}
            sourceBreakdown={data.index.sourceBreakdown}
            perSourceContent={data.index.perSourceContent}
          />

          {/* Content Explorer */}
          <ContentExplorer
            contentBreakdown={data.index.contentBreakdown}
            perSourceContent={data.index.perSourceContent}
          />
        </div>

        {/* Operations Panel */}
        <OperationsPanel
          batches={data.batches.batches ?? []}
          batchTotalFiles={data.batches.totalFiles ?? 0}
          batchTotalGb={data.batches.totalGb ?? 0}
          clawbotFreeGb={data.nas.clawbotFreeGb}
          pictureCloudFreeGb={data.nas.pictureCloudFreeGb}
          clawbotMounted={data.nas.clawbotMounted}
          pictureCloudMounted={data.nas.pictureCloudMounted}
          extractionDone={data.pipeline.extractionDone}
        />
      </div>
    </div>
  )
}
