import { useEffect } from 'react'

export interface KeyboardShortcutHandlers {
  onTogglePlay: () => void
  onPrevious: () => void
  onNext: () => void
}

export function useKeyboardShortcuts({
  onTogglePlay,
  onPrevious,
  onNext,
}: KeyboardShortcutHandlers) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null
      const isInput =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)

      if (isInput) return

      if (event.code === 'Space') {
        event.preventDefault()
        onTogglePlay()
      } else if (event.key === 'MediaTrackPrevious') {
        event.preventDefault()
        onPrevious()
      } else if (event.key === 'MediaTrackNext') {
        event.preventDefault()
        onNext()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [onTogglePlay, onPrevious, onNext])
}
