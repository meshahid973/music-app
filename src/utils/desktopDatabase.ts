import { invoke } from '@tauri-apps/api/core'
import { isDesktopApp } from './platform.ts'
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

// Desktop snapshots go to native SQLite. Never overlap saves: an older snapshot
// finishing late must not overwrite a newer playlist or preference edit.
let saveChain: Promise<void> = Promise.resolve()
let migrationFailed = false

export function queueSqliteSave(
  json: string,
  write: (snapshot: string) => Promise<void> = (snapshot) =>
    invoke<void>('save_library_sqlite', { json: snapshot }),
): Promise<void> {
  const task = saveChain.catch(() => {}).then(() => {
    if (migrationFailed) throw new Error('Library recovery required; writes are disabled')
    return write(json)
  })
  saveChain = task
  return task
}

export async function saveDesktopLibrary(data: DesktopLibraryPayload): Promise<void> {
  const payload: DesktopLibraryPayload = {
    ...data,
    version: STORAGE_VERSION,
    tracks: sanitizeTracksForPersistence(Array.isArray(data.tracks) ? data.tracks : []),
  }

  // Compact JSON reduces CPU spent formatting large libraries and disk size.
  const json = JSON.stringify(payload)

  // Browser builds need a localStorage fallback. In the Windows desktop app,
  // keep the full library in AppData only: synchronous localStorage writes of a
  // large JSON library can block the WebView2 UI thread during frequent edits.
  if (!isDesktopApp()) {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(WEB_STORAGE_KEY, json)
      }
    } catch {
      // ignore
    }
  }

  if (isDesktopApp()) {
    await queueSqliteSave(json)
  }
}

export async function loadDesktopLibrary(): Promise<DesktopLibraryPayload | null> {
  if (isDesktopApp()) {
    try {
      // The native command migrates the old resonance_library.json once, in a
      // transaction. It never deletes the JSON (or its backup).
      const content = await invoke<string | null>('load_library_sqlite')
      migrationFailed = false
      if (content) {
        const parsed = migrateDesktopLibraryPayload(safeReadJson(content))
        if (!parsed) throw new Error('Stored SQLite library has an invalid payload')
        return parsed
      }
    } catch (error) {
      migrationFailed = true
      // A corrupt database/legacy JSON must not silently become an empty one.
      throw new Error('Could not load saved music library; original data is preserved', { cause: error })
    }
  }

  // Browser-only fallback is unchanged. Do not consult this when a native load
  // fails; that could hide a damaged on-disk library.
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(WEB_STORAGE_KEY)
      if (raw) {
        const parsed = migrateDesktopLibraryPayload(safeReadJson(raw))
        if (parsed) return parsed
      }
    }
  } catch {
    // Browser storage may be blocked by private mode.
  }
  return null
}
