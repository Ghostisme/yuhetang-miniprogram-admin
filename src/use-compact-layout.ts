import {useEffect, useState} from 'react'

/** Keep interaction breakpoints in sync with admin-responsive.css. */
export function useCompactLayout(query = '(max-width: 1023px)') {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const media = window.matchMedia(query)
    const update = () => setMatches(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [query])
  return matches
}
