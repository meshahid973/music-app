import { useEffect, useRef, useState } from 'react'
import {
  CheckFilled,
  ChevronDownFilled,
  HeartFilled,
  PlaylistFilled,
} from './icons'
import { favoritesId } from '../store/useMusicStore'
import type { Playlist } from '../types'

export type PlaylistDropdownProps = {
  trackId: string
  trackTitle: string
  playlists: Playlist[]
  onAddToPlaylist: (playlistId: string, trackId: string) => void
  onRemoveFromPlaylist: (playlistId: string, trackId: string) => void
}

export function PlaylistDropdown({
  trackId,
  trackTitle,
  playlists,
  onAddToPlaylist,
  onRemoveFromPlaylist,
}: PlaylistDropdownProps) {
  const [isOpen, setIsOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen])

  function handleToggle(playlist: Playlist) {
    if (playlist.trackIds.includes(trackId)) {
      onRemoveFromPlaylist(playlist.id, trackId)
    } else {
      onAddToPlaylist(playlist.id, trackId)
    }
  }

  return (
    <div className="playlist-dropdown-wrapper" ref={dropdownRef}>
      <button
        type="button"
        className={`playlist-dropdown-trigger ${isOpen ? 'active' : ''}`}
        onClick={(e) => {
          e.stopPropagation()
          setIsOpen(!isOpen)
        }}
        aria-haspopup="true"
        aria-expanded={isOpen}
        aria-label={`Manage playlists for ${trackTitle}`}
      >
        <span>Add to</span>
        <ChevronDownFilled size={14} className={`dropdown-chevron ${isOpen ? 'open' : ''}`} />
      </button>

      {isOpen && (
        <div className="playlist-menu" role="menu">
          <div className="playlist-menu-header">Add or Remove from Playlist</div>
          {playlists.map((playlist) => {
            const isAlreadyIn = playlist.trackIds.includes(trackId)
            return (
              <button
                key={playlist.id}
                type="button"
                className={`playlist-menu-item ${isAlreadyIn ? 'is-added' : ''}`}
                onClick={(e) => {
                  e.stopPropagation()
                  handleToggle(playlist)
                }}
                role="menuitem"
                title={isAlreadyIn ? `Remove from ${playlist.name}` : `Add to ${playlist.name}`}
              >
                <div className="playlist-item-label">
                  {playlist.id === favoritesId ? (
                    <HeartFilled size={14} className="playlist-icon heart" />
                  ) : (
                    <PlaylistFilled size={14} className="playlist-icon" />
                  )}
                  <span>{playlist.name}</span>
                </div>
                {isAlreadyIn && <CheckFilled size={14} className="playlist-check" />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default PlaylistDropdown
