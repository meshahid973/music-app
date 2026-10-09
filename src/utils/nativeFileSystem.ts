import { readDir } from '@tauri-apps/plugin-fs'
import { toNativeAssetUrl } from './platform.ts'
import { audioExtensions, coverExtensions, getExtension, readDuration } from './audioFiles.ts'
import { colorFromString, normalizeName } from './covers.ts'
import { autoDetectTrackMetadata } from './metadata.ts'
import { cleanDisplayTitle } from './tracks.ts'
import { readBoundedNativeFile } from './boundedMetadata.ts'
import { saveEmbeddedArtwork } from './artworkStorage.ts'
import { objectUrlForBlob } from './objectUrls.ts'
import type { CoverLookup, Track } from '../types.ts'

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

export async function scanNativeDroppedPaths(droppedPaths: string[]): Promise<NativeScanResult> {
  const audioPaths: string[] = []
  const coverPaths: string[] = []

  for (const itemPath of droppedPaths) {
    const ext = getExtension(itemPath)
    if (audioExtensions.has(ext)) {
      audioPaths.push(itemPath)
    } else if (coverExtensions.has(ext)) {
      coverPaths.push(itemPath)
    } else {
      const folderScan = await scanNativeFolder(itemPath)
      audioPaths.push(...folderScan.audioPaths)
      coverPaths.push(...folderScan.coverPaths)
    }
  }

  return { audioPaths, coverPaths }
}

export function nativeCoversFromPaths(coverPaths: string[]): {
  lookup: CoverLookup
  paths: Map<string, string>
  urls: string[]
} {
  const lookup: CoverLookup = new Map()
  const paths: Map<string, string> = new Map()
  const urls: string[] = []

  for (const path of coverPaths) {
    const url = toNativeAssetUrl(path)
    urls.push(url)

    const fileName = getFileName(path)
    const baseName = normalizeName(fileName)
    if (baseName && !lookup.has(baseName)) {
      lookup.set(baseName, url)
      paths.set(baseName, path)
    }

    const parentFolder = normalizeName(getParentDirName(path))
    if (parentFolder && !lookup.has(parentFolder)) {
      lookup.set(parentFolder, url)
      paths.set(parentFolder, path)
    }
  }

  return { lookup, paths, urls }
}

export async function nativeTracksFromPaths(
  filePaths: string[],
  covers: CoverLookup,
  existingIds: ReadonlySet<string> = new Set(),
  coverPathsMap?: Map<string, string>,
): Promise<Track[]> {
  const tracks: Track[] = []
  const seen = new Set(existingIds)

  for (const filePath of filePaths) {
    const fileName = getFileName(filePath)
    const id = `native:${filePath}`
    if (seen.has(id)) continue
    seen.add(id)

    const audioUrl = toNativeAssetUrl(filePath)

    let duration = 0
    try {
      duration = await readDuration(audioUrl)
    } catch {
      duration = 0
    }

    // Read ONLY bounded metadata region (up to 4MB max) instead of full audio file
    let detectedTitle = ''
    let detectedArtist = ''
    let detectedAlbum = ''
    let embeddedCoverUrl: string | undefined
    let embeddedCoverPath: string | undefined

    try {
      const tagBytes = await readBoundedNativeFile(filePath)
      if (tagBytes && tagBytes.length >= 10) {
        const detected = await autoDetectTrackMetadata(fileName, tagBytes)
        detectedTitle = detected.title
        detectedArtist = detected.artist
        detectedAlbum = detected.album

        // If track contains embedded artwork, save it durably to AppData
        if (detected.coverBytes && detected.coverBytes.length > 0) {
          try {
            const savedPath = await saveEmbeddedArtwork(
              id,
              detected.coverBytes,
              detected.coverMime,
            )
            if (savedPath) {
              embeddedCoverPath = savedPath
              embeddedCoverUrl = toNativeAssetUrl(savedPath)
            } else {
              // Provide a visible in-session fallback when durable saving fails
              const mime = detected.coverMime || 'image/jpeg'
              embeddedCoverUrl = objectUrlForBlob(new Blob([detected.coverBytes as unknown as BlobPart], { type: mime }))
              embeddedCoverPath = undefined
            }
          } catch {
            const mime = detected.coverMime || 'image/jpeg'
            embeddedCoverUrl = objectUrlForBlob(new Blob([detected.coverBytes as unknown as BlobPart], { type: mime }))
            embeddedCoverPath = undefined
          }
        }
      } else {
        // Fallback for files with missing or invalid tags
        const detected = await autoDetectTrackMetadata(fileName)
        detectedTitle = detected.title
        detectedArtist = detected.artist
        detectedAlbum = detected.album
      }
    } catch (err) {
      console.warn(`Error reading metadata for ${fileName}:`, err)
      const detected = await autoDetectTrackMetadata(fileName)
      detectedTitle = detected.title
      detectedArtist = detected.artist
      detectedAlbum = detected.album
    }

    // Direct cover matches from directory or pool
    let directCoverUrl: string | undefined
    let directCoverPath: string | undefined

    const normFileName = normalizeName(fileName)
    const normTitle = normalizeName(detectedTitle)
    const normCleanTitle = normalizeName(cleanDisplayTitle(detectedTitle))

    if (covers.has(normFileName)) {
      directCoverUrl = covers.get(normFileName)
      directCoverPath = coverPathsMap?.get(normFileName)
    } else if (covers.has(normTitle)) {
      directCoverUrl = covers.get(normTitle)
      directCoverPath = coverPathsMap?.get(normTitle)
    } else if (covers.has(normCleanTitle)) {
      directCoverUrl = covers.get(normCleanTitle)
      directCoverPath = coverPathsMap?.get(normCleanTitle)
    }

    // Check parent folder name
    const parentFolder = normalizeName(getParentDirName(filePath))
    if (!directCoverUrl && parentFolder && covers.has(parentFolder)) {
      directCoverUrl = covers.get(parentFolder)
      directCoverPath = coverPathsMap?.get(parentFolder)
    }

    // Check album name match
    if (!directCoverUrl && detectedAlbum) {
      const normAlbum = normalizeName(detectedAlbum)
      if (normAlbum && covers.has(normAlbum)) {
        directCoverUrl = covers.get(normAlbum)
        directCoverPath = coverPathsMap?.get(normAlbum)
      }
    }

    let coverUrl: string | undefined
    let coverPath: string | undefined
    let coverSource: Track['coverSource']

    if (directCoverUrl) {
      coverUrl = directCoverUrl
      // When a direct cover wins over embedded artwork, coverPath MUST refer to that direct cover,
      // or be cleared (undefined) if no durable path is available.
      coverPath = directCoverPath
      coverSource = 'direct'
    } else if (embeddedCoverUrl) {
      coverUrl = embeddedCoverUrl
      coverPath = embeddedCoverPath
      coverSource = 'embedded'
    }

    const parentName = getParentDirName(filePath)
    const album =
      detectedAlbum && detectedAlbum !== 'Local files'
        ? detectedAlbum
        : parentName || 'Local files'

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
      coverPath,
      coverSource,
      accent: colorFromString(fileName),
    })
  }

  return tracks
}
