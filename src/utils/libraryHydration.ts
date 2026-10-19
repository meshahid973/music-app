import type { Track } from '../types.ts'
import { hydrateTrackArtwork } from './artworkStorage.ts'

/**
 * AppData is authoritative for tracks that already exist on disk. Legacy
 * Zustand/localStorage tracks must never overwrite a rebuilt native audio URL.
 * In-memory tracks not yet saved (e.g. an import racing initialization) survive.
 */
export function mergeHydratedLibraryTracks(
  savedTracks: Track[],
  inMemoryTracks: Track[],
): Track[] {
  const merged = new Map<string, Track>()
  for (const track of inMemoryTracks) merged.set(track.id, hydrateTrackArtwork(track))
  for (const track of savedTracks) merged.set(track.id, hydrateTrackArtwork(track))
  return [...merged.values()]
}

export function restorePlayableTrackId(
  tracks: Track[],
  savedId?: string,
  inMemoryId?: string,
): string | undefined {
  const isPlayable = (id: string | undefined) =>
    id !== undefined && tracks.some((track) => track.id === id && Boolean(track.audioUrl))
  if (isPlayable(savedId)) return savedId
  if (isPlayable(inMemoryId)) return inMemoryId
  return tracks.find((track) => Boolean(track.audioUrl))?.id
}
