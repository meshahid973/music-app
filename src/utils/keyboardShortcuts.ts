export const SHORTCUT_DEFINITIONS = [
  { id: 'togglePlay', label: 'Play / Pause' },
  { id: 'previous', label: 'Previous Track' },
  { id: 'next', label: 'Next Track' },
  { id: 'seekBackward', label: 'Seek Backward 5s' },
  { id: 'seekForward', label: 'Seek Forward 5s' },
  { id: 'volumeUp', label: 'Volume Up' },
  { id: 'volumeDown', label: 'Volume Down' },
  { id: 'toggleMute', label: 'Toggle Mute' },
  { id: 'toggleShuffle', label: 'Toggle Shuffle' },
  { id: 'cycleRepeat', label: 'Cycle Repeat Mode' },
] as const

export type ShortcutAction = (typeof SHORTCUT_DEFINITIONS)[number]['id']
export type KeyboardShortcutBindings = Record<ShortcutAction, string>

export const DEFAULT_KEYBOARD_SHORTCUTS: KeyboardShortcutBindings = {
  togglePlay: 'Space',
  previous: 'MediaTrackPrevious',
  next: 'MediaTrackNext',
  seekBackward: 'ArrowLeft',
  seekForward: 'ArrowRight',
  volumeUp: 'ArrowUp',
  volumeDown: 'ArrowDown',
  toggleMute: 'KeyM',
  toggleShuffle: 'KeyS',
  cycleRepeat: 'KeyR',
}

const MODIFIERS = ['Ctrl', 'Alt', 'Shift', 'Meta'] as const
const MODIFIER_ALIASES: Record<string, (typeof MODIFIERS)[number]> = {
  ctrl: 'Ctrl', control: 'Ctrl', alt: 'Alt', shift: 'Shift',
  meta: 'Meta', cmd: 'Meta', command: 'Meta', super: 'Meta',
}
const KEY_CODES = new Set<string>([
  'Space', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown',
  'Minus', 'Equal', 'BracketLeft', 'BracketRight', 'Backslash',
  'Semicolon', 'Quote', 'Backquote', 'Comma', 'Period', 'Slash',
  'MediaTrackPrevious', 'MediaTrackNext',
  ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((letter) => `Key${letter}`),
  ...'0123456789'.split('').map((digit) => `Digit${digit}`),
  ...Array.from({ length: 12 }, (_, index) => `F${index + 1}`),
])
const RESERVED_SHORTCUTS = new Set([
  'Alt+F4',
  'Ctrl+KeyR', 'Ctrl+KeyW', 'Ctrl+KeyT', 'Ctrl+KeyN', 'Ctrl+KeyL',
  'Ctrl+KeyO', 'Ctrl+KeyP', 'Ctrl+KeyS', 'Ctrl+KeyF',
  'Ctrl+Shift+KeyI', 'Ctrl+Shift+KeyJ', 'Ctrl+Shift+KeyC', 'Ctrl+Shift+KeyK',
  'Meta+KeyQ', 'Meta+KeyW', 'Meta+KeyR', 'Meta+KeyT', 'Meta+KeyL',
])

