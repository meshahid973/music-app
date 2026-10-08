import { useEffect, useState } from 'react'
import { getAverageColor, hslToRgb } from '../utils/library'

export interface CoverTheme {
  background: string
  heroBg: string
  heroBgDeep: string
  borderColor: string
  shadowColor: string
  isLight: boolean
}

const DEFAULT_THEME: CoverTheme = {
  background: 'var(--panel)',
  heroBg: '#151716',
  heroBgDeep: '#0d0f0e',
  borderColor: 'var(--line)',
  shadowColor: 'rgba(0, 0, 0, 0.5)',
  isLight: false,
}

export function useHeroTheme(coverUrl?: string, accent?: string): CoverTheme {
  const [coverColor, setCoverColor] = useState<CoverTheme | null>(null)

  useEffect(() => {
    let cancelled = false

    if (coverUrl) {
      getAverageColor(coverUrl).then(({ r, g, b }) => {
        if (cancelled) return
        const avgColor = `rgb(${r}, ${g}, ${b})`
        const deepR = Math.max(0, Math.round(r * 0.45))
        const deepG = Math.max(0, Math.round(g * 0.45))
        const deepB = Math.max(0, Math.round(b * 0.45))
        const deepColor = `rgb(${deepR}, ${deepG}, ${deepB})`
        const isLight = 0.299 * r + 0.587 * g + 0.114 * b > 165
        setCoverColor({
          background: `linear-gradient(135deg, ${avgColor} 0%, ${deepColor} 100%)`,
          heroBg: avgColor,
          heroBgDeep: deepColor,
          borderColor: `rgba(${r}, ${g}, ${b}, 0.45)`,
          shadowColor: `rgba(${r}, ${g}, ${b}, 0.3)`,
          isLight,
        })
      })
    } else {
      const timer = setTimeout(() => {
        if (cancelled) return
        if (accent) {
          const { r, g, b } = hslToRgb(accent)
          const avgColor = `rgb(${r}, ${g}, ${b})`
          const deepR = Math.max(0, Math.round(r * 0.4))
          const deepG = Math.max(0, Math.round(g * 0.4))
          const deepB = Math.max(0, Math.round(b * 0.4))
          const deepColor = `rgb(${deepR}, ${deepG}, ${deepB})`
          const isLight = 0.299 * r + 0.587 * g + 0.114 * b > 165
          setCoverColor({
            background: `linear-gradient(135deg, ${avgColor} 0%, ${deepColor} 100%)`,
            heroBg: avgColor,
            heroBgDeep: deepColor,
            borderColor: `rgba(${r}, ${g}, ${b}, 0.4)`,
            shadowColor: `rgba(${r}, ${g}, ${b}, 0.25)`,
            isLight,
          })
        } else {
          setCoverColor(null)
        }
      }, 0)
      return () => {
        cancelled = true
        clearTimeout(timer)
      }
    }

    return () => {
      cancelled = true
    }
  }, [coverUrl, accent])

  return coverColor ?? DEFAULT_THEME
}
