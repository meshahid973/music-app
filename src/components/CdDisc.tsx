import type { CSSProperties } from 'react'
import { DiscFilled } from './icons'
import { cleanDisplayTitle } from '../utils/library'
import type { Track } from '../types'

export type CdDiscProps = {
  track?: Track
  isPlaying: boolean
  onTogglePlay: () => void
}

export function CdDisc({ track, isPlaying, onTogglePlay }: CdDiscProps) {
  return (
    <div
      className="cd-wrapper"
      onClick={onTogglePlay}
      role="button"
      tabIndex={0}
      title={track ? `${isPlaying ? 'Pause' : 'Play'} - ${cleanDisplayTitle(track.title)}` : 'No track loaded'}
      aria-label={track ? `${cleanDisplayTitle(track.title)} CD - ${isPlaying ? 'Pause' : 'Play'}` : 'CD player'}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onTogglePlay()
        }
      }}
    >
      {/* The physical rotating CD disc */}
      <div className={`cd-disc ${isPlaying ? 'is-playing' : 'is-paused'}`}>
        {/* Base reflective substrate */}
        <div className="cd-base" />

        {/* Cover Art Layer with circular CD mask */}
        {track?.coverUrl ? (
          <div className="cd-artwork-layer">
            <img src={track.coverUrl} alt={`${track.title} cover art`} className="cd-artwork-img" />
          </div>
        ) : (
          <div
            className="cd-artwork-layer cd-generated-artwork"
            style={{ '--cover-accent': track?.accent ?? 'var(--lime)' } as CSSProperties}
          >
            <div className="cd-generated-pattern" />
            <div className="cd-generated-content">
              <DiscFilled size={36} className="cd-generated-icon" />
              <strong className="cd-generated-title">{track ? cleanDisplayTitle(track.title) : 'No Track Selected'}</strong>
              <span className="cd-generated-artist">{track?.artist ?? 'Resonance Audio'}</span>
            </div>
          </div>
        )}

        {/* Concentric microgrooves & laser data tracks */}
        <div className="cd-grooves" />

        {/* Iridescent rainbow optical diffraction spectral sheen */}
        <div className="cd-spectral-sheen" />

        {/* Dynamic gloss reflection */}
        <div className="cd-surface-glare" />

        {/* Center Polycarbonate Clamping Hub (Clear plastic ring) */}
        <div className="cd-hub-area">
          <div className="cd-hub-mirror-band" />
          <div className="cd-hub-text">
            <span>COMPACT DISC DIGITAL AUDIO</span>
          </div>
          <div className="cd-hub-inner-ridge" />

          {/* Authentic Center Spindle Hole (hole in the middle) */}
          <div className="cd-center-hole" />
        </div>

        {/* Outer clear polycarbonate rim */}
        <div className="cd-outer-rim" />
      </div>
    </div>
  )
}

export default CdDisc
