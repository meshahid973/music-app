import { useCallback, useEffect } from 'react'
import type { ChangeEvent, DragEvent } from 'react'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import { useMusicStore } from '../store/useMusicStore'
import {
  extractCovers,
  isAudioFile,
  isCoverFile,
  tracksFromFiles,
} from '../utils/library'
import { isDesktopApp, pickNativeAudioFiles, pickNativeFolder } from '../utils/platform'
import {
  nativeCoversFromPaths,
  nativeTracksFromPaths,
  scanNativeDroppedPaths,
  scanNativeFolder,
} from '../utils/nativeFileSystem'

export function useLibraryImport() {
  const { addTracks, addCovers } = useMusicStore()
  const isDesktop = isDesktopApp()

  const importNativeScanResult = useCallback(
    async (audioPaths: string[], coverPaths: string[]) => {
      const storeLookup = useMusicStore.getState().coverLookup
      const combinedLookup = new Map(storeLookup)

      let coverPathsMap: Map<string, string> | undefined

      if (coverPaths.length > 0) {
        const { lookup, paths, urls } = nativeCoversFromPaths(coverPaths)
        coverPathsMap = paths
        for (const [k, v] of lookup.entries()) {
          combinedLookup.set(k, v)
        }
        addCovers(lookup, urls)
      }

      if (audioPaths.length > 0) {
        const existingIds = new Set(useMusicStore.getState().tracks.map((t) => t.id))
        const parsedTracks = await nativeTracksFromPaths(
          audioPaths,
          combinedLookup,
          existingIds,
          coverPathsMap,
        )
        if (parsedTracks.length > 0) {
          addTracks(parsedTracks)
        }
      }
    },
    [addCovers, addTracks],
  )

  useEffect(() => {
    if (!isDesktop) return
    let unlisten: (() => void) | undefined
    let cancelled = false

    getCurrentWebview()
      .onDragDropEvent((event) => {
        if (event.payload.type === 'drop' && event.payload.paths.length > 0) {
          void scanNativeDroppedPaths(event.payload.paths).then(({ audioPaths, coverPaths }) =>
            importNativeScanResult(audioPaths, coverPaths),
          )
        }
      })
      .then((fn) => {
        if (cancelled) {
          fn()
        } else {
          unlisten = fn
        }
      })
      .catch((err) => {
        console.warn('Could not register native drag-drop listener:', err)
      })

    return () => {
      cancelled = true
      unlisten?.()
    }
  }, [isDesktop, importNativeScanResult])

  // Native desktop handlers using OS dialogs
  async function handleNativeAddSongs() {
    const filePaths = await pickNativeAudioFiles()
    if (!filePaths || filePaths.length === 0) return

    const storeLookup = useMusicStore.getState().coverLookup
    const existingIds = new Set(useMusicStore.getState().tracks.map((t) => t.id))
    const parsedTracks = await nativeTracksFromPaths(filePaths, storeLookup, existingIds)
    if (parsedTracks.length > 0) {
      addTracks(parsedTracks)
    }
  }

  async function handleNativeMusicFolder() {
    const folderPath = await pickNativeFolder()
    if (!folderPath) return

    const { audioPaths, coverPaths } = await scanNativeFolder(folderPath)
    await importNativeScanResult(audioPaths, coverPaths)
  }

  async function handleNativeCoverFolder() {
    const folderPath = await pickNativeFolder()
    if (!folderPath) return

    const { coverPaths } = await scanNativeFolder(folderPath)
    if (coverPaths.length > 0) {
      const { lookup, urls } = nativeCoversFromPaths(coverPaths)
      if (urls.length > 0) {
        addCovers(lookup, urls)
      }
    }
  }

  // Web browser fallback handlers using HTML inputs
  async function handleMusicFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? [])
    if (files.length === 0) return

    const coverFiles = files.filter(isCoverFile)
    const storeLookup = useMusicStore.getState().coverLookup
    const combinedLookup = new Map(storeLookup)

    if (coverFiles.length > 0) {
      const { lookup, urls } = extractCovers(coverFiles)
      for (const [k, v] of lookup.entries()) {
        combinedLookup.set(k, v)
      }
      addCovers(lookup, urls)
    }

    const parsedTracks = await tracksFromFiles(
      files,
      combinedLookup,
      new Set(useMusicStore.getState().tracks.map((track) => track.id)),
    )
    if (parsedTracks.length > 0) {
      addTracks(parsedTracks)
    }
    event.target.value = ''
  }

  async function handleMusicFolder(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? [])
    if (files.length === 0) return

    const coverFiles = files.filter(isCoverFile)
    const storeLookup = useMusicStore.getState().coverLookup
    const combinedLookup = new Map(storeLookup)

    if (coverFiles.length > 0) {
      const { lookup, urls } = extractCovers(coverFiles)
      for (const [k, v] of lookup.entries()) {
        combinedLookup.set(k, v)
      }
      addCovers(lookup, urls)
    }

    const parsedTracks = await tracksFromFiles(
      files,
      combinedLookup,
      new Set(useMusicStore.getState().tracks.map((track) => track.id)),
    )
    if (parsedTracks.length > 0) {
      addTracks(parsedTracks)
    }
    event.target.value = ''
  }

  function handleCoverFolder(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? [])
    if (files.length === 0) return
    const { lookup, urls } = extractCovers(files)
    if (urls.length > 0) {
      addCovers(lookup, urls)
    }
    event.target.value = ''
  }

  async function handleDrop(event: DragEvent) {
    event.preventDefault()
    const files = Array.from(event.dataTransfer?.files ?? [])
    if (files.length === 0) return

    const coverFiles = files.filter(isCoverFile)
    const audioFiles = files.filter(isAudioFile)
    const storeLookup = useMusicStore.getState().coverLookup
    const combinedLookup = new Map(storeLookup)

    if (coverFiles.length > 0) {
      const { lookup, urls } = extractCovers(coverFiles)
      for (const [k, v] of lookup.entries()) {
        combinedLookup.set(k, v)
      }
      addCovers(lookup, urls)
    }

    if (audioFiles.length > 0) {
      const parsedTracks = await tracksFromFiles(
        audioFiles,
        combinedLookup,
        new Set(useMusicStore.getState().tracks.map((track) => track.id)),
      )
      addTracks(parsedTracks)
    }
  }

  return {
    isDesktop: isDesktopApp(),
    handleNativeAddSongs,
    handleNativeMusicFolder,
    handleNativeCoverFolder,
    handleMusicFiles,
    handleMusicFolder,
    handleCoverFolder,
    handleDrop,
  }
}
