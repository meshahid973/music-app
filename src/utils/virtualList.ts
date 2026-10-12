export type VirtualListRange = { start: number; end: number }

export function getVirtualListRange(
  itemCount: number,
  scrollOffset: number,
  viewportHeight: number,
  itemHeight = 86,
  overscan = 8,
): VirtualListRange {
  const count = Math.max(0, Math.floor(itemCount))
  const height = Math.max(1, itemHeight)
  const buffer = Math.max(0, Math.floor(overscan))
  const offset = Math.max(0, scrollOffset)
  const viewport = Math.max(0, viewportHeight)
  const start = Math.max(0, Math.floor(offset / height) - buffer)
  const end = Math.min(count, Math.ceil((offset + viewport) / height) + buffer)
  return { start: Math.min(start, count), end: Math.max(Math.min(end, count), Math.min(start, count)) }
}
