import { Howl } from 'howler'
import { invoke } from '@tauri-apps/api/core'
import { useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { useMusicStore } from '../store/useMusicStore'
import { showToast } from '../store/useToastStore'
import { getExtension } from '../utils/audioFiles'
import { restoreAudioAssetAccess } from '../utils/audioAccess'
import { PlaybackEngine, type PlaybackPhase } from '../utils/playbackEngine'
import { isDesktopApp } from '../utils/platform'
import { revokeOwnedObjectUrls } from '../utils/objectUrls'
import type { PlaybackQueue } from '../utils/queue'

export function useAudioPlayback(queueRef: RefObject<PlaybackQueue>) {
  const audioRef = useRef<Howl | null>(null)
  const engineRef = useRef<PlaybackEngine | null>(null)
  const playRequested = useRef(false)
  const volumeRef = useRef(0.82)
  const playNextRef = useRef<() => void>(() => {})
  const [seek, setSeek] = useState(0)
  const [phase, setPhase] = useState<PlaybackPhase>('idle')

  const tracks = useMusicStore((state) => state.tracks)
  const currentTrackId = useMusicStore((state) => state.currentTrackId)
  const shuffle = useMusicStore((state) => state.shuffle)
  const repeat = useMusicStore((state) => state.repeat)
  const volume = useMusicStore((state) => state.volume)
  const setCurrentTrack = useMusicStore((state) => state.setCurrentTrack)
  const setIsPlaying = useMusicStore((state) => state.setIsPlaying)

  const currentTrack = tracks.find((track) => track.id === currentTrackId)
  const currentAudioUrl = currentTrack?.audioUrl
  const currentId = currentTrack?.id

  useEffect(() => {
    volumeRef.current = volume
    engineRef.current?.setVolume(volume)
  }, [volume])

  useEffect(() => () => revokeOwnedObjectUrls(), [])

  useEffect(() => {
    engineRef.current?.dispose()
    engineRef.current = null
    audioRef.current = null
    setSeek(0)
    setIsPlaying(false)

    if (!currentAudioUrl) {
      setPhase('idle')
      return
    }

    const path = currentTrack?.filePath
    const extension = getExtension(currentTrack?.fileName ?? '') || 'mp3'
    let disposed = false
    let engine: PlaybackEngine
    engine = new PlaybackEngine({
      source: currentAudioUrl,
      authorize: () => restoreAudioAssetAccess(path, isDesktopApp(), (filePath) =>
        invoke<void>('authorize_audio_path', { path: filePath }),
      ),
      createAudio: (events) => {
        const howl = new Howl({
          src: [currentAudioUrl],
          format: [extension],
          html5: true,
          autoplay: false,
          preload: true,
          volume: volumeRef.current,
          onplay: events.onplay,
          onpause: events.onpause,
          onend: events.onend,
          onload: events.onload,
          onloaderror: events.onloaderror,
          onplayerror: events.onplayerror,
        })
        if (!disposed) audioRef.current = howl
        return howl
      },
      onPhase: (nextPhase) => {
        if (disposed) return
        setPhase(nextPhase)
        // The UI must not animate its disc or present "playing" before a
        // real media onplay event. Buffered/stalled sources remain paused.
        setIsPlaying(nextPhase === 'playing')
        if (import.meta.env.DEV) console.info('[resonance:audio]', {
          phase: nextPhase,
          trackType: currentId?.startsWith('native:') ? 'native' : 'other',
          hasNativePath: Boolean(path),
          sourceType: currentAudioUrl.startsWith('blob:') ? 'blob' : 'asset',
        })
      },
      onEnd: () => {
        if (!disposed) playNextRef.current()
      },
      onError: (message, error) => {
        if (disposed) return
        console.warn('Resonance audio failure:', message, error)
        playRequested.current = false
        audioRef.current = null
        setIsPlaying(false)
        showToast(message, { title: 'Playback Error', type: 'error' })
      },
    })
    engineRef.current = engine
    if (playRequested.current) engine.play()

    return () => {
      disposed = true
      engine.dispose()
      if (engineRef.current === engine) {
        engineRef.current = null
        audioRef.current = null
      }
    }
  }, [currentAudioUrl, currentId, currentTrack?.filePath, currentTrack?.fileName, setIsPlaying])

  function requestPlay(): void {
    if (!currentAudioUrl) {
      playRequested.current = false
      showToast('This song has no playable audio source.', { title: 'Playback Error', type: 'error' })
      return
    }
    playRequested.current = true
    engineRef.current?.play()
  }

  function requestPause(): void {
    playRequested.current = false
    engineRef.current?.pause()
    setIsPlaying(false)
  }

  function selectAndPlay(trackId: string, availableTrackIds?: string[]): void {
    const target = tracks.find((track) => track.id === trackId)
    if (!target?.audioUrl) {
      showToast('The selected song has no playable audio file.', { title: 'Playback Error', type: 'error' })
      return
    }
    if (availableTrackIds) queueRef.current?.start(availableTrackIds, trackId)
    playRequested.current = true
    if (trackId === currentTrackId) {
      engineRef.current?.play()
    } else {
      setIsPlaying(false)
      setCurrentTrack(trackId)
    }
  }

  function moveTrack(direction: 1 | -1, automatic = false): void {
    if (!currentTrackId || !queueRef.current) return
    const nextId = direction === 1
      ? queueRef.current.next(currentTrackId, shuffle, repeat, automatic)
      : queueRef.current.previous(currentTrackId, shuffle, repeat)
    if (!nextId) {
      requestPause()
    } else if (nextId === currentTrackId) {
      engineRef.current?.seek(0)
      requestPlay()
    } else {
      selectAndPlay(nextId)
    }
  }

  function playPrevious(): void { moveTrack(-1) }
  function playNext(automatic = false): void {
    if (automatic && repeat === 'one') {
      engineRef.current?.seek(0)
      requestPlay()
      return
    }
    moveTrack(1, automatic)
  }

  useEffect(() => {
    playNextRef.current = () => playNext(true)
  })

  function handleTrackPlay(trackId: string, availableTrackIds: string[]): void {
    if (currentTrackId === trackId) {
      if (engineRef.current?.status === 'playing') requestPause()
      else requestPlay()
    } else {
      selectAndPlay(trackId, availableTrackIds)
    }
  }

  function togglePlay(fallbackTrackId?: string, availableTrackIds: string[] = []): void {
    if (!currentTrack && fallbackTrackId) {
      selectAndPlay(fallbackTrackId, availableTrackIds)
    } else if (engineRef.current?.status === 'playing') {
      requestPause()
    } else {
      requestPlay()
    }
  }

  function handleSeek(value: number): void {
    setSeek(value)
    engineRef.current?.seek(value)
  }

  return {
    audioRef,
    seek,
    phase,
    currentTrack,
    handleSeek,
    playPrevious,
    playNext,
    handleTrackPlay,
    togglePlay,
  }
}
