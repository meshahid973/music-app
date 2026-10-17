import { BaseDirectory, exists, mkdir, readDir, readFile, remove, stat, writeFile } from '@tauri-apps/plugin-fs'
import { appDataDir, join } from '@tauri-apps/api/path'
import { isDesktopApp, toNativeAssetUrl } from './platform.ts'
import type { Track } from '../types.ts'

export function sanitizeArtworkFilename(name: string): string {
  const base = name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 32)
  let hash = 5381
  for (let i = 0; i < name.length; i++) {
    hash = ((hash << 5) + hash) ^ name.charCodeAt(i)
  }
  return `${base || 'art'}_${(hash >>> 0).toString(16)}`
}

export function extensionForMime(mime?: string): string {
  if (!mime) return 'jpg'
  if (/png/i.test(mime)) return 'png'
  if (/webp/i.test(mime)) return 'webp'
  if (/gif/i.test(mime)) return 'gif'
  return 'jpg'
}

/**
 * Save raw image bytes to the AppData artwork directory durably.
 * Returns the durable absolute filePath, or null.
 */
export async function saveEmbeddedArtwork(
  trackId: string,
  imageBytes: Uint8Array,
  mime?: string,
): Promise<string | null> {
  if (!isDesktopApp()) return null

  try {
    const artworkDirExists = await exists('artwork', { baseDir: BaseDirectory.AppData })
    if (!artworkDirExists) {
      await mkdir('artwork', { baseDir: BaseDirectory.AppData, recursive: true })
    }

    const ext = extensionForMime(mime)
    const fileName = `${sanitizeArtworkFilename(trackId)}.${ext}`
    const relativePath = `artwork/${fileName}`
    await writeFile(relativePath, imageBytes, { baseDir: BaseDirectory.AppData })

    const appData = await appDataDir()
    return await join(appData, 'artwork', fileName)
  } catch (err) {
    console.warn('Failed to save embedded artwork to disk:', err)
    return null
  }
}


/** Cheap identity for an image file: changes whenever its size or modified time changes. */
export function statFingerprint(size: number, modifiedMs: number): string {
  let hash = 5381
  for (const char of `${size}:${modifiedMs}`) hash = ((hash << 5) + hash + char.charCodeAt(0)) | 0
  return (hash >>> 0).toString(16)
}

/**
 * Copy artwork selected from an arbitrary user folder into AppData.
 *
 * Tauri's asset protocol is intentionally scoped to AppData, so external image paths
 * cannot be used directly as <img src> URLs. The copy is named after the source file's size
 * and modified time, so unchanged covers are recognised without re-reading or re-writing them
 * on every rescan, while a changed image still gets a new URL (no stale WebView cache).
 * Filesystems that report no modified time fall back to fingerprinting the file's content.
 */
export async function saveFolderArtwork(sourcePath: string): Promise<string | null> {
  if (!isDesktopApp()) return null

  try {
    const info = await stat(sourcePath)
    if (info.size === 0 || info.size > 25 * 1024 * 1024) {
      console.warn('Skipping artwork that is empty or larger than 25 MiB:', sourcePath)
      return null
    }

    const extension = sourcePath.match(/\.([a-z0-9]{2,5})$/i)?.[1]?.toLowerCase()
    const allowedExtensions = new Set(['jpg', 'jpeg', 'png', 'webp', 'avif', 'bmp', 'gif', 'svg'])
    const ext = extension && allowedExtensions.has(extension) ? extension : 'img'
    const modifiedMs = info.mtime ? info.mtime.getTime() : 0

    let bytes: Uint8Array | null = null
    let fingerprint: string
    if (modifiedMs > 0) {
      fingerprint = statFingerprint(info.size, modifiedMs)
    } else {
      bytes = await readFile(sourcePath)
      let hash = 2166136261
      for (const byte of bytes) {
        hash = Math.imul(hash ^ byte, 16777619)
      }
      fingerprint = (hash >>> 0).toString(16)
    }

    const fileName = `folder_${sanitizeArtworkFilename(sourcePath)}_${fingerprint}.${ext}`
    const relativePath = `artwork/${fileName}`
    const appData = await appDataDir()
    const durablePath = await join(appData, 'artwork', fileName)

    if (await exists(relativePath, { baseDir: BaseDirectory.AppData })) return durablePath

    const artworkDirExists = await exists('artwork', { baseDir: BaseDirectory.AppData })
    if (!artworkDirExists) {
      await mkdir('artwork', { baseDir: BaseDirectory.AppData, recursive: true })
    }

    await writeFile(relativePath, bytes ?? (await readFile(sourcePath)), { baseDir: BaseDirectory.AppData })
    return durablePath
  } catch (err) {
    console.warn('Failed to copy cover-folder artwork into AppData:', sourcePath, err)
    return null
  }
}

