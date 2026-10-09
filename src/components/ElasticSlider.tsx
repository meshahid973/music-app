import { useCallback, useEffect, useRef, useState } from 'react'
import type { PointerEvent, WheelEvent } from 'react'
import { Volume1, Volume2, VolumeX } from 'lucide-react'
import './ElasticSlider.css'

export type ElasticSliderProps = {
  value: number
  onChange: (volume: number) => void
}

/**
 * Modern, responsive volume controller with:
 * - Dynamic mute/unmute toggle button with stateful icons (Muted, Low, High)
 * - Smooth pointer-captured draggable slider with hover expansion
 * - Mouse wheel scrolling support
 * - Tabular percentage readout
 */
export default function ElasticSlider({ value, onChange }: ElasticSliderProps) {
  const trackRef = useRef<HTMLDivElement>(null)
  const prevVolumeRef = useRef<number>(value > 0 ? value : 0.8)
  const [isDragging, setIsDragging] = useState(false)
  const [isHovered, setIsHovered] = useState(false)

  // Track previous non-zero volume for unmuting
  useEffect(() => {
    if (value > 0) {
      prevVolumeRef.current = value
    }
  }, [value])

  const calculateVolumeFromClientX = useCallback(
    (clientX: number) => {
      if (!trackRef.current) return value
      const rect = trackRef.current.getBoundingClientRect()
      if (rect.width <= 0) return 0
      const relative = (clientX - rect.left) / rect.width
      return Math.max(0, Math.min(1, Math.round(relative * 100) / 100))
    },
    [value],
  )

  const handlePointerDown = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    setIsDragging(true)
    const newVol = calculateVolumeFromClientX(e.clientX)
    onChange(newVol)
  }

  const handlePointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!isDragging) return
    const newVol = calculateVolumeFromClientX(e.clientX)
    onChange(newVol)
  }

  const handlePointerUp = (e: PointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
    setIsDragging(false)
  }

  const handleToggleMute = () => {
    if (value > 0) {
      prevVolumeRef.current = value
      onChange(0)
    } else {
      onChange(prevVolumeRef.current || 0.8)
    }
  }

  const handleWheel = (e: WheelEvent<HTMLDivElement>) => {
    e.preventDefault()
    const delta = e.deltaY < 0 ? 0.05 : -0.05
    const next = Math.max(0, Math.min(1, Math.round((value + delta) * 100) / 100))
    onChange(next)
  }

  const percent = Math.round(Math.max(0, Math.min(1, value)) * 100)

  // Select dynamic volume icon
  const renderVolumeIcon = () => {
    if (percent === 0) {
      return <VolumeX size={18} className="volume-icon muted" />
    }
    if (percent < 50) {
      return <Volume1 size={18} className="volume-icon low" />
    }
    return <Volume2 size={18} className="volume-icon high" />
  }

  return (
    <div
      className="modern-volume-control"
      onWheel={handleWheel}
      onPointerEnter={() => setIsHovered(true)}
      onPointerLeave={() => {
        if (!isDragging) setIsHovered(false)
      }}
    >
      <button
        type="button"
        className="volume-mute-btn"
        onClick={handleToggleMute}
        title={percent === 0 ? 'Unmute' : 'Mute'}
        aria-label={percent === 0 ? 'Unmute volume' : 'Mute volume'}
      >
        {renderVolumeIcon()}
      </button>

      <div
        ref={trackRef}
        className={`volume-track-container ${isHovered || isDragging ? 'active' : ''}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        role="slider"
        tabIndex={0}
        aria-label="Volume slider"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-valuetext={`${percent} percent`}
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
            e.preventDefault()
            onChange(Math.min(1, Math.round((value + 0.05) * 100) / 100))
          } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
            e.preventDefault()
            onChange(Math.max(0, Math.round((value - 0.05) * 100) / 100))
          } else if (e.key === 'Home') {
            e.preventDefault()
            onChange(0)
          } else if (e.key === 'End') {
            e.preventDefault()
            onChange(1)
          }
        }}
      >
        <div className="volume-track-rail">
          <div className="volume-track-fill" style={{ width: `${percent}%` }} />
          <div
            className={`volume-track-thumb ${isHovered || isDragging ? 'visible' : ''}`}
            style={{ left: `${percent}%` }}
          />
        </div>
      </div>

      <span
        className="volume-percentage"
        onClick={() => {
          // Quick presets: 0% -> 50% -> 100%
          if (percent === 0) onChange(0.5)
          else if (percent < 90) onChange(1)
          else onChange(0.5)
        }}
        title="Click to toggle preset levels"
      >
        {percent}%
      </span>
    </div>
  )
}
