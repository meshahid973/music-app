import { useEffect, useRef, useState } from 'react'
import { libraryId, useMusicStore } from '../store/useMusicStore'
import { PlaybackQueue } from '../utils/queue'
import type { Playlist } from '../types'

export function usePlaylistManager() {
  const queueRef = useRef(new PlaybackQueue())
  const lastPlaylistIdRef = useRef<string | null>(null)

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

    if (!playlistTrackIds.length) {
      lastPlaylistIdRef.current = activePlaylistId
      queueRef.current.clear()
      return
    }

    const currentIdInPlaylist = currentTrackId
      ? playlistTrackIds.includes(currentTrackId)
      : false

    if (lastPlaylistIdRef.current !== activePlaylistId) {
      lastPlaylistIdRef.current = activePlaylistId
      if (!currentTrackId || !currentIdInPlaylist) {
        const fallbackTrackId = playlistTrackIds[0]
        queueRef.current.start(playlistTrackIds, fallbackTrackId)
        if (currentTrackId !== fallbackTrackId) setCurrentTrack(fallbackTrackId)
        return
      }
      queueRef.current.start(playlistTrackIds, currentTrackId)
      return
    }

    if (!currentTrackId && queueRef.current.size === 0) {
      queueRef.current.start(playlistTrackIds, playlistTrackIds[0])
    }
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
