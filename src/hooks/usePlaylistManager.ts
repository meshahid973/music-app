import { useEffect, useRef, useState } from 'react'
import { libraryId, useMusicStore } from '../store/useMusicStore.ts'
import { PlaybackQueue } from '../utils/queue.ts'
import type { Playlist } from '../types.ts'

export interface PlaylistQueueSyncState {
  lastPlaylistId: string | null
  lastTrackIds: string[]
}

export function syncPlaylistQueue(
  queue: PlaybackQueue,
  syncState: PlaylistQueueSyncState,
  params: {
    activePlaylistId: string
    playlistTrackIds: string[]
    currentTrackId?: string
    onTrackSelect?: (trackId: string) => void
  },
): void {
  const { activePlaylistId, playlistTrackIds, currentTrackId, onTrackSelect } = params

  if (!playlistTrackIds.length) {
    syncState.lastPlaylistId = activePlaylistId
    syncState.lastTrackIds = []
    queue.clear()
    return
  }

  const currentIdInPlaylist = currentTrackId
    ? playlistTrackIds.includes(currentTrackId)
    : false

  const playlistChanged = syncState.lastPlaylistId !== activePlaylistId
  const tracksChanged =
    syncState.lastTrackIds.length !== playlistTrackIds.length ||
    syncState.lastTrackIds.some((id, idx) => id !== playlistTrackIds[idx])

  if (playlistChanged) {
    syncState.lastPlaylistId = activePlaylistId
    syncState.lastTrackIds = playlistTrackIds
    const targetId = currentTrackId && currentIdInPlaylist ? currentTrackId : playlistTrackIds[0]
    queue.start(playlistTrackIds, targetId)
    if (currentTrackId !== targetId && onTrackSelect) {
      onTrackSelect(targetId)
    }
    return
  }

  if (queue.size === 0) {
    syncState.lastTrackIds = playlistTrackIds
    const targetId = currentTrackId && currentIdInPlaylist ? currentTrackId : playlistTrackIds[0]
    queue.start(playlistTrackIds, targetId)
    if (currentTrackId !== targetId && onTrackSelect) {
      onTrackSelect(targetId)
    }
    return
  }

  if (tracksChanged) {
    syncState.lastTrackIds = playlistTrackIds
    queue.sync(playlistTrackIds, currentTrackId)
  }
}

export function usePlaylistManager() {
  const queueRef = useRef(new PlaybackQueue())
  const syncStateRef = useRef<PlaylistQueueSyncState>({
    lastPlaylistId: null,
    lastTrackIds: [],
  })

  const [newPlaylistName, setNewPlaylistName] = useState('')
  const [playlistToDelete, setPlaylistToDelete] = useState<Playlist | null>(null)
  const [playlistToRename, setPlaylistToRename] = useState<Playlist | null>(null)

  const {
    tracks,
    playlists,
    activePlaylistId,
    currentTrackId,
    createPlaylist,
    deletePlaylist,
    renamePlaylist,
    setCurrentTrack,
  } = useMusicStore()

  const activePlaylist = playlists.find((playlist) => playlist.id === activePlaylistId)

  useEffect(() => {
    const playlistTrackIds =
      activePlaylistId === libraryId
        ? tracks.map((track) => track.id)
        : activePlaylist?.trackIds ?? []

    syncPlaylistQueue(queueRef.current, syncStateRef.current, {
      activePlaylistId,
      playlistTrackIds,
      currentTrackId,
      onTrackSelect: setCurrentTrack,
    })
  }, [activePlaylist, activePlaylistId, currentTrackId, setCurrentTrack, tracks])

  function handleCreatePlaylist() {
    const name = newPlaylistName.trim()
    if (!name) return
    createPlaylist(name)
    setNewPlaylistName('')
  }

  function handleConfirmDelete() {
    if (playlistToDelete) {
      deletePlaylist(playlistToDelete.id)
      setPlaylistToDelete(null)
    }
  }

  function handleConfirmRename(newName: string) {
    if (playlistToRename) {
      renamePlaylist(playlistToRename.id, newName)
      setPlaylistToRename(null)
    }
  }

  return {
    queueRef,
    activePlaylist,
    newPlaylistName,
    setNewPlaylistName,
    handleCreatePlaylist,
    playlistToDelete,
    setPlaylistToDelete,
    handleConfirmDelete,
    playlistToRename,
    setPlaylistToRename,
    handleConfirmRename,
  }
}
