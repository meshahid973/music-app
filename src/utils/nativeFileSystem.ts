import { readDir, readFile } from '@tauri-apps/plugin-fs'
import { toNativeAssetUrl } from './platform'
import { audioExtensions, coverExtensions, getExtension, readDuration } from './audioFiles'
import { colorFromString, normalizeName } from './covers'
import { autoDetectTrackMetadata, cleanMusicString } from './metadata'
import { cleanDisplayTitle } from './tracks'
import type { CoverLookup, Track } from '../types'

function joinPath(dir: string, file: string): string {
  if (dir.endsWith('/') || dir.endsWith('\\')) {
    return `${dir}${file}`
  }
  const separator = dir.includes('\\') ? '\\' : '/'
  return `${dir}${separator}${file}`
}

function getFileName(filePath: string): string {
  const parts = filePath.split(/[/\\]/)
  return parts[parts.length - 1] || filePath
}

function getParentDirName(filePath: string): string {
  const parts = filePath.split(/[/\\]/).filter(Boolean)
  return parts.length > 1 ? parts[parts.length - 2] : ''
}

export interface NativeScanResult {
  audioPaths: string[]
  coverPaths: string[]
}

export async function scanNativeFolder(folderPath: string): Promise<NativeScanResult> {
  const audioPaths: string[] = []
  const coverPaths: string[] = []

  async function traverse(currentPath: string, depth = 0) {
    if (depth > 8) return // Guard against excessive recursion
    try {
      const entries = await readDir(currentPath)
      for (const entry of entries) {
        const fullPath = joinPath(currentPath, entry.name)
        if (entry.isDirectory) {
          await traverse(fullPath, depth + 1)
        } else if (entry.isFile) {
          const ext = getExtension(entry.name)
          if (audioExtensions.has(ext)) {
            audioPaths.push(fullPath)
          } else if (coverExtensions.has(ext)) {
            coverPaths.push(fullPath)
          }
        }
      }
    } catch (err) {
      console.warn(`Could not read directory ${currentPath}:`, err)
    }
  }

  await traverse(folderPath)
  return { audioPaths, coverPaths }
}

export function nativeCoversFromPaths(coverPaths: string[]): {
  lookup: CoverLookup
  urls: string[]
} {
  const lookup: CoverLookup = new Map()
  const urls: string[] = []

  for (const path of coverPaths) {
    const url = toNativeAssetUrl(path)
    urls.push(url)

    const fileName = getFileName(path)
    const baseName = normalizeName(fileName)
    if (baseName && !lookup.has(baseName)) {
      lookup.set(baseName, url)
    }

    const parentFolder = normalizeName(getParentDirName(path))
    if (parentFolder && !lookup.has(parentFolder)) {
      lookup.set(parentFolder, url)
    }
  }

  return { lookup, urls }
}

export async function nativeTracksFromPaths(
  filePaths: string[],
  covers: CoverLookup,
  existingIds: ReadonlySet<string> = new Set(),
): Promise<Track[]> {
  const tracks: Track[] = []

  for (const filePath of filePaths) {
    const fileName = getFileName(filePath)
    const id = `native:${filePath}`
    if (existingIds.has(id)) continue

    const audioUrl = toNativeAssetUrl(filePath)

    let duration = 0
    try {
      duration = await readDuration(audioUrl)
    } catch {
      duration = 0
    }

    // Try reading ID3 metadata from the file header
    let detectedTitle = ''
    let detectedArtist = ''
    let detectedAlbum = ''
    let embeddedCoverUrl: string | undefined

    try {
      // Read initial 256KB to detect tags and embedded artwork
      const rawBytes = await readFile(filePath)
      const blob = new Blob([rawBytes])
      const detected = await autoDetectTrackMetadata(fileName, blob as File)
      detectedTitle = detected.title
      detectedArtist = detected.artist
      detectedAlbum = detected.album
      embeddedCoverUrl = detected.coverUrl
    } catch {
      detectedTitle = cleanMusicString(fileName.replace(/\.[^/.]+$/, ''))
      detectedArtist = 'Unknown artist'
      detectedAlbum = 'Local files'
    }

    // Direct cover matches
    let coverUrl =
      covers.get(normalizeName(fileName)) ||
      covers.get(normalizeName(detectedTitle)) ||
      covers.get(normalizeName(cleanDisplayTitle(detectedTitle)))
    let coverSource: Track['coverSource'] = coverUrl ? 'direct' : undefined

    // Check parent folder name
    const parentFolder = normalizeName(getParentDirName(filePath))
    if (!coverUrl && parentFolder && covers.has(parentFolder)) {
      coverUrl = covers.get(parentFolder)
      coverSource = 'direct'
    }

    // Check album name match
    if (!coverUrl && detectedAlbum) {
      const normAlbum = normalizeName(detectedAlbum)
      if (normAlbum && covers.has(normAlbum)) {
        coverUrl = covers.get(normAlbum)
        coverSource = 'direct'
      }
    }

    // Use embedded cover if available
    if (!coverUrl && embeddedCoverUrl) {
      coverUrl = embeddedCoverUrl
      coverSource = 'embedded'
    }

    const parentName = getParentDirName(filePath)
    const album = detectedAlbum && detectedAlbum !== 'Local files' ? detectedAlbum : parentName || 'Local files'

    tracks.push({
      id,
      title: detectedTitle || cleanDisplayTitle(fileName),
      artist: detectedArtist || 'Unknown artist',
      album,
      duration,
      fileName,
      filePath,
      audioUrl,
      coverUrl,
      coverSource,
      accent: colorFromString(fileName),
    })
  }

  return tracks
}
