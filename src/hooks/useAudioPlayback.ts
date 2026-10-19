import { Howl } from 'howler'
import { invoke } from '@tauri-apps/api/core'
import { useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { useMusicStore } from '../store/useMusicStore'
import { showToast } from '../store/useToastStore'
import { getExtension } from '../utils/audioFiles'
import { restoreAudioAssetAccess } from '../utils/audioAccess'
import { isDesktopApp } from '../utils/platform'
import { revokeOwnedObjectUrls } from '../utils/objectUrls'
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
    // The library can be hydrated before asset permissions are restored.
    // A rescan triggers the dialog's scope grant, but playback must work on
    // the first launch without making the user rescan the folder.
    audioRef.current?.stop()
    audioRef.current?.unload()
    audioRef.current = null
    setSeek(0)

    if (!currentAudioUrl) return

    let cancelled = false
    let howl: Howl | null = null
    const selectedFilePath = currentTrack?.filePath
    const ext = getExtension(currentTrack?.fileName ?? '') || 'mp3'

    const showPlaybackError = (message: string) => {
      if (cancelled) return
      useMusicStore.getState().setIsPlaying(false)
      showToast(message, { title: 'Playback Error', type: 'error' })
    }

    const prepare = async () => {
      await restoreAudioAssetAccess(selectedFilePath, isDesktopApp(), (path) =>
        invoke<void>('authorize_audio_path', { path }),
      )
      if (cancelled) return

      const next = new Howl({
        src: [currentAudioUrl],
        format: [ext],
        html5: true,
        autoplay: false,
        volume: volumeRef.current,
        onend: () => {
          if (!cancelled && audioRef.current === next) playNextRef.current()
        },
        onload: () => {
          if (!cancelled && audioRef.current === next) setSeek(0)
        },
        onloaderror: (_id, error) => {
          if (cancelled || audioRef.current !== next) return
          console.warn('Audio load error:', error)
          showPlaybackError('This track could not be loaded. Check its path and audio format.')
        },
        onplayerror: (_id, error) => {
          if (cancelled || audioRef.current !== next) return
          console.warn('Audio play error:', error)
          showPlaybackError('Playback failed. Try playing again or check the audio format.')
        },
      })
      howl = next
      audioRef.current = next
      // A user may press Play while access is still being restored. Honor
      // the latest requested state instead of discarding that first click.
      if (useMusicStore.getState().isPlaying) next.play()
    }

    void prepare().catch((error) => {
      if (cancelled) return
      console.warn('Cannot restore saved audio access:', error)
      showPlaybackError(
        'Could not open this song. Select the Music folder again if its access was revoked.',
      )
    })

    return () => {
      cancelled = true
      howl?.stop()
      howl?.unload()
      if (audioRef.current === howl) audioRef.current = null
    }
  }, [currentAudioUrl, currentId, currentTrack?.filePath, currentTrack?.fileName])

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
