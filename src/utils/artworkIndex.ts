/** Durable hints for folder artwork. The cache is optional; invalid entries are ignored. */
export type ArtworkIndexEntry = {
  size: number
  modifiedMs: number
  relativePath: string
}

const CACHED_ARTWORK_PATH = /^artwork\/folder_[a-zA-Z0-9_-]+_[0-9a-f]+\.(?:jpg|jpeg|png|webp|avif|bmp|gif|svg|img)$/

export function validArtworkIndexEntry(value: unknown): value is ArtworkIndexEntry {
  if (!value || typeof value !== 'object') return false
  const entry = value as Partial<ArtworkIndexEntry>
  return Number.isSafeInteger(entry.size) && entry.size! > 0 &&
    Number.isFinite(entry.modifiedMs) &&
    typeof entry.relativePath === 'string' &&
    CACHED_ARTWORK_PATH.test(entry.relativePath)
}

export function parseArtworkIndex(json: string | null): Map<string, ArtworkIndexEntry> {
  if (!json) return new Map()
  try {
    const parsed: unknown = JSON.parse(json)
    if (!parsed || typeof parsed !== 'object') return new Map()
    const snapshot = parsed as { version?: unknown; entries?: unknown }
    if (snapshot.version !== 1 || !snapshot.entries || typeof snapshot.entries !== 'object' ||
        Array.isArray(snapshot.entries)) return new Map()
    const entries = new Map<string, ArtworkIndexEntry>()
    for (const [source, entry] of Object.entries(snapshot.entries)) {
      if (source && validArtworkIndexEntry(entry)) entries.set(source, entry)
    }
    return entries
  } catch {
    return new Map()
  }
}

export function artworkIndexMatches(
  entry: ArtworkIndexEntry | undefined,
  size: number,
  modifiedMs: number | undefined,
): boolean {
  return Boolean(entry && Number.isFinite(modifiedMs) &&
    entry.size === size && entry.modifiedMs === modifiedMs)
}

export function serializeArtworkIndex(entries: ReadonlyMap<string, ArtworkIndexEntry>): string {
  return JSON.stringify({ version: 1, entries: Object.fromEntries(entries) })
}
