export type ShortcutEventLike = {
  key: string
  code: string
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  defaultPrevented: boolean
  target: EventTarget | null
}

type ElementLike = {
  tagName?: string
  isContentEditable?: boolean
  closest?: (selector: string) => unknown
}

const FORM_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT'])

/**
 * True when a global player shortcut must NOT fire: typing in a field, browser/OS
 * combinations (Ctrl+R, Alt+Left, ...), keys another control already handled, dialogs and
 * menus, and Space on a focused button/link (where it means "activate"). Hardware media
 * keys always work.
 */
export function shouldIgnoreShortcut(event: ShortcutEventLike, options: { allowModifiers?: boolean } = {}): boolean {
  if (event.key.startsWith('Media')) return false
  const target = event.target as ElementLike | null
  if (target?.tagName && FORM_TAGS.has(target.tagName)) return true
  if (target?.isContentEditable) return true
  if (!options.allowModifiers && (event.ctrlKey || event.metaKey || event.altKey)) return true
  if (event.defaultPrevented) return true
  if (target?.closest?.('[data-shortcut-capture="true"]')) return true
  if (target?.closest?.('dialog, [role="dialog"], [role="menu"], [role="listbox"]')) return true
  if (event.code === 'Space' && target?.closest?.('button, a[href], [role="button"], [role="menuitem"]')) return true
  return false
}
