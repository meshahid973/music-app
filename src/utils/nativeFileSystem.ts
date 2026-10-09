import { invoke } from '@tauri-apps/api/core'
import { toNativeAssetUrl } from './platform.ts'
import { readDuration } from './audioFiles.ts'
import { colorFromString, normalizeName } from './covers.ts'
import { autoDetectTrackMetadata } from './metadata.ts'
import { cleanDisplayTitle } from './tracks.ts'
import { readBoundedNativeFile } from './boundedMetadata.ts'
import { saveEmbeddedArtwork } from './artworkStorage.ts'
import { objectUrlForBlob } from './objectUrls.ts'
import type { CoverLookup, Track } from '../types.ts'

function getFileName(filePath: string): string {
  const parts = filePath.split(/[/\\\\]/)
  return parts[parts.length - 1] || filePath
}

function getParentDirName(filePath: string): string {
  const parts = filePath.split(/[/\\\\]/).filter(Boolean)
  return parts.length > 1 ? parts[parts.length - 2] : ''
}

export interface NativeScanResult {
  audioPaths: string[]
  coverPaths: string[]
}

async function scanNativePaths(paths: string[]): Promise<NativeScanResult> {
  if (paths.length === 0) return { audioPaths: [], coverPaths: [] }
  return invoke<NativeScanResult>('scan_music_paths', { paths })
}

// Both OS folder selection and Explorer drag/drop share the same Rust worker.
export function scanNativeFolder(folderPath: string): Promise<NativeScanResult> {
  return scanNativePaths([folderPath])
}

export function scanNativeDroppedPaths(droppedPaths: string[]): Promise<NativeScanResult> {
  return scanNativePaths(droppedPaths)
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
  const seen = new Set(existingIds)
  const uniquePaths = filePaths.filter((path) => {
    const id = `native:${path}`
    if (seen.has(id)) return false
    seen.add(id)
    return true
  })

  // Bounded concurrency speeds up large imports without opening hundreds of
  // media elements or metadata files simultaneously. Preserve file order.
  const tracks = new Array<Track>(uniquePaths.length)
  let cursor = 0
  async function parseNext(): Promise<void> {
    while (cursor < uniquePaths.length) {
      const index = cursor++
      const filePath = uniquePaths[index]
      const fileName = getFileName(filePath)
      const id = `native:${filePath}`
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

      tracks[index] = {
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
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(4, uniquePaths.length) }, () => parseNext()),
  )
  return tracks
}
