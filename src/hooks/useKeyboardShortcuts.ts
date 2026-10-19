import { useEffect } from 'react'
import { shouldIgnoreShortcut } from '../utils/shortcutGuard.ts'
import { matchesKeyboardShortcut, SHORTCUT_DEFINITIONS, type KeyboardShortcutBindings, type ShortcutAction } from '../utils/keyboardShortcuts.ts'

export interface KeyboardShortcutHandlers {
  shortcuts: KeyboardShortcutBindings
  onTogglePlay: () => void
  onPrevious: () => void
  onNext: () => void
  onSeekBackward?: () => void
  onSeekForward?: () => void
  onVolumeUp?: () => void
  onVolumeDown?: () => void
  onToggleMute?: () => void
  onToggleShuffle?: () => void
  onCycleRepeat?: () => void
}

export function useKeyboardShortcuts({
  onTogglePlay,
  onPrevious,
  onNext,
  onSeekBackward,
  onSeekForward,
  onVolumeUp,
  onVolumeDown,
  onToggleMute,
  onToggleShuffle,
  onCycleRepeat,
  shortcuts,
}: KeyboardShortcutHandlers) {
  useEffect(() => {
    const handlers: Record<ShortcutAction, (() => void) | undefined> = {
      togglePlay: onTogglePlay, previous: onPrevious, next: onNext,
      seekBackward: onSeekBackward, seekForward: onSeekForward,
      volumeUp: onVolumeUp, volumeDown: onVolumeDown, toggleMute: onToggleMute,
      toggleShuffle: onToggleShuffle, cycleRepeat: onCycleRepeat,
    }
    function handleKeyDown(event: KeyboardEvent) {
      const matched = SHORTCUT_DEFINITIONS.find(({ id }) => matchesKeyboardShortcut(event, shortcuts[id]))
      if (!matched || shouldIgnoreShortcut(event, { allowModifiers: true })) return
      const handler = handlers[matched.id]
      if (!handler) return
      event.preventDefault()
      handler()
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [
    shortcuts,
    onTogglePlay,
    onPrevious,
    onNext,
    onSeekBackward,
    onSeekForward,
    onVolumeUp,
    onVolumeDown,
    onToggleMute,
    onToggleShuffle,
    onCycleRepeat,
  ])
}
