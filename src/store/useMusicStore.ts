import { create } from 'zustand'
import type { Playlist, RepeatMode, Track } from '../types'
import { assignRandomCovers, attachCovers, uniqueTracks } from '../utils/library'

type MusicState = {
  tracks: Track[]
  playlists: Playlist[]
  coverPool: string[]
  activePlaylistId: string
  currentTrackId?: string
  isPlaying: boolean
  shuffle: boolean
  repeat: RepeatMode
  volume: number
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

export const useMusicStore = create<MusicState>((set) => ({
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
  activePlaylistId: libraryId,
  isPlaying: false,
  shuffle: false,
  repeat: 'off',
  volume: 0.82,
  addTracks: (incoming) =>
    set((state) => {
      const processedIncoming =
        state.coverPool.length > 0
          ? assignRandomCovers(incoming, state.coverPool)
          : incoming
      const tracks = [...state.tracks, ...uniqueTracks(state.tracks, processedIncoming)]
      return {
        tracks,
        currentTrackId: state.currentTrackId ?? tracks[0]?.id,
      }
    }),
  addCovers: (covers, extraUrls = []) =>
    set((state) => {
      const incomingCovers = Array.from(new Set([...Array.from(covers.values()), ...extraUrls]))
      const updatedPool = Array.from(new Set([...state.coverPool, ...incomingCovers]))
      return {
        coverPool: updatedPool,
        tracks: attachCovers(state.tracks, covers, updatedPool),
      }
    }),
  createPlaylist: (name) =>
    set((state) => ({
      playlists: [
        ...state.playlists,
        {
          id: `${name}-${Date.now()}`,
          name,
          trackIds: [],
          createdAt: Date.now(),
        },
      ],
    })),
  deletePlaylist: (playlistId) =>
    set((state) => ({
      playlists: state.playlists.filter((playlist) => playlist.id !== playlistId),
      activePlaylistId:
        state.activePlaylistId === playlistId ? libraryId : state.activePlaylistId,
    })),
  renamePlaylist: (playlistId, name) =>
    set((state) => ({
      playlists: state.playlists.map((playlist) =>
        playlist.id === playlistId
          ? { ...playlist, name: name.trim() || playlist.name }
          : playlist,
      ),
    })),
  addTrackToPlaylist: (playlistId, trackId) =>
    set((state) => ({
      playlists: state.playlists.map((playlist) =>
        playlist.id === playlistId && !playlist.trackIds.includes(trackId)
          ? { ...playlist, trackIds: [...playlist.trackIds, trackId] }
          : playlist,
      ),
    })),
  removeTrackFromPlaylist: (playlistId, trackId) =>
    set((state) => ({
      playlists: state.playlists.map((playlist) =>
        playlist.id === playlistId
          ? { ...playlist, trackIds: playlist.trackIds.filter((id) => id !== trackId) }
          : playlist,
      ),
    })),
  setActivePlaylist: (activePlaylistId) => set({ activePlaylistId }),
  setCurrentTrack: (currentTrackId) => set({ currentTrackId, isPlaying: true }),
  setIsPlaying: (isPlaying) => set({ isPlaying }),
  toggleShuffle: () => set((state) => ({ shuffle: !state.shuffle })),
  cycleRepeat: () =>
    set((state) => ({
      repeat: state.repeat === 'off' ? 'all' : state.repeat === 'all' ? 'one' : 'off',
    })),
  setVolume: (volume) => set({ volume }),
  updateTrack: (trackId, updates) =>
    set((state) => ({
      tracks: state.tracks.map((track) =>
        track.id === trackId ? { ...track, ...updates } : track,
      ),
    })),
}))
