import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent, CSSProperties } from 'react'
import {
  CloseFilled,
  DiscFilled,
  FolderImageFilled,
  FolderMusicFilled,
  PauseFilled,
  PencilFilled,
  PlayFilled,
  UploadFilled,
} from './icons'
import PlaylistDropdown from './PlaylistDropdown'
import { libraryId } from '../store/useMusicStore'
import { cleanDisplayTitle, formatTime } from '../utils/library'
import type { Playlist, Track } from '../types'

const TRACK_BATCH_SIZE = 120

export type TrackListProps = {
  tracks: Track[]
  playlists: Playlist[]
  activePlaylistId: string
  query?: string
  activePlaylist?: Playlist
  currentTrackId?: string
  isPlaying: boolean
  onPlay: (trackId: string) => void
  onAddToPlaylist: (playlistId: string, trackId: string) => void
  onRemoveFromPlaylist: (playlistId: string, trackId: string) => void
  onEditTrack: (track: Track) => void
  onAddSongs?: (e: ChangeEvent<HTMLInputElement>) => void
  onAddMusicFolder?: (e: ChangeEvent<HTMLInputElement>) => void
  onAddCoverFolder?: (e: ChangeEvent<HTMLInputElement>) => void
  isDesktop?: boolean
  onNativeAddSongs?: () => void
  onNativeMusicFolder?: () => void
  onNativeCoverFolder?: () => void
}

