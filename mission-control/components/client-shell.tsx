'use client'

import dynamic from 'next/dynamic'
import { useState, useEffect } from 'react'

const TurboChat = dynamic(() => import('./turbo-chat'), { ssr: false })

export default function ClientShell({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    const timer = setTimeout(() => setReady(true), 3000)
    return () => clearTimeout(timer)
  }, [])

  return (
    <>
      {children}
      {ready && <TurboChat />}
    </>
  )
}
