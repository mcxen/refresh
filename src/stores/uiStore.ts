import { create } from 'zustand'

interface UIStore {
  /** 'all' 或 source name */
  activeSource: string
  view: 'feed' | 'windows'
  /** windows 视图中选中的 window */
  selectedWindow: string | null
  setActiveSource: (source: string) => void
  setView: (view: 'feed' | 'windows') => void
  setSelectedWindow: (name: string | null) => void
}

export const useUIStore = create<UIStore>(set => ({
  activeSource: 'all',
  view: 'feed',
  selectedWindow: null,
  setActiveSource: source => set({ activeSource: source, view: 'feed' }),
  setView: view => set({ view }),
  setSelectedWindow: name => set({ selectedWindow: name }),
}))
