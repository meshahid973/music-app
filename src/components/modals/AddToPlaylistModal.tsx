import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { motion } from 'framer-motion'
import { CheckFilled, CloseFilled, DiscFilled, PlusFilled, SearchFilled } from '../icons'
import { cleanDisplayTitle, formatTime } from '../../utils/library'
import type { Playlist, Track } from '../../types'
import { getVirtualListRange } from '../../utils/virtualList.ts'

export type AddToPlaylistModalProps = {
  playlist: Playlist
  allTracks: Track[]
  onClose: () => void
  onAddTrack: (playlistId: string, trackId: string) => void
  onRemoveTrack?: (playlistId: string, trackId: string) => void
}

const ROW_HEIGHT = 72
const ROW_STEP = 80 // 72px rows with 8px gap

export function AddToPlaylistModal({
  playlist,
  allTracks,
  onClose,
  onAddTrack,
  onRemoveTrack,
}: AddToPlaylistModalProps) {
  const [query, setQuery] = useState('')
  const searchInputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const [visibleRange, setVisibleRange] = useState({ start: 0, end: 24 })

  useEffect(() => {
    searchInputRef.current?.focus()
  }, [])

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const normalizedQuery = query.trim().toLowerCase()

  const filteredTracks = useMemo(() => {
    if (!normalizedQuery) return allTracks
    return allTracks.filter((track) => {
      const title = cleanDisplayTitle(track.title).toLowerCase()
      const artist = track.artist.toLowerCase()
      const album = (track.album || '').toLowerCase()
      return (
        title.includes(normalizedQuery) ||
        artist.includes(normalizedQuery) ||
        album.includes(normalizedQuery)
      )
    })
  }, [allTracks, normalizedQuery])

  // Search can shrink the list while it is scrolled near the end; reset before
  // paint to prevent a blank result window.
  useLayoutEffect(() => {
    const list = listRef.current
    if (list) list.scrollTop = 0
    setVisibleRange((previous) => {
      const next = getVirtualListRange(filteredTracks.length, 0, list?.clientHeight ?? 900, ROW_STEP, 6)
      return previous.start === next.start && previous.end === next.end ? previous : next
    })
  }, [normalizedQuery, playlist.id, filteredTracks.length])

  const handleScroll = () => {
    const list = listRef.current
    if (!list) return
    const next = getVirtualListRange(filteredTracks.length, list.scrollTop, list.clientHeight, ROW_STEP, 6)
    setVisibleRange((previous) =>
      previous.start === next.start && previous.end === next.end ? previous : next,
    )
  }

  const inPlaylistSet = useMemo(() => new Set(playlist.trackIds), [playlist.trackIds])

  return (
    <motion.div
      className="modal-backdrop"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-playlist-modal-title"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
    >
      <motion.div
        className="modal-card modal-card-lg add-to-playlist-modal-card"
        onClick={(e) => e.stopPropagation()}
        initial={{ opacity: 0, scale: 0.95, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 12 }}
        transition={{ type: 'spring', damping: 26, stiffness: 380 }}
      >
        <div className="modal-header">
          <div>
            <h2 id="add-playlist-modal-title" className="modal-title">
              Add songs to "{playlist.name}"
            </h2>
            <p className="modal-sub">
              {inPlaylistSet.size} {inPlaylistSet.size === 1 ? 'song' : 'songs'} in playlist ·{' '}
              {allTracks.length} available in library
            </p>
          </div>
          <button
            type="button"
            className="modal-close-btn"
            onClick={onClose}
            aria-label="Close dialog"
            title="Close"
          >
            <CloseFilled size={16} />
          </button>
        </div>

        <div className="add-playlist-search-wrap">
          <div className="search-box add-playlist-search-box">
            <SearchFilled size={18} />
            <input
              ref={searchInputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search all songs by title, artist, or album..."
              aria-label="Search songs to add"
            />
            {query && (
              <button
                type="button"
                className="search-clear-btn"
                onClick={() => setQuery('')}
                title="Clear search"
                aria-label="Clear search"
              >
                <CloseFilled size={14} />
              </button>
            )}
          </div>
        </div>

        <div className="add-playlist-track-list" ref={listRef} onScroll={handleScroll} role="list">
          {allTracks.length === 0 ? (
            <div className="add-playlist-empty">
              <DiscFilled size={36} />
              <p>Your library is empty. Import songs first to add them to this playlist.</p>
            </div>
          ) : filteredTracks.length === 0 ? (
            <div className="add-playlist-empty">
              <SearchFilled size={36} />
              <p>No songs found matching "{query}"</p>
            </div>
          ) : (
            <div className="add-playlist-track-spacer" style={{ height: Math.max(0, filteredTracks.length * ROW_STEP - (ROW_STEP - ROW_HEIGHT)) }}>
              {filteredTracks.slice(visibleRange.start, visibleRange.end).map((track, index) => {
              const isAdded = inPlaylistSet.has(track.id)
              return (
                <div
                  key={track.id}
                  className={`add-playlist-track-row ${isAdded ? 'is-added' : ''}`}
                  style={{ top: `${(visibleRange.start + index) * ROW_STEP}px` }}
                  role="listitem"
                >
                  <div
                    className="mini-cover"
                    style={{ '--cover-accent': track.accent } as CSSProperties}
                  >
                    {track.coverUrl ? (
                      <img src={track.coverUrl} alt="" loading="lazy" decoding="async" />
                    ) : (
                      <DiscFilled size={18} />
                    )}
                  </div>

                  <div className="add-playlist-track-info">
                    <strong className="add-playlist-track-title">
                      {cleanDisplayTitle(track.title)}
                    </strong>
                    <span className="add-playlist-track-sub">
                      {track.artist}
                      {track.album ? ` · ${track.album}` : ''}
                    </span>
                  </div>

                  <span className="add-playlist-track-time">{formatTime(track.duration)}</span>

                  <div className="add-playlist-track-action">
                    {isAdded ? (
                      <motion.button
                        type="button"
                        className="add-song-toggle-btn added"
                        onClick={() => {
                          if (onRemoveTrack) {
                            onRemoveTrack(playlist.id, track.id)
                          }
                        }}
                        title={`Remove "${cleanDisplayTitle(track.title)}" from ${playlist.name}`}
                        aria-label={`Remove "${cleanDisplayTitle(track.title)}" from ${playlist.name}`}
                      >
                        <CheckFilled size={14} />
                        <span>Added</span>
                      </motion.button>
                    ) : (
                      <motion.button
                        type="button"
                        className="add-song-toggle-btn add"
                        onClick={() => onAddTrack(playlist.id, track.id)}
                        title={`Add "${cleanDisplayTitle(track.title)}" to ${playlist.name}`}
                        aria-label={`Add "${cleanDisplayTitle(track.title)}" to ${playlist.name}`}
                      >
                        <PlusFilled size={15} />
                        <span>Add</span>
                      </motion.button>
                    )}
                  </div>
                </div>
              )
              })}
            </div>
          )}
        </div>

        <div className="modal-actions add-playlist-modal-footer">
          <span className="add-playlist-footer-count">
            {inPlaylistSet.size} of {allTracks.length} tracks in this playlist
          </span>
          <button type="button" className="btn btn-primary" onClick={onClose}>
            Done
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}
