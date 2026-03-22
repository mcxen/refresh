import { ReactNode } from 'react'
import { Sidebar } from './Sidebar'

interface LayoutProps {
  children: ReactNode
}

export function Layout({ children }: LayoutProps) {
  return (
    <div className="h-screen flex">
      <Sidebar />
      <main className="flex-1 h-full overflow-hidden">
        {children}
      </main>
    </div>
  )
}
