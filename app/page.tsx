'use client'
import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { supabase, Book } from '@/lib/supabase'
import { GoogleBook } from '@/lib/search'
// Book type still used for wantedBooks
import { Nav, BottomNav, BookCover, useToast, Toast, ScanErrorSheet, SkeletonList, TermsFooter } from '@/components/ui'
import { scanBarcode } from '@/lib/scan'

export default function HomePage() {
  const router = useRouter()
  const [recentListings, setRecentListings] = useState<any[]>([])
  const [wantedBooks, setWantedBooks] = useState<Book[]>([])
  const [query, setQuery] = useState('')
  const [liveResults, setLiveResults] = useState<any[]>([])
  const [liveSearching, setLiveSearching] = useState(false)
  const [googleLiveResults, setGoogleLiveResults] = useState<GoogleBook[]>([])
  const [scanning, setScanning] = useState(false)
  const [scanError, setScanError] = useState(false)
  const [loading, setLoading] = useState(true)
  const [googleLoading, setGoogleLoading] = useState(false)
  const [matchQuality, setMatchQuality] = useState<'exact' | 'partial' | 'none'>('none')
  const scanInputRef = useRef<HTMLInputElement>(null)
  const { msg, show } = useToast()

  useEffect(() => { loadData() }, [])

  // Live search — 3+ chars → DB ก่อน → ถ้าเจอน้อย (< 3) auto-fallback ไป Google
  // ทุก search ที่ trigger Google = auto-cache เข้า DB → user ช่วยโต catalog
  // Debounce 350ms กัน burst quota จากการพิมพ์เร็ว
  useEffect(() => {
    const trimmed = query.trim()
    if (!trimmed) { setLiveResults([]); setGoogleLiveResults([]); setGoogleLoading(false); return }

    // ถ้า user paste ISBN-13 ที่ valid → auto-redirect ไปหน้า book
    const digits = query.replace(/[^0-9]/g, '')
    if (/^(978|979)\d{10}$/.test(digits)) {
      router.push(`/book/${digits}`)
      return
    }

    // Min 3 chars ก่อน trigger ใดๆ
    if (trimmed.length < 3) {
      setLiveResults([])
      setGoogleLiveResults([])
      return
    }

    let cancelled = false
    const t = setTimeout(async () => {
      const q = trimmed
      setLiveSearching(true)
      setGoogleLoading(false)
      const FALLBACK_THRESHOLD = 3

      try {
        // Step 1: ดึง DB ก่อน (ฟรี ไว)
        const r1 = await fetch(`/api/search?q=${encodeURIComponent(q)}&mode=db`)
        const { results: dbResults, matchQuality: mq1 } = await r1.json()
        if (cancelled) return

        // ถ้า DB เจอเยอะแล้ว (>= 3) → จบ ไม่ต้อง call Google
        if ((dbResults || []).length >= FALLBACK_THRESHOLD) {
          const withListings = (dbResults || []).filter((b: any) => (b.active_listings_count || 0) > 0).slice(0, 3)
          const noListings = (dbResults || []).filter((b: any) => (b.active_listings_count || 0) === 0).slice(0, 5 - withListings.length)
          setLiveResults(withListings)
          setGoogleLiveResults(noListings)
          setMatchQuality(mq1 || 'none')
          setLiveSearching(false)
          return
        }

        // Step 2: DB เจอน้อย → fallback ไปดึง Google + auto-cache
        setGoogleLoading(true)
        const r2 = await fetch(`/api/search?q=${encodeURIComponent(q)}&mode=all`)
        const { results: allResults, matchQuality: mq2 } = await r2.json()
        if (cancelled) return
        const withListings = (allResults || []).filter((b: any) => (b.active_listings_count || 0) > 0).slice(0, 3)
        const noListings = (allResults || []).filter((b: any) => (b.active_listings_count || 0) === 0).slice(0, 5 - withListings.length)
        setLiveResults(withListings)
        setGoogleLiveResults(noListings)
        setMatchQuality(mq2 || 'none')
      } catch {
        if (!cancelled) { setLiveResults([]); setGoogleLiveResults([]); setMatchQuality('none') }
      } finally {
        if (!cancelled) {
          setLiveSearching(false)
          setGoogleLoading(false)
        }
      }
    }, 350)
    return () => { cancelled = true; clearTimeout(t) }
  }, [query])

  const loadData = async () => {
    const [recentRes, { data: wanted }] = await Promise.all([
      fetch('/api/listings/recent?limit=10'),
      supabase.from('books').select('*').gt('wanted_count', 0).order('wanted_count', { ascending: false }).order('created_at', { ascending: false }).limit(3),
    ])
    const { listings } = await recentRes.json()
    setRecentListings(listings || [])
    setWantedBooks(wanted || [])
    setLoading(false)
  }

  const isISBN = (q: string) => /^[\d-]{9,17}$/.test(q.replace(/\s/g, ''))

  const doSearch = () => {
    const q = query.trim()
    if (!q) return
    if (isISBN(q)) {
      router.push(`/book/${encodeURIComponent(q)}`)
    } else {
      router.push(`/search?q=${encodeURIComponent(q)}`)
    }
  }

  const scanFromPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.files?.[0]
    if (!raw) return
    e.target.value = ''
    setScanning(true)
    try {
      const result = await scanBarcode(raw)
      if (result.isbn) {
        router.push(`/book/${result.isbn}`)
      } else if (result.raw) {
        setQuery(result.raw)
        show('อ่านบาร์โค้ดไม่ชัด ลองถ่ายใหม่ให้เห็นบาร์โค้ดชัดขึ้น')
      } else {
        setScanError(true)
      }
    } finally {
      setScanning(false)
    }
  }

  return (
    <>
      <Nav />
      <Toast msg={msg} />
      <div className="page">
        <div className="hero">
          <h1 className="hero-title">ตลาดหนังสือออนไลน์</h1>
          <p className="hero-sub">หนังสือทุกเล่ม — มีคนที่ใช่รออยู่<br />เจอหนังสือที่ตามหา เจอลูกค้าที่รอซื้อ</p>

          {/* Search input */}
          <div style={{ maxWidth: 440, margin: '0 auto 10px', position: 'relative' }}>
            <div style={{ position: 'relative' }}>
              <input
                className="search-input"
                value={query}
                onChange={e => { setQuery(e.target.value); setLiveResults([]) }}
                placeholder="ค้นหาชื่อหนังสือ หรือ ISBN"
                onKeyDown={e => e.key === 'Enter' && doSearch()}
                style={{ width: '100%', paddingRight: query ? 44 : 16 }}
              />
              {liveSearching ? (
                <button
                  type="button"
                  aria-label="ยกเลิกค้นหา"
                  onClick={() => { setQuery(''); setLiveResults([]); setGoogleLiveResults([]); setLiveSearching(false); setGoogleLoading(false) }}
                  style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', padding: '4px 6px' }}
                >
                  <span className="spin" style={{ width: 14, height: 14, borderColor: 'rgba(37,99,235,.2)', borderTopColor: 'var(--primary)' }} />
                  <span style={{ fontSize: 13, color: 'var(--ink3)', fontFamily: 'Kanit' }}>ยกเลิก</span>
                </button>
              ) : query ? (
                <button
                  type="button"
                  aria-label="ล้างคำค้น"
                  onClick={() => {
                    setQuery('')
                    setLiveResults([])
                    setGoogleLiveResults([])
                  }}
                  style={{
                    position: 'absolute',
                    right: 8,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    width: 26,
                    height: 26,
                    borderRadius: '50%',
                    background: '#E5E7EB',
                    border: 'none',
                    color: '#475569',
                    fontSize: 14,
                    fontWeight: 700,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    lineHeight: 1,
                    padding: 0,
                  }}
                >
                  ✕
                </button>
              ) : null}
            </div>

            {/* Live results dropdown */}
            {query.trim() && !liveSearching && (liveResults.length > 0 || googleLiveResults.length > 0) && (
              <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'white', borderRadius: 14, boxShadow: '0 8px 28px rgba(0,0,0,.18)', zIndex: 50, overflow: 'hidden', marginTop: 6 }}>
                {/* รวมเป็น list เดียว — with listings ก่อน, no listings ตาม (แต่ไม่มี section header) */}
                {[...liveResults, ...googleLiveResults].map((b: any) => {
                  const hasListing = (b.active_listings_count || 0) > 0
                  return (
                    <button key={b.isbn} onClick={() => { router.push(`/book/${b.isbn}`); setQuery(''); setLiveResults([]); setGoogleLiveResults([]) }}
                      style={{ display: 'flex', gap: 12, alignItems: 'center', background: 'white', border: 'none', borderBottom: '1px solid var(--border-light)', padding: '12px 14px', cursor: 'pointer', fontFamily: 'Kanit', textAlign: 'left', width: '100%' }}>
                      <BookCover isbn={b.isbn} title={b.title} size={44} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 15, fontWeight: 600, color: '#121212', lineHeight: 1.35, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.title}</div>
                        {b.author && <div style={{ fontSize: 13, fontWeight: 500, color: '#555555', lineHeight: 1.5, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.author}</div>}
                        {hasListing && b.min_price && (
                          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--green)', marginTop: 2 }}>฿{b.min_price} · {b.active_listings_count} คนขาย</div>
                        )}
                      </div>
                      <span style={{ color: hasListing ? 'var(--green)' : 'var(--ink3)', fontSize: 14, fontWeight: 600, flexShrink: 0 }}>›</span>
                    </button>
                  )
                })}
                <button onClick={doSearch} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, width: '100%', padding: '14px 16px', background: 'var(--primary)', border: 'none', fontFamily: 'Kanit', fontSize: 15, color: 'white', fontWeight: 600, cursor: 'pointer', textAlign: 'left', minHeight: 48 }}>
                  <span>🔍 ดูผลทั้งหมดสำหรับ "{query}"</span>
                  <span style={{ fontSize: 18, fontWeight: 700 }}>→</span>
                </button>
              </div>
            )}

            {/* Empty state — query >= 3 chars แล้วยังไม่เจออะไร (auto-fetched DB+Google แล้ว) */}
            {query.trim().length >= 3 && !liveSearching && !googleLoading && liveResults.length === 0 && googleLiveResults.length === 0 && (
              <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'white', borderRadius: 14, boxShadow: '0 8px 28px rgba(0,0,0,.18)', zIndex: 50, overflow: 'hidden', marginTop: 6, padding: '24px 16px', textAlign: 'center' }}>
                <div style={{ fontSize: 36, marginBottom: 10 }}>🔍</div>
                <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)', marginBottom: 6 }}>
                  ไม่พบหนังสือ "{query}"
                </div>
                <div style={{ fontSize: 13, color: 'var(--ink3)', lineHeight: 1.6 }}>
                  ลองพิมพ์ชื่อให้ครบ ใช้ ISBN<br />หรือสแกน barcode
                </div>
              </div>
            )}

            {/* Loading state — Google ยังหาอยู่ และยังไม่มีผลใดๆ */}
            {query.trim() && !liveSearching && googleLoading && liveResults.length === 0 && googleLiveResults.length === 0 && (
              <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'white', borderRadius: 14, boxShadow: '0 8px 28px rgba(0,0,0,.18)', zIndex: 50, overflow: 'hidden', marginTop: 6, padding: '20px 16px', textAlign: 'center' }}>
                <span className="spin" style={{ width: 20, height: 20 }} />
                <div style={{ fontSize: 13, color: 'var(--ink3)', marginTop: 10, lineHeight: 1.6 }}>
                  กำลังค้นในฐานข้อมูลเพิ่มเติม...
                </div>
                <button
                  onClick={() => { setQuery(''); setGoogleLoading(false); setLiveResults([]); setGoogleLiveResults([]) }}
                  style={{ marginTop: 12, background: 'none', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 16px', fontFamily: 'Kanit', fontSize: 13, color: 'var(--ink3)', cursor: 'pointer' }}
                >
                  ยกเลิก
                </button>
              </div>
            )}
          </div>

          {/* Scan button — secondary action บน home (search เป็น primary) */}
          <label style={{ background: 'transparent', border: 'none', color: 'rgba(255,255,255,.85)', fontFamily: 'Kanit', fontWeight: 500, fontSize: 13, cursor: scanning ? 'default' : 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, margin: '0 auto', minHeight: 36, textDecoration: 'underline', textUnderlineOffset: 4 }}>
            <input ref={scanInputRef} type="file" accept="image/*" capture="environment" onChange={scanFromPhoto} style={{ display: 'none' }} disabled={scanning} />
            {scanning ? <><span className="spin" style={{ width: 14, height: 14, borderColor: 'rgba(255,255,255,.3)', borderTopColor: 'white' }} /> กำลังอ่าน...</> : 'หรือ 📷 สแกน barcode แทนการพิมพ์'}
          </label>

          {scanError && (
            <ScanErrorSheet
              onRetry={() => { setScanError(false); scanInputRef.current?.click() }}
              onClose={() => setScanError(false)}
            />
          )}
        </div>

        <div className="stats-bar">
          <div className="stat">
            <div className="stat-n" style={{ fontSize: 24 }}>📦</div>
            <div className="stat-l">ลงขายง่าย</div>
          </div>
          <div className="stat">
            <div className="stat-n" style={{ fontSize: 24 }}>✅</div>
            <div className="stat-l">ซื้อสบายใจ</div>
          </div>
          <div className="stat">
            <div className="stat-n" style={{ fontSize: 24 }}>🔔</div>
            <div className="stat-l">แจ้งเตือนเมื่อเจอหนังสือที่ต้องการ</div>
          </div>
        </div>

        <div className="section">
          <div className="section-hd" style={{ marginBottom: 16, alignItems: 'flex-end' }}>
            <div>
              <div style={{ fontSize: 22, fontWeight: 700, color: '#121212', lineHeight: 1.3, letterSpacing: '-0.02em' }}>
                ✨ ลงใหม่ล่าสุด
              </div>
              <div style={{ fontSize: 13, color: 'var(--ink3)', marginTop: 4, lineHeight: 1.5 }}>
                หนังสือที่พึ่งลงขายในระบบ
              </div>
            </div>
          </div>
          {loading && <SkeletonList count={5} />}
          {!loading && recentListings.length === 0 && (
            <div className="empty">
              <div className="empty-icon">📚</div>
              <div style={{ marginBottom: 16 }}>ยังไม่มีหนังสือในระบบ</div>
              <Link href="/sell"><button className="btn" style={{ maxWidth: 200, margin: '0 auto', display: 'block' }}>ลงขายเป็นคนแรก</button></Link>
            </div>
          )}
          {recentListings.map((l: any) => (
            <Link key={l.id} href={`/book/${l.books?.isbn}`} style={{ textDecoration: 'none', color: 'inherit' }}>
              <div className="card">
                <div className="book-card">
                  <BookCover coverUrl={l.photos?.[0]} isbn={!l.photos?.[0] ? l.books?.isbn : undefined} title={l.books?.title} size={60} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="book-title" style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{l.books?.title}</div>
                    {l.books?.author && <div className="book-author">{l.books.author}</div>}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8, flexWrap: 'wrap' }}>
                      <span className="price">฿{l.price}</span>
                      {l.price_includes_shipping && <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--green)' }}>ส่งฟรี</span>}
                    </div>
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>

        {wantedBooks.length > 0 && (
          <div className="section" style={{ marginTop: 12 }}>
            <div className="section-hd" style={{ marginBottom: 16, alignItems: 'flex-end' }}>
              <div>
                <div style={{ fontSize: 22, fontWeight: 700, color: '#121212', lineHeight: 1.3, letterSpacing: '-0.02em' }}>
                  🔔 มีคนรอซื้ออยู่
                </div>
                <div style={{ fontSize: 13, color: 'var(--ink3)', marginTop: 4, lineHeight: 1.5 }}>
                  หนังสือที่หลายคนกำลังตามหา — ลงขายโอกาสขายไว
                </div>
              </div>
              <Link href="/market" style={{ fontSize: 14, fontWeight: 600, color: 'var(--primary)', textDecoration: 'none', whiteSpace: 'nowrap', minHeight: 44, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                ดูทั้งหมด →
              </Link>
            </div>
            {wantedBooks.map(b => (
              <Link key={b.id} href={`/book/${b.isbn}`} style={{ textDecoration: 'none', color: 'inherit' }}>
                <div className="card">
                  <div className="book-card">
                    <BookCover isbn={b.isbn} title={b.title} size={60} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="book-title">{b.title}</div>
                      {b.author && <div className="book-author">{b.author}</div>}
                      <div style={{ marginTop: 8 }}>
                        <span className="badge badge-blue">🔔 {b.wanted_count} คนตามหา</span>
                      </div>
                    </div>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
        <div style={{ height: 12 }} />
        <TermsFooter />
      </div>
      <BottomNav />
    </>
  )
}
