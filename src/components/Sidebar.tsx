import { useUIStore } from '@/stores/uiStore'
import { cn } from '@/lib/utils'
import { FEED_SOURCES, type FeedCategory, type FeedSource } from '@/types'
import { User, Sparkles, ChevronRight } from 'lucide-react'

interface SidebarProps {
  onSourceChange?: (source: FeedSource) => void
}

export function Sidebar({ onSourceChange }: SidebarProps) {
  const activeSource = useUIStore((s) => s.activeSource)
  const setActiveSource = useUIStore((s) => s.setActiveSource)

  const handleSourceChange = (source: FeedSource) => {
    setActiveSource(source)
    onSourceChange?.(source)
  }

  const categories: { id: FeedCategory; label: string; icon: React.ReactNode }[] = [
    { id: 'follow', label: '关注的人', icon: <User className="h-4 w-4" /> },
    { id: 'recommend', label: '平台推送', icon: <Sparkles className="h-4 w-4" /> },
  ]

  return (
    <div className="w-48 border-r bg-muted/30 flex flex-col">
      <div className="p-4 border-b">
        <h1 className="font-semibold text-lg">Radar</h1>
        <p className="text-xs text-muted-foreground">信息雷达</p>
      </div>
      <nav className="flex-1 p-2 space-y-1">
        {categories.map((category) => (
          <div key={category.id} className="space-y-1">
            <button
              className={cn(
                "w-full flex items-center gap-2 px-3 py-2 text-sm rounded-md transition-colors",
                "hover:bg-accent hover:text-accent-foreground",
                FEED_SOURCES[category.id].some(s => s.id === activeSource) &&
                  "bg-accent text-accent-foreground font-medium"
              )}
            >
              {category.icon}
              {category.label}
            </button>
            <div className="ml-4 space-y-0.5">
              {FEED_SOURCES[category.id].map((source) => (
                <button
                  key={source.id}
                  onClick={() => handleSourceChange(source.id)}
                  className={cn(
                    "w-full flex items-center gap-1 px-3 py-1.5 text-sm rounded-md transition-colors",
                    "hover:bg-accent hover:text-accent-foreground",
                    activeSource === source.id &&
                      "bg-primary text-primary-foreground hover:bg-primary"
                  )}
                >
                  <ChevronRight className="h-3 w-3" />
                  {source.label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </nav>
    </div>
  )
}
