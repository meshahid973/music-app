import { useEffect, useRef } from 'react'
import type { CSSProperties, RefObject } from 'react'
import type { Howl } from 'howler'
import ElasticSlider from './ElasticSlider'
import {
  DiscFilled,
  PauseFilled,
  PlayFilled,
  RepeatFilled,
  RepeatOneFilled,
  ShuffleFilled,
  SkipBackFilled,
  SkipForwardFilled,
} from './icons'
import { cleanDisplayTitle, formatTime } from '../utils/library'
import type { Track } from '../types'

export type PlayerBarProps = {
  currentTrack?: Track
  isPlaying: boolean
  audioRef: RefObject<Howl | null>
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

export function PlayerBar({
  currentTrack,
  isPlaying,
  audioRef,
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
  const isDraggingRef = useRef(false)
  const rangeInputRef = useRef<HTMLInputElement>(null)
  const timeLabelRef = useRef<HTMLSpanElement>(null)
  const rafRef = useRef<number | null>(null)

  const duration = currentTrack?.duration ?? 0

  // 60fps continuous animation frame for seamless, smooth progression
  useEffect(() => {
    if (!isPlaying) {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
      return
    }

    let lastSec = -1

    const loop = () => {
      const howl = audioRef.current
      if (howl && isPlaying && !isDraggingRef.current) {
        const pos = howl.seek()
        if (typeof pos === 'number' && !Number.isNaN(pos)) {
          const clampedPos = duration > 0 ? Math.min(pos, duration) : pos
          const pct = duration > 0 ? (clampedPos / duration) * 100 : 0

          if (rangeInputRef.current) {
            rangeInputRef.current.value = String(clampedPos)
            rangeInputRef.current.style.setProperty('--progress-pct', `${pct}%`)
          }

          const currentSec = Math.floor(clampedPos)
          if (currentSec !== lastSec) {
            lastSec = currentSec
            if (timeLabelRef.current) {
              timeLabelRef.current.textContent = formatTime(clampedPos)
            }
          }
        }
      }
      rafRef.current = requestAnimationFrame(loop)
    }

    rafRef.current = requestAnimationFrame(loop)

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
    }
  }, [isPlaying, audioRef, duration])

  // Sync on track switch, pause, or external seek
  useEffect(() => {
    if (rangeInputRef.current && !isDraggingRef.current) {
      const pct = duration > 0 ? (Math.min(seek, duration) / duration) * 100 : 0
      rangeInputRef.current.value = String(seek)
      rangeInputRef.current.style.setProperty('--progress-pct', `${pct}%`)
    }
    if (timeLabelRef.current && !isDraggingRef.current) {
      timeLabelRef.current.textContent = formatTime(seek)
    }
  }, [seek, duration, currentTrack?.id])

  return (
    <footer className="player-bar">
      <div className="player-track">
        <div className="mini-cover large" style={{ '--cover-accent': currentTrack?.accent } as CSSProperties}>
          {currentTrack?.coverUrl ? <img src={currentTrack.coverUrl} alt="" /> : <DiscFilled size={22} />}
        </div>
        <div>
          <strong>{currentTrack ? cleanDisplayTitle(currentTrack.title) : 'No track selected'}</strong>
          <span>{currentTrack?.artist ?? 'Choose a song to start'}</span>
        </div>
      </div>

      <div className="transport">
        <div className="transport-buttons">
          <button className={shuffle ? 'control active' : 'control'} type="button" onClick={onShuffle} aria-label="Toggle shuffle">
            <ShuffleFilled size={18} />
          </button>
          <button className="control" type="button" onClick={onPrevious} aria-label="Previous track">
            <SkipBackFilled size={20} />
          </button>
          <button className="play-button" type="button" onClick={onTogglePlay} aria-label={isPlaying ? 'Pause' : 'Play'}>
            {isPlaying ? <PauseFilled size={24} /> : <PlayFilled size={24} />}
          </button>
          <button className="control" type="button" onClick={onNext} aria-label="Next track">
            <SkipForwardFilled size={20} />
          </button>
          <button className={repeat !== 'off' ? 'control active' : 'control'} type="button" onClick={onRepeat} aria-label="Cycle repeat mode">
            {repeat === 'one' ? <RepeatOneFilled size={18} /> : <RepeatFilled size={18} />}
          </button>
        </div>
        <div className="progress-line">
          <span ref={timeLabelRef}>{formatTime(seek)}</span>
          <input
            ref={rangeInputRef}
            type="range"
            className="frosted-range"
            min="0"
            max={Math.max(duration, 1)}
            step="any"
            defaultValue={seek}
            onPointerDown={() => {
              isDraggingRef.current = true
            }}
            onInput={(event) => {
              const val = Number(event.currentTarget.value)
              const pct = duration > 0 ? (val / duration) * 100 : 0
              if (rangeInputRef.current) {
                rangeInputRef.current.style.setProperty('--progress-pct', `${pct}%`)
              }
              if (timeLabelRef.current) {
                timeLabelRef.current.textContent = formatTime(val)
              }
            }}
            onChange={(event) => {
              const val = Number(event.target.value)
              isDraggingRef.current = false
              onSeek(val)
            }}
            onPointerUp={(event) => {
              isDraggingRef.current = false
              const val = Number(event.currentTarget.value)
              onSeek(val)
            }}
            style={
              {
                '--progress-pct': `${duration > 0 ? (Math.min(seek, duration) / duration) * 100 : 0}%`,
              } as CSSProperties
            }
            aria-label="Playback progress"
          />
          <span>{formatTime(duration)}</span>
        </div>
      </div>

      <div className="volume">
        <ElasticSlider value={volume} onChange={onVolume} />
      </div>
    </footer>
  )
}

export default PlayerBar