export function normalizeShortcutBinding(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null
  const tokens = value.split('+').map((part) => part.trim()).filter(Boolean)
  if (!tokens.length) return null
  const modifiers = new Set<(typeof MODIFIERS)[number]>()
  let baseCode: string | null = null
  for (const token of tokens) {
    const modifier = MODIFIER_ALIASES[token.toLowerCase()]
    if (modifier) {
      if (modifiers.has(modifier)) return null
      modifiers.add(modifier)
    } else {
      if (baseCode !== null) return null
      baseCode = token
    }
  }
  if (!baseCode || !KEY_CODES.has(baseCode)) return null
  if ((baseCode === 'MediaTrackPrevious' || baseCode === 'MediaTrackNext') && modifiers.size) return null

  // Keep browser/window navigation and editing commands available. Modified shortcuts
  // remain customizable, but combinations reserved by the browser or operating system do not.
  const usesBrowserModifier = modifiers.has('Ctrl') || modifiers.has('Meta')
  if (modifiers.has('Alt') && ['ArrowLeft', 'ArrowRight', 'F4'].includes(baseCode)) return null
  if (
    usesBrowserModifier &&
    ['KeyA', 'KeyB', 'KeyC', 'KeyD', 'KeyE', 'KeyF', 'KeyG', 'KeyH', 'KeyI', 'KeyJ',
      'KeyK', 'KeyL', 'KeyN', 'KeyO', 'KeyP', 'KeyQ', 'KeyR', 'KeyS', 'KeyT', 'KeyU',
      'KeyV', 'KeyW', 'KeyX', 'KeyY', 'KeyZ'].includes(baseCode)
  ) return null

  const ordered = MODIFIERS.filter((modifier) => modifiers.has(modifier))
  const canonical = [...ordered, baseCode].join('+')
  return RESERVED_SHORTCUTS.has(canonical) ? null : canonical
}

export function normalizeShortcutEvent(
  event: Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey'>,
): string | null {
  if (event.key === 'Escape' || event.key === 'Tab') return null
  if (['Control', 'Alt', 'Shift', 'Meta'].includes(event.key)) return null
  const baseCode = event.key.startsWith('MediaTrack') ? event.key : event.code
  if (!baseCode) return null
  const parts = [
    ...(event.ctrlKey ? ['Ctrl'] : []),
    ...(event.altKey ? ['Alt'] : []),
    ...(event.shiftKey ? ['Shift'] : []),
    ...(event.metaKey ? ['Meta'] : []),
    baseCode,
  ]
  return normalizeShortcutBinding(parts.join('+'))
}

export function matchesKeyboardShortcut(
  event: Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey'>,
  binding: string,
): boolean {
  const candidate = normalizeShortcutEvent(event)
  const expected = normalizeShortcutBinding(binding)
  return candidate !== null && expected !== null && candidate === expected
}

export function formatShortcut(binding: string): string {
  const normalized = normalizeShortcutBinding(binding) ?? 'Unassigned'
  const parts = normalized.split('+')
  const baseCode = parts.pop() ?? ''
  const prettyBase: Record<string, string> = {
    Space: 'Space', ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓',
    MediaTrackPrevious: 'Media Previous', MediaTrackNext: 'Media Next',
    Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\',
    Semicolon: ';', Quote: "'", Backquote: '`', Comma: ',', Period: '.', Slash: '/',
  }
  const key = prettyBase[baseCode] ?? baseCode.replace(/^Key/, '').replace(/^Digit/, '')
  return [...parts, key].join('+')
}

export function sanitizeKeyboardShortcutBindings(value: unknown): KeyboardShortcutBindings {
  const source = typeof value === 'object' && value !== null ? value as Record<string, unknown> : {}
  const result = { ...DEFAULT_KEYBOARD_SHORTCUTS }
  for (const { id } of SHORTCUT_DEFINITIONS) {
    const candidate = normalizeShortcutBinding(source[id])
    if (candidate) result[id] = candidate
  }
  for (let pass = 0; pass < SHORTCUT_DEFINITIONS.length; pass += 1) {
    let changed = false
    for (const { id } of SHORTCUT_DEFINITIONS) {
      const conflicts = SHORTCUT_DEFINITIONS.filter((other) => other.id !== id && result[other.id] === result[id])
      if (conflicts.length) {
        for (const action of [id, ...conflicts.map((item) => item.id)]) {
          if (result[action] !== DEFAULT_KEYBOARD_SHORTCUTS[action]) {
            result[action] = DEFAULT_KEYBOARD_SHORTCUTS[action]
            changed = true
          }
        }
      }
    }
    if (!changed) break
  }
  return result
}
