'use client'

import { useEffect, useRef } from 'react'

/**
 * Like setInterval, but pauses when the browser tab is hidden and
 * resumes (with an immediate fire) when it becomes visible again.
 */
export function useVisibilityInterval(callback: () => void, intervalMs: number) {
  const savedCallback = useRef(callback)
  savedCallback.current = callback

  useEffect(() => {
    let id: ReturnType<typeof setInterval> | null = null

    function start() {
      stop()
      id = setInterval(() => savedCallback.current(), intervalMs)
    }

    function stop() {
      if (id !== null) { clearInterval(id); id = null }
    }

    function onVisibilityChange() {
      if (document.hidden) {
        stop()
      } else {
        savedCallback.current() // fire immediately — data is stale
        start()
      }
    }

    // Initial start (only if tab is currently visible)
    if (!document.hidden) start()

    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [intervalMs])
}
