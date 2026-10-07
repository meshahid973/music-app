import { AnimatePresence, motion } from 'framer-motion'
import { Howl, Howler } from 'howler'
import {
  Disc3,
  FileAudio,
  Heart,
  ListMusic,
  Pause,
  Play,
  Plus,
  Repeat,
  Repeat1,
  Search,
  Shuffle,
  SkipBack,
  SkipForward,
  Sparkles,
  Upload,
  Volume2,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, CSSProperties } from 'react'
import './App.css'
import { favoritesId, libraryId, useMusicStore } from './store/useMusicStore'
import type { Playlist, Track } from './types'
import { buildCoverLookup, formatTime, tracksFromFiles } from './utils/library'

function App() {
  const audioRef = useRef<Howl | null>(null)
  const progressTimer = useRef<number | null>(null)
  const isPlayingRef = useRef(false)
  const volumeRef = useRef(0.82)
  const playNextRef = useRef<() => void>(() => {})
  const [query, setQuery] = useState('')
  const [seek, setSeek] = useState(0)
  const [newPlaylistName, setNewPlaylistName] = useState('')
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
    addTrackToPlaylist,
    setActivePlaylist,
    setCurrentTrack,
    setIsPlaying,
    toggleShuffle,
    cycleRepeat,
    setVolume,
  } = useMusicStore()

  const activePlaylist = playlists.find((playlist) => playlist.id === activePlaylistId)
  const currentTrack = tracks.find((track) => track.id === currentTrackId)
  const currentAudioUrl = currentTrack?.audioUrl
  const currentId = currentTrack?.id
  const visibleTracks = useMemo(
    () => getVisibleTracks(tracks, activePlaylistId, activePlaylist, query),
    [activePlaylist, activePlaylistId, query, tracks],
  )

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
    Howler.volume(volume)
    volumeRef.current = volume
  }, [volume])

  useEffect(() => {
    isPlayingRef.current = isPlaying
  }, [isPlaying])

  useEffect(() => {
    audioRef.current?.stop()
    audioRef.current?.unload()

    if (!currentAudioUrl) return

    const howl = new Howl({
      src: [currentAudioUrl],
      html5: true,
      volume: volumeRef.current,
      onend: () => playNextRef.current(),
      onload: () => setSeek(0),
    })

    audioRef.current = howl

    if (isPlayingRef.current) {
      howl.play()
      startProgress()
    }

    return () => {
      howl.stop()
      howl.unload()
      stopProgress()
    }
  }, [currentAudioUrl, currentId])

  useEffect(() => {
    const howl = audioRef.current
    if (!howl) return

    if (isPlaying) {
      howl.play()
      startProgress()
    } else {
      howl.pause()
      stopProgress()
    }
  }, [isPlaying])

  useEffect(() => {
    audioRef.current?.volume(volume)
  }, [volume])

  async function handleMusicFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? [])
    const coverLookup = buildCoverLookup(files)
    const parsedTracks = await tracksFromFiles(files, coverLookup)
    addTracks(parsedTracks)
    event.target.value = ''
  }

  function handleCoverFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? [])
    addCovers(buildCoverLookup(files))
    event.target.value = ''
  }

  function handleCreatePlaylist() {
    const name = newPlaylistName.trim()
    if (!name) return
    createPlaylist(name)
    setNewPlaylistName('')
  }

  function moveTrack(direction: 1 | -1) {
    if (visibleTracks.length === 0) return
    if (shuffle && direction === 1) {
      const randomTrack = visibleTracks[Math.floor(Math.random() * visibleTracks.length)]
      setCurrentTrack(randomTrack.id)
      return
    }

    const currentIndex = Math.max(
      0,
      visibleTracks.findIndex((track) => track.id === currentTrackId),
    )
    const nextIndex = currentIndex + direction

    if (nextIndex < 0 || nextIndex >= visibleTracks.length) {
      if (repeat === 'all') {
        setCurrentTrack(visibleTracks[direction === 1 ? 0 : visibleTracks.length - 1].id)
      } else {
        setIsPlaying(false)
      }
      return
    }

    setCurrentTrack(visibleTracks[nextIndex].id)
  }

  function playPrevious() {
    moveTrack(-1)
  }

  function playNext() {
    if (repeat === 'one') {
      audioRef.current?.seek(0)
      audioRef.current?.play()
      return
    }
    moveTrack(1)
  }

  useEffect(() => {
    playNextRef.current = playNext
  })

  function togglePlay() {
    if (!currentTrack && visibleTracks[0]) {
      setCurrentTrack(visibleTracks[0].id)
      return
    }
    setIsPlaying(!isPlaying)
  }

  function handleSeek(value: number) {
    setSeek(value)
    audioRef.current?.seek(value)
  }

  return (
    <main className="app-shell">
      <Sidebar
        activePlaylistId={activePlaylistId}
        playlists={playlists}
        tracks={tracks}
        onSelect={setActivePlaylist}
        onCreate={handleCreatePlaylist}
        playlistName={newPlaylistName}
        setPlaylistName={setNewPlaylistName}
      />

      <section className="content">
        <header className="topbar">
          <div>
            <p className="eyebrow">Local player</p>
            <h1>{activePlaylist?.name ?? 'Your Library'}</h1>
          </div>
          <div className="toolbar">
            <label className="icon-button import-button">
              <Upload size={18} />
              <span>Add songs</span>
              <input type="file" accept="audio/*" multiple onChange={handleMusicFiles} />
            </label>
            <label className="icon-button import-button secondary">
              <FileAudio size={18} />
              <span>Cover folder</span>
              <input
                type="file"
                accept="image/*"
                multiple
                onChange={handleCoverFiles}
                {...{ webkitdirectory: '' }}
              />
            </label>
          </div>
        </header>

        <section className="hero-player">
          <motion.div
            className="cover-stage"
            layout
            transition={{ type: 'spring', stiffness: 180, damping: 22 }}
          >
            <AnimatePresence mode="wait">
              <motion.div
                key={currentTrack?.id ?? 'empty'}
                className="big-cover"
                initial={{ opacity: 0, rotate: -4, scale: 0.94 }}
                animate={{ opacity: 1, rotate: isPlaying ? 2 : 0, scale: 1 }}
                exit={{ opacity: 0, rotate: 4, scale: 0.92 }}
                transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
              >
                {currentTrack?.coverUrl ? (
                  <img src={currentTrack.coverUrl} alt={`${currentTrack.title} cover art`} />
                ) : (
                  <div className="generated-cover" style={{ '--cover-accent': currentTrack?.accent } as CSSProperties}>
                    <Disc3 size={74} />
                    <span>{currentTrack?.title.slice(0, 2) ?? 'LM'}</span>
                  </div>
                )}
              </motion.div>
            </AnimatePresence>
          </motion.div>

          <div className="now-copy">
            <p className="eyebrow">
              <Sparkles size={15} />
              Now playing
            </p>
            <AnimatePresence mode="wait">
              <motion.div
                key={currentTrack?.id ?? 'no-track'}
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -14 }}
                transition={{ duration: 0.28 }}
              >
                <h2>{currentTrack?.title ?? 'Drop in your first track'}</h2>
                <p>{currentTrack ? `${currentTrack.artist} · ${currentTrack.album}` : 'Import songs, then add cover images with matching filenames.'}</p>
              </motion.div>
            </AnimatePresence>
          </div>
        </section>

        <section className="library-tools">
          <label className="search-box">
            <Search size={18} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search songs, artists, albums"
            />
          </label>
          <div className="library-stats">
            <span>{visibleTracks.length} songs</span>
            <span>{formatTime(visibleTracks.reduce((sum, track) => sum + track.duration, 0))}</span>
          </div>
        </section>

        <TrackList
          tracks={visibleTracks}
          playlists={playlists}
          currentTrackId={currentTrackId}
          isPlaying={isPlaying}
          onPlay={setCurrentTrack}
          onAddToPlaylist={addTrackToPlaylist}
        />
      </section>

      <PlayerBar
        currentTrack={currentTrack}
        isPlaying={isPlaying}
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
    </main>
  )
}

