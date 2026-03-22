import { create } from 'zustand'
import type { FeedSource } from '@/types'

interface UIState {
  activeSource: FeedSource
  setActiveSource: (source: FeedSource) => void
}

export const useUIStore = create<UIState>((set) => ({
  activeSource: 'twitter-following',
  setActiveSource: (source) => set({ activeSource: source }),
}))
