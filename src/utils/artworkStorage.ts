import { BaseDirectory, exists, mkdir, readFile, stat, writeFile } from '@tauri-apps/plugin-fs'
import { invoke } from '@tauri-apps/api/core'
import { appDataDir, join } from '@tauri-apps/api/path'
import { isDesktopApp, toNativeAssetUrl } from './platform.ts'
import type { Track } from '../types.ts'
import {
  artworkIndexMatches,
  parseArtworkIndex,
  serializeArtworkIndex,
  type ArtworkIndexEntry,
} from './artworkIndex.ts'

// A cache miss never prevents artwork from importing. The on-disk index is optional
// and may be discarded/rebuilt without touching existing user-selected artwork.
let artworkIndexPromise: Promise<Map<string, ArtworkIndexEntry>> | null = null
let artworkIndexTimer: ReturnType<typeof setTimeout> | null = null
let artworkIndexDirty = false
let artworkIndexWriteTail: Promise<void> = Promise.resolve()
const artworkInFlight = new Map<string, Promise<string | null>>()

async function loadArtworkIndex(): Promise<Map<string, ArtworkIndexEntry>> {
  if (!artworkIndexPromise) {
    artworkIndexPromise = (async () => {
      try {
        const result = await invoke<{ json: string | null }>('load_appdata_snapshot', { kind: 'artwork' })
        return parseArtworkIndex(result.json)
      } catch (error) {
        console.warn('Rebuilding optional artwork cache:', error)
        return new Map<string, ArtworkIndexEntry>()
      }
    })()
  }
  return artworkIndexPromise
}

function scheduleArtworkIndexSave(): void {
  artworkIndexDirty = true
  if (artworkIndexTimer !== null) clearTimeout(artworkIndexTimer)
  artworkIndexTimer = setTimeout(() => {
    artworkIndexTimer = null
    void flushArtworkIndex()
  }, 300)
}

/** Flushes a batch once, rather than serializing a manifest for every cover. */
export async function flushArtworkIndex(): Promise<void> {
  if (!isDesktopApp()) return
  if (artworkIndexTimer !== null) {
    clearTimeout(artworkIndexTimer)
    artworkIndexTimer = null
  }
  if (!artworkIndexDirty) {
    await artworkIndexWriteTail.catch(() => {})
    return
  }
  artworkIndexDirty = false
  const json = serializeArtworkIndex(await loadArtworkIndex())
  const write = artworkIndexWriteTail.catch(() => {}).then(() =>
    invoke<void>('save_appdata_snapshot', { kind: 'artwork', json }),
  )
  artworkIndexWriteTail = write
  try {
    await write
  } catch (error) {
    artworkIndexDirty = true
    console.warn('Could not save optional artwork index; future scans will rebuild it:', error)
  }
}

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


/**
 * Copy artwork selected from an arbitrary user folder into AppData.
 *
 * Tauri's asset protocol is intentionally scoped to AppData, so external image paths
 * cannot be used directly as <img src> URLs. A content fingerprint also gives changed
 * artwork a new URL, avoiding stale WebView image-cache entries after a rescan.
 */
async function saveFolderArtworkOnce(sourcePath: string): Promise<string | null> {
  try {
    const index = await loadArtworkIndex()
    // Only trust the index when both the file size and modification time match.
    // If stat permission is unavailable, fall back to fingerprinting the bytes.
    const info = await stat(sourcePath).catch(() => null)
    const modifiedMs = info?.mtime instanceof Date ? info.mtime.getTime() : undefined
    const previous = index.get(sourcePath)
    if (info && artworkIndexMatches(previous, info.size, modifiedMs) && previous) {
      const cached = await stat(previous.relativePath, { baseDir: BaseDirectory.AppData }).catch(() => null)
      if (cached?.isFile && cached.size === info.size) {
        return join(await appDataDir(), ...previous.relativePath.split('/'))
      }
    }

    if (info && (info.size === 0 || info.size > 25 * 1024 * 1024)) {
      console.warn('Skipping empty or oversized cover:', sourcePath)
      return null
    }
    const bytes = await readFile(sourcePath)
    if (bytes.length === 0 || bytes.length > 25 * 1024 * 1024) {
      console.warn('Skipping artwork that is empty or larger than 25 MiB:', sourcePath)
      return null
    }

    let hash = 2166136261
    for (const byte of bytes) hash = Math.imul(hash ^ byte, 16777619)
    const fingerprint = (hash >>> 0).toString(16)
    const extension = sourcePath.match(/\.([a-z0-9]{2,5})$/i)?.[1]?.toLowerCase()
    const allowedExtensions = new Set(['jpg', 'jpeg', 'png', 'webp', 'avif', 'bmp', 'gif', 'svg'])
    const ext = extension && allowedExtensions.has(extension) ? extension : 'img'
    const fileName = `folder_${sanitizeArtworkFilename(sourcePath)}_${fingerprint}.${ext}`
    const relativePath = `artwork/${fileName}`

    // A previous interrupted copy may exist but be incomplete. Size-check it
    // before reusing its deterministic, content-fingerprinted destination.
    const copied = await stat(relativePath, { baseDir: BaseDirectory.AppData }).catch(() => null)
    if (!copied?.isFile || copied.size !== bytes.length) {
      await mkdir('artwork', { baseDir: BaseDirectory.AppData, recursive: true })
      await writeFile(relativePath, bytes, { baseDir: BaseDirectory.AppData })
    }

    // Only persist reliable filesystem metadata. Without an mtime, a subsequent
    // scan safely re-hashes the file rather than returning stale cover artwork.
    if (info && Number.isFinite(modifiedMs)) {
      index.set(sourcePath, { size: info.size, modifiedMs: modifiedMs!, relativePath })
      scheduleArtworkIndexSave()
    }
    return join(await appDataDir(), 'artwork', fileName)
  } catch (error) {
    console.warn('Failed to cache cover-folder artwork:', sourcePath, error)
    return null
  }
}

export async function saveFolderArtwork(sourcePath: string): Promise<string | null> {
  if (!isDesktopApp()) return null
  // Rescans and manual imports can overlap. Deduplicate identical in-flight copies.
  const existing = artworkInFlight.get(sourcePath)
  if (existing) return existing
  const task = saveFolderArtworkOnce(sourcePath)
  artworkInFlight.set(sourcePath, task)
  try {
    return await task
  } finally {
    artworkInFlight.delete(sourcePath)
  }
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
