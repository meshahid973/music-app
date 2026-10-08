import { BaseDirectory, exists, mkdir, readTextFile, writeTextFile } from '@tauri-apps/plugin-fs'
import { isDesktopApp, toNativeAssetUrl } from './platform'
import type { Playlist, RepeatMode, Track } from '../types'

export interface DesktopLibraryPayload {
  tracks: Track[]
  playlists: Playlist[]
  activePlaylistId: string
  currentTrackId?: string
  volume: number
  shuffle: boolean
  repeat: RepeatMode
}

const STORAGE_FILE = 'resonance_library.json'
const WEB_STORAGE_KEY = 'resonance_desktop_library_backup'

export async function saveDesktopLibrary(data: DesktopLibraryPayload): Promise<void> {
  if (isDesktopApp()) {
    try {
      const appDataExists = await exists('', { baseDir: BaseDirectory.AppData })
      if (!appDataExists) {
        await mkdir('', { baseDir: BaseDirectory.AppData, recursive: true })
      }
      const json = JSON.stringify(data, null, 2)
      await writeTextFile(STORAGE_FILE, json, { baseDir: BaseDirectory.AppData })
    } catch (err) {
      console.warn('Failed to save native library to AppData:', err)
    }
  } else {
    try {
      localStorage.setItem(WEB_STORAGE_KEY, JSON.stringify(data))
    } catch {
      // ignore
    }
  }
}

export async function loadDesktopLibrary(): Promise<DesktopLibraryPayload | null> {
  if (isDesktopApp()) {
    try {
      const fileExists = await exists(STORAGE_FILE, { baseDir: BaseDirectory.AppData })
      if (!fileExists) return null

      const content = await readTextFile(STORAGE_FILE, { baseDir: BaseDirectory.AppData })
      if (!content) return null

      const parsed: DesktopLibraryPayload = JSON.parse(content)
      // Re-hydrate native asset URLs for any saved tracks that have file paths
      const hydratedTracks = parsed.tracks.map((track) => {
        if (track.filePath) {
          return {
            ...track,
            audioUrl: toNativeAssetUrl(track.filePath),
            coverUrl: track.coverPath ? toNativeAssetUrl(track.coverPath) : track.coverUrl,
          }
        }
        return track
      })

      return {
        ...parsed,
        tracks: hydratedTracks,
      }
    } catch (err) {
      console.warn('Failed to load native library from AppData:', err)
      return null
    }
  } else {
    try {
      const raw = localStorage.getItem(WEB_STORAGE_KEY)
      if (raw) return JSON.parse(raw)
    } catch {
      // ignore
    }
    return null
  }
}
