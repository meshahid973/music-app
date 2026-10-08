import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { CloseFilled, PencilFilled } from '../icons'
import type { Playlist } from '../../types'

export type RenamePlaylistModalProps = {
  playlist: Playlist
  onClose: () => void
  onSave: (newName: string) => void
}

export function RenamePlaylistModal({ playlist, onClose, onSave }: RenamePlaylistModalProps) {
  const [name, setName] = useState(playlist.name)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
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

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const trimmed = name.trim()
    if (trimmed) {
      onSave(trimmed)
      onClose()
    }
  }

  return (
    <div
      className="modal-backdrop"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="rename-playlist-title"
    >
      <div className="modal-card modal-card-sm" onClick={(e) => e.stopPropagation()}>
        <header className="modal-header">
          <div className="delete-modal-title-group">
            <div className="rename-modal-icon-badge">
              <PencilFilled size={18} />
            </div>
            <div>
              <h3 id="rename-playlist-title">Rename Playlist</h3>
              <p className="delete-modal-subtitle">Update playlist display name</p>
            </div>
          </div>
          <button
            type="button"
            className="modal-close-btn"
            onClick={onClose}
            aria-label="Close dialog"
          >
            <CloseFilled size={18} />
          </button>
        </header>

        <form onSubmit={handleSubmit} className="modal-body">
          <div className="form-group">
            <label htmlFor="rename-input">Playlist Name</label>
            <input
              ref={inputRef}
              id="rename-input"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Enter new name"
              required
            />
          </div>

          <footer className="modal-footer">
            <button type="button" className="btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={!name.trim()}>
              Save Name
            </button>
          </footer>
        </form>
      </div>
    </div>
  )
}

export default RenamePlaylistModal
