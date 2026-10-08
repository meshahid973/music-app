import { AnimatePresence, motion } from 'framer-motion'
import { Howl } from 'howler'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, DragEvent } from 'react'
import './App.css'
import {
  PencilFilled,
  SearchFilled,
  TrashFilled,
} from './components/icons'
import {
  DeletePlaylistModal,
  EditTrackModal,
  HeroPlayer,
  PlayerBar,
  RenamePlaylistModal,
  Sidebar,
  TrackList,
} from './components'
import { useHeroTheme } from './hooks/useHeroTheme'
import { libraryId, useMusicStore } from './store/useMusicStore'
import { PlaybackQueue } from './utils/queue'
import { revokeOwnedObjectUrls } from './utils/objectUrls'
import type { Playlist, Track } from './types'
import {
  extractCovers,
  formatTime,
  isAudioFile,
  isCoverFile,
  tracksFromFiles,
} from './utils/library'

function getVisibleTracks(
  tracks: Track[],
  activePlaylistId: string,
  activePlaylist: Playlist | undefined,
  query: string,
) {
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

function App() {
  const audioRef = useRef<Howl | null>(null)
  const progressTimer = useRef<number | null>(null)
  const volumeRef = useRef(0.82)
  const playNextRef = useRef<() => void>(() => {})
  const queueRef = useRef(new PlaybackQueue())
  const lastPlaylistIdRef = useRef<string | null>(null)

  const [query, setQuery] = useState('')
  const [seek, setSeek] = useState(0)
  const [newPlaylistName, setNewPlaylistName] = useState('')
  const [editingTrack, setEditingTrack] = useState<Track | null>(null)
  const [playlistToDelete, setPlaylistToDelete] = useState<Playlist | null>(null)
  const [playlistToRename, setPlaylistToRename] = useState<Playlist | null>(null)

  const {
    tracks,
    playlists,
    activePlaylistId,
    currentTrackId,
    isPlaying,
    shuffle,
    repeat,
    volume,
    addTracks,
    addCovers,
    createPlaylist,
    deletePlaylist,
    renamePlaylist,
    addTrackToPlaylist,
    removeTrackFromPlaylist,
    setActivePlaylist,
    setCurrentTrack,
    setIsPlaying,
    toggleShuffle,
    cycleRepeat,
    setVolume,
    updateTrack,
  } = useMusicStore()

  const activePlaylist = playlists.find((playlist) => playlist.id === activePlaylistId)
  const currentTrack = tracks.find((track) => track.id === currentTrackId)
  const currentAudioUrl = currentTrack?.audioUrl
  const currentId = currentTrack?.id

  const visibleTracks = useMemo(
    () => getVisibleTracks(tracks, activePlaylistId, activePlaylist, query),
    [activePlaylist, activePlaylistId, query, tracks],
  )

  const heroTheme = useHeroTheme(currentTrack?.coverUrl, currentTrack?.accent)

  function startProgress() {
    stopProgress()
    progressTimer.current = window.setInterval(() => {
      const howl = audioRef.current
      if (!howl) return
      const position = howl.seek()
      setSeek(typeof position === 'number' ? position : 0)
    }, 350)
  }

  function stopProgress() {
    if (progressTimer.current) {
      window.clearInterval(progressTimer.current)
      progressTimer.current = null
    }
  }

  useEffect(() => {
    volumeRef.current = volume
  }, [volume])

  useEffect(() => () => revokeOwnedObjectUrls(), [])

  useEffect(() => {
    const playlistTrackIds = activePlaylistId === libraryId
      ? tracks.map((track) => track.id)
      : activePlaylist?.trackIds ?? []

    if (!playlistTrackIds.length) return

    const currentIdInPlaylist = currentTrackId ? playlistTrackIds.includes(currentTrackId) : false

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

  useEffect(() => {
    audioRef.current?.stop()
    audioRef.current?.unload()
    audioRef.current = null
    if (!currentAudioUrl) return

    const shouldAutoplay = useMusicStore.getState().isPlaying
    const howl = new Howl({
      src: [currentAudioUrl],
      format: ['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac', 'webm'],
      html5: true,
      autoplay: shouldAutoplay,
      volume: volumeRef.current,
      onend: () => playNextRef.current(),
      onload: () => {
        setSeek(0)
        if (useMusicStore.getState().isPlaying && !howl.playing()) {
          try {
            howl.play()
            startProgress()
          } catch {
            // ignore
          }
        }
      },
      onplay: () => {
        startProgress()
      },
      onpause: () => {
        stopProgress()
      },
      onstop: () => {
        stopProgress()
      },
      onloaderror: (_id, err) => {
        console.warn('Audio load error:', err)
      },
      onplayerror: (_id, err) => {
        console.warn('Audio play error:', err)
        howl.once('unlock', () => {
          try {
            howl.play()
          } catch {
            // ignore
          }
        })
      },
    })
    audioRef.current = howl
    return () => {
      howl.stop()
      howl.unload()
      if (audioRef.current === howl) audioRef.current = null
      stopProgress()
    }
  }, [currentAudioUrl, currentId])

  useEffect(() => {
    const howl = audioRef.current
    if (!howl) return
    if (isPlaying) {
      if (!howl.playing()) {
        try {
          howl.play()
          startProgress()
        } catch {
          // ignore
        }
      }
    } else {
      try {
        howl.pause()
      } catch {
        // ignore
      }
      stopProgress()
    }
    return () => stopProgress()
  }, [isPlaying, currentAudioUrl])

  useEffect(() => {
    audioRef.current?.volume(volume)
  }, [volume])

  async function handleMusicFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? [])
    if (files.length === 0) return

    const coverFiles = files.filter(isCoverFile)
    const storeLookup = useMusicStore.getState().coverLookup
    const combinedLookup = new Map(storeLookup)

    if (coverFiles.length > 0) {
      const { lookup, urls } = extractCovers(coverFiles)
      for (const [k, v] of lookup.entries()) {
        combinedLookup.set(k, v)
      }
      addCovers(lookup, urls)
    }

    const parsedTracks = await tracksFromFiles(
      files,
      combinedLookup,
      new Set(useMusicStore.getState().tracks.map((track) => track.id)),
    )
    if (parsedTracks.length > 0) {
      addTracks(parsedTracks)
    }
    event.target.value = ''
  }

  async function handleMusicFolder(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? [])
    if (files.length === 0) return

    const coverFiles = files.filter(isCoverFile)
    const storeLookup = useMusicStore.getState().coverLookup
    const combinedLookup = new Map(storeLookup)

    if (coverFiles.length > 0) {
      const { lookup, urls } = extractCovers(coverFiles)
      for (const [k, v] of lookup.entries()) {
        combinedLookup.set(k, v)
      }
      addCovers(lookup, urls)
    }

    const parsedTracks = await tracksFromFiles(
      files,
      combinedLookup,
      new Set(useMusicStore.getState().tracks.map((track) => track.id)),
    )
    if (parsedTracks.length > 0) {
      addTracks(parsedTracks)
    }
    event.target.value = ''
  }

  function handleCoverFolder(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? [])
    if (files.length === 0) return
    const { lookup, urls } = extractCovers(files)
    if (urls.length > 0) {
      addCovers(lookup, urls)
    }
    event.target.value = ''
  }

  async function handleDrop(event: DragEvent) {
    event.preventDefault()
    const files = Array.from(event.dataTransfer?.files ?? [])
    if (files.length === 0) return

    const coverFiles = files.filter(isCoverFile)
    const audioFiles = files.filter(isAudioFile)
    const storeLookup = useMusicStore.getState().coverLookup
    const combinedLookup = new Map(storeLookup)

    if (coverFiles.length > 0) {
      const { lookup, urls } = extractCovers(coverFiles)
      for (const [k, v] of lookup.entries()) {
        combinedLookup.set(k, v)
      }
      addCovers(lookup, urls)
    }

    if (audioFiles.length > 0) {
      const parsedTracks = await tracksFromFiles(
        audioFiles,
        combinedLookup,
        new Set(useMusicStore.getState().tracks.map((track) => track.id)),
      )
      addTracks(parsedTracks)
    }
  }

  function handleCreatePlaylist() {
    const name = newPlaylistName.trim()
    if (!name) return
    createPlaylist(name)
    setNewPlaylistName('')
  }

  function moveTrack(direction: 1 | -1, automatic = false) {
    if (!currentTrackId) return
    const nextId = direction === 1
      ? queueRef.current.next(currentTrackId, shuffle, repeat, automatic)
      : queueRef.current.previous(currentTrackId, shuffle, repeat)
    if (nextId) {
      setCurrentTrack(nextId)
      setIsPlaying(true)
    } else {
      setIsPlaying(false)
    }
  }

  function playPrevious() {
    moveTrack(-1)
  }

  function playNext(automatic = false) {
    if (automatic && repeat === 'one') {
      audioRef.current?.seek(0)
      audioRef.current?.play()
      startProgress()
      return
    }
    moveTrack(1, automatic)
  }

  function handleTrackPlay(trackId: string) {
    if (currentTrackId === trackId) {
      setIsPlaying(!isPlaying)
    } else {
      queueRef.current.start(visibleTracks.map((track) => track.id), trackId)
      setCurrentTrack(trackId)
      setIsPlaying(true)
    }
  }

  useEffect(() => {
    playNextRef.current = () => playNext(true)
  })

  function togglePlay() {
    if (!currentTrack && visibleTracks[0]) {
      queueRef.current.start(visibleTracks.map((track) => track.id), visibleTracks[0].id)
      setCurrentTrack(visibleTracks[0].id)
      setIsPlaying(true)
      return
    }
    setIsPlaying(!isPlaying)
  }

  function handleSeek(value: number) {
    setSeek(value)
    audioRef.current?.seek(value)
  }

  return (
    <main
      className="app-shell"
      onDragOver={(event) => event.preventDefault()}
      onDrop={handleDrop}
    >
      <Sidebar
        activePlaylistId={activePlaylistId}
        playlists={playlists}
        tracks={tracks}
        onSelect={setActivePlaylist}
        onCreate={handleCreatePlaylist}
        onRenamePlaylist={(playlist) => setPlaylistToRename(playlist)}
        onDeletePlaylist={(playlist) => setPlaylistToDelete(playlist)}
        playlistName={newPlaylistName}
        setPlaylistName={setNewPlaylistName}
        onAddSongs={handleMusicFiles}
        onAddMusicFolder={handleMusicFolder}
        onAddCoverFolder={handleCoverFolder}
      />

      <section className="content">
        <header className="topbar">
          <div>
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={activePlaylistId}
                className="topbar-title-row"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.2, ease: [0.25, 1, 0.5, 1] }}
              >
                <h1>{activePlaylist?.name ?? 'Your Library'}</h1>
                {activePlaylist && (
                  <div className="playlist-header-actions">
                    <button
                      type="button"
                      className="edit-playlist-header-btn"
                      onClick={() => setPlaylistToRename(activePlaylist)}
                      title={`Rename playlist "${activePlaylist.name}"`}
                    >
                      <PencilFilled size={14} />
                      <span>Rename</span>
                    </button>
                    <button
                      type="button"
                      className="delete-playlist-header-btn"
                      onClick={() => setPlaylistToDelete(activePlaylist)}
                      title={`Delete playlist "${activePlaylist.name}"`}
                    >
                      <TrashFilled size={14} />
                      <span>Delete</span>
                    </button>
                  </div>
                )}
              </motion.div>
            </AnimatePresence>
          </div>
        </header>

        <HeroPlayer
          currentTrack={currentTrack}
          isPlaying={isPlaying}
          heroTheme={heroTheme}
          onTogglePlay={togglePlay}
        />

        <section className="library-tools">
          <label className="search-box">
            <SearchFilled size={18} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search songs, artists, albums"
            />
          </label>
          <div className="library-stats">
            <span>
              {visibleTracks.length} {visibleTracks.length === 1 ? 'song' : 'songs'} · {formatTime(visibleTracks.reduce((sum, track) => sum + track.duration, 0))}
            </span>
          </div>
        </section>

        <TrackList
          tracks={visibleTracks}
          playlists={playlists}
          activePlaylistId={activePlaylistId}
          activePlaylist={activePlaylist}
          currentTrackId={currentTrackId}
          isPlaying={isPlaying}
          onPlay={handleTrackPlay}
          onAddToPlaylist={addTrackToPlaylist}
          onRemoveFromPlaylist={removeTrackFromPlaylist}
          onEditTrack={setEditingTrack}
          onAddSongs={handleMusicFiles}
          onAddMusicFolder={handleMusicFolder}
          onAddCoverFolder={handleCoverFolder}
        />
      </section>

      <PlayerBar
        currentTrack={currentTrack}
        isPlaying={isPlaying}
        audioRef={audioRef}
        seek={seek}
        shuffle={shuffle}
        repeat={repeat}
        volume={volume}
        onTogglePlay={togglePlay}
        onPrevious={playPrevious}
        onNext={playNext}
        onSeek={handleSeek}
        onShuffle={toggleShuffle}
        onRepeat={cycleRepeat}
        onVolume={setVolume}
      />

      {editingTrack && (
        <EditTrackModal
          track={editingTrack}
          isPlaying={isPlaying}
          onClose={() => setEditingTrack(null)}
          onSave={(updates) => updateTrack(editingTrack.id, updates)}
        />
      )}

      {playlistToRename && (
        <RenamePlaylistModal
          playlist={playlistToRename}
          onClose={() => setPlaylistToRename(null)}
          onSave={(newName) => renamePlaylist(playlistToRename.id, newName)}
        />
      )}

      {playlistToDelete && (
        <DeletePlaylistModal
          playlist={playlistToDelete}
          onClose={() => setPlaylistToDelete(null)}
          onConfirm={() => deletePlaylist(playlistToDelete.id)}
        />
      )}
    </main>
  )
}

export default App
