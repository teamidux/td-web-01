'use client'
import { useState, useEffect, Suspense } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { supabase, Book } from '@/lib/supabase'
import { Nav, BottomNav, BookCover } from '@/components/ui'

export default function SearchPageWrapper() {
  return (
    <Suspense fallback={
      <><Nav /><div style={{ textAlign: 'center', padding: 60 }}><span className="spin" style={{ width: 28, height: 28 }} /></div></>
    }>
      <SearchPage />
    </Suspense>
  )
}

function SearchPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [query, setQuery] = useState(searchParams.get('q') || '')
  const [results, setResults] = useState<Book[]>([])
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)

  // โหลดผลจาก URL param เมื่อเข้าหน้าครั้งแรก
  useEffect(() => {
    const q = searchParams.get('q') || ''
    setQuery(q)
    if (q) { doSearch(q); setSearched(true) }
  }, [searchParams])

  // debounced live search — ยิง query หลังพิมพ์หยุด 400ms
  useEffect(() => {
    if (!query.trim()) { setResults([]); setSearched(false); return }
    const t = setTimeout(() => { doSearch(query); setSearched(true) }, 400)
    return () => clearTimeout(t)
  }, [query])

  const doSearch = async (q: string) => {
    if (!q.trim()) return
    setLoading(true)
    const res = await fetch(`/api/search?q=${encodeURIComponent(q.trim())}`)
    const { results } = await res.json()
    setResults(results || [])
    setLoading(false)
  }

  const handleSubmit = () => {
    if (!query.trim()) return
    router.push(`/search?q=${encodeURIComponent(query.trim())}`)
  }

  return (
    <>
      <Nav />
      <div className="page">
        <div style={{ padding: '16px 0 8px' }}>
          <div className="search-row" style={{ maxWidth: 440, margin: '0 auto 0' }}>
            <input
              className="search-input"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="ค้นหาชื่อหนังสือ..."
              onKeyDown={e => e.key === 'Enter' && handleSubmit()}
              autoFocus
            />
            <button className="btn-search" onClick={handleSubmit}>ค้นหา</button>
          </div>
        </div>

        <div className="section">
          {loading && (
            <div style={{ textAlign: 'center', padding: 32 }}>
              <span className="spin" style={{ width: 24, height: 24 }} />
            </div>
          )}

          {!loading && results.length === 0 && searched && query.trim() && (
            <div className="empty">
              <div className="empty-icon">🔍</div>
              <div>ไม่พบหนังสือที่ตรงกับ "{query}"</div>
            </div>
          )}

          {results.map(b => (
            <Link key={b.id} href={`/book/${b.isbn}`} style={{ textDecoration: 'none', color: 'inherit' }}>
              <div className="card">
                <div className="book-card">
                  <BookCover coverUrl={b.cover_url} title={b.title} size={52} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="book-title" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.title}</div>
                    <div className="book-author">{b.author}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      {(b as any).min_price ? <span className="price">฿{(b as any).min_price}</span> : <span style={{ fontSize: 12, color: 'var(--ink3)' }}>ยังไม่มีคนขาย</span>}
                      {(b as any).count > 0 && <span style={{ fontSize: 11, color: 'var(--ink3)' }}>{(b as any).count} คนขาย</span>}
                      {b.wanted_count > 0 && <span className="badge badge-blue">🔔 {b.wanted_count} คนรอ</span>}
                    </div>
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>
        <div style={{ height: 12 }} />
      </div>
      <BottomNav />
    </>
  )
}
