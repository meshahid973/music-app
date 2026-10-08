import type { ChangeEvent, DragEvent } from 'react'
import { useMusicStore } from '../store/useMusicStore'
import {
  extractCovers,
  isAudioFile,
  isCoverFile,
  tracksFromFiles,
} from '../utils/library'

export function useLibraryImport() {
  const { addTracks, addCovers } = useMusicStore()

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
    handleMusicFiles,
    handleMusicFolder,
    handleCoverFolder,
    handleDrop,
  }
}
