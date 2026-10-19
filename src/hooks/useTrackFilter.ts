import { useMemo, useState } from 'react'
import { libraryId } from '../store/useMusicStore.ts'
import type { Playlist, Track } from '../types'

export function normalizeSearchText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, '')
    .replace(/[\p{M}\p{Cf}]/gu, '')
    .replace(/[‘’‛]/g, "'")
    .replace(/[‐‑‒–—―]/g, '-')
    .toLowerCase()
    .trim()
}

// Cached per immutable track object. Searches no longer repeatedly normalize the
// same title/artist/album/file name on every keystroke.
const searchTextByTrack = new WeakMap<Track, string>()

function indexedSearchText(track: Track): string {
  const cached = searchTextByTrack.get(track)
  if (cached !== undefined) return cached
  const indexed = [track.title, track.artist, track.album, track.fileName]
    .map(normalizeSearchText)
    .join('\u0000')
  searchTextByTrack.set(track, indexed)
  return indexed
}

export function getVisibleTracks(
  tracks: Track[],
  activePlaylistId: string,
  activePlaylist: Playlist | undefined,
  query: string,
): Track[] {
  // Build membership once per filter calculation rather than scanning the
  // playlist array for every track. This matters for large libraries/playlists.
  const membership = activePlaylistId === libraryId ? null : new Set(activePlaylist?.trackIds ?? [])
  const playlistTracks = membership ? tracks.filter((track) => membership.has(track.id)) : tracks
  const normalizedQuery = normalizeSearchText(query)

  if (!normalizedQuery) return playlistTracks

  return playlistTracks.filter((track) => indexedSearchText(track).includes(normalizedQuery))
}

export function useTrackFilter(
  tracks: Track[],
  activePlaylistId: string,
  activePlaylist?: Playlist,
) {
  const [query, setQuery] = useState('')

  const visibleTracks = useMemo(
    () => getVisibleTracks(tracks, activePlaylistId, activePlaylist, query),
    [tracks, activePlaylistId, activePlaylist, query],
  )

  const totalDuration = useMemo(
    () => visibleTracks.reduce((sum, track) => sum + track.duration, 0),
    [visibleTracks],
  )

  return {
    query,
    setQuery,
    visibleTracks,
    totalDuration,
    trackCount: visibleTracks.length,
  }
}
