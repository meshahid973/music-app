import { create } from 'zustand'
import type { Playlist, RepeatMode, Track } from '../types'
import { attachCovers, uniqueTracks } from '../utils/library'

type MusicState = {
  tracks: Track[]
  playlists: Playlist[]
  activePlaylistId: string
  currentTrackId?: string
  isPlaying: boolean
  shuffle: boolean
  repeat: RepeatMode
  volume: number
  addTracks: (tracks: Track[]) => void
  addCovers: (covers: Map<string, string>) => void
  createPlaylist: (name: string) => void
  addTrackToPlaylist: (playlistId: string, trackId: string) => void
  setActivePlaylist: (playlistId: string) => void
  setCurrentTrack: (trackId: string) => void
  setIsPlaying: (isPlaying: boolean) => void
  toggleShuffle: () => void
  cycleRepeat: () => void
  setVolume: (volume: number) => void
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
  activePlaylistId: libraryId,
  isPlaying: false,
  shuffle: false,
  repeat: 'off',
  volume: 0.82,
  addTracks: (incoming) =>
    set((state) => {
      const tracks = [...state.tracks, ...uniqueTracks(state.tracks, incoming)]
      return {
        tracks,
        currentTrackId: state.currentTrackId ?? tracks[0]?.id,
      }
    }),
  addCovers: (covers) =>
    set((state) => ({
      tracks: attachCovers(state.tracks, covers),
    })),
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
  addTrackToPlaylist: (playlistId, trackId) =>
    set((state) => ({
      playlists: state.playlists.map((playlist) =>
        playlist.id === playlistId && !playlist.trackIds.includes(trackId)
          ? { ...playlist, trackIds: [...playlist.trackIds, trackId] }
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
}))
