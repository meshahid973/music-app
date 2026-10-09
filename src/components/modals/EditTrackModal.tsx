import { useRef, useState } from 'react'
import type { ChangeEvent, CSSProperties, FormEvent } from 'react'
import {
  CloseFilled,
  DiscFilled,
  ImageFilled,
  TrashFilled,
  UploadFilled,
} from '../icons'
import { cleanDisplayTitle } from '../../utils/library'
import { isDesktopApp, pickNativeImageFile, toNativeAssetUrl } from '../../utils/platform'
import { saveCustomArtwork } from '../../utils/artworkStorage'
import type { Track } from '../../types'

export type EditTrackModalProps = {
  track: Track
  isPlaying: boolean
  onClose: () => void
  onSave: (updates: Partial<Track>) => void
}

export function EditTrackModal({ track, isPlaying, onClose, onSave }: EditTrackModalProps) {
  const [title, setTitle] = useState(cleanDisplayTitle(track.title))
  const [artist, setArtist] = useState(track.artist)
  const [album, setAlbum] = useState(track.album)
  const [coverUrl, setCoverUrl] = useState<string | undefined>(track.coverUrl)
  const [coverPath, setCoverPath] = useState<string | undefined>(track.coverPath)
  const [pendingImageSource, setPendingImageSource] = useState<string | undefined>(undefined)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const isDesktop = isDesktopApp()

  async function handleNativeChooseImage() {
    const selected = await pickNativeImageFile()
    if (selected) {
      setCoverPath(selected)
      setCoverUrl(toNativeAssetUrl(selected))
      setPendingImageSource(selected)
    }
  }

  function handleImageUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string
      setCoverUrl(dataUrl)
      setCoverPath(undefined)
      setPendingImageSource(dataUrl)
    }
    reader.readAsDataURL(file)
    event.target.value = ''
  }

  function handleRemoveCover() {
    setCoverUrl(undefined)
    setCoverPath(undefined)
    setPendingImageSource(undefined)
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    let finalCoverUrl = coverUrl
    let finalCoverPath = coverPath

    if (isDesktop && pendingImageSource) {
      const saved = await saveCustomArtwork(track.id, pendingImageSource)
      if (saved) {
        finalCoverPath = saved
        finalCoverUrl = toNativeAssetUrl(saved)
      }
    }

    onSave({
      title: title.trim() || track.title,
      artist: artist.trim() || track.artist,
      album: album.trim() || track.album,
      coverUrl: finalCoverUrl,
      coverPath: finalCoverUrl ? finalCoverPath : undefined,
      coverSource: finalCoverUrl ? 'custom' : undefined,
    })
    onClose()
  }

  return (
    <div
      className="modal-backdrop"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="edit-modal-title"
    >
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <header className="modal-header">
          <h3 id="edit-modal-title">Edit Track Details</h3>
          <button
            type="button"
            className="modal-close-btn"
            onClick={onClose}
            aria-label="Close edit dialog"
          >
            <CloseFilled size={18} />
          </button>
        </header>

        <form onSubmit={handleSubmit} className="modal-body">
          {/* Cover Art Upload & CD Preview */}
          <div className="cover-upload-section">
            <div className="cover-preview-box">
              {coverUrl ? (
                <img src={coverUrl} alt="Cover preview" />
              ) : (
                <div className="cover-preview-empty">
                  <ImageFilled size={26} />
                  <span>No cover</span>
                </div>
              )}
            </div>

            <div className="cover-preview-cd">
              <div
                className={`cd-disc ${isPlaying ? 'is-playing' : 'is-paused'}`}
                style={{ width: 84, height: 84 }}
              >
                <div className="cd-base" />
                {coverUrl ? (
                  <div className="cd-artwork-layer">
                    <img src={coverUrl} alt="Cover CD preview" className="cd-artwork-img" />
                  </div>
                ) : (
                  <div
                    className="cd-artwork-layer cd-generated-artwork"
                    style={{ '--cover-accent': track.accent } as CSSProperties}
                  >
                    <div className="cd-generated-pattern" />
                    <DiscFilled size={20} color="#0b0c0b" />
                  </div>
                )}
                <div className="cd-grooves" />
                <div className="cd-spectral-sheen" />
                <div className="cd-surface-glare" />
                <div className="cd-hub-area">
                  <div className="cd-hub-inner-ridge" />
                  <div className="cd-center-hole" />
                </div>
                <div className="cd-outer-rim" />
              </div>
            </div>

            <div className="cover-upload-controls">
              <p>Upload artwork to display on the spinning CD disc.</p>
              <div className="cover-upload-actions">
                {isDesktop ? (
                  <button
                    type="button"
                    className="upload-file-btn"
                    onClick={handleNativeChooseImage}
                  >
                    <UploadFilled size={14} />
                    <span>{coverUrl ? 'Replace Art' : 'Upload Art'}</span>
                  </button>
                ) : (
                  <label className="upload-file-btn">
                    <UploadFilled size={14} />
                    <span>{coverUrl ? 'Replace Art' : 'Upload Art'}</span>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      onChange={handleImageUpload}
                    />
                  </label>
                )}
                {coverUrl && (
                  <button
                    type="button"
                    className="remove-cover-btn"
                    onClick={handleRemoveCover}
                    title="Remove custom artwork"
                  >
                    <TrashFilled size={14} />
                    <span>Remove</span>
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="edit-title">Song Title</label>
            <input
              id="edit-title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Lover Is a Day"
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="edit-artist">Artist</label>
            <input
              id="edit-artist"
              type="text"
              value={artist}
              onChange={(e) => setArtist(e.target.value)}
              placeholder="e.g. Cuco"
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="edit-album">Album</label>
            <input
              id="edit-album"
              type="text"
              value={album}
              onChange={(e) => setAlbum(e.target.value)}
              placeholder="e.g. Local files"
            />
          </div>

          <footer className="modal-footer">
            <button type="button" className="btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn-primary">
              Save Changes
            </button>
          </footer>
        </form>
      </div>
    </div>
  )
}

export default EditTrackModal
