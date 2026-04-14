import type { Metadata } from 'next'
import './globals.css'
import Sidebar from '@/components/sidebar'
import ClientShell from '@/components/client-shell'
import { Manrope, Syne } from 'next/font/google'

const manrope = Manrope({
  subsets: ['latin'],
  variable: '--font-body',
  display: 'swap',
})

const syne = Syne({
  subsets: ['latin'],
  variable: '--font-display',
  weight: ['400', '600', '700', '800'],
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Mission Control | turbodot',
  description: "turbodot's personal mission control dashboard"
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${manrope.variable} ${syne.variable}`}>
      <body>
        <ClientShell>
          <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
            <Sidebar />
            <main style={{ flex: 1, minWidth: 0, overflow: 'auto', display: 'flex', flexDirection: 'column', transition: 'width 0.2s ease' }}>
              {children}
            </main>
          </div>
        </ClientShell>
      </body>
    </html>
  )
}
