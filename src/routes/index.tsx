import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useUIStore } from '@/stores/uiStore'
import { fetchFeed } from '@/api/client'
import { MessageCard } from '@/components/MessageCard'
import { Loader2 } from 'lucide-react'

export const Route = createFileRoute('/')({
  component: FeedPage,
})

function FeedPage() {
  const activeSource = useUIStore((s) => s.activeSource)

  const { data, isLoading, error } = useQuery({
    queryKey: ['feed', activeSource],
    queryFn: () => fetchFeed(activeSource),
  })

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="h-full flex items-center justify-center text-destructive">
        <p>加载失败: {(error as Error).message}</p>
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto p-4 space-y-4">
      {data?.messages.map((message) => (
        <MessageCard key={message.id} message={message} fetchedAt={data?.fetchedAt} />
      ))}
      {data?.messages.length === 0 && (
        <div className="text-center text-muted-foreground py-8">
          暂无内容
        </div>
      )}
    </div>
  )
}
