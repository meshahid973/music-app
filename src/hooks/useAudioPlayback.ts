import { Howl } from 'howler'
import { invoke } from '@tauri-apps/api/core'
import { useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { useMusicStore } from '../store/useMusicStore'
import { showToast } from '../store/useToastStore'
import { getExtension } from '../utils/audioFiles'
import { startPlayback } from '../utils/playbackTransport'
import { restoreAudioAssetAccess } from '../utils/audioAccess'
import { isDesktopApp } from '../utils/platform'
import { revokeOwnedObjectUrls } from '../utils/objectUrls'
import type { PlaybackQueue } from '../utils/queue'

export function useAudioPlayback(queueRef: RefObject<PlaybackQueue>) {
  const audioRef = useRef<Howl | null>(null)
  const volumeRef = useRef(0.82)
  const playNextRef = useRef<() => void>(() => {})
  const wantsPlaybackRef = useRef(false)
  const permissionRetryRef = useRef<string | null>(null)
  const [playerGeneration, setPlayerGeneration] = useState(0)
  const [seek, setSeek] = useState(0)

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
    audioRef.current?.volume(volume)
  }, [volume])

  useEffect(() => () => revokeOwnedObjectUrls(), [])

  // Initialize Howler as soon as the selected track becomes available. Do NOT
  // await native IPC here: it delays creating the player until after the Play
  // gesture, leaving the transport showing a false playing state.
  // The native app restores selected-folder permissions before the window loads.
  useEffect(() => {
    const previous = audioRef.current
    audioRef.current = null
    previous?.stop()
    previous?.unload()

    if (!currentAudioUrl) return

    let cancelled = false
    const filePath = currentTrack?.filePath
    const ext = getExtension(currentTrack?.fileName ?? '') || 'mp3'
    const trackKey = [currentId ?? '', currentAudioUrl].join('\u0000')

    const stopWithError = (message: string) => {
      if (cancelled || audioRef.current !== howl) return
      wantsPlaybackRef.current = false
      useMusicStore.getState().setIsPlaying(false)
      showToast(message, { title: 'Playback Error', type: 'error' })
    }

    const howl = new Howl({
      src: [currentAudioUrl],
      format: [ext],
      html5: true,
      autoplay: false,
      volume: volumeRef.current,
      onplay: () => {
        if (cancelled || audioRef.current !== howl) return
        // UI playback state reflects actual audio, never a hopeful toggle.
        useMusicStore.getState().setIsPlaying(true)
      },
      onpause: () => {
        if (cancelled || audioRef.current !== howl) return
        useMusicStore.getState().setIsPlaying(false)
      },
      onend: () => {
        if (cancelled || audioRef.current !== howl) return
        playNextRef.current()
      },
      onload: () => {
        if (cancelled || audioRef.current !== howl) return
        setSeek(0)
      },
      onloaderror: (_id, error) => {
        if (cancelled || audioRef.current !== howl) return
        console.warn('Audio load error:', error)

        // A legacy entry might not have its asset permission persisted.
        // Restore exactly that saved file and rebuild the failed player once.
        if (filePath && isDesktopApp() && permissionRetryRef.current !== trackKey) {
          permissionRetryRef.current = trackKey
          void restoreAudioAssetAccess(filePath, true, (path) =>
            invoke<void>('authorize_audio_path', { path }),
          ).then(() => {
            if (!cancelled && audioRef.current === howl) {
              setPlayerGeneration((generation) => generation + 1)
            }
          }).catch((failure) => {
            console.warn('Could not restore playback permission:', failure)
            stopWithError('Could not open this song. Select its Music folder again if access was revoked.')
          })
        } else {
          stopWithError('This audio file could not be loaded. Check its location and format.')
        }
      },
      onplayerror: (_id, error) => {
        console.warn('Audio playback error:', error)
        stopWithError('Playback failed. Try again or check whether the audio format is supported.')
      },
    })
    audioRef.current = howl

    if (wantsPlaybackRef.current) howl.play()

    return () => {
      cancelled = true
      howl.stop()
      howl.unload()
      if (audioRef.current === howl) audioRef.current = null
    }
  }, [currentAudioUrl, currentId, currentTrack?.fileName, currentTrack?.filePath, playerGeneration])

  function requestPlay() {
    wantsPlaybackRef.current = true
    if (!currentAudioUrl) {
      wantsPlaybackRef.current = false
      showToast('This track has no playable audio file.', { title: 'Playback Error', type: 'error' })
      return
    }
    // Run play() in the click/keyboard task. Never use setIsPlaying as
    // a proxy for starting media. Rebuild if the previous instance failed.
    startPlayback(audioRef.current, () => setPlayerGeneration((generation) => generation + 1))
  }

  function requestPause() {
    wantsPlaybackRef.current = false
    audioRef.current?.pause()
    setIsPlaying(false)
  }

  function selectAndPlay(trackId: string, availableTrackIds?: string[]) {
    if (availableTrackIds) queueRef.current?.start(availableTrackIds, trackId)
    wantsPlaybackRef.current = true
    setIsPlaying(false)
    setCurrentTrack(trackId)
  }

  function moveTrack(direction: 1 | -1, automatic = false) {
    if (!currentTrackId || !queueRef.current) return
    const nextId =
      direction === 1
        ? queueRef.current.next(currentTrackId, shuffle, repeat, automatic)
        : queueRef.current.previous(currentTrackId, shuffle, repeat)
    if (nextId) {
      if (nextId === currentTrackId) {
        audioRef.current?.seek(0)
        requestPlay()
      } else {
        selectAndPlay(nextId)
      }
    } else {
      requestPause()
    }
  }

  function playPrevious() {
    moveTrack(-1)
  }

  function playNext(automatic = false) {
    if (automatic && repeat === 'one') {
      audioRef.current?.seek(0)
      requestPlay()
      return
    }
    moveTrack(1, automatic)
  }

  useEffect(() => {
    playNextRef.current = () => playNext(true)
  })

  function handleTrackPlay(trackId: string, availableTrackIds: string[]) {
    if (currentTrackId === trackId) {
      if (audioRef.current?.playing()) requestPause()
      else requestPlay()
    } else {
      selectAndPlay(trackId, availableTrackIds)
    }
  }

  function togglePlay(fallbackTrackId?: string, availableTrackIds: string[] = []) {
    if (!currentTrack && fallbackTrackId) {
      selectAndPlay(fallbackTrackId, availableTrackIds)
      return
    }
    if (audioRef.current?.playing()) requestPause()
    else requestPlay()
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
