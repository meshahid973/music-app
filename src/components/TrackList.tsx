import { AnimatePresence, motion } from 'framer-motion'
import { EllipsisVertical } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ChangeEvent, CSSProperties } from 'react'
import {
  CloseFilled,
  DiscFilled,
  FolderImageFilled,
  FolderMusicFilled,
  HeartFilled,
  HeartOutline,
  PauseFilled,
  PencilFilled,
  PlayFilled,
  PlusFilled,
  TrashFilled,
  UploadFilled,
} from './icons'
import { favoritesId, libraryId } from '../store/useMusicStore'
import { cleanDisplayTitle, formatTime } from '../utils/library'
import type { Playlist, Track } from '../types'
import { getVirtualListRange } from '../utils/virtualList.ts'

export type TrackListProps = {
  tracks: Track[]
  filterQuery?: string
  playlists: Playlist[]
  activePlaylistId: string
  activePlaylist?: Playlist
  currentTrackId?: string
  isPlaying: boolean
  onPlay: (trackId: string) => void
  onAddToPlaylist?: (playlistId: string, trackId: string) => void
  onRemoveFromPlaylist?: (playlistId: string, trackId: string) => void
  onToggleFavorite: (trackId: string) => void
  onOpenAddToPlaylist?: (playlist: Playlist) => void
  onEditTrack: (track: Track) => void
  onDeleteTrack: (track: Track) => void
  onAddSongs?: (e: ChangeEvent<HTMLInputElement>) => void
  onAddMusicFolder?: (e: ChangeEvent<HTMLInputElement>) => void
  onAddCoverFolder?: (e: ChangeEvent<HTMLInputElement>) => void
  isDesktop?: boolean
  onNativeAddSongs?: () => void
  onNativeMusicFolder?: () => void
  onNativeCoverFolder?: () => void
}

