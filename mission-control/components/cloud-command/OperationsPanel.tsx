'use client'

import { HardDrive, Package, AlertTriangle, CheckCircle2, Clock } from 'lucide-react'

type Batch = {
  name: string
  files: number
  sizeGb: number
  executed: boolean
}

type Props = {
  batches: Batch[]
  batchTotalFiles: number
  batchTotalGb: number
  clawbotFreeGb: number | null
  pictureCloudFreeGb: number | null
  clawbotMounted: boolean
  pictureCloudMounted: boolean
  extractionDone: boolean
}

function fmtGb(gb: number | null): string {
  if (gb === null) return '--'
  if (gb >= 1024) return `${(gb / 1024).toFixed(1)} TB`
  return `${gb >= 100 ? gb.toFixed(0) : gb.toFixed(1)} GB`
}

export default function OperationsPanel({
  batches, batchTotalFiles, batchTotalGb,
  clawbotFreeGb, pictureCloudFreeGb,
  clawbotMounted, pictureCloudMounted, extractionDone,
}: Props) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
      {/* Disk Space */}
      <div style={{ background: '#111318', borderRadius: '10px', padding: '16px', borderLeft: '3px solid #a78bfa' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
          <HardDrive size={14} color="#a78bfa" />
          <span style={{ fontSize: '11px', fontWeight: 700, color: '#E5E7EE', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            Storage Volumes
          </span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', background: '#0d1117', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)' }}>
            <div>
              <div style={{ fontSize: '12px', fontWeight: 600, color: '#E5E7EE' }}>ClawBotLoot</div>
              <div style={{ fontSize: '10px', color: '#6b7280' }}>
                {clawbotMounted ? 'Mounted' : 'Not mounted'}
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              {clawbotMounted
                ? <CheckCircle2 size={12} color="#34d399" />
                : <AlertTriangle size={12} color="#fb7185" />
              }
              <span style={{ fontSize: '16px', fontWeight: 700, color: clawbotMounted ? '#34d399' : '#fb7185' }}>
                {fmtGb(clawbotFreeGb)}
              </span>
              <span style={{ fontSize: '10px', color: '#6b7280' }}>free</span>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', background: '#0d1117', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)' }}>
            <div>
              <div style={{ fontSize: '12px', fontWeight: 600, color: '#E5E7EE' }}>Picture Cloud Sync</div>
              <div style={{ fontSize: '10px', color: '#6b7280' }}>
                {pictureCloudMounted ? 'Mounted' : 'Not mounted'}
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              {pictureCloudMounted
                ? <CheckCircle2 size={12} color="#34d399" />
                : <AlertTriangle size={12} color="#fb7185" />
              }
              <span style={{ fontSize: '16px', fontWeight: 700, color: pictureCloudMounted ? '#34d399' : '#fb7185' }}>
                {fmtGb(pictureCloudFreeGb)}
              </span>
              <span style={{ fontSize: '10px', color: '#6b7280' }}>free</span>
            </div>
          </div>
        </div>
      </div>

      {/* Deletion Batches */}
      <div style={{ background: '#111318', borderRadius: '10px', padding: '16px', borderLeft: '3px solid #f59e0b' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
          <Package size={14} color="#f59e0b" />
          <span style={{ fontSize: '11px', fontWeight: 700, color: '#E5E7EE', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            Deletion Batches
          </span>
        </div>

        {!extractionDone && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: '8px',
            padding: '8px 12px', marginBottom: '10px',
            background: 'rgba(251,113,133,0.08)', border: '1px solid rgba(251,113,133,0.2)',
            borderRadius: '6px', fontSize: '10px', color: '#fb7185',
          }}>
            <Clock size={12} />
            Deletion blocked — Erin C extraction still in progress
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {batches.map(batch => (
            <div key={batch.name} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '8px 12px', background: '#0d1117', borderRadius: '6px',
              border: '1px solid rgba(255,255,255,0.05)',
            }}>
              <div>
                <div style={{ fontSize: '11px', fontWeight: 600, color: '#E5E7EE' }}>{batch.name}</div>
                <div style={{ fontSize: '10px', color: '#6b7280' }}>{batch.files.toLocaleString()} files</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ fontSize: '12px', fontWeight: 600, color: batch.executed ? '#34d399' : '#f59e0b' }}>
                  {fmtGb(batch.sizeGb)}
                </span>
                <span style={{
                  fontSize: '9px', fontWeight: 600,
                  padding: '3px 6px', borderRadius: '999px',
                  background: batch.executed ? 'rgba(52,211,153,0.1)' : 'rgba(245,158,11,0.1)',
                  color: batch.executed ? '#34d399' : '#f59e0b',
                  textTransform: 'uppercase', letterSpacing: '0.05em',
                }}>
                  {batch.executed ? 'Done' : 'Ready'}
                </span>
              </div>
            </div>
          ))}
        </div>

        {batches.length > 0 && (
          <div style={{ marginTop: '10px', padding: '8px 12px', background: 'rgba(255,255,255,0.02)', borderRadius: '6px', display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '10px', color: '#6b7280' }}>Total recoverable</span>
            <span style={{ fontSize: '12px', fontWeight: 700, color: '#f59e0b' }}>{fmtGb(batchTotalGb)} / {batchTotalFiles.toLocaleString()} files</span>
          </div>
        )}
      </div>
    </div>
  )
}
