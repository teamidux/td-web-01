'use client'
import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { supabase, Book } from '@/lib/supabase'
import { Nav, BottomNav, BookCover, InAppBanner, useToast, Toast } from '@/components/ui'

export default function HomePage() {
  const router = useRouter()
  const [books, setBooks] = useState<Book[]>([])
  const [wantedBooks, setWantedBooks] = useState<Book[]>([])
  const [stats, setStats] = useState({ books: 0, sellers: 0, wanted: 0 })
  const [query, setQuery] = useState('')
  const [scanning, setScanning] = useState(false)
  const [loading, setLoading] = useState(true)
  const scannerRef = useRef<any>(null)
  const { msg, show } = useToast()

  useEffect(() => { loadData() }, [])

  const loadData = async () => {
    const [{ data: bks }, { data: wanted }, { count: sellerCount }] = await Promise.all([
      supabase.from('books').select('*').order('created_at', { ascending: false }).limit(10),
      supabase.from('books').select('*').gt('wanted_count', 0).order('wanted_count', { ascending: false }).limit(3),
      supabase.from('users').select('*', { count: 'exact', head: true }),
    ])
    setBooks(bks || [])
    setWantedBooks(wanted || [])
    setStats({ books: bks?.length || 0, sellers: sellerCount || 0, wanted: wanted?.reduce((s, b) => s + (b.wanted_count || 0), 0) || 0 })
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

  const startScan = async () => {
    setScanning(true)
    try {
      const { Html5Qrcode, Html5QrcodeSupportedFormats } = await import('html5-qrcode')
      const scanner = new Html5Qrcode('scanner-div', { formatsToSupport: [Html5QrcodeSupportedFormats.EAN_13], verbose: false })
      scannerRef.current = scanner
      await scanner.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 250, height: 100 } },
        (text: string) => {
          scanner.stop()
          setScanning(false)
          if (!/^(978|979)\d{10}$/.test(text)) { show('ISBN ไม่ถูกต้อง กรุณาตรวจสอบใหม่'); return }
          router.push(`/book/${text}`)
        },
        () => {}
      )
    } catch {
      setScanning(false)
      show('ไม่สามารถเปิดกล้องได้ กรุณาเปิดใน Chrome')
    }
  }

  const stopScan = () => {
    scannerRef.current?.stop()
    setScanning(false)
  }

  return (
    <>
      <Nav />
      <InAppBanner />
      <Toast msg={msg} />
      <div className="page">
        <div className="hero">
          <h1 className="hero-title">ตลาดหนังสือ<br /><em>ค้นหาด้วย ISBN</em></h1>
          <p className="hero-sub">มือหนึ่ง มือสอง ครบในที่เดียว</p>

          {!scanning && (
            <div className="search-row" style={{ maxWidth: 440, margin: '0 auto 10px' }}>
              <input
                className="search-input"
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="ISBN หรือชื่อหนังสือ..."
                onKeyDown={e => e.key === 'Enter' && doSearch()}
              />
              <button className="btn-search" onClick={doSearch}>ค้นหา</button>
            </div>
          )}

          {scanning ? (
            <div style={{ borderRadius: 12, overflow: 'hidden', maxWidth: 440, margin: '0 auto', position: 'relative' }}>
              <div id="scanner-div" style={{ width: '100%' }} />
              <button onClick={stopScan} style={{ position: 'absolute', top: 8, right: 8, background: 'rgba(0,0,0,.6)', border: 'none', borderRadius: 20, padding: '5px 12px', color: 'white', fontFamily: 'Sarabun', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
                ✕ ปิด
              </button>
            </div>
          ) : (
            <button onClick={startScan} style={{ background: 'rgba(255,255,255,.15)', border: '1.5px solid rgba(255,255,255,.3)', borderRadius: 10, padding: '10px 18px', color: 'white', fontFamily: 'Sarabun', fontWeight: 600, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, margin: '0 auto' }}>
              📷 สแกน Barcode
            </button>
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
          {loading && <div style={{ textAlign: 'center', padding: 32 }}><span className="spin" style={{ width: 24, height: 24 }} /></div>}
          {!loading && books.length === 0 && (
            <div className="empty">
              <div className="empty-icon">📚</div>
              <div style={{ marginBottom: 16 }}>ยังไม่มีหนังสือในระบบ</div>
              <Link href="/sell"><button className="btn" style={{ maxWidth: 200, margin: '0 auto', display: 'block' }}>ลงขายเป็นคนแรก</button></Link>
            </div>
          )}
          {books.map(b => (
            <Link key={b.id} href={`/book/${b.isbn}`} style={{ textDecoration: 'none', color: 'inherit' }}>
              <div className="card">
                <div className="book-card">
                  <BookCover coverUrl={b.cover_url} title={b.title} size={52} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="book-title" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.title}</div>
                    <div className="book-author">{b.author}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      {b.min_price ? <span className="price">฿{b.min_price}</span> : <span style={{ fontSize: 12, color: 'var(--ink3)' }}>ยังไม่มีคนขาย</span>}
                      {b.active_listings_count > 0 && <span style={{ fontSize: 11, color: 'var(--ink3)' }}>{b.active_listings_count} คนขาย</span>}
                      {b.wanted_count > 0 && <span className="badge badge-blue">🔔 {b.wanted_count} คนรอ</span>}
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
