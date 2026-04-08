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

  // Live search — debounce 220ms, ค้น DB + Google Books คู่ขนาน
  // เหตุผล: query "เทคนิค" อาจ match "เทคนิคการขาย" ใน DB → ผู้ใช้ควรเห็น
  // "เทคนิคออกกำลังกาย" จาก Google ด้วย ไม่งั้นเหมือนระบบไม่รู้จัก
  useEffect(() => {
    if (!query.trim()) { setLiveResults([]); setGoogleLiveResults([]); return }
    const t = setTimeout(async () => {
      const q = query.trim()
      if (/^(978|979)\d{10}$/.test(q.replace(/[^0-9]/g, ''))) return
      setLiveSearching(true)
      setGoogleLiveResults([])

      const orFilter = buildOrFilter(searchVariants(q))
      // dropdown แสดงสูงสุด 5 รายการ (3 DB + 2 Google) — ที่เหลือคลิก "ดูทั้งหมด"
      const dbPromise = supabase
        .from('books')
        .select('id, isbn, title, author, cover_url')
        .or(orFilter)
        .limit(3)

      // เรียก Google คู่ขนาน — ทำเฉพาะ query ยาวพอเพื่อประหยัด quota
      const googlePromise = q.length >= 3 ? fetchGoogleBooksByTitle(q) : Promise.resolve([])

      const [{ data }, gBooks] = await Promise.all([dbPromise, googlePromise])
      setLiveResults(data || [])
      // กรอง Google ออก ISBN ที่ซ้ำกับ DB และ cap ที่ 2 รายการ
      const dbIsbns = new Set((data || []).map(b => b.isbn))
      setGoogleLiveResults((gBooks || []).filter(b => !dbIsbns.has(b.isbn)).slice(0, 2))
      setLiveSearching(false)
    }, 220)
    return () => clearTimeout(t)
  }, [query])

  const loadData = async () => {
    const [recentRes, { data: wanted }] = await Promise.all([
      fetch('/api/listings/recent?limit=10'),
      supabase.from('books').select('*').gt('wanted_count', 0).order('wanted_count', { ascending: false }).limit(3),
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
      console.log('[SCAN DEBUG]', result)
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
              <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'white', borderRadius: 14, boxShadow: '0 8px 28px rgba(0,0,0,.18)', zIndex: 50, overflow: 'hidden', marginTop: 6 }}>
                {liveResults.length > 0 && (
                  <div style={{ padding: '10px 14px 6px', fontSize: 12, fontWeight: 700, color: 'var(--green)', background: '#F0FDF4', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    ✓ มีในระบบ มีคนลงขาย
                  </div>
                )}
                {liveResults.map((b, i) => (
                  <button key={b.id} onClick={() => { router.push(`/book/${b.isbn}`); setQuery(''); setLiveResults([]); setGoogleLiveResults([]) }}
                    style={{ display: 'flex', gap: 12, alignItems: 'center', background: 'white', border: 'none', borderBottom: '1px solid var(--border-light)', padding: '12px 14px', cursor: 'pointer', fontFamily: 'Kanit', textAlign: 'left', width: '100%' }}>
                    <BookCover isbn={b.isbn} title={b.title} size={44} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 15, fontWeight: 600, color: '#121212', lineHeight: 1.35, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.title}</div>
                      {b.author && <div style={{ fontSize: 13, fontWeight: 500, color: '#555555', lineHeight: 1.5, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.author}</div>}
                    </div>
                    <span style={{ color: 'var(--primary)', fontSize: 14, fontWeight: 600, flexShrink: 0 }}>›</span>
                  </button>
                ))}
                {googleLiveResults.length > 0 && (
                  <>
                    <div style={{ padding: '10px 14px 6px', fontSize: 12, fontWeight: 700, color: 'var(--ink3)', background: 'var(--surface)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      📚 มีในฐานข้อมูล ยังไม่มีคนลงขาย
                    </div>
                    {googleLiveResults.map((b, i) => (
                      <button key={b.isbn} onClick={() => { router.push(`/book/${b.isbn}`); setQuery(''); setLiveResults([]); setGoogleLiveResults([]) }}
                        style={{ display: 'flex', gap: 12, alignItems: 'center', background: 'white', border: 'none', borderBottom: '1px solid var(--border-light)', padding: '12px 14px', cursor: 'pointer', fontFamily: 'Kanit', textAlign: 'left', width: '100%' }}>
                        <BookCover isbn={b.isbn} title={b.title} size={44} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 15, fontWeight: 600, color: '#121212', lineHeight: 1.35, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.title}</div>
                          {b.author && <div style={{ fontSize: 13, fontWeight: 500, color: '#555555', lineHeight: 1.5, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.author}</div>}
                        </div>
                        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink3)', flexShrink: 0 }}>🔔</span>
                      </button>
                    ))}
                  </>
                )}
                <button onClick={doSearch} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, width: '100%', padding: '14px 16px', background: 'var(--primary)', border: 'none', fontFamily: 'Kanit', fontSize: 15, color: 'white', fontWeight: 600, cursor: 'pointer', textAlign: 'left', minHeight: 48 }}>
                  <span>🔍 ดูผลทั้งหมดสำหรับ "{query}"</span>
                  <span style={{ fontSize: 18, fontWeight: 700 }}>→</span>
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
            <div className="stat-n">200,000+</div>
            <div className="stat-l">หนังสือ</div>
          </div>
          <div className="stat">
            <div className="stat-n" style={{ fontSize: 24 }}>🤝</div>
            <div className="stat-l">ซื้อขายง่าย</div>
          </div>
          <div className="stat">
            <div className="stat-n" style={{ fontSize: 24 }}>🔔</div>
            <div className="stat-l">LINE แจ้งเตือน</div>
          </div>
        </div>

        <div className="section">
          <div className="section-hd" style={{ marginBottom: 16, alignItems: 'flex-end' }}>
            <div>
              <div style={{ fontSize: 22, fontWeight: 700, color: '#121212', lineHeight: 1.3, letterSpacing: '-0.02em' }}>
                ✨ ลงใหม่ล่าสุด
              </div>
              <div style={{ fontSize: 13, color: 'var(--ink3)', marginTop: 4, lineHeight: 1.5 }}>
                หนังสือมือสองที่เพิ่งลงขายในระบบ
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
                      {l.price_includes_shipping && <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--green)' }}>ส่งฟรี</span>}
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
                        <span className="badge badge-blue">🙋 {b.wanted_count} คนรอซื้อ</span>
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
