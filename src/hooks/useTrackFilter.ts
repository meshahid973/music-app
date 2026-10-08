import { useMemo, useState } from 'react'
import { libraryId } from '../store/useMusicStore'
import type { Playlist, Track } from '../types'

export function getVisibleTracks(
  tracks: Track[],
  activePlaylistId: string,
  activePlaylist: Playlist | undefined,
  query: string,
): Track[] {
  const playlistTracks =
    activePlaylistId === libraryId
      ? tracks
      : tracks.filter((track) => activePlaylist?.trackIds.includes(track.id))
  const normalizedQuery = query.trim().toLowerCase()

  if (!normalizedQuery) return playlistTracks

  return playlistTracks.filter((track) =>
    [track.title, track.artist, track.album, track.fileName].some((value) =>
      value.toLowerCase().includes(normalizedQuery),
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
