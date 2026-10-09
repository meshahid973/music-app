import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useState } from 'react'
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
import {
  useAudioPlayback,
  useHeroTheme,
  useKeyboardShortcuts,
  useLibraryImport,
  usePlaylistManager,
  useTrackFilter,
} from './hooks'
import { useMusicStore } from './store/useMusicStore'
import { formatTime } from './utils/library'
import type { Track } from './types'

function App() {
  const [editingTrack, setEditingTrack] = useState<Track | null>(null)

  const {
    tracks,
    playlists,
    activePlaylistId,
    isPlaying,
    shuffle,
    repeat,
    volume,
    initDesktopStorage,
    setActivePlaylist,
    addTrackToPlaylist,
    removeTrackFromPlaylist,
    toggleShuffle,
    cycleRepeat,
    setVolume,
    updateTrack,
  } = useMusicStore()

  // Initialize desktop local database storage on launch
  useEffect(() => {
    initDesktopStorage()
  }, [initDesktopStorage])

  // 1. Playlist and queue management
  const {
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
  } = usePlaylistManager()

  // 2. Search and track filtering
  const { query, setQuery, visibleTracks, totalDuration, trackCount } =
    useTrackFilter(tracks, activePlaylistId, activePlaylist)

  // 3. Audio playback lifecycle & synchronization
  const {
    audioRef,
    seek,
    currentTrack,
    handleSeek,
    playPrevious,
    playNext,
    handleTrackPlay,
    togglePlay,
  } = useAudioPlayback(queueRef)

  // 4. File importing & drag/drop (supporting both native dialogs & web drag/drop)
  const {
    isDesktop,
    musicFolderName,
    coverFolderName,
    isScanningMusic,
    isScanningCovers,
    scanNotice,
    handleNativeAddSongs,
    handleNativeMusicFolder,
    handleNativeCoverFolder,
    handleRescanMusicFolder,
    handleRescanCoverFolder,
    handleMusicFiles,
    handleMusicFolder,
    handleCoverFolder,
    handleDrop,
  } = useLibraryImport()

  // 5. Global keyboard shortcuts (e.g. Space to play/pause, media keys)
  useKeyboardShortcuts({
    onTogglePlay: () => togglePlay(visibleTracks[0]?.id, visibleTracks.map((t) => t.id)),
    onPrevious: playPrevious,
    onNext: playNext,
  })

  // 6. Dynamic cover color accent theme
  const heroTheme = useHeroTheme(currentTrack?.coverUrl, currentTrack?.accent)

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
        onRenamePlaylist={setPlaylistToRename}
        onDeletePlaylist={setPlaylistToDelete}
        playlistName={newPlaylistName}
        setPlaylistName={setNewPlaylistName}
        onAddSongs={handleMusicFiles}
        onAddMusicFolder={handleMusicFolder}
        onAddCoverFolder={handleCoverFolder}
        isDesktop={isDesktop}
        onNativeAddSongs={handleNativeAddSongs}
        onNativeMusicFolder={handleNativeMusicFolder}
        onNativeCoverFolder={handleNativeCoverFolder}
        onRescanMusicFolder={handleRescanMusicFolder}
        onRescanCoverFolder={handleRescanCoverFolder}
        isScanningMusic={isScanningMusic}
        isScanningCovers={isScanningCovers}
        musicFolderName={musicFolderName}
        coverFolderName={coverFolderName}
        scanNotice={scanNotice}
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
          onTogglePlay={() => togglePlay(visibleTracks[0]?.id, visibleTracks.map((t) => t.id))}
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
              {trackCount} {trackCount === 1 ? 'song' : 'songs'} · {formatTime(totalDuration)}
            </span>
          </div>
        </section>

        <TrackList
          tracks={visibleTracks}
          query={query}
          playlists={playlists}
          activePlaylistId={activePlaylistId}
          activePlaylist={activePlaylist}
          currentTrackId={currentTrack?.id}
          isPlaying={isPlaying}
          onPlay={(trackId) => handleTrackPlay(trackId, visibleTracks.map((t) => t.id))}
          onAddToPlaylist={addTrackToPlaylist}
          onRemoveFromPlaylist={removeTrackFromPlaylist}
          onEditTrack={setEditingTrack}
          onAddSongs={handleMusicFiles}
          onAddMusicFolder={handleMusicFolder}
          onAddCoverFolder={handleCoverFolder}
          isDesktop={isDesktop}
          onNativeAddSongs={handleNativeAddSongs}
          onNativeMusicFolder={handleNativeMusicFolder}
          onNativeCoverFolder={handleNativeCoverFolder}
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
        onTogglePlay={() => togglePlay(visibleTracks[0]?.id, visibleTracks.map((t) => t.id))}
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
          onSave={handleConfirmRename}
        />
      )}

      {playlistToDelete && (
        <DeletePlaylistModal
          playlist={playlistToDelete}
          onClose={() => setPlaylistToDelete(null)}
          onConfirm={handleConfirmDelete}
        />
      )}
    </main>
  )
}

export default App
