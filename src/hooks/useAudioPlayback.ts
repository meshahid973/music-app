import { Howl } from 'howler'
import { useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { useMusicStore } from '../store/useMusicStore'
import { revokeOwnedObjectUrls } from '../utils/objectUrls'
import type { PlaybackQueue } from '../utils/queue'

export function useAudioPlayback(queueRef: RefObject<PlaybackQueue>) {
  const audioRef = useRef<Howl | null>(null)
  const progressTimer = useRef<number | null>(null)
  const volumeRef = useRef(0.82)
  const playNextRef = useRef<() => void>(() => {})
  const [seek, setSeek] = useState(0)

  const {
    tracks,
    currentTrackId,
    isPlaying,
    shuffle,
    repeat,
    volume,
    setCurrentTrack,
    setIsPlaying,
  } = useMusicStore()

  const currentTrack = tracks.find((track) => track.id === currentTrackId)
  const currentAudioUrl = currentTrack?.audioUrl
  const currentId = currentTrack?.id

  function startProgress() {
    stopProgress()
    progressTimer.current = window.setInterval(() => {
      const howl = audioRef.current
      if (!howl) return
      const position = howl.seek()
      setSeek(typeof position === 'number' ? position : 0)
    }, 350)
  }

  function stopProgress() {
    if (progressTimer.current) {
      window.clearInterval(progressTimer.current)
      progressTimer.current = null
    }
  }

  useEffect(() => {
    volumeRef.current = volume
  }, [volume])

  useEffect(() => () => revokeOwnedObjectUrls(), [])

  useEffect(() => {
    audioRef.current?.stop()
    audioRef.current?.unload()
    audioRef.current = null
    if (!currentAudioUrl) return

    const shouldAutoplay = useMusicStore.getState().isPlaying
    const howl = new Howl({
      src: [currentAudioUrl],
      format: ['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac', 'webm'],
      html5: true,
      autoplay: shouldAutoplay,
      volume: volumeRef.current,
      onend: () => playNextRef.current(),
      onload: () => {
        setSeek(0)
        if (useMusicStore.getState().isPlaying && !howl.playing()) {
          try {
            howl.play()
            startProgress()
          } catch {
            // ignore
          }
        }
      },
      onplay: () => {
        startProgress()
      },
      onpause: () => {
        stopProgress()
      },
      onstop: () => {
        stopProgress()
      },
      onloaderror: (_id, err) => {
        console.warn('Audio load error:', err)
      },
      onplayerror: (_id, err) => {
        console.warn('Audio play error:', err)
        howl.once('unlock', () => {
          try {
            howl.play()
          } catch {
            // ignore
          }
        })
      },
    })
    audioRef.current = howl
    return () => {
      howl.stop()
      howl.unload()
      if (audioRef.current === howl) audioRef.current = null
      stopProgress()
    }
  }, [currentAudioUrl, currentId])

  useEffect(() => {
    const howl = audioRef.current
    if (!howl) return
    if (isPlaying) {
      if (!howl.playing()) {
        try {
          howl.play()
          startProgress()
        } catch {
          // ignore
        }
      }
    } else {
      try {
        howl.pause()
      } catch {
        // ignore
      }
      stopProgress()
    }
    return () => stopProgress()
  }, [isPlaying, currentAudioUrl])

  useEffect(() => {
    audioRef.current?.volume(volume)
  }, [volume])

  function moveTrack(direction: 1 | -1, automatic = false) {
    if (!currentTrackId || !queueRef.current) return
    const nextId =
      direction === 1
        ? queueRef.current.next(currentTrackId, shuffle, repeat, automatic)
        : queueRef.current.previous(currentTrackId, shuffle, repeat)
    if (nextId) {
      setCurrentTrack(nextId)
      setIsPlaying(true)
    } else {
      setIsPlaying(false)
    }
  }

  function playPrevious() {
    moveTrack(-1)
  }

  function playNext(automatic = false) {
    if (automatic && repeat === 'one') {
      audioRef.current?.seek(0)
      audioRef.current?.play()
      startProgress()
      return
    }
    moveTrack(1, automatic)
  }

  useEffect(() => {
    playNextRef.current = () => playNext(true)
  })

  function handleTrackPlay(trackId: string, availableTrackIds: string[]) {
    if (currentTrackId === trackId) {
      setIsPlaying(!isPlaying)
    } else {
      queueRef.current?.start(availableTrackIds, trackId)
      setCurrentTrack(trackId)
      setIsPlaying(true)
    }
  }

  function togglePlay(fallbackTrackId?: string, availableTrackIds: string[] = []) {
    if (!currentTrack && fallbackTrackId) {
      queueRef.current?.start(availableTrackIds, fallbackTrackId)
      setCurrentTrack(fallbackTrackId)
      setIsPlaying(true)
      return
    }
    setIsPlaying(!isPlaying)
  }

  function handleSeek(value: number) {
    setSeek(value)
    audioRef.current?.seek(value)
  }

  return {
    audioRef,
    seek,
    currentTrack,
    handleSeek,
    playPrevious,
    playNext,
    handleTrackPlay,
    togglePlay,
  }
}