export function TrackList({
  tracks,
  playlists,
  activePlaylistId,
  query = '',
  activePlaylist,
  currentTrackId,
  isPlaying,
  onPlay,
  onAddToPlaylist,
  onRemoveFromPlaylist,
  onEditTrack,
  onAddSongs,
  onAddMusicFolder,
  onAddCoverFolder,
  isDesktop = false,
  onNativeAddSongs,
  onNativeMusicFolder,
  onNativeCoverFolder,
}: TrackListProps) {
  // Keep initial renders bounded for large libraries, while retaining natural
  // document scrolling and an accessible manual fallback.
  const [visibleCount, setVisibleCount] = useState(TRACK_BATCH_SIZE)
  const moreRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setVisibleCount(TRACK_BATCH_SIZE)
  }, [activePlaylistId, query])

  useEffect(() => {
    if (visibleCount >= tracks.length || typeof IntersectionObserver === 'undefined') return
    const element = moreRef.current
    if (!element) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisibleCount((count) => Math.min(tracks.length, count + TRACK_BATCH_SIZE))
        }
      },
      { rootMargin: '500px 0px' },
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [tracks.length, visibleCount])

  if (tracks.length === 0) {
    return (
      <motion.div className="empty-state" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }}>
        <DiscFilled size={42} />
        <h3>Your library is waiting</h3>
        <p>Add songs manually or import an entire music folder. Covers will automatically be applied to songs in your library.</p>
        <div className="empty-state-actions">
          {isDesktop && onNativeAddSongs ? (
            <button
              type="button"
              className="empty-state-btn"
              title="Select audio files from your computer"
              onClick={onNativeAddSongs}
            >
              <UploadFilled size={15} />
              <span>Add songs</span>
            </button>
          ) : (
            onAddSongs && (
              <label className="empty-state-btn" title="Manually select audio files">
                <UploadFilled size={15} />
                <span>Add songs</span>
                <input type="file" accept="audio/*" multiple onChange={onAddSongs} />
              </label>
            )
          )}

          {isDesktop && onNativeMusicFolder ? (
            <button
              type="button"
              className="empty-state-btn"
              title="Import an entire music folder from your computer"
              onClick={onNativeMusicFolder}
            >
              <FolderMusicFilled size={15} />
              <span>Music folder</span>
            </button>
          ) : (
            onAddMusicFolder && (
              <label className="empty-state-btn" title="Import an entire music folder">
                <FolderMusicFilled size={15} />
                <span>Music folder</span>
                <input
                  type="file"
                  multiple
                  onChange={onAddMusicFolder}
                  {...{ webkitdirectory: '', directory: '' }}
                />
              </label>
            )
          )}

          {isDesktop && onNativeCoverFolder ? (
            <button
              type="button"
              className="empty-state-btn subtle"
              title="Import a folder of cover artwork from your computer"
              onClick={onNativeCoverFolder}
            >
              <FolderImageFilled size={15} />
              <span>Cover folder</span>
            </button>
          ) : (
            onAddCoverFolder && (
              <label className="empty-state-btn subtle" title="Import a folder of cover artwork">
                <FolderImageFilled size={15} />
                <span>Cover folder</span>
                <input
                  type="file"
                  multiple
                  onChange={onAddCoverFolder}
                  {...{ webkitdirectory: '', directory: '' }}
                />
              </label>
            )
          )}
        </div>
      </motion.div>
    )
  }

  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={activePlaylistId}
        className="track-list"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -6 }}
        transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
      >
        {tracks.slice(0, visibleCount).map((track, index) => (
          <motion.article
            className={currentTrackId === track.id ? 'track-row active' : 'track-row'}
            key={track.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: Math.min(index * 0.018, 0.14), duration: 0.22, ease: 'easeOut' }}
            onClick={() => onPlay(track.id)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                if (e.target === e.currentTarget) {
                  e.preventDefault()
                  onPlay(track.id)
                }
              }
            }}
          >
            <button
              className="track-play"
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onPlay(track.id)
              }}
              title={currentTrackId === track.id && isPlaying ? 'Pause' : 'Play'}
              aria-label={currentTrackId === track.id && isPlaying ? 'Pause' : 'Play'}
            >
              {currentTrackId === track.id && isPlaying ? (
                <PauseFilled size={18} />
              ) : (
                <PlayFilled size={18} />
              )}
            </button>
            <div className="mini-cover" style={{ '--cover-accent': track.accent } as CSSProperties}>
              {track.coverUrl ? <img src={track.coverUrl} alt="" /> : <DiscFilled size={20} />}
            </div>
            <div className="track-meta">
              <strong>{cleanDisplayTitle(track.title)}</strong>
              <span>{track.artist}</span>
            </div>
            <span className="track-album">{track.album}</span>
            <span className="track-time">{formatTime(track.duration)}</span>
            <PlaylistDropdown
              trackId={track.id}
              trackTitle={cleanDisplayTitle(track.title)}
              playlists={playlists}
              onAddToPlaylist={onAddToPlaylist}
              onRemoveFromPlaylist={onRemoveFromPlaylist}
            />
            <div className="track-row-btns" onClick={(e) => e.stopPropagation()}>
              <button
                type="button"
                className="track-edit-btn"
                onClick={(e) => {
                  e.stopPropagation()
                  onEditTrack(track)
                }}
                title={`Rename or edit details for ${cleanDisplayTitle(track.title)}`}
                aria-label={`Edit ${cleanDisplayTitle(track.title)}`}
              >
                <PencilFilled size={15} />
              </button>
              {activePlaylistId !== libraryId && (
                <button
                  type="button"
                  className="track-remove-from-playlist-btn"
                  onClick={(e) => {
                    e.stopPropagation()
                    onRemoveFromPlaylist(activePlaylistId, track.id)
                  }}
                  title={`Remove "${cleanDisplayTitle(track.title)}" from ${activePlaylist?.name ?? 'playlist'}`}
                  aria-label={`Remove "${cleanDisplayTitle(track.title)}" from ${activePlaylist?.name ?? 'playlist'}`}
                >
                  <CloseFilled size={15} />
                </button>
              )}
            </div>
          </motion.article>
        ))}
        {visibleCount < tracks.length && (
          <div className="track-list-more" ref={moreRef}>
            <button
              type="button"
              onClick={() => setVisibleCount((count) => Math.min(tracks.length, count + TRACK_BATCH_SIZE))}
            >
              Show more songs ({tracks.length - visibleCount} remaining)
            </button>
          </div>
        )}
      </motion.div>
    </AnimatePresence>
  )
}

export default TrackList
