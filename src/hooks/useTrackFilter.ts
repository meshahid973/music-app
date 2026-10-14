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

export function getVisibleTracks(
  tracks: Track[],
  activePlaylistId: string,
  activePlaylist: Playlist | undefined,
  query: string,
): Track[] {
  // Build membership once per filter calculation rather than scanning the
  // playlist array for every track. This matters for large libraries/playlists.
  const playlistTrackIds = new Set(activePlaylist?.trackIds ?? [])
  const playlistTracks =
    activePlaylistId === libraryId
      ? tracks
      : tracks.filter((track) => playlistTrackIds.has(track.id))
  const normalizedQuery = normalizeSearchText(query)

  if (!normalizedQuery) return playlistTracks

  return playlistTracks.filter((track) =>
    [track.title, track.artist, track.album, track.fileName].some((value) =>
      normalizeSearchText(value).includes(normalizedQuery),
    ),
  )
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
