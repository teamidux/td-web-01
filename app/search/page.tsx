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

        // Fallback Google — hybrid: ดึงเพิ่มเมื่อ DB ≤ 3 เล่ม OR top result ไม่ใช่ exact match
        // - ≤ 3 เล่ม → อาจขาด edition (เช่น Atomic Habits มีแต่ฉบับการ์ตูน)
        // - ไม่ exact → DB มีหลายเล่มแต่ไม่มีเล่มที่ user หา → ลอง Google
        // - มี exact + ≥ 4 เล่ม → skip (ประหยัด quota)
        if (allResults.length <= 3 || mq !== 'exact') {
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

  // Combined + filtered + sorted results (logic เดิม)
  const combined = (() => {
    let c = [...results, ...(googleResults as any[])]
    if (onlyWithListings) c = c.filter((b: any) => (b.active_listings_count || 0) > 0)
    if (sortBy === 'price_low') {
      c.sort((a: any, b: any) => (a.min_price ?? Infinity) - (b.min_price ?? Infinity))
    } else if (sortBy === 'price_high') {
      c.sort((a: any, b: any) => (b.min_price ?? -1) - (a.min_price ?? -1))
    } else if (sortBy === 'popular') {
      c.sort((a: any, b: any) => (b.wanted_count || 0) - (a.wanted_count || 0))
    }
    return c
  })()

  return (
    <>
      <Nav />
      <div className="page" style={{ padding: 0, background: '#F8FAFC' }}>
        {/* ─── Search bar header (design style) ─── */}
        <div style={{ padding: '10px 14px', background: 'white', borderBottom: '1px solid #F1F5F9', display: 'flex', gap: 10, alignItems: 'center', maxWidth: 480, margin: '0 auto' }}>
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8, background: '#F1F5F9', borderRadius: 999, padding: '8px 14px' }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#64748B" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSubmit()}
              placeholder="ค้นหาชื่อหนังสือ..."
              autoFocus
              style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', fontFamily: 'Kanit', fontSize: 14, color: '#0F172A', minWidth: 0 }}
            />
            {query && (
              <button
                type="button" onClick={clearQuery} aria-label="ล้างคำค้นหา"
                style={{ width: 18, height: 18, borderRadius: 999, border: 'none', background: '#CBD5E1', color: 'white', display: 'grid', placeItems: 'center', fontSize: 11, fontWeight: 700, cursor: 'pointer', flexShrink: 0 }}
              >×</button>
            )}
          </div>
          <button
            onClick={handleSubmit}
            style={{ padding: '8px 14px', background: 'var(--primary)', color: 'white', border: 'none', borderRadius: 999, fontFamily: 'Kanit', fontSize: 13, fontWeight: 700, cursor: 'pointer', flexShrink: 0 }}
          >
            ค้นหา
          </button>
        </div>

        {/* ─── Filter chips row ─── */}
        {!loading && combined.length > 0 && (
          <div style={{ padding: '10px 14px', background: 'white', borderBottom: '1px solid #F1F5F9', display: 'flex', gap: 6, overflowX: 'auto', maxWidth: 480, margin: '0 auto' }}>
            {[
              { id: 'all' as const, label: 'ทั้งหมด', active: !onlyWithListings },
              { id: 'withSellers' as const, label: 'มีคนขาย', active: onlyWithListings },
            ].map(f => (
              <button
                key={f.id}
                onClick={() => setOnlyWithListings(f.id === 'withSellers')}
                style={{
                  padding: '6px 12px', borderRadius: 999, flexShrink: 0, cursor: 'pointer',
                  background: f.active ? '#0F172A' : '#F1F5F9',
                  color: f.active ? 'white' : '#475569',
                  border: 'none', fontFamily: 'Kanit', fontSize: 12.5, fontWeight: 600,
                }}
              >
                {f.label}
              </button>
            ))}
          </div>
        )}

        {/* ─── Results count + sort ─── */}
        {!loading && combined.length > 0 && (
          <div style={{ padding: '14px 16px 10px', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, maxWidth: 480, margin: '0 auto' }}>
            <div style={{ fontSize: 13, color: '#64748B', flex: 1, minWidth: 0 }}>
              พบ <span style={{ color: '#0F172A', fontWeight: 700 }}>{combined.length}</span> เล่ม
              {query && <> สำหรับ "<span style={{ color: '#0F172A', fontWeight: 600 }}>{query}</span>"</>}
              {expanding && <span style={{ marginLeft: 8, color: '#94A3B8' }}>· กำลังค้นเพิ่ม...</span>}
            </div>
            <select
              value={sortBy}
              onChange={e => setSortBy(e.target.value as any)}
              style={{ background: 'transparent', border: 'none', fontSize: 12, fontWeight: 500, color: '#64748B', fontFamily: 'Kanit', cursor: 'pointer', outline: 'none', flexShrink: 0 }}
            >
              <option value="relevance">เรียง: ตรงใจ</option>
              <option value="price_low">ราคาต่ำ → สูง</option>
              <option value="price_high">ราคาสูง → ต่ำ</option>
              <option value="popular">ยอดนิยม</option>
            </select>
          </div>
        )}

        {/* ─── Results list ─── */}
        <div style={{ padding: '0 16px 24px', display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 480, margin: '0 auto' }}>
          {loading && <SkeletonList count={4} />}

          {!loading && combined.length === 0 && searched && query.trim() && (
            <div style={{ background: 'white', borderRadius: 14, padding: '40px 20px', textAlign: 'center', border: '1px solid #EEF2F7' }}>
              <div style={{ fontSize: 42, marginBottom: 12 }}>🔍</div>
              <div style={{ fontSize: 16, fontWeight: 600, color: '#0F172A', marginBottom: 8 }}>
                ไม่พบหนังสือ "{query}"
              </div>
              <div style={{ fontSize: 13, color: '#94A3B8', lineHeight: 1.6 }}>
                ลองพิมพ์ชื่อให้ครบ ใช้ ISBN หรือสแกน barcode
              </div>
            </div>
          )}

          {!loading && combined.map((b: any) => {
            const hasListing = (b.active_listings_count || 0) > 0
            const isHot = (b.wanted_count || 0) >= 5 // มาแรง = คนตามหา ≥ 5
            return (
              <Link key={b.isbn} href={`/book/${b.isbn}`} style={{ textDecoration: 'none', color: 'inherit' }}>
                <div style={{ background: 'white', borderRadius: 14, padding: 12, display: 'flex', gap: 12, border: '1px solid #EEF2F7', position: 'relative' }}>
                  <div style={{ width: 58, aspectRatio: '3/4', borderRadius: 6, overflow: 'hidden', flexShrink: 0, boxShadow: '0 2px 6px rgba(15,23,42,0.08)', background: '#F8FAFC' }}>
                    <BookCover isbn={b.isbn} title={b.title} size={58} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                      <div style={{ flex: 1, fontSize: 13.5, fontWeight: 600, color: '#0F172A', lineHeight: 1.35, letterSpacing: '-0.005em' }}>
                        {b.title}
                      </div>
                      {isHot && (
                        <div style={{ padding: '2px 7px', borderRadius: 999, background: '#FEE2E2', fontSize: 10, fontWeight: 700, color: '#DC2626', flexShrink: 0 }}>
                          มาแรง
                        </div>
                      )}
                    </div>
                    {b.author && (
                      <div style={{ fontSize: 11.5, color: '#64748B', marginTop: 2 }}>
                        {b.author}
                      </div>
                    )}
                    <div style={{ fontSize: 10, color: '#CBD5E1', fontFamily: 'monospace', marginTop: 2, letterSpacing: 0.3 }}>
                      ISBN {b.isbn}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
                      {hasListing && b.min_price ? (
                        <>
                          <div style={{ fontSize: 16, fontWeight: 800, color: '#1D4ED8', letterSpacing: '-0.02em', lineHeight: 1 }}>
                            ฿{b.min_price}
                          </div>
                          <div style={{ fontSize: 11.5, color: '#64748B' }}>
                            · {b.active_listings_count} ราย
                          </div>
                        </>
                      ) : (
                        <div style={{ fontSize: 12.5, color: '#94A3B8', fontStyle: 'italic' }}>
                          ยังไม่มีคนขาย
                        </div>
                      )}
                      {(b.wanted_count || 0) > 0 && (
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 3, marginLeft: 'auto' }}>
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#B45309" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /></svg>
                          <span style={{ fontSize: 11, fontWeight: 600, color: '#B45309' }}>
                            {b.wanted_count} ตามหา
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </Link>
            )
          })}
        </div>
      </div>
      <BottomNav />
    </>
  )
}
