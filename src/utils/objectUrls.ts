import { trackIdForFile } from './trackIdentity.ts'

const cachedFileUrls = new Map<string, string>()
const ownedUrls = new Set<string>()

/** Reusing the same File's URL prevents duplicate artwork imports from leaking blobs. */
export function objectUrlForFile(file: File): string {
  const key = `${file.type}:${trackIdForFile(file)}`
  const existing = cachedFileUrls.get(key)
  if (existing) return existing
  const url = URL.createObjectURL(file)
  cachedFileUrls.set(key, url)
  ownedUrls.add(url)
  return url
}

/** Embedded artwork is a fresh Blob, not a re-imported file. */
export function objectUrlForBlob(blob: Blob): string {
  const url = URL.createObjectURL(blob)
  ownedUrls.add(url)
  return url
}

export function revokeOwnedObjectUrls(): void {
  for (const url of ownedUrls) URL.revokeObjectURL(url)
  ownedUrls.clear()
  cachedFileUrls.clear()
}
