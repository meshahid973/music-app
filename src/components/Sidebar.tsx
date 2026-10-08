import type { ChangeEvent } from 'react'
import {
  AudioLinesFilled,
  DiscFilled,
  FolderImageFilled,
  FolderMusicFilled,
  HeartFilled,
  PencilFilled,
  PlaylistFilled,
  PlusFilled,
  TrashFilled,
  UploadFilled,
} from './icons'
import { favoritesId, libraryId } from '../store/useMusicStore'
import type { Playlist, Track } from '../types'

export type SidebarProps = {
  activePlaylistId: string
  playlists: Playlist[]
  tracks: Track[]
  playlistName: string
  setPlaylistName: (name: string) => void
  onSelect: (playlistId: string) => void
  onCreate: () => void
  onRenamePlaylist: (playlist: Playlist) => void
  onDeletePlaylist: (playlist: Playlist) => void
  onAddSongs: (e: ChangeEvent<HTMLInputElement>) => void
  onAddMusicFolder: (e: ChangeEvent<HTMLInputElement>) => void
  onAddCoverFolder: (e: ChangeEvent<HTMLInputElement>) => void
  isDesktop?: boolean
  onNativeAddSongs?: () => void
  onNativeMusicFolder?: () => void
  onNativeCoverFolder?: () => void
}

export function Sidebar({
  activePlaylistId,
  playlists,
  tracks,
  playlistName,
  setPlaylistName,
  onSelect,
  onCreate,
  onRenamePlaylist,
  onDeletePlaylist,
  onAddSongs,
  onAddMusicFolder,
  onAddCoverFolder,
  isDesktop = false,
  onNativeAddSongs,
  onNativeMusicFolder,
  onNativeCoverFolder,
}: SidebarProps) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">
          <AudioLinesFilled size={22} />
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
          <DiscFilled size={18} />
          <span>All Songs</span>
          <em>{tracks.length}</em>
        </button>
        {playlists.map((playlist) => (
          <div
            key={playlist.id}
            className={`nav-item nav-playlist-item ${activePlaylistId === playlist.id ? 'active' : ''}`}
            onClick={() => onSelect(playlist.id)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onSelect(playlist.id)
              }
            }}
          >
            {playlist.id === favoritesId ? <HeartFilled size={18} /> : <PlaylistFilled size={18} />}
            <span className="nav-playlist-name">{playlist.name}</span>
            <em>{playlist.trackIds.length}</em>
            <div className="nav-item-actions">
              <button
                type="button"
                className="nav-action-btn edit"
                title={`Rename playlist "${playlist.name}"`}
                aria-label={`Rename playlist "${playlist.name}"`}
                onClick={(e) => {
                  e.stopPropagation()
                  onRenamePlaylist(playlist)
                }}
              >
                <PencilFilled size={13} />
              </button>
              <button
                type="button"
                className="nav-action-btn delete"
                title={`Delete playlist "${playlist.name}"`}
                aria-label={`Delete playlist "${playlist.name}"`}
                onClick={(e) => {
                  e.stopPropagation()
                  onDeletePlaylist(playlist)
                }}
              >
                <TrashFilled size={13} />
              </button>
            </div>
          </div>
        ))}
        <form
          className="nav-item playlist-form"
          onSubmit={(event) => {
            event.preventDefault()
            onCreate()
          }}
        >
          <PlaylistFilled size={18} className="playlist-form-icon" />
          <input
            value={playlistName}
            onChange={(event) => setPlaylistName(event.target.value)}
            placeholder="New playlist"
            aria-label="New playlist name"
          />
          <button
            type="submit"
            aria-label="Create playlist"
            className="playlist-add-btn"
            title="Create playlist"
          >
            <PlusFilled size={14} />
          </button>
        </form>

        {isDesktop && onNativeAddSongs ? (
          <button
            type="button"
            className="nav-item import-nav-item"
            title="Select audio files from your computer"
            onClick={onNativeAddSongs}
          >
            <UploadFilled size={18} />
            <span>Add songs</span>
          </button>
        ) : (
          <label className="nav-item import-nav-item" title="Manually select audio files">
            <UploadFilled size={18} />
            <span>Add songs</span>
            <input type="file" accept="audio/*" multiple onChange={onAddSongs} />
          </label>
        )}

        {isDesktop && onNativeMusicFolder ? (
          <button
            type="button"
            className="nav-item import-nav-item"
            title="Import an entire music folder from your computer"
            onClick={onNativeMusicFolder}
          >
            <FolderMusicFilled size={18} />
            <span>Music folder</span>
          </button>
        ) : (
          <label className="nav-item import-nav-item" title="Import an entire music folder">
            <FolderMusicFilled size={18} />
            <span>Music folder</span>
            <input
              type="file"
              multiple
              onChange={onAddMusicFolder}
              {...{ webkitdirectory: '', directory: '' }}
            />
          </label>
        )}

        {isDesktop && onNativeCoverFolder ? (
          <button
            type="button"
            className="nav-item import-nav-item"
            title="Import a folder of cover artwork from your computer"
            onClick={onNativeCoverFolder}
          >
            <FolderImageFilled size={18} />
            <span>Cover folder</span>
          </button>
        ) : (
          <label className="nav-item import-nav-item" title="Import a folder of cover artwork">
            <FolderImageFilled size={18} />
            <span>Cover folder</span>
            <input
              type="file"
              multiple
              onChange={onAddCoverFolder}
              {...{ webkitdirectory: '', directory: '' }}
            />
          </label>
        )}
      </nav>
    </aside>
  )
}

export default Sidebar
