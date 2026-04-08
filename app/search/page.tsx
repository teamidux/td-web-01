'use client'
import { useState, useEffect, Suspense } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Book } from '@/lib/supabase'
import { GoogleBook } from '@/lib/search'
import { Nav, BottomNav, BookCover, SkeletonList } from '@/components/ui'

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
  const [googleResults, setGoogleResults] = useState<GoogleBook[]>([])
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)

  // โหลดผลจาก URL param เมื่อเข้าหน้าครั้งแรก
  useEffect(() => {
    const q = searchParams.get('q') || ''
    setQuery(q)
    if (q) { doSearch(q); setSearched(true) }
  }, [searchParams])

  // debounced live search — ยิง query หลังพิมพ์หยุด 220ms
  useEffect(() => {
    if (!query.trim()) { setResults([]); setSearched(false); return }
    const t = setTimeout(() => { doSearch(query); setSearched(true) }, 220)
    return () => clearTimeout(t)
  }, [query])

  const doSearch = async (q: string) => {
    if (!q.trim()) return
    const trimmed = q.trim()
    setLoading(true)
    setGoogleResults([])

    // /api/search ตอนนี้ทำ DB + Google + auto-cache รวมในตัวเดียว
    const r = await fetch(`/api/search?q=${encodeURIComponent(trimmed)}`)
    const { results: combined } = await r.json()
    const inDb = (combined || []).filter((b: any) => b.source !== 'google')
    const fromGoogle = (combined || []).filter((b: any) => b.source === 'google')
    setResults(inDb)
    setGoogleResults(fromGoogle)
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
          {loading && <SkeletonList count={4} />}

          {!loading && results.length === 0 && googleResults.length === 0 && searched && query.trim() && (
            <div className="empty">
              <div className="empty-icon">🔍</div>
              <div>ไม่พบหนังสือที่ตรงกับ "{query}"</div>
            </div>
          )}

          {!loading && results.length > 0 && (
            <div style={{ padding: '4px 0 12px', fontSize: 13, fontWeight: 700, color: 'var(--green)', letterSpacing: '0.02em' }}>
              ✓ มีในระบบ มีคนลงขาย ({results.length})
            </div>
          )}

          {results.map(b => (
            <Link key={b.id} href={`/book/${b.isbn}`} style={{ textDecoration: 'none', color: 'inherit' }}>
              <div className="card">
                <div className="book-card">
                  <BookCover isbn={b.isbn} title={b.title} size={60} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="book-title" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.title}</div>
                    <div className="book-author">{b.author}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      {(b as any).min_price ? <span className="price">฿{(b as any).min_price}</span> : <span style={{ fontSize: 12, color: 'var(--ink3)' }}>ยังไม่มีคนขาย</span>}
                      {(b as any).count > 0 && <span style={{ fontSize: 11, color: 'var(--ink3)' }}>{(b as any).count} คนขาย</span>}
                      {b.wanted_count > 0 && <span className="badge badge-blue">🔔 {b.wanted_count} คนรอซื้อ</span>}
                    </div>
                  </div>
                </div>
              </div>
            </Link>
          ))}

          {!loading && googleResults.length > 0 && (
            <>
              <div style={{ padding: '16px 0 12px', fontSize: 13, fontWeight: 700, color: 'var(--ink3)', letterSpacing: '0.02em' }}>
                📚 มีในฐานข้อมูล ยังไม่มีคนลงขาย ({googleResults.length})
              </div>
              {googleResults.map(b => (
                <Link key={b.isbn} href={`/book/${b.isbn}`} style={{ textDecoration: 'none', color: 'inherit' }}>
                  <div className="card" style={{ opacity: 0.85 }}>
                    <div className="book-card">
                      <BookCover isbn={b.isbn} title={b.title} size={60} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="book-title" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.title}</div>
                        <div className="book-author">{b.author}</div>
                        <span style={{ fontSize: 11, color: 'var(--ink3)' }}>ยังไม่มีคนขาย · กด Wantlist เพื่อรับแจ้งเตือน</span>
                      </div>
                    </div>
                  </div>
                </Link>
              ))}
            </>
          )}
        </div>
        <div style={{ height: 12 }} />
      </div>
      <BottomNav />
    </>
  )
}
