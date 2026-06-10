import { ReactNode } from 'react'
import { Sidebar } from './Sidebar'
import { LoginBanner } from './LoginBanner'

interface LayoutProps {
  children: ReactNode
}

export function Layout({ children }: LayoutProps) {
  return (
    <div className="h-screen flex">
      <Sidebar />
      <main className="flex-1 h-full overflow-hidden flex flex-col">
        <LoginBanner />
        <div className="flex-1 overflow-hidden">{children}</div>
      </main>
    </div>
  )
}
