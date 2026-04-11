'use client'
import { useState, useEffect, ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import Link from 'next/link'
import { useAuth } from '@/lib/auth'

function AdminHeader() {
  const pathname = usePathname()
  const isDashboard = pathname === '/tomga'
  return (
    <nav style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 0', borderBottom: '1px solid #E2E8F0', marginBottom: 8 }}>
      <Link href="/tomga" style={{ fontFamily: "'Kanit', sans-serif", fontSize: 20, fontWeight: 700, color: '#2563EB', textDecoration: 'none' }}>
        BookMatch <span style={{ fontSize: 14, color: '#94A3B8', fontWeight: 500 }}>Admin</span>
      </Link>
      {isDashboard ? (
        <Link href="/" style={{ fontSize: 15, color: '#64748B', textDecoration: 'none', fontFamily: 'Kanit' }}>← กลับหน้าเว็บ</Link>
      ) : (
        <Link href="/tomga" style={{ fontSize: 15, color: '#64748B', textDecoration: 'none', fontFamily: 'Kanit' }}>← Dashboard</Link>
      )}
    </nav>
  )
}

export default function AdminLayout({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()
  const [allowed, setAllowed] = useState<boolean | null>(null)

  // noindex — กัน search engine / AI crawlers
  useEffect(() => {
    const meta = document.createElement('meta')
    meta.name = 'robots'
    meta.content = 'noindex, nofollow, noarchive'
    document.head.appendChild(meta)
    return () => { try { document.head.removeChild(meta) } catch {} }
  }, [])

  // Override body max-width สำหรับ admin (ปกติ 480px สำหรับ mobile)
  useEffect(() => {
    document.body.style.maxWidth = '100%'
    return () => { document.body.style.maxWidth = '' }
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

  return (
    <div style={{ width: '100%', maxWidth: 1200, margin: '0 auto', minHeight: '100vh', padding: '0 24px', boxSizing: 'border-box' }}>
      <AdminHeader />
      {children}
    </div>
  )
}
