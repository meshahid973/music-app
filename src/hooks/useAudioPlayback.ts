import { Howl } from 'howler'
import { invoke } from '@tauri-apps/api/core'
import { useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { useMusicStore } from '../store/useMusicStore'
import { showToast } from '../store/useToastStore'
import { revokeOwnedObjectUrls } from '../utils/objectUrls'
import { isDesktopApp } from '../utils/platform'
import type { PlaybackQueue } from '../utils/queue'

export function useAudioPlayback(queueRef: RefObject<PlaybackQueue>) {
  const audioRef = useRef<Howl | null>(null)
  const volumeRef = useRef(0.82)
  const playNextRef = useRef<() => void>(() => {})
  const [seek, setSeek] = useState(0)

  const tracks = useMusicStore((state) => state.tracks)
  const currentTrackId = useMusicStore((state) => state.currentTrackId)
  const isPlaying = useMusicStore((state) => state.isPlaying)
  const shuffle = useMusicStore((state) => state.shuffle)
  const repeat = useMusicStore((state) => state.repeat)
  const volume = useMusicStore((state) => state.volume)
  const setCurrentTrack = useMusicStore((state) => state.setCurrentTrack)
  const setIsPlaying = useMusicStore((state) => state.setIsPlaying)

  const currentTrack = tracks.find((track) => track.id === currentTrackId)
  const currentAudioUrl = currentTrack?.audioUrl
  const currentId = currentTrack?.id

  // PlayerBar reads the Howler position with requestAnimationFrame and updates its
  // scrubber DOM directly, so no progress timer (and no re-render of App) is needed here.

  useEffect(() => {
    volumeRef.current = volume
  }, [volume])

  useEffect(() => () => revokeOwnedObjectUrls(), [])

  useEffect(() => {
    let cancelled = false
    const previous = audioRef.current
    if (previous) {
      previous.stop()
      previous.unload()
    }
    audioRef.current = null

    const fail = (message: string) => {
      if (cancelled) return
      useMusicStore.getState().setIsPlaying(false)
      showToast(message, { title: 'Playback Error', type: 'error' })
    }

    if (!currentAudioUrl) {
      if (useMusicStore.getState().isPlaying) {
        fail('This track has no local audio file. Import a matching song to play it.')
      }
      return () => { cancelled = true }
    }

    let howl: Howl | null = null
    const prepare = async () => {
      // convertFileSrc alone does not grant asset protocol permission for
      // user-selected songs. This command checks the existing Tauri FS scope
      // and grants access only to this audio file.
      if (isDesktopApp() && currentTrack?.filePath) {
        await invoke<void>('authorize_audio_path', { path: currentTrack.filePath })
      }
      if (cancelled) return

      const audio = new Howl({
        src: [currentAudioUrl],
        html5: true,
        autoplay: false,
        volume: volumeRef.current,
        onend: () => playNextRef.current(),
        onload: () => {
          if (cancelled || audioRef.current !== audio) return
          setSeek(0)
        },
        onloaderror: (_id, error) => {
          if (cancelled || audioRef.current !== audio) return
          console.warn('Audio load error:', error)
          fail('Could not load this audio. The file may have moved or its codec may not be supported.')
        },
        onplayerror: (_id, error) => {
          if (cancelled || audioRef.current !== audio) return
          console.warn('Audio playback error:', error)
          // Browsers may defer playback until the next user gesture.
          audio.once('unlock', () => {
            if (!cancelled && audioRef.current === audio && useMusicStore.getState().isPlaying) {
              audio.play()
            }
          })
        },
      })
      howl = audio
      audioRef.current = audio
      if (useMusicStore.getState().isPlaying) audio.play()
    }
    void prepare().catch((error) => {
      console.warn('Audio access denied:', error)
      fail(typeof error === 'string' ? error : 'This audio file could not be opened. Select the Music folder again.')
    })
    return () => {
      cancelled = true
      howl?.stop()
      howl?.unload()
      if (audioRef.current === howl) audioRef.current = null
    }
  }, [currentAudioUrl, currentId, currentTrack?.filePath])

  useEffect(() => {
    const howl = audioRef.current
    if (!howl) return
    if (isPlaying) {
      if (!howl.playing()) {
        try {
          howl.play()
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
    }
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
