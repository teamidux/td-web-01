'use client'
import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { supabase, Book } from '@/lib/supabase'
import { searchVariants, buildOrFilter, fetchGoogleBooksByTitle, GoogleBook } from '@/lib/search'
// Book type still used for wantedBooks
import { Nav, BottomNav, BookCover, InAppBanner, useToast, Toast, ScanErrorSheet, SkeletonList } from '@/components/ui'
import { scanBarcode } from '@/lib/scan'

export default function HomePage() {
  const router = useRouter()
  const [recentListings, setRecentListings] = useState<any[]>([])
  const [wantedBooks, setWantedBooks] = useState<Book[]>([])
  const [stats, setStats] = useState({ books: 0, sellers: 0, wanted: 0 })
  const [query, setQuery] = useState('')
  const [liveResults, setLiveResults] = useState<any[]>([])
  const [liveSearching, setLiveSearching] = useState(false)
  const [googleLiveResults, setGoogleLiveResults] = useState<GoogleBook[]>([])
  const [scanning, setScanning] = useState(false)
  const [scanError, setScanError] = useState(false)
  const [loading, setLoading] = useState(true)
  const scanInputRef = useRef<HTMLInputElement>(null)
  const { msg, show } = useToast()

  useEffect(() => { loadData() }, [])

  // Live search — debounce 400ms, ใช้ fuzzy variants
  useEffect(() => {
    if (!query.trim()) { setLiveResults([]); setGoogleLiveResults([]); return }
    const t = setTimeout(async () => {
      const q = query.trim()
      if (/^(978|979)\d{10}$/.test(q.replace(/[^0-9]/g, ''))) return
      setLiveSearching(true)
      setGoogleLiveResults([])
      const orFilter = buildOrFilter(searchVariants(q))
      const { data } = await supabase
        .from('books')
        .select('id, isbn, title, author, cover_url')
        .or(orFilter)
        .limit(6)
      setLiveResults(data || [])
      setLiveSearching(false)
      // fallback Google Books ถ้า DB ไม่มีผลและ query >= 3 ตัว
      if ((!data || data.length === 0) && q.length >= 3) {
        const gBooks = await fetchGoogleBooksByTitle(q)
        setGoogleLiveResults(gBooks)
      }
    }, 400)
    return () => clearTimeout(t)
  }, [query])

  const loadData = async () => {
    const [recentRes, { data: wanted }, { count: sellerCount }, { count: bookCount }] = await Promise.all([
      fetch('/api/listings/recent?limit=10'),
      supabase.from('books').select('*').gt('wanted_count', 0).order('wanted_count', { ascending: false }).limit(3),
      supabase.from('users').select('*', { count: 'exact', head: true }),
      supabase.from('books').select('*', { count: 'exact', head: true }),
    ])
    const { listings } = await recentRes.json()
    setRecentListings(listings || [])
    setWantedBooks(wanted || [])
    setStats({ books: bookCount || 0, sellers: sellerCount || 0, wanted: wanted?.reduce((s, b) => s + (b.wanted_count || 0), 0) || 0 })
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
      console.log('[SCAN DEBUG]', result)
      if (result.isbn) {
        router.push(`/book/${result.isbn}`)
      } else if (result.raw) {
        setQuery(result.raw)
        show('อ่านบาร์โค้ดไม่ชัด ลองถ่ายใหม่ให้เห็นบาร์โค้ดชัดขึ้น')
        alert(`🔍 Debug (got value but invalid ISBN):\nraw=${result.raw}\nvariant=${result.variantHit}\n\n${result.debug.join('\n')}`)
      } else {
        setScanError(true)
        alert('🔍 Debug:\n' + result.debug.join('\n'))
      }
    } finally {
      setScanning(false)
    }
  }

  return (
    <>
      <Nav />
      <InAppBanner />
      <Toast msg={msg} />
      <div className="page">
        <div className="hero">
          <h1 className="hero-title">ระบบซื้อขายหนังสือแบบง่ายสุดๆ</h1>
          <p className="hero-sub">ไม่ว่าคุณจะตามหาเล่มโปรด หรืออยากเปลี่ยนตู้หนังสือให้เป็นรายได้ เรา Match คุณให้เจอคนที่ใช่ ในคลิกเดียว</p>

          {/* Search input */}
          <div style={{ maxWidth: 440, margin: '0 auto 10px', position: 'relative' }}>
            <div style={{ position: 'relative' }}>
              <input
                className="search-input"
                value={query}
                onChange={e => { setQuery(e.target.value); setLiveResults([]) }}
                placeholder="ค้นหาชื่อหนังสือ หรือ ISBN"
                onKeyDown={e => e.key === 'Enter' && doSearch()}
                style={{ width: '100%', paddingRight: liveSearching ? 44 : 16 }}
              />
              {liveSearching && (
                <span className="spin" style={{ position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)', width: 16, height: 16, borderColor: 'rgba(37,99,235,.2)', borderTopColor: 'var(--primary)' }} />
              )}
            </div>

            {/* Live results dropdown */}
            {(liveResults.length > 0 || googleLiveResults.length > 0) && (
              <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'white', borderRadius: 12, boxShadow: '0 4px 20px rgba(0,0,0,.15)', zIndex: 50, overflow: 'hidden', marginTop: 4 }}>
                {liveResults.map((b, i) => (
                  <button key={b.id} onClick={() => { router.push(`/book/${b.isbn}`); setQuery(''); setLiveResults([]); setGoogleLiveResults([]) }}
                    style={{ display: 'flex', gap: 10, alignItems: 'center', background: 'white', border: 'none', borderBottom: i < liveResults.length - 1 ? '1px solid var(--border-light)' : 'none', padding: '10px 14px', cursor: 'pointer', fontFamily: 'Kanit', textAlign: 'left', width: '100%' }}>
                    <BookCover coverUrl={b.cover_url} title={b.title} size={36} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.title}</div>
                      {b.author && <div style={{ fontSize: 11, color: 'var(--ink3)', marginTop: 1 }}>{b.author}</div>}
                    </div>
                    <span style={{ color: 'var(--primary)', fontSize: 12, fontWeight: 700, flexShrink: 0 }}>›</span>
                  </button>
                ))}
                {googleLiveResults.length > 0 && (
                  <>
                    <div style={{ padding: '6px 14px', fontSize: 10, fontWeight: 700, color: 'var(--ink3)', background: 'var(--surface)', textTransform: 'uppercase', letterSpacing: '0.6px' }}>
                      พบในระบบ — ยังไม่มีผู้ลงขายตอนนี้
                    </div>
                    {googleLiveResults.map((b, i) => (
                      <button key={b.isbn} onClick={() => { router.push(`/book/${b.isbn}`); setQuery(''); setLiveResults([]); setGoogleLiveResults([]) }}
                        style={{ display: 'flex', gap: 10, alignItems: 'center', background: 'white', border: 'none', borderBottom: i < googleLiveResults.length - 1 ? '1px solid var(--border-light)' : 'none', padding: '10px 14px', cursor: 'pointer', fontFamily: 'Kanit', textAlign: 'left', width: '100%', opacity: 0.8 }}>
                        <BookCover coverUrl={b.cover_url} title={b.title} size={36} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.title}</div>
                          {b.author && <div style={{ fontSize: 11, color: 'var(--ink3)', marginTop: 1 }}>{b.author}</div>}
                        </div>
                        <span style={{ fontSize: 10, color: 'var(--ink3)', flexShrink: 0 }}>🔔 Wantlist</span>
                      </button>
                    ))}
                  </>
                )}
                <button onClick={doSearch} style={{ display: 'block', width: '100%', padding: '10px 14px', background: 'var(--surface)', border: 'none', fontFamily: 'Kanit', fontSize: 13, color: 'var(--primary)', fontWeight: 600, cursor: 'pointer', textAlign: 'left' }}>
                  🔍 ดูผลทั้งหมดสำหรับ "{query}"
                </button>
              </div>
            )}
          </div>

          {/* Scan button */}
          <label style={{ background: scanning ? 'rgba(255,255,255,.08)' : 'rgba(255,255,255,.15)', border: '1.5px solid rgba(255,255,255,.3)', borderRadius: 10, padding: '12px 18px', color: 'white', fontFamily: 'Kanit', fontWeight: 600, fontSize: 14, cursor: scanning ? 'default' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, margin: '0 auto', maxWidth: 440, width: '100%' }}>
            <input ref={scanInputRef} type="file" accept="image/*" capture="environment" onChange={scanFromPhoto} style={{ display: 'none' }} disabled={scanning} />
            {scanning ? <><span className="spin" style={{ width: 14, height: 14, borderColor: 'rgba(255,255,255,.3)', borderTopColor: 'white' }} /> กำลังอ่าน...</> : '📷 ค้นหาด้วย Barcode'}
          </label>

          {scanError && (
            <ScanErrorSheet
              onRetry={() => { setScanError(false); scanInputRef.current?.click() }}
              onClose={() => setScanError(false)}
            />
          )}
        </div>

        <div className="stats-bar">
          <div className="stat"><div className="stat-n">{stats.books}+</div><div className="stat-l">หนังสือ</div></div>
          <div className="stat"><div className="stat-n">{stats.sellers}</div><div className="stat-l">ผู้ขาย</div></div>
          <div className="stat"><div className="stat-n">{stats.wanted}</div><div className="stat-l">Wanted</div></div>
        </div>

        <div className="section">
          <div className="section-hd">
            <div className="section-title">ลงใหม่ล่าสุด</div>
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
                  {l.photos?.[0]
                    ? <img src={l.photos[0]} alt="" style={{ width: 52, height: 52, borderRadius: 8, objectFit: 'cover', flexShrink: 0 }} />
                    : <BookCover coverUrl={l.books?.cover_url} title={l.books?.title} size={52} />
                  }
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="book-title" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{l.books?.title}</div>
                    <div className="book-author">{l.books?.author}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                      <span className="price">฿{l.price}</span>
                      {l.price_includes_shipping && <span style={{ fontSize: 11, color: 'var(--green)' }}>ส่งฟรี</span>}
                    </div>
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>

        {wantedBooks.length > 0 && (
          <div className="section" style={{ marginTop: 8 }}>
            <div className="section-hd">
              <div className="section-title">🔔 มีคนรอซื้ออยู่</div>
            </div>
            {wantedBooks.map(b => (
              <Link key={b.id} href={`/book/${b.isbn}`} style={{ textDecoration: 'none', color: 'inherit' }}>
                <div className="card">
                  <div className="book-card">
                    <BookCover coverUrl={b.cover_url} title={b.title} size={52} />
                    <div style={{ flex: 1 }}>
                      <div className="book-title">{b.title}</div>
                      <div className="book-author">{b.author}</div>
                      <div style={{ marginTop: 6 }}>
                        <span className="badge badge-blue">🔔 {b.wanted_count} คนรอซื้อ</span>
                      </div>
                    </div>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
        <div style={{ height: 12 }} />
      </div>
      <BottomNav />
    </>
  )
}
