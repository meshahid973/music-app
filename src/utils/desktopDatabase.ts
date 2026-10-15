import { invoke } from '@tauri-apps/api/core'
import { isDesktopApp } from './platform.ts'
import { createSerializedWriter } from './serializedWrites.ts'
import { hydrateTracksArtwork, sanitizeTracksForPersistence } from './artworkStorage.ts'
import type { Playlist, RepeatMode, ThemeMode, Track } from '../types.ts'

export interface DesktopLibraryPayload {
  version?: number
  tracks: Track[]
  playlists: Playlist[]
  activePlaylistId: string
  currentTrackId?: string
  volume: number
  shuffle: boolean
  repeat: RepeatMode
  themeMode?: ThemeMode
  musicFolderPath?: string
  coverFolderPath?: string
  musicFolderName?: string
  coverFolderName?: string
  firstRunSetupCompleted?: boolean
}

const WEB_STORAGE_KEY = 'resonance_desktop_library_backup'
const STORAGE_VERSION = 2

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

function normalizeNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function normalizeTracks(value: unknown): Track[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is Track => isObject(item) && typeof item.id === 'string')
}

function normalizePlaylists(value: unknown): Playlist[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is Playlist => {
    return isObject(item) && typeof item.id === 'string' && typeof item.name === 'string'
  })
}

function normalizeTheme(_value: unknown): ThemeMode {
  // Keep older saved libraries compatible while removing the Ambient Mode option.
  return 'normal'
}

function normalizeRepeat(value: unknown): RepeatMode {
  return value === 'one' || value === 'all' ? value : 'off'
}

export function migrateDesktopLibraryPayload(raw: unknown): DesktopLibraryPayload | null {
  if (!isObject(raw)) return null

  const tracks = normalizeTracks(raw.tracks)
  const playlists = normalizePlaylists(raw.playlists)
  const activePlaylistId = normalizeString(raw.activePlaylistId) ?? 'library'
  const currentTrackId = normalizeString(raw.currentTrackId)
  const volume = Math.min(1, Math.max(0, normalizeNumber(raw.volume, 0.82)))
  const shuffle = normalizeBoolean(raw.shuffle, false)
  const repeat = normalizeRepeat(raw.repeat)
  const themeMode = normalizeTheme(raw.themeMode)
  const firstRunSetupCompleted = normalizeBoolean(raw.firstRunSetupCompleted, tracks.length > 0)

  const payload: DesktopLibraryPayload = {
    version: STORAGE_VERSION,
    tracks: hydrateTracksArtwork(sanitizeTracksForPersistence(tracks)),
    playlists,
    activePlaylistId,
    currentTrackId,
    volume,
    shuffle,
    repeat,
    themeMode,
    musicFolderPath: normalizeString(raw.musicFolderPath),
    coverFolderPath: normalizeString(raw.coverFolderPath),
    musicFolderName: normalizeString(raw.musicFolderName),
    coverFolderName: normalizeString(raw.coverFolderName),
    firstRunSetupCompleted,
  }

  return payload
}

function safeReadJson(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

type SnapshotResult = { json: string | null; recovered: boolean }

// A failed native load must never be followed by an automatic empty-library save.
// Leave the user's original files in AppData for manual recovery.
let nativeWritesBlocked = false

/** Serialize disk writes, preserving call order and never running two at once. */
export const saveDesktopLibrary = createSerializedWriter(async (data: DesktopLibraryPayload): Promise<void> => {
  const payload: DesktopLibraryPayload = {
    ...data,
    version: STORAGE_VERSION,
    tracks: sanitizeTracksForPersistence(Array.isArray(data.tracks) ? data.tracks : []),
  }
  const json = JSON.stringify(payload)

  const persist = async () => {
    if (isDesktopApp()) {
      if (nativeWritesBlocked) {
        throw new Error('Library writes are disabled because the saved library needs recovery.')
      }
      await invoke<void>('save_appdata_snapshot', { kind: 'library', json })
      return
    }
    // Keep browser-only persistence behavior unchanged.
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(WEB_STORAGE_KEY, json)
      }
    } catch {
      // Browser private mode/storage quotas can disable localStorage.
    }
  }

  await persist()
})

export async function loadDesktopLibrary(): Promise<DesktopLibraryPayload | null> {
  if (isDesktopApp()) {
    try {
      const snapshot = await invoke<SnapshotResult>('load_appdata_snapshot', { kind: 'library' })
      if (snapshot.recovered) {
        console.warn('Resonance restored the library from its last good AppData backup.')
      }
      if (snapshot.json !== null) {
        const parsed = migrateDesktopLibraryPayload(safeReadJson(snapshot.json))
        if (!parsed) throw new Error('Stored library has an unsupported format')
        nativeWritesBlocked = false
        return parsed
      }
      nativeWritesBlocked = false
    } catch (error) {
      nativeWritesBlocked = true
      console.error('Library recovery required; refusing to overwrite existing AppData:', error)
      throw error
    }
  }

  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(WEB_STORAGE_KEY)
      if (raw) {
        const parsed = migrateDesktopLibraryPayload(safeReadJson(raw))
        if (parsed) return parsed
      }
    }
  } catch {
    // ignore
  }
  return null
}
