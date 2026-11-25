import { useEffect, useState } from 'react'

/** Live clock for the masthead, mirroring the legacy UI's "• 3:28:38 PM". */
export function Clock() {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])

  return (
    <span>
      •{' '}
      {now.toLocaleTimeString([], {
        hour: 'numeric',
        minute: '2-digit',
        second: '2-digit',
      })}
    </span>
  )
}
