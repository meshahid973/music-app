import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChangeEvent, DragEvent } from 'react'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import { appDataDir } from '@tauri-apps/api/path'
import { useMusicStore } from '../store/useMusicStore'
import { saveFolderArtwork } from '../utils/artworkStorage'
import { showToast, type ToastType } from '../store/useToastStore'
import {
  extractCovers,
  isAudioFile,
  isCoverFile,
  tracksFromFiles,
} from '../utils/library'
import { isDesktopApp, pickNativeAudioFiles, pickNativeFolder, toNativeAssetUrl } from '../utils/platform'
import {
  nativeCoversFromPaths,
  nativeTracksFromPaths,
  scanNativeDroppedPaths,
  scanNativeFolder,
} from '../utils/nativeFileSystem'

export function useLibraryImport() {
  const {
    addTracks,
    addCovers,
    musicFolderPath,
    coverFolderPath,
    isInitialized,
    musicFolderName,
    coverFolderName,
    setMusicFolder,
    setCoverFolder,
  } = useMusicStore()
  const isDesktop = isDesktopApp()

  const [isScanningMusic, setIsScanningMusic] = useState(false)
  const [isScanningCovers, setIsScanningCovers] = useState(false)
  const [scanNotice, setScanNotice] = useState<string | null>(null)
  const noticeTimerRef = useRef<number | null>(null)
  const nativeCoverPathsRef = useRef<Map<string, string>>(new Map())

  const showNotice = useCallback(
    (
      message: string,
      type: ToastType = 'success',
      title = 'Library Updated',
    ) => {
      if (noticeTimerRef.current) {
        window.clearTimeout(noticeTimerRef.current)
      }
      setScanNotice(message)
      showToast(message, { title, type })
      noticeTimerRef.current = window.setTimeout(() => {
        setScanNotice(null)
        noticeTimerRef.current = null
      }, 3800)
    },
    [],
  )

  const showScanErrors = useCallback(
    (paths: string[]) => {
      const count = new Set(paths).size
      if (count === 0) return
      showNotice(
        `${count} folder(s) could not be scanned. Check folder permissions; accessible files were still imported.`,
        'warning',
        'Folder Scan Incomplete',
      )
    },
    [showNotice],
  )

  const importNativeScanResult = useCallback(
    async (audioPaths: string[], coverPaths: string[]) => {
      const storeLookup = useMusicStore.getState().coverLookup
      const combinedLookup = new Map(storeLookup)

      let addedCoversCount = 0

      if (coverPaths.length > 0) {
        const { lookup, paths, urls } = await nativeCoversFromPaths(coverPaths)
        for (const [k, v] of lookup.entries()) {
          if (!combinedLookup.has(k)) {
            addedCoversCount++
          }
          combinedLookup.set(k, v)
        }
        // Preserve keys from an independently selected cover folder too.
        for (const [key, path] of paths.entries()) {
          nativeCoverPathsRef.current.set(key, path)
        }
        addCovers(lookup, urls, paths)
      }

      let addedTracksCount = 0
      if (audioPaths.length > 0) {
        const existingIds = new Set(useMusicStore.getState().tracks.map((t) => t.id))
        const parsedTracks = await nativeTracksFromPaths(
          audioPaths,
          combinedLookup,
          existingIds,
          nativeCoverPathsRef.current,
        )
        if (parsedTracks.length > 0) {
          addedTracksCount = parsedTracks.length
          addTracks(parsedTracks)
        }
      }

      return { addedTracksCount, addedCoversCount }
    },
    [addCovers, addTracks],
  )

  // Migrate older manual/direct cover paths that pointed outside AppData. The asset
  // protocol cannot load those paths, so copy them once into the allowed artwork directory.
  useEffect(() => {
    if (!isDesktop || !isInitialized) return
    let cancelled = false

    void (async () => {
      const appDataPath = (await appDataDir()).replace(/\\/g, '/').replace(/\/$/, '').toLowerCase()
      const savedTracks = useMusicStore.getState().tracks
      for (const track of savedTracks) {
        if (!track.coverPath) continue
        const normalizedPath = track.coverPath.replace(/\\/g, '/').replace(/\/$/, '').toLowerCase()
        if (normalizedPath === appDataPath || normalizedPath.startsWith(`${appDataPath}/`)) continue

        const savedPath = await saveFolderArtwork(track.coverPath)
        if (cancelled) return
        if (savedPath) {
          useMusicStore.getState().updateTrack(track.id, {
            coverPath: savedPath,
            coverUrl: toNativeAssetUrl(savedPath),
            coverSource: track.coverSource,
          })
        }
      }
    })().catch((err) => {
      console.warn('Could not repair legacy cover paths:', err)
    })

    return () => {
      cancelled = true
    }
  }, [isDesktop, isInitialized])

  // Restore durable cover paths before rendering persisted tracks. This repairs older
  // library entries that saved an asset URL but did not save the corresponding image path.
  useEffect(() => {
    if (!isDesktop || !isInitialized || !coverFolderPath) return
    let cancelled = false

    void scanNativeFolder(coverFolderPath)
      .then(async ({ coverPaths, errors }) => {
        if (cancelled) return
        if (errors.length > 0) showScanErrors(errors)
        if (coverPaths.length === 0) return
        const { lookup, paths, urls } = await nativeCoversFromPaths(coverPaths)
        if (cancelled) return
        for (const [key, path] of paths.entries()) nativeCoverPathsRef.current.set(key, path)
        addCovers(lookup, urls, paths)
      })
      .catch((err) => {
        console.warn('Could not restore cover paths from the saved cover folder:', err)
      })

    return () => {
      cancelled = true
    }
  }, [addCovers, coverFolderPath, isDesktop, isInitialized, showScanErrors])

  useEffect(() => {
    if (!isDesktop) return
    let unlisten: (() => void) | undefined
    let cancelled = false

    getCurrentWebview()
      .onDragDropEvent((event) => {
        if (event.payload.type === 'drop' && event.payload.paths.length > 0) {
          void scanNativeDroppedPaths(event.payload.paths)
            .then(async ({ audioPaths, coverPaths, errors }) => {
              await importNativeScanResult(audioPaths, coverPaths)
              showScanErrors(errors)
            })
            .catch((err) => {
              console.warn('Importing dropped files or folders failed:', err)
              showNotice('Could not import the dropped files or folders', 'error', 'Import Failed')
            })
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
  }, [isDesktop, importNativeScanResult, showNotice, showScanErrors])

  // Native desktop handlers using OS dialogs
  async function handleNativeAddSongs() {
    try {
      const filePaths = await pickNativeAudioFiles()
      if (!filePaths || filePaths.length === 0) return

      const storeState = useMusicStore.getState()
      const combinedLookup = new Map(storeState.coverLookup)

      // Rebuild the selected cover folder's path index before parsing individually selected songs.
      // The in-memory maps are lost on restart, while the folder itself is persisted.
      if (storeState.coverFolderPath) {
        const { coverPaths, errors } = await scanNativeFolder(storeState.coverFolderPath)
        if (errors.length > 0) showScanErrors(errors)
        if (coverPaths.length > 0) {
          const { lookup, paths, urls } = await nativeCoversFromPaths(coverPaths)
          for (const [key, value] of lookup.entries()) combinedLookup.set(key, value)
          for (const [key, path] of paths.entries()) nativeCoverPathsRef.current.set(key, path)
          addCovers(lookup, urls, paths)
        }
      }

      const existingIds = new Set(useMusicStore.getState().tracks.map((t) => t.id))
      const parsedTracks = await nativeTracksFromPaths(
        filePaths,
        combinedLookup,
        existingIds,
        nativeCoverPathsRef.current,
      )
      if (parsedTracks.length > 0) {
        addTracks(parsedTracks)
        showNotice(
          parsedTracks.length === 1
            ? '1 song imported successfully'
            : `${parsedTracks.length} songs imported successfully`,
          'success',
          'Import Successful',
        )
      } else {
        showNotice('All selected songs are already in your library', 'info', 'Library Up to Date')
      }
    } catch (err) {
      console.warn('Importing selected audio files failed:', err)
      showNotice('Could not import the selected audio files', 'error', 'Import Failed')
    }
  }

  async function handleNativeMusicFolder() {
    const folderPath = await pickNativeFolder()
    if (!folderPath) return

    const folderName = folderPath.split(/[/\\]/).filter(Boolean).pop() || folderPath
    setMusicFolder(folderPath, folderName)

    setIsScanningMusic(true)
    try {
      const { audioPaths, coverPaths, errors } = await scanNativeFolder(folderPath)
      const result = await importNativeScanResult(audioPaths, coverPaths)
      showScanErrors(errors)
      if (result.addedTracksCount > 0) {
        showNotice(
          result.addedTracksCount === 1
            ? '1 song imported successfully'
            : `${result.addedTracksCount} songs imported successfully`,
          'success',
          'Import Successful',
        )
      } else {
        showNotice(`Library is up to date (${audioPaths.length} songs found)`, 'info', 'Folder Scanned')
      }
    } catch (err) {
      console.warn('Importing the selected music folder failed:', err)
      showNotice('Could not import the selected music folder', 'error', 'Import Failed')
    } finally {
      setIsScanningMusic(false)
    }
  }

  async function handleRescanMusicFolder() {
    if (isDesktop) {
      const currentPath = useMusicStore.getState().musicFolderPath
      if (!currentPath) {
        await handleNativeMusicFolder()
        return
      }

      setIsScanningMusic(true)
      try {
        const { audioPaths, coverPaths, errors } = await scanNativeFolder(currentPath)
        const result = await importNativeScanResult(audioPaths, coverPaths)
        showScanErrors(errors)
        if (result.addedTracksCount > 0) {
          showNotice(
            result.addedTracksCount === 1
              ? '1 new song imported successfully'
              : `${result.addedTracksCount} new songs imported successfully`,
            'success',
            'Import Successful',
          )
        } else {
          showNotice('Music folder is up to date (no new files)', 'info', 'Library Up to Date')
        }
      } catch (err) {
        console.warn('Rescan music folder failed:', err)
        showNotice('Failed to scan music folder', 'error', 'Scan Error')
      } finally {
        setIsScanningMusic(false)
      }
    } else {
      if ('showDirectoryPicker' in window) {
        try {
          setIsScanningMusic(true)
          // @ts-expect-error window.showDirectoryPicker
          const dirHandle = await window.showDirectoryPicker()
          if (dirHandle) {
            setMusicFolder(undefined, dirHandle.name)
            const files: File[] = []
            async function readEntries(dir: any, pathPrefix = '') {
              for await (const entry of dir.values()) {
                if (entry.kind === 'file') {
                  const f = await entry.getFile()
                  Object.defineProperty(f, 'webkitRelativePath', {
                    value: pathPrefix ? `${pathPrefix}/${f.name}` : f.name,
                    writable: true,
                  })
                  files.push(f)
                } else if (entry.kind === 'directory') {
                  await readEntries(entry, pathPrefix ? `${pathPrefix}/${entry.name}` : entry.name)
                }
              }
            }
            await readEntries(dirHandle)
            await processWebMusicFiles(files)
          }
        } catch (err: any) {
          if (err?.name !== 'AbortError') {
            console.warn('Web directory picker error:', err)
            showNotice('Could not access the selected music folder. Check its permissions and try again.', 'error', 'Folder Access Failed')
          }
        } finally {
          setIsScanningMusic(false)
        }
      }
    }
  }

  async function handleNativeCoverFolder() {
    const folderPath = await pickNativeFolder()
    if (!folderPath) return

    const folderName = folderPath.split(/[/\\]/).filter(Boolean).pop() || folderPath
    setCoverFolder(folderPath, folderName)

    setIsScanningCovers(true)
    try {
      const { coverPaths, errors } = await scanNativeFolder(folderPath)
      if (coverPaths.length > 0) {
        const { lookup, paths, urls } = await nativeCoversFromPaths(coverPaths)
        for (const [key, path] of paths.entries()) nativeCoverPathsRef.current.set(key, path)
        if (urls.length > 0) {
          addCovers(lookup, urls, paths)
          showNotice(
            urls.length === 1
              ? '1 cover artwork imported successfully'
              : `${urls.length} cover artworks imported successfully`,
            'success',
            'Covers Imported',
          )
        }
      } else if (errors.length === 0) {
        showNotice('No cover artwork files found', 'info', 'Covers Notice')
      }
      showScanErrors(errors)
    } catch (err) {
      console.warn('Importing the selected cover folder failed:', err)
      showNotice('Could not import the selected cover folder', 'error', 'Import Failed')
    } finally {
      setIsScanningCovers(false)
    }
  }

  async function handleRescanCoverFolder() {
    if (isDesktop) {
      const currentPath = useMusicStore.getState().coverFolderPath
      if (!currentPath) {
        await handleNativeCoverFolder()
        return
      }

      setIsScanningCovers(true)
      try {
        const { coverPaths, errors } = await scanNativeFolder(currentPath)
        if (coverPaths.length > 0) {
          const { lookup, paths, urls } = await nativeCoversFromPaths(coverPaths)
          const existingLookup = useMusicStore.getState().coverLookup
          let newCoversCount = 0
          for (const key of lookup.keys()) {
            if (!existingLookup.has(key)) {
              newCoversCount++
            }
          }
          const pathsChanged = Array.from(paths.entries()).some(
            ([key, path]) => nativeCoverPathsRef.current.get(key) !== path,
          )
          for (const [key, path] of paths.entries()) nativeCoverPathsRef.current.set(key, path)
          if (newCoversCount > 0 || pathsChanged) {
            addCovers(lookup, urls, paths)
            showNotice(
              newCoversCount === 1
                ? '1 new cover artwork imported'
                : `${newCoversCount} new cover artworks imported`,
              'success',
              'Covers Imported',
            )
          } else {
            showNotice('Cover folder is up to date (no new files)', 'info', 'Covers Up to Date')
          }
        } else if (errors.length === 0) {
          showNotice('Cover folder is up to date (no new files)', 'info', 'Covers Up to Date')
        }
        showScanErrors(errors)
      } catch (err) {
        console.warn('Rescan cover folder failed:', err)
        showNotice('Failed to scan cover folder', 'error', 'Scan Error')
      } finally {
        setIsScanningCovers(false)
      }
    } else {
      if ('showDirectoryPicker' in window) {
        try {
          setIsScanningCovers(true)
          // @ts-expect-error window.showDirectoryPicker
          const dirHandle = await window.showDirectoryPicker()
          if (dirHandle) {
            setCoverFolder(undefined, dirHandle.name)
            const files: File[] = []
            async function readEntries(dir: any, pathPrefix = '') {
              for await (const entry of dir.values()) {
                if (entry.kind === 'file') {
                  const f = await entry.getFile()
                  Object.defineProperty(f, 'webkitRelativePath', {
                    value: pathPrefix ? `${pathPrefix}/${f.name}` : f.name,
                    writable: true,
                  })
                  files.push(f)
                } else if (entry.kind === 'directory') {
                  await readEntries(entry, pathPrefix ? `${pathPrefix}/${entry.name}` : entry.name)
                }
              }
            }
            await readEntries(dirHandle)
            processWebCoverFiles(files)
          }
        } catch (err: any) {
          if (err?.name !== 'AbortError') {
            console.warn('Web directory picker error:', err)
            showNotice('Could not access the selected cover folder. Check its permissions and try again.', 'error', 'Folder Access Failed')
          }
        } finally {
          setIsScanningCovers(false)
        }
      }
    }
  }

  // Shared web import path for file pickers and directory scans.
  async function importWebMusicFiles(
    files: File[],
    emptyMessage: string,
    emptyTitle: string,
  ) {
    if (files.length === 0) return

    const coverFiles = files.filter(isCoverFile)
    const combinedLookup = new Map(useMusicStore.getState().coverLookup)

    if (coverFiles.length > 0) {
      const { lookup, urls } = extractCovers(coverFiles)
      for (const [key, value] of lookup.entries()) {
        combinedLookup.set(key, value)
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
      showNotice(
        parsedTracks.length === 1
          ? '1 song imported successfully'
          : `${parsedTracks.length} songs imported successfully`,
        'success',
        'Import Successful',
      )
    } else {
      showNotice(emptyMessage, 'info', emptyTitle)
    }
  }

  async function processWebMusicFiles(files: File[]) {
    await importWebMusicFiles(files, 'Music folder is up to date (no new files)', 'Folder Scanned')
  }

  function processWebCoverFiles(files: File[]) {
    if (files.length === 0) return
    const { lookup, urls } = extractCovers(files)
    if (urls.length > 0) {
      addCovers(lookup, urls)
      showNotice(
        urls.length === 1
          ? '1 cover artwork imported successfully'
          : `${urls.length} cover artworks imported successfully`,
        'success',
        'Covers Imported',
      )
    } else {
      showNotice('No cover artwork files found', 'info', 'Covers Notice')
    }
  }

  // Web browser fallback handlers using HTML inputs
  async function handleMusicFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? [])
    if (files.length === 0) return

    try {
      await importWebMusicFiles(
        files,
        'All selected songs are already in your library',
        'Library Up to Date',
      )
    } finally {
      event.target.value = ''
    }
  }

  async function handleMusicFolder(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? [])
    if (files.length === 0) return

    if (files[0]?.webkitRelativePath) {
      const rootFolder = files[0].webkitRelativePath.split('/')[0]
      if (rootFolder) setMusicFolder(undefined, rootFolder)
    }

    setIsScanningMusic(true)
    try {
      await processWebMusicFiles(files)
    } finally {
      setIsScanningMusic(false)
    }
    event.target.value = ''
  }

  function handleCoverFolder(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? [])
    if (files.length === 0) return

    if (files[0]?.webkitRelativePath) {
      const rootFolder = files[0].webkitRelativePath.split('/')[0]
      if (rootFolder) setCoverFolder(undefined, rootFolder)
    }

    setIsScanningCovers(true)
    try {
      processWebCoverFiles(files)
    } finally {
      setIsScanningCovers(false)
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
      if (parsedTracks.length > 0) {
        addTracks(parsedTracks)
        showNotice(
          parsedTracks.length === 1
            ? '1 song imported successfully'
            : `${parsedTracks.length} songs imported successfully`,
          'success',
          'Import Successful',
        )
      }
    }
  }

  return {
    isDesktop,
    musicFolderPath,
    coverFolderPath,
    musicFolderName,
    coverFolderName,
    isScanningMusic,
    isScanningCovers,
    scanNotice,
    handleNativeAddSongs,
    handleNativeMusicFolder,
    handleNativeCoverFolder,
    handleRescanMusicFolder,
    handleRescanCoverFolder,
    handleMusicFiles,
    handleMusicFolder,
    handleCoverFolder,
    handleDrop,
  }
}