function fileNameOf(pathOrUrl: string): string {
  const withoutQuery = pathOrUrl.split(/[?#]/)[0]
  let decoded = withoutQuery
  try {
    decoded = decodeURIComponent(withoutQuery)
  } catch {
    // keep the raw text
  }
  return (decoded.split(/[\\/]/).pop() ?? '').toLowerCase()
}

/** Lower-cased file names of all artwork the library still points at (paths or asset URLs). */
export function referencedArtworkNames(
  tracks: Pick<Track, 'coverPath' | 'coverUrl'>[],
  extraPaths: Iterable<string> = [],
): Set<string> {
  const names = new Set<string>()
  const add = (value?: string) => {
    if (!value || value.startsWith('blob:') || value.startsWith('data:')) return
    const name = fileNameOf(value)
    if (name) names.add(name)
  }
  for (const track of tracks) {
    add(track.coverPath)
    add(track.coverUrl)
  }
  for (const path of extraPaths) add(path)
  return names
}

export interface ArtworkPruneDeps {
  listFiles(): Promise<string[]>
  modifiedAt(fileName: string): Promise<number | null>
  remove(fileName: string): Promise<void>
}

const ORPHAN_MIN_AGE_MS = 30 * 24 * 60 * 60 * 1000

const nativeArtworkDeps: ArtworkPruneDeps = {
  async listFiles() {
    const entries = await readDir('artwork', { baseDir: BaseDirectory.AppData })
    return entries.filter((entry) => entry.isFile).map((entry) => entry.name)
  },
  async modifiedAt(fileName) {
    const info = await stat(`artwork/${fileName}`, { baseDir: BaseDirectory.AppData })
    return info.mtime ? info.mtime.getTime() : null
  },
  remove: (fileName) => remove(`artwork/${fileName}`, { baseDir: BaseDirectory.AppData }),
}

/**
 * Deletes cached artwork nothing references any more (covers of removed tracks, replaced
 * images, old copies). Deliberately conservative: a file is only removed when it is not
 * referenced AND has not been touched for 30 days, so artwork created or refreshed
 * recently is never at risk. Returns how many files were removed.
 */
export async function pruneOrphanArtwork(
  referencedNames: Set<string>,
  deps: ArtworkPruneDeps = nativeArtworkDeps,
  now: number = Date.now(),
  minAgeMs: number = ORPHAN_MIN_AGE_MS,
): Promise<number> {
  let removed = 0
  let files: string[]
  try {
    files = await deps.listFiles()
  } catch {
    return 0 // no artwork folder yet
  }
  for (const fileName of files) {
    if (referencedNames.has(fileName.toLowerCase())) continue
    try {
      const modified = await deps.modifiedAt(fileName)
      if (modified === null || now - modified < minAgeMs) continue
      await deps.remove(fileName)
      removed += 1
    } catch (err) {
      console.warn('Could not clean up cached artwork:', fileName, err)
    }
  }
  return removed
}

/**
 * Save custom artwork to the AppData artwork directory or retain local file path.
 */
export async function saveCustomArtwork(
  trackId: string,
  source: string,
): Promise<string | null> {
  if (!isDesktopApp()) return null

  // Native paths outside AppData are durable on disk but cannot be loaded by the
  // WebView's restricted asset protocol. Copy them into AppData just like folder covers.
  if (!source.startsWith('data:') && !source.startsWith('blob:')) {
    return saveFolderArtwork(source)
  }

  // If a data: URL, convert to bytes and save to disk
  if (source.startsWith('data:')) {
    try {
      const match = source.match(/^data:([^;]+);base64,(.+)$/)
      if (!match) return null

      const mime = match[1]
      const base64 = match[2]
      const binaryString = atob(base64)
      const bytes = new Uint8Array(binaryString.length)
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i)
      }

      const artworkDirExists = await exists('artwork', { baseDir: BaseDirectory.AppData })
      if (!artworkDirExists) {
        await mkdir('artwork', { baseDir: BaseDirectory.AppData, recursive: true })
      }

      const ext = extensionForMime(mime)
      const fileName = `custom_${sanitizeArtworkFilename(trackId)}.${ext}`
      const relativePath = `artwork/${fileName}`
      await writeFile(relativePath, bytes, { baseDir: BaseDirectory.AppData })

      const appData = await appDataDir()
      return await join(appData, 'artwork', fileName)
    } catch (err) {
      console.warn('Failed to save custom artwork data URL to disk:', err)
      return null
    }
  }

  // If a blob: URL, fetch bytes and save to disk
  if (source.startsWith('blob:')) {
    try {
      const response = await fetch(source)
      const blob = await response.blob()
      const arrayBuffer = await blob.arrayBuffer()
      const bytes = new Uint8Array(arrayBuffer)

      const artworkDirExists = await exists('artwork', { baseDir: BaseDirectory.AppData })
      if (!artworkDirExists) {
        await mkdir('artwork', { baseDir: BaseDirectory.AppData, recursive: true })
      }

      const ext = extensionForMime(blob.type)
      const fileName = `custom_${sanitizeArtworkFilename(trackId)}.${ext}`
      const relativePath = `artwork/${fileName}`
      await writeFile(relativePath, bytes, { baseDir: BaseDirectory.AppData })

      const appData = await appDataDir()
      return await join(appData, 'artwork', fileName)
    } catch (err) {
      console.warn('Failed to save custom artwork blob to disk:', err)
      return null
    }
  }

  return null
}