type SidebarProps = {
  activePlaylistId: string
  playlists: Playlist[]
  tracks: Track[]
  playlistName: string
  setPlaylistName: (name: string) => void
  onSelect: (playlistId: string) => void
  onCreate: () => void
}

function Sidebar({
  activePlaylistId,
  playlists,
  tracks,
  playlistName,
  setPlaylistName,
  onSelect,
  onCreate,
}: SidebarProps) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">
          <ListMusic size={22} />
        </div>
        <div>
          <strong>Resonance</strong>
          <span>Local library</span>
        </div>
      </div>

      <nav className="nav-stack" aria-label="Music sections">
        <button
          className={activePlaylistId === libraryId ? 'nav-item active' : 'nav-item'}
          type="button"
          onClick={() => onSelect(libraryId)}
        >
          <Disc3 size={18} />
          <span>All Songs</span>
          <em>{tracks.length}</em>
        </button>
        {playlists.map((playlist) => (
          <button
            key={playlist.id}
            className={activePlaylistId === playlist.id ? 'nav-item active' : 'nav-item'}
            type="button"
            onClick={() => onSelect(playlist.id)}
          >
            {playlist.id === favoritesId ? <Heart size={18} /> : <ListMusic size={18} />}
            <span>{playlist.name}</span>
            <em>{playlist.trackIds.length}</em>
          </button>
        ))}
      </nav>

      <div className="playlist-form">
        <input
          value={playlistName}
          onChange={(event) => setPlaylistName(event.target.value)}
          placeholder="New playlist"
          onKeyDown={(event) => {
            if (event.key === 'Enter') onCreate()
          }}
        />
        <button type="button" aria-label="Create playlist" onClick={onCreate}>
          <Plus size={18} />
        </button>
      </div>
    </aside>
  )
}

