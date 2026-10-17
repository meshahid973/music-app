import type { Track } from '../types.ts'

/** Case/separator-insensitive form of a Windows (or POSIX) path for comparisons. */
export function normalizePathForCompare(path: string): string {
  const unified = path.replace(/\\/g, '/').replace(/\/+$/, '')
  return /^[a-z]:/i.test(unified) || unified.startsWith('//') ? unified.toLowerCase() : unified
}

export function isPathInside(childPath: string, folderPath: string): boolean {
  const folder = normalizePathForCompare(folderPath)
  const child = normalizePathForCompare(childPath)
  return child.startsWith(`${folder}/`)
}

/**
 * Library tracks that live inside `folderPath` but were not found by a fresh scan of it,
 * i.e. their files were deleted or moved. Tracks added from elsewhere are never touched.
 * The caller must only use this after a complete, error-free scan that found files.
 */
export function findMissingTrackIds(
  tracks: Track[],
  scannedAudioPaths: string[],
  folderPath: string,
): string[] {
  const present = new Set(scannedAudioPaths.map(normalizePathForCompare))
  return tracks
    .filter(
      (track) =>
        track.filePath &&
        isPathInside(track.filePath, folderPath) &&
        !present.has(normalizePathForCompare(track.filePath)),
    )
    .map((track) => track.id)
}