const TRACK_ROW_HEIGHT = 86
export function TrackList({
  tracks,
  filterQuery = '',
  playlists,
  activePlaylistId,
  activePlaylist,
  currentTrackId,
  isPlaying,
  onPlay,
  onRemoveFromPlaylist,
  onToggleFavorite,
  onOpenAddToPlaylist,
  onEditTrack,
  onDeleteTrack,
  onAddSongs,
  onAddMusicFolder,
  onAddCoverFolder,
  isDesktop = false,
  onNativeAddSongs,
  onNativeMusicFolder,
  onNativeCoverFolder,
}: TrackListProps) {
  const listRef = useRef<HTMLDivElement | null>(null)
  const [visibleRange, setVisibleRange] = useState({ start: 0, end: 32 })
  const [openMenuTrackId, setOpenMenuTrackId] = useState<string | null>(null)

  useEffect(() => {
    if (!openMenuTrackId) return

    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (event.target instanceof Element && !event.target.closest('.track-action-menu')) {
        setOpenMenuTrackId(null)
      }
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenMenuTrackId(null)
    }

    document.addEventListener('pointerdown', closeOnOutsidePointer)
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer)
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [openMenuTrackId])

  // Search changes can shrink a large virtual list to just a few rows. Reset the
  // virtual window before paint so stale scroll offsets never leave blank space.
  useLayoutEffect(() => {
    setVisibleRange({ start: 0, end: 32 })
  }, [filterQuery, activePlaylistId])

  const updateVisibleRange = useCallback(() => {
    const list = listRef.current
    const scrollContainer = list?.closest<HTMLElement>('.content')
    if (!list || !scrollContainer) return

    const listTop = list.getBoundingClientRect().top -
      scrollContainer.getBoundingClientRect().top +
      scrollContainer.scrollTop
    const relativeTop = Math.max(0, scrollContainer.scrollTop - listTop)
    const nextRange = getVirtualListRange(
      tracks.length,
      relativeTop,
      scrollContainer.clientHeight,
      TRACK_ROW_HEIGHT,
    )

    setVisibleRange((current) =>
      current.start === nextRange.start && current.end === nextRange.end
        ? current
        : nextRange,
    )
  }, [tracks.length])

  useEffect(() => {
    const list = listRef.current
    const scrollContainer = list?.closest<HTMLElement>('.content')
    if (!list || !scrollContainer) return

    let frame = 0
    const scheduleUpdate = () => {
      if (frame) cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        frame = 0
        updateVisibleRange()
      })
    }

    scrollContainer.addEventListener('scroll', scheduleUpdate, { passive: true })
    window.addEventListener('resize', scheduleUpdate)
    scheduleUpdate()
    return () => {
      scrollContainer.removeEventListener('scroll', scheduleUpdate)
      window.removeEventListener('resize', scheduleUpdate)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [activePlaylistId, updateVisibleRange])

  const favoritesPlaylist = playlists.find((p) => p.id === favoritesId)
  const favoriteTrackIds = new Set(favoritesPlaylist?.trackIds ?? [])

  if (tracks.length === 0) {
    if (activePlaylistId !== libraryId && activePlaylist) {
      return (
        <motion.div
          className="empty-state empty-playlist-state"
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <DiscFilled size={42} />
          <h3>"{activePlaylist.name}" is empty</h3>
          <p>There are no songs in this playlist yet. Add songs from your library.</p>
          {onOpenAddToPlaylist && (
            <div className="empty-state-actions">
              <button
                type="button"
                className="empty-state-btn primary-action"
                onClick={() => onOpenAddToPlaylist(activePlaylist)}
              >
                <PlusFilled size={15} />
                <span>Add to playlist</span>
              </button>
            </div>
          )}
        </motion.div>
      )
    }

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
        ref={listRef}
        className="track-list track-list-virtual"
        style={{ height: Math.max(0, tracks.length * TRACK_ROW_HEIGHT - 10) }}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -6 }}
        transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
      >
        <AnimatePresence initial={false} mode="popLayout">
        {tracks.slice(visibleRange.start, visibleRange.end).map((track, offset) => {
          const index = visibleRange.start + offset
          const isCurrentTrack = currentTrackId === track.id
          const isFavorited = favoriteTrackIds.has(track.id)
          return (
            <motion.article
              className={`track-row ${isCurrentTrack ? 'active ' : ''}${openMenuTrackId === track.id ? 'menu-open' : ''}`}
              key={track.id}
              initial={isCurrentTrack ? { opacity: 0 } : { opacity: 0, y: 10 }}
              animate={isCurrentTrack ? { opacity: 1 } : { opacity: 1, y: 0 }}
              exit={isCurrentTrack ? { opacity: 0 } : { opacity: 0, y: -8 }}
              transition={{
                opacity: { duration: 0.2, delay: Math.min(offset * 0.008, 0.08) },
                y: { duration: 0.24, ease: [0.22, 1, 0.36, 1], delay: Math.min(offset * 0.006, 0.06) },
              }}
              style={{
                position: 'absolute',
                top: index * TRACK_ROW_HEIGHT,
                left: 0,
                right: 0,
                height: TRACK_ROW_HEIGHT - 10,
              }}
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
              <motion.button
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
              </motion.button>
              <div className="mini-cover" style={{ '--cover-accent': track.accent } as CSSProperties}>
                {track.coverUrl ? <img src={track.coverUrl} alt="" /> : <DiscFilled size={20} />}
              </div>
              <div className="track-meta">
                <div className="track-title-row">
                  <strong>{cleanDisplayTitle(track.title)}</strong>
                  {currentTrackId === track.id && isPlaying && (
                    <div className="track-equalizer" title="Playing" aria-label="Now playing">
                      <span className="eq-bar eq-1" />
                      <span className="eq-bar eq-2" />
                      <span className="eq-bar eq-3" />
                    </div>
                  )}
                </div>
                <span>{track.artist}</span>
              </div>
              <span className="track-album">{track.album}</span>
              <span className="track-time">{formatTime(track.duration)}</span>

              {/* Heart button to automatically add/remove from Favorites */}
              <motion.button
                type="button"
                className={`track-heart-btn ${isFavorited ? 'is-favorited' : ''}`}
                onClick={(e) => {
                  e.stopPropagation()
                  onToggleFavorite(track.id)
                }}
                title={
                  isFavorited
                    ? `Remove "${cleanDisplayTitle(track.title)}" from Favorites`
                    : `Add "${cleanDisplayTitle(track.title)}" to Favorites`
                }
                aria-label={
                  isFavorited
                    ? `Remove "${cleanDisplayTitle(track.title)}" from Favorites`
                    : `Add "${cleanDisplayTitle(track.title)}" to Favorites`
                }
              >
                {isFavorited ? (
                  <HeartFilled size={19} color="#ff3b69" className="heart-icon-filled" />
                ) : (
                  <HeartOutline size={19} className="heart-icon-outline" />
                )}
              </motion.button>

              <div className="track-row-btns" onClick={(e) => e.stopPropagation()}>
                <div className="track-action-menu">
                  <button
                    type="button"
                    className="track-more-btn"
                    aria-label={`More actions for ${cleanDisplayTitle(track.title)}`}
                    aria-haspopup="menu"
                    aria-expanded={openMenuTrackId === track.id}
                    title="Song actions"
                    onClick={(e) => {
                      e.stopPropagation()
                      setOpenMenuTrackId((current) => current === track.id ? null : track.id)
                    }}
                  >
                    <EllipsisVertical size={18} />
                  </button>
                  {openMenuTrackId === track.id && (
                    <div className="track-action-menu-popover" role="menu" aria-label={`Actions for ${cleanDisplayTitle(track.title)}`}>
                      <button
                        type="button"
                        role="menuitem"
                        className="track-menu-item"
                        onClick={(e) => {
                          e.stopPropagation()
                          setOpenMenuTrackId(null)
                          onEditTrack(track)
                        }}
                      >
                        <PencilFilled size={14} />
                        <span>Edit</span>
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        className="track-menu-item danger"
                        title="Remove from Resonance; keeps the original audio file"
                        onClick={(e) => {
                          e.stopPropagation()
                          setOpenMenuTrackId(null)
                          onDeleteTrack(track)
                        }}
                      >
                        <TrashFilled size={14} />
                        <span>Delete</span>
                      </button>
                    </div>
                  )}
                </div>
                {activePlaylistId !== libraryId && (
                  <motion.button
                    type="button"
                    className="track-remove-from-playlist-btn"
                    onClick={(e) => {
                      e.stopPropagation()
                      onRemoveFromPlaylist?.(activePlaylistId, track.id)
                    }}
                    title={`Remove "${cleanDisplayTitle(track.title)}" from ${activePlaylist?.name ?? 'playlist'}`}
                    aria-label={`Remove "${cleanDisplayTitle(track.title)}" from ${activePlaylist?.name ?? 'playlist'}`}
                  >
                    <CloseFilled size={15} />
                  </motion.button>
                )}
              </div>
            </motion.article>
          )
        })}
        </AnimatePresence>
      </motion.div>
    </AnimatePresence>
  )
}

export default TrackList
