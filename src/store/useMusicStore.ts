import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Playlist, RepeatMode, Track } from '../types'
import { assignCoversToTracks, syncTracksWithCovers, uniqueTracks } from '../utils/library'
import { loadDesktopLibrary, saveDesktopLibrary } from '../utils/desktopDatabase'

type MusicState = {
  tracks: Track[]
  playlists: Playlist[]
  coverPool: string[]
  coverLookup: Map<string, string>
  activePlaylistId: string
  currentTrackId?: string
  isPlaying: boolean
  shuffle: boolean
  repeat: RepeatMode
  volume: number
  isInitialized: boolean
  initDesktopStorage: () => Promise<void>
  addTracks: (tracks: Track[]) => void
  addCovers: (covers: Map<string, string>, extraUrls?: string[]) => void
  createPlaylist: (name: string) => void
  deletePlaylist: (playlistId: string) => void
  renamePlaylist: (playlistId: string, name: string) => void
  addTrackToPlaylist: (playlistId: string, trackId: string) => void
  removeTrackFromPlaylist: (playlistId: string, trackId: string) => void
  setActivePlaylist: (playlistId: string) => void
  setCurrentTrack: (trackId: string) => void
  setIsPlaying: (isPlaying: boolean) => void
  toggleShuffle: () => void
  cycleRepeat: () => void
  setVolume: (volume: number) => void
  updateTrack: (trackId: string, updates: Partial<Track>) => void
}

export const libraryId = 'library'
export const favoritesId = 'favorites'

let saveTimer: ReturnType<typeof setTimeout> | null = null
function queueSave(state: MusicState) {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveDesktopLibrary({
      tracks: state.tracks.filter((t) => Boolean(t.filePath)),
      playlists: state.playlists,
      activePlaylistId: state.activePlaylistId,
      currentTrackId: state.currentTrackId,
      volume: state.volume,
      shuffle: state.shuffle,
      repeat: state.repeat,
    })
  }, 400)
}

