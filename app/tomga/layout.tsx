'use client'
import { useState, useEffect, ReactNode } from 'react'
import { useAuth } from '@/lib/auth'

export default function AdminLayout({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()
  const [allowed, setAllowed] = useState<boolean | null>(null)

  useEffect(() => {
    // noindex — กัน search engine / AI crawlers
    const meta = document.createElement('meta')
    meta.name = 'robots'
    meta.content = 'noindex, nofollow, noarchive'
    document.head.appendChild(meta)
    return () => { document.head.removeChild(meta) }
  }, [])

  useEffect(() => {
    if (loading || !user) return
    fetch('/api/tomga/check')
      .then(r => r.json())
      .then(d => setAllowed(d.isAdmin))
      .catch(() => setAllowed(false))
  }, [user, loading])

  if (loading || allowed === null) {
    return <div style={{ padding: 60, textAlign: 'center', fontFamily: 'Kanit', color: '#94A3B8' }}>Loading...</div>
  }

  if (!user || !allowed) {
    return (
      <div style={{ padding: 60, textAlign: 'center', fontFamily: 'Kanit' }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>🔒</div>
        <div style={{ fontSize: 18, fontWeight: 700, color: '#121212', marginBottom: 8 }}>404</div>
        <div style={{ fontSize: 14, color: '#64748B' }}>This page could not be found.</div>
      </div>
    )
  }

  // Desktop-friendly layout — ไม่จำกัด max-width
  return (
    <div style={{ maxWidth: 960, margin: '0 auto', minHeight: '100vh' }}>
      {children}
    </div>
  )
}