type TrackListProps = {
  tracks: Track[]
  playlists: Playlist[]
  currentTrackId?: string
  isPlaying: boolean
  onPlay: (trackId: string) => void
  onAddToPlaylist: (playlistId: string, trackId: string) => void
}

function TrackList({
  tracks,
  playlists,
  currentTrackId,
  isPlaying,
  onPlay,
  onAddToPlaylist,
}: TrackListProps) {
  if (tracks.length === 0) {
    return (
      <motion.div className="empty-state" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }}>
        <Disc3 size={42} />
        <h3>Your library is waiting</h3>
        <p>Add music files, then add a cover-art folder. Covers match songs when filenames are the same.</p>
      </motion.div>
    )
  }

  return (
    <motion.div className="track-list" layout>
      <AnimatePresence initial={false}>
        {tracks.map((track, index) => (
          <motion.article
            className={currentTrackId === track.id ? 'track-row active' : 'track-row'}
            key={track.id}
            layout
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{ delay: Math.min(index * 0.025, 0.18), duration: 0.28 }}
          >
            <button className="track-play" type="button" onClick={() => onPlay(track.id)} aria-label={`Play ${track.title}`}>
              {currentTrackId === track.id && isPlaying ? <Pause size={16} /> : <Play size={16} />}
            </button>
            <div className="mini-cover" style={{ '--cover-accent': track.accent } as CSSProperties}>
              {track.coverUrl ? <img src={track.coverUrl} alt="" /> : <Disc3 size={20} />}
            </div>
            <div className="track-meta">
              <strong>{track.title}</strong>
              <span>{track.artist}</span>
            </div>
            <span className="track-album">{track.album}</span>
            <span className="track-time">{formatTime(track.duration)}</span>
            <select
              aria-label={`Add ${track.title} to playlist`}
              defaultValue=""
              onChange={(event) => {
                if (!event.target.value) return
                onAddToPlaylist(event.target.value, track.id)
                event.target.value = ''
              }}
            >
              <option value="">Add to</option>
              {playlists.map((playlist) => (
                <option key={playlist.id} value={playlist.id}>
                  {playlist.name}
                </option>
              ))}
            </select>
          </motion.article>
        ))}
      </AnimatePresence>
    </motion.div>
  )
}

type PlayerBarProps = {
  currentTrack?: Track
  isPlaying: boolean
  seek: number
  shuffle: boolean
  repeat: string
  volume: number
  onTogglePlay: () => void
  onPrevious: () => void
  onNext: () => void
  onSeek: (value: number) => void
  onShuffle: () => void
  onRepeat: () => void
  onVolume: (value: number) => void
}

function PlayerBar({
  currentTrack,
  isPlaying,
  seek,
  shuffle,
  repeat,
  volume,
  onTogglePlay,
  onPrevious,
  onNext,
  onSeek,
  onShuffle,
  onRepeat,
  onVolume,
}: PlayerBarProps) {
  return (
    <footer className="player-bar">
      <div className="player-track">
        <div className="mini-cover large" style={{ '--cover-accent': currentTrack?.accent } as CSSProperties}>
          {currentTrack?.coverUrl ? <img src={currentTrack.coverUrl} alt="" /> : <Disc3 size={22} />}
        </div>
        <div>
          <strong>{currentTrack?.title ?? 'No track selected'}</strong>
          <span>{currentTrack?.artist ?? 'Choose a song to start'}</span>
        </div>
      </div>

      <div className="transport">
        <div className="transport-buttons">
          <button className={shuffle ? 'control active' : 'control'} type="button" onClick={onShuffle} aria-label="Toggle shuffle">
            <Shuffle size={18} />
          </button>
          <button className="control" type="button" onClick={onPrevious} aria-label="Previous track">
            <SkipBack size={20} />
          </button>
          <button className="play-button" type="button" onClick={onTogglePlay} aria-label={isPlaying ? 'Pause' : 'Play'}>
            {isPlaying ? <Pause size={24} /> : <Play size={24} />}
          </button>
          <button className="control" type="button" onClick={onNext} aria-label="Next track">
            <SkipForward size={20} />
          </button>
          <button className={repeat !== 'off' ? 'control active' : 'control'} type="button" onClick={onRepeat} aria-label="Cycle repeat mode">
            {repeat === 'one' ? <Repeat1 size={18} /> : <Repeat size={18} />}
          </button>
        </div>
        <div className="progress-line">
          <span>{formatTime(seek)}</span>
          <input
            type="range"
            min="0"
            max={Math.max(currentTrack?.duration ?? 0, 1)}
            step="1"
            value={Math.min(seek, currentTrack?.duration ?? 0)}
            onChange={(event) => onSeek(Number(event.target.value))}
            aria-label="Playback progress"
          />
          <span>{formatTime(currentTrack?.duration ?? 0)}</span>
        </div>
      </div>

      <label className="volume">
        <Volume2 size={18} />
        <input
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={volume}
          onChange={(event) => onVolume(Number(event.target.value))}
          aria-label="Volume"
        />
      </label>
    </footer>
  )
}

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

export default App
