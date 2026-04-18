'use client'
import { useState, useEffect, Suspense, useRef } from 'react'
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
  const [expanding, setExpanding] = useState(false)
  const [matchQuality, setMatchQuality] = useState<'exact' | 'partial' | 'none'>('none')
  const [searched, setSearched] = useState(false)
  // Filter + sort
  const [onlyWithListings, setOnlyWithListings] = useState(false)
  const [sortBy, setSortBy] = useState<'relevance' | 'price_low' | 'price_high' | 'popular'>('relevance')
  // เก็บ AbortController ของ request ที่กำลังวิ่ง — ใช้ cancel เมื่อ query เปลี่ยน
  const abortRef = useRef<AbortController | null>(null)

  // โหลดผลจาก URL param เมื่อเข้าหน้าครั้งแรก
  useEffect(() => {
    const q = searchParams.get('q') || ''
    setQuery(q)
    if (q) { doSearch(q); setSearched(true) }
  }, [searchParams])

  // debounced live search — DB → ถ้าน้อย auto-fallback Google
  useEffect(() => {
    const trimmed = query.trim()
    // query สั้น/ว่าง → abort fetch ที่ค้าง + reset loading + เคลียร์ผล
    if (trimmed.length < 3) {
      abortRef.current?.abort()
      abortRef.current = null
      setLoading(false)
      setExpanding(false)
      setResults([])
      setGoogleResults([])
      if (!trimmed) setSearched(false)
      return
    }
    const t = setTimeout(() => { doSearch(trimmed); setSearched(true) }, 500)
    return () => clearTimeout(t)
  }, [query])

  const doSearch = async (q: string, forceMode?: 'all') => {
    if (!q.trim()) return
    // Cancel request ก่อนหน้า — กัน race + ประหยัด Google quota
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl

    setLoading(true)
    try {
      // ─────────────────────────────────────────────────────────────
      // forceMode='all' = ผู้ใช้กดปุ่ม "ค้นหา" → deep search 5 pages
      // ─────────────────────────────────────────────────────────────
      // ไป Google ตรง ๆ ทันที ไม่ผ่าน DB ก่อน (เพราะตั้งใจจะ deep search)
      // หลังได้ผล merge กับ DB ใน server (route.ts ทำให้แล้ว)
      let allResults: any[]
      let mq: 'exact' | 'partial' | 'none'

      if (forceMode === 'all') {
        setExpanding(true)
        const r = await fetch(`/api/search?q=${encodeURIComponent(q.trim())}&mode=all&pages=5`, { signal: ctrl.signal })
        const data = await r.json()
        if (ctrl.signal.aborted) return
        allResults = data.results || []
        mq = data.matchQuality || 'none'
        setExpanding(false)
      } else {
        // Live search — DB ก่อน (ฟรี ไว)
        const r1 = await fetch(`/api/search?q=${encodeURIComponent(q.trim())}&mode=db`, { signal: ctrl.signal })
        const data1 = await r1.json()
        if (ctrl.signal.aborted) return
        allResults = data1.results || []
        mq = data1.matchQuality || 'none'

        // Fallback Google — ถ้า DB เจอ ≤ 3 เล่ม ดึง Google เพิ่มเพื่อให้เห็น edition อื่นๆ
        // (เคส: มีแต่ฉบับการ์ตูนใน DB แต่ user อยากได้ฉบับปกติด้วย)
        if (allResults.length <= 3) {
          setExpanding(true)
          const r2 = await fetch(`/api/search?q=${encodeURIComponent(q.trim())}&mode=all&pages=1`, { signal: ctrl.signal })
          const data2 = await r2.json()
          if (ctrl.signal.aborted) return
          allResults = data2.results || allResults
          mq = data2.matchQuality || mq
          setExpanding(false)
        }
      }

      const withListings = allResults.filter((b: any) => (b.active_listings_count || 0) > 0)
      const noListings = allResults.filter((b: any) => (b.active_listings_count || 0) === 0)
      setResults(withListings)
      setGoogleResults(noListings)
      setMatchQuality(mq)
    } catch (err: any) {
      // AbortError = user เปลี่ยน query → เงียบไว้ ไม่ใช่ error
      if (err?.name === 'AbortError') return
      setResults([])
      setGoogleResults([])
      setMatchQuality('none')
    } finally {
      // เช็คว่ายัง active request นี้อยู่ไหม — ถ้าโดน abort แล้ว state จะถูก request ใหม่จัดการ
      if (abortRef.current === ctrl) {
        setLoading(false)
        setExpanding(false)
      }
    }
  }

  const clearQuery = () => {
    abortRef.current?.abort()
    abortRef.current = null
    setQuery('')
    setResults([])
    setGoogleResults([])
    setLoading(false)
    setExpanding(false)
    setSearched(false)
  }

  const handleSubmit = () => {
    if (!query.trim()) return
    // กด "ค้นหา" → force mode=all เสมอ (ดึงเต็มที่)
    doSearch(query, 'all')
    setSearched(true)
  }

  return (
    <>
      <Nav />
      <div className="page">
        <div style={{ padding: '16px 0 8px' }}>
          <div className="search-row" style={{ maxWidth: 440, margin: '0 auto 0' }}>
            <div style={{ position: 'relative', flex: 1 }}>
              <input
                className="search-input"
                style={{ width: '100%', paddingRight: query ? 36 : undefined }}
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="ค้นหาชื่อหนังสือ..."
                onKeyDown={e => e.key === 'Enter' && handleSubmit()}
                autoFocus
              />
              {query && (
                <button
                  type="button"
                  onClick={clearQuery}
                  aria-label="ล้างคำค้นหา"
                  style={{
                    position: 'absolute',
                    right: 8,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    width: 24,
                    height: 24,
                    borderRadius: '50%',
                    border: 'none',
                    background: 'var(--ink3)',
                    color: '#fff',
                    fontSize: 14,
                    lineHeight: 1,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: 0,
                  }}
                >
                  ✕
                </button>
              )}
            </div>
            <button className="btn-search" onClick={handleSubmit}>ค้นหา</button>
          </div>
        </div>

        <div className="section">
          {loading && <SkeletonList count={4} />}

          {!loading && results.length === 0 && googleResults.length === 0 && searched && query.trim() && (
            <div className="empty">
              <div className="empty-icon">🔍</div>
              <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink)', marginBottom: 8 }}>
                ไม่พบหนังสือ "{query}"
              </div>
              <div style={{ fontSize: 13, color: 'var(--ink3)', lineHeight: 1.6, marginBottom: 16, maxWidth: 320, margin: '0 auto 16px' }}>
                ลองพิมพ์ชื่อให้ครบ ใช้ ISBN หรือสแกน barcode
              </div>
            </div>
          )}

          {!loading && (results.length + googleResults.length) > 0 && (
            <>
              <div style={{ padding: '4px 0 10px', fontSize: 13, fontWeight: 700, color: 'var(--ink2)', letterSpacing: '0.02em' }}>
                พบ {results.length + googleResults.length} เล่ม
                {expanding && <span style={{ marginLeft: 8, color: 'var(--ink3)', fontWeight: 500 }}>· กำลังค้นเพิ่ม...</span>}
              </div>

              {/* Filter + sort bar */}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14, paddingBottom: 12, borderBottom: '1px solid var(--border)' }}>
                <button
                  onClick={() => setOnlyWithListings(v => !v)}
                  style={{
                    background: onlyWithListings ? 'var(--primary)' : 'white',
                    color: onlyWithListings ? 'white' : 'var(--ink2)',
                    border: `1px solid ${onlyWithListings ? 'var(--primary)' : 'var(--border)'}`,
                    borderRadius: 20,
                    padding: '7px 14px',
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: 'pointer',
                    fontFamily: 'Kanit',
                  }}
                >
                  {onlyWithListings ? '✓ ' : ''}เฉพาะมีคนขาย
                </button>

                <select
                  value={sortBy}
                  onChange={e => setSortBy(e.target.value as any)}
                  style={{
                    background: 'white',
                    border: '1px solid var(--border)',
                    borderRadius: 20,
                    padding: '7px 12px',
                    fontSize: 13,
                    fontWeight: 600,
                    fontFamily: 'Kanit',
                    color: 'var(--ink2)',
                    cursor: 'pointer',
                    outline: 'none',
                  }}
                >
                  <option value="relevance">เกี่ยวข้องสุด</option>
                  <option value="price_low">ราคาต่ำ → สูง</option>
                  <option value="price_high">ราคาสูง → ต่ำ</option>
                  <option value="popular">ยอดนิยม</option>
                </select>
              </div>
            </>
          )}

          {/* รวม with listings + no listings เป็น list เดียว + filter + sort */}
          {(() => {
            let combined = [...results, ...(googleResults as any[])]
            if (onlyWithListings) {
              combined = combined.filter((b: any) => (b.active_listings_count || 0) > 0)
            }
            if (sortBy === 'price_low') {
              combined.sort((a: any, b: any) => {
                const ap = a.min_price ?? Infinity
                const bp = b.min_price ?? Infinity
                return ap - bp
              })
            } else if (sortBy === 'price_high') {
              combined.sort((a: any, b: any) => {
                const ap = a.min_price ?? -1
                const bp = b.min_price ?? -1
                return bp - ap
              })
            } else if (sortBy === 'popular') {
              combined.sort((a: any, b: any) => (b.wanted_count || 0) - (a.wanted_count || 0))
            }
            // relevance = คง order เดิม (API ส่งตามความเกี่ยวข้อง)
            return combined
          })().map((b: any) => {
            const hasListing = (b.active_listings_count || 0) > 0
            const hasSoldHistory = !hasListing && b.last_sold_price
            return (
              <Link key={b.isbn} href={`/book/${b.isbn}`} style={{ textDecoration: 'none', color: 'inherit' }}>
                <div className="card" style={hasSoldHistory ? { opacity: 0.75 } : undefined}>
                  <div className="book-card">
                    <div style={{ position: 'relative' }}>
                      <BookCover isbn={b.isbn} title={b.title} size={60} />
                      {hasSoldHistory && (
                        <span style={{ position: 'absolute', top: 2, left: 2, background: 'rgba(15,23,42,.85)', color: 'white', fontSize: 9, fontWeight: 800, padding: '2px 5px', borderRadius: 3, letterSpacing: '0.05em' }}>
                          SOLD
                        </span>
                      )}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="book-title" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.title}</div>
                      <div className="book-author">{b.author}</div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        {hasListing && b.min_price ? (
                          <>
                            <span className="price">฿{b.min_price}</span>
                            <span style={{ fontSize: 13, color: 'var(--ink3)' }}>{b.active_listings_count} คนขาย</span>
                          </>
                        ) : hasSoldHistory ? (
                          <span style={{ fontSize: 13, color: 'var(--ink3)' }}>
                            ขายล่าสุด <b style={{ color: 'var(--ink2)' }}>฿{b.last_sold_price}</b> · กดเพื่อตามหา
                          </span>
                        ) : (
                          <span style={{ fontSize: 13, color: 'var(--ink3)' }}>ยังไม่มีคนขาย</span>
                        )}
                        {b.wanted_count > 0 && <span className="badge badge-blue">🔔 {b.wanted_count} คนตามหา</span>}
                      </div>
                    </div>
                  </div>
                </div>
              </Link>
            )
          })}
        </div>
        <div style={{ height: 12 }} />
      </div>
      <BottomNav />
    </>
  )
}