export const useMusicStore = create<MusicState>()(
  persist(
    (set, get) => ({
      tracks: [],
      playlists: [
        {
          id: favoritesId,
          name: 'Favorites',
          trackIds: [],
          createdAt: Date.now(),
        },
        {
          id: 'night-drive',
          name: 'Night Drive',
          trackIds: [],
          createdAt: Date.now() + 1,
        },
      ],
      coverPool: [],
      coverLookup: new Map<string, string>(),
      activePlaylistId: libraryId,
      isPlaying: false,
      shuffle: false,
      repeat: 'off',
      volume: 0.82,
      isInitialized: false,

      initDesktopStorage: async () => {
        if (get().isInitialized) return
        try {
          const loaded = await loadDesktopLibrary()
          if (loaded) {
            set((state) => ({
              tracks: loaded.tracks.length > 0 ? loaded.tracks : state.tracks,
              playlists: loaded.playlists.length > 0 ? loaded.playlists : state.playlists,
              activePlaylistId: loaded.activePlaylistId || state.activePlaylistId,
              currentTrackId: loaded.currentTrackId || state.currentTrackId,
              volume: typeof loaded.volume === 'number' ? loaded.volume : state.volume,
              shuffle: typeof loaded.shuffle === 'boolean' ? loaded.shuffle : state.shuffle,
              repeat: loaded.repeat || state.repeat,
              isInitialized: true,
            }))
            return
          }
        } catch (err) {
          console.warn('Could not initialize desktop storage:', err)
        }
        set({ isInitialized: true })
      },

      addTracks: (incoming) =>
        set((state) => {
          const processedIncoming = assignCoversToTracks(
            state.tracks,
            uniqueTracks(state.tracks, incoming),
            state.coverPool,
            state.coverLookup,
          )
          const tracks = [...state.tracks, ...processedIncoming]
          const next = {
            tracks,
            currentTrackId: state.currentTrackId ?? tracks[0]?.id,
          }
          queueSave({ ...state, ...next })
          return next
        }),

      addCovers: (covers, extraUrls = []) =>
        set((state) => {
          const mergedLookup = new Map(state.coverLookup)
          for (const [key, value] of covers.entries()) {
            mergedLookup.set(key, value)
          }
          const incomingCovers = Array.from(new Set([...Array.from(covers.values()), ...extraUrls]))
          const updatedPool = Array.from(new Set([...state.coverPool, ...incomingCovers]))
          const tracks = syncTracksWithCovers(state.tracks, mergedLookup, updatedPool)
          const next = {
            coverLookup: mergedLookup,
            coverPool: updatedPool,
            tracks,
          }
          queueSave({ ...state, ...next })
          return next
        }),

      createPlaylist: (name) =>
        set((state) => {
          const playlists = [
            ...state.playlists,
            {
              id: crypto.randomUUID(),
              name,
              trackIds: [],
              createdAt: Date.now(),
            },
          ]
          queueSave({ ...state, playlists })
          return { playlists }
        }),

      deletePlaylist: (playlistId) =>
        set((state) => {
          const playlists = state.playlists.filter((playlist) => playlist.id !== playlistId)
          const activePlaylistId =
            state.activePlaylistId === playlistId ? libraryId : state.activePlaylistId
          queueSave({ ...state, playlists, activePlaylistId })
          return { playlists, activePlaylistId }
        }),

      renamePlaylist: (playlistId, name) =>
        set((state) => {
          const playlists = state.playlists.map((playlist) =>
            playlist.id === playlistId
              ? { ...playlist, name: name.trim() || playlist.name }
              : playlist,
          )
          queueSave({ ...state, playlists })
          return { playlists }
        }),

      addTrackToPlaylist: (playlistId, trackId) =>
        set((state) => {
          const playlists = state.playlists.map((playlist) =>
            playlist.id === playlistId && !playlist.trackIds.includes(trackId)
              ? { ...playlist, trackIds: [...playlist.trackIds, trackId] }
              : playlist,
          )
          queueSave({ ...state, playlists })
          return { playlists }
        }),

      removeTrackFromPlaylist: (playlistId, trackId) =>
        set((state) => {
          const playlists = state.playlists.map((playlist) =>
            playlist.id === playlistId
              ? { ...playlist, trackIds: playlist.trackIds.filter((id) => id !== trackId) }
              : playlist,
          )
          queueSave({ ...state, playlists })
          return { playlists }
        }),

      setActivePlaylist: (activePlaylistId) => {
        set({ activePlaylistId })
        queueSave(get())
      },

      setCurrentTrack: (currentTrackId) => {
        set({ currentTrackId, isPlaying: true })
        queueSave(get())
      },

      setIsPlaying: (isPlaying) => set({ isPlaying }),

      toggleShuffle: () =>
        set((state) => {
          const shuffle = !state.shuffle
          queueSave({ ...state, shuffle })
          return { shuffle }
        }),

      cycleRepeat: () =>
        set((state) => {
          const repeat =
            state.repeat === 'off' ? 'all' : state.repeat === 'all' ? 'one' : 'off'
          queueSave({ ...state, repeat })
          return { repeat }
        }),

      setVolume: (volume) => {
        set({ volume })
        queueSave(get())
      },

      updateTrack: (trackId, updates) =>
        set((state) => {
          const tracks = state.tracks.map((track) =>
            track.id === trackId
              ? {
                  ...track,
                  ...updates,
                  coverSource: updates.coverUrl !== undefined ? 'custom' : track.coverSource,
                }
              : track,
          )
          queueSave({ ...state, tracks })
          return { tracks }
        }),
    }),
    {
      name: 'resonance-playlists-v1',
      version: 1,
      // Persist playlists, settings, and native persistent tracks
      partialize: (state) => ({
        tracks: state.tracks.filter((track) => Boolean(track.filePath)),
        playlists: state.playlists,
        activePlaylistId: state.activePlaylistId,
        volume: state.volume,
        shuffle: state.shuffle,
        repeat: state.repeat,
      }),
    },
  ),
)