/**
 * Strips temporary in-memory URLs from tracks before saving to storage.
 * Preserves durable file path references and any explicitly selected custom artwork location.
 */
export function sanitizeTrackForPersistence(track: Track): Track {
  const isTemporaryUrl = (value?: string) =>
    Boolean(value && (value.startsWith('blob:') || value.startsWith('data:')))

  const nextAudioUrl = isTemporaryUrl(track.audioUrl) ? undefined : track.audioUrl
  const nextCoverUrl = isTemporaryUrl(track.coverUrl) ? undefined : track.coverUrl

  return {
    ...track,
    audioUrl: nextAudioUrl,
    coverUrl: nextCoverUrl,
  }
}

export function sanitizeTracksForPersistence(tracks: Track[]): Track[] {
  return tracks.map(sanitizeTrackForPersistence)
}

/**
 * Hydrates artwork on track load:
 * Rebuilds durable URLs from file paths and removes transient blob/data URLs.
 */
export function hydrateTrackArtwork(track: Track): Track {
  let coverUrl = track.coverUrl
  let audioUrl = track.audioUrl

  if (coverUrl && (coverUrl.startsWith('blob:') || coverUrl.startsWith('data:'))) {
    coverUrl = undefined
  }

  if (audioUrl && (audioUrl.startsWith('blob:') || audioUrl.startsWith('data:'))) {
    audioUrl = undefined
  }

  if (track.coverPath) {
    coverUrl = toNativeAssetUrl(track.coverPath)
  }

  if (track.filePath) {
    audioUrl = toNativeAssetUrl(track.filePath)
  }

  return {
    ...track,
    audioUrl,
    coverUrl,
  }
}

export function hydrateTracksArtwork(tracks: Track[]): Track[] {
  return tracks.map(hydrateTrackArtwork)
}
