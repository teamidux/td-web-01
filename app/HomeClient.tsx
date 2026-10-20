'use client'
import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { supabase, Book } from '@/lib/supabase'
import { GoogleBook } from '@/lib/search'
// Book type still used for wantedBooks
import { Nav, BottomNav, BookCover, useToast, Toast, ScanErrorSheet, SkeletonList, TermsFooter, useCapture, CameraCaptureModal } from '@/components/ui'
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
  const [showCamera, setShowCamera] = useState(false)
  const [scanError, setScanError] = useState(false)
  const [loading, setLoading] = useState(true)
  const [googleLoading, setGoogleLoading] = useState(false)
  const [matchQuality, setMatchQuality] = useState<'exact' | 'partial' | 'none'>('none')
  const scanInputRef = useRef<HTMLInputElement>(null)
  const capture = useCapture()
  const isLineIAB = capture === undefined
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

  // Diversify by seller — เดินตามลำดับใหม่สุด, cap per seller, fill ที่เหลือจาก skipped
  // ผลลัพธ์: variety เมื่อมี seller หลายคน + fill ครบ 12 ถ้า seller น้อย
  const diversifyBySeller = (items: any[], maxPerSeller = 4, target = 12): any[] => {
    const used: Record<string, number> = {}
    const result: any[] = []
    const skipped: any[] = []
    // Pass 1: เดินตามลำดับใหม่สุด cap max ต่อ seller
    for (const l of items) {
      if (result.length >= target) break
      const sid = l.seller_id || 'unknown'
      const count = used[sid] || 0
      if (count < maxPerSeller) {
        result.push(l)
        used[sid] = count + 1
      } else {
        skipped.push(l)
      }
    }
    // Pass 2: ถ้ายังไม่ครบ fill จาก skipped (ไม่สนใจ cap แล้ว)
    for (const l of skipped) {
      if (result.length >= target) break
      result.push(l)
    }
    return result
  }

  const loadData = async () => {
    const [recentRes, { data: wanted }] = await Promise.all([
      // ดึงเยอะหน่อย (50 = max) เพื่อให้ diversify ครอบคลุมทุก seller
      fetch('/api/listings/recent?limit=50'),
      supabase.from('books').select('*').gt('wanted_count', 0).order('wanted_count', { ascending: false }).order('created_at', { ascending: false }).limit(3),
    ])
    const { listings } = await recentRes.json()
    setRecentListings(diversifyBySeller(listings || [], 3, 12))
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

  const processPhoto = async (raw: File) => {
    setScanning(true)
    // Force paint overlay ก่อนเริ่ม heavy scan (กัน React batch render → overlay ไม่โผล่)
    // scanBarcode ใช้เวลา 1-2s บนมือถือ (canvas + decode)
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
    try {
      const result = await scanBarcode(raw)
      if (result.isbn) {
        router.push(`/book/${result.isbn}`)
      } else {
        setScanError(true)
      }
    } catch (err) {
      console.error('[home scan] error:', err)
      setScanError(true)
    } finally {
      setScanning(false)
    }
  }

  const scanFromPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.files?.[0]
    if (!raw) return
    e.target.value = ''
    processPhoto(raw)
  }

  return (
    <>
      <Nav />
      <Toast msg={msg} />
      {scanning && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.6)', zIndex: 180, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div style={{ background: 'white', borderRadius: 18, padding: '36px 24px', textAlign: 'center', maxWidth: 300, width: '100%' }}>
            <span className="spin" style={{ width: 32, height: 32, marginBottom: 16 }} />
            <div style={{ fontFamily: "'Kanit', sans-serif", fontSize: 17, fontWeight: 700 }}>กำลังค้นหาหนังสือ...</div>
          </div>
        </div>
      )}
      <div className="page" style={{ padding: 0, background: '#F8FAFC' }}>
        {/* ─── Hero: blue gradient + combined search/scan ───
            Note: ไม่ใส่ overflow:hidden บน outer — กัน clip dropdown search
            ใส่ blobs ใน wrapper ของตัวเองเพื่อ clip เฉพาะ blobs + zIndex: 1 ให้ search อยู่สูงกว่า */}
        <div style={{
          position: 'relative',
          background: 'linear-gradient(170deg, var(--primary) 0%, #1D4ED8 100%)',
          padding: '22px 18px 26px',
          color: 'white',
        }}>
          <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}>
            <div style={{ position: 'absolute', top: -60, right: -60, width: 220, height: 220, borderRadius: 999, background: 'radial-gradient(circle, rgba(250,204,21,0.25), transparent 70%)' }} />
            <div style={{ position: 'absolute', bottom: -80, left: -40, width: 200, height: 200, borderRadius: 999, background: 'radial-gradient(circle, rgba(255,255,255,0.12), transparent 70%)' }} />
          </div>

          <div style={{ position: 'relative', maxWidth: 440, margin: '0 auto' }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 10px', borderRadius: 999, background: 'rgba(255,255,255,0.16)', backdropFilter: 'blur(6px)', fontSize: 12, fontWeight: 500, color: 'rgba(255,255,255,0.95)', marginBottom: 14 }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#FACC15" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                <path d="m9 12 2 2 4-4" />
              </svg>
              <span>ฟรี · ไม่มีค่าธรรมเนียม</span>
            </div>

            <h1 style={{ fontSize: 28, fontWeight: 700, lineHeight: 1.2, letterSpacing: '-0.02em', marginBottom: 6, color: 'white' }}>
              หนังสือที่คุณไม่อ่าน<br />
              <span style={{ color: '#FACC15' }}>มีคนตามหาอยู่</span>
            </h1>
            <p style={{ fontSize: 14, fontWeight: 400, color: 'rgba(255,255,255,0.82)', lineHeight: 1.5, marginBottom: 18 }}>
              สแกนเล่มเดียวก็เจอราคา ลงขาย 30 วิฯ เร็วทันใจ
            </p>

            {/* ─── Unified search + scan bar ─── */}
            <div style={{ position: 'relative' }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8,
                background: 'white', borderRadius: 16, padding: '6px 6px 6px 16px',
                boxShadow: '0 8px 24px rgba(15, 23, 42, 0.18), 0 2px 6px rgba(15,23,42,0.1)',
              }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#94A3B8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                  <circle cx="11" cy="11" r="7" />
                  <path d="m20 20-3.5-3.5" />
                </svg>
                <input
                  value={query}
                  onChange={e => { setQuery(e.target.value); setLiveResults([]) }}
                  placeholder="ชื่อหนังสือ หรือ ISBN"
                  onKeyDown={e => e.key === 'Enter' && doSearch()}
                  style={{
                    flex: 1, border: 'none', outline: 'none',
                    fontFamily: 'Kanit, sans-serif', fontSize: 15, color: '#0F172A',
                    background: 'transparent', padding: '10px 0', minWidth: 0,
                  }}
                />
                {query && !liveSearching && (
                  <button
                    type="button" aria-label="ล้างคำค้น"
                    onClick={() => { setQuery(''); setLiveResults([]); setGoogleLiveResults([]) }}
                    style={{ width: 32, height: 32, minWidth: 32, minHeight: 32, borderRadius: '50%', background: '#E5E7EB', border: 'none', color: '#475569', fontSize: 16, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
                  >×</button>
                )}
                {isLineIAB ? (
                  <button
                    type="button" onClick={() => setShowCamera(true)} disabled={scanning}
                    style={{ height: 40, padding: '0 14px', borderRadius: 12, border: 'none', background: '#0F172A', color: 'white', display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: 'Kanit, sans-serif', fontWeight: 600, fontSize: 13, cursor: scanning ? 'wait' : 'pointer', flexShrink: 0 }}
                  >
                    {scanning ? <span className="spin" style={{ width: 14, height: 14, borderColor: 'rgba(255,255,255,.3)', borderTopColor: 'white' }} /> : (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2M4 12h16" />
                      </svg>
                    )}
                    สแกน
                  </button>
                ) : (
                  <label style={{ height: 40, padding: '0 14px', borderRadius: 12, background: '#0F172A', color: 'white', display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: 'Kanit, sans-serif', fontWeight: 600, fontSize: 13, cursor: scanning ? 'wait' : 'pointer', flexShrink: 0 }}>
                    <input ref={scanInputRef} type="file" accept="image/*" capture={capture} onChange={scanFromPhoto} style={{ display: 'none' }} disabled={scanning} />
                    {scanning ? <span className="spin" style={{ width: 14, height: 14, borderColor: 'rgba(255,255,255,.3)', borderTopColor: 'white' }} /> : (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2M4 12h16" />
                      </svg>
                    )}
                    สแกน
                  </label>
                )}
              </div>

              {/* Live results dropdown */}
              {query.trim() && !liveSearching && (liveResults.length > 0 || googleLiveResults.length > 0) && (
                <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'white', borderRadius: 14, boxShadow: '0 8px 28px rgba(0,0,0,.18)', zIndex: 50, overflow: 'hidden', marginTop: 6 }}>
                  {[...liveResults, ...googleLiveResults].map((b: any) => {
                    const hasListing = (b.active_listings_count || 0) > 0
                    return (
                      <button key={b.isbn} onClick={() => { router.push(`/book/${b.isbn}`); setQuery(''); setLiveResults([]); setGoogleLiveResults([]) }}
                        style={{ display: 'flex', gap: 12, alignItems: 'center', background: 'white', border: 'none', borderBottom: '1px solid var(--border-light)', padding: '12px 14px', cursor: 'pointer', fontFamily: 'Kanit', textAlign: 'left', width: '100%' }}>
                        <BookCover isbn={b.isbn} title={b.title} size={44} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 15, fontWeight: 600, color: '#121212', lineHeight: 1.35, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.title}</div>
                          {b.author && <div style={{ fontSize: 13, fontWeight: 500, color: '#555555', lineHeight: 1.5, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.author}</div>}
                          <div style={{ fontSize: 11, color: '#94A3B8', fontFamily: 'monospace', marginTop: 2 }}>ISBN {b.isbn}</div>
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

              {/* ค้นไม่เจอ */}
              {query.trim().length >= 3 && !liveSearching && !googleLoading && liveResults.length === 0 && googleLiveResults.length === 0 && (
                <div style={{ fontSize: 13, color: 'white', marginTop: 10, textAlign: 'center', background: 'rgba(0,0,0,.3)', borderRadius: 8, padding: '8px 12px' }}>
                  ไม่พบ "{query}" — ลองใช้ ISBN หรือสแกน barcode
                </div>
              )}

              {/* Loading — Google fallback */}
              {query.trim() && !liveSearching && googleLoading && liveResults.length === 0 && googleLiveResults.length === 0 && (
                <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'white', borderRadius: 14, boxShadow: '0 8px 28px rgba(0,0,0,.18)', zIndex: 50, overflow: 'hidden', marginTop: 6, padding: '20px 16px', textAlign: 'center' }}>
                  <span className="spin" style={{ width: 20, height: 20 }} />
                  <div style={{ fontSize: 13, color: 'var(--ink3)', marginTop: 10, lineHeight: 1.6 }}>กำลังค้นในฐานข้อมูลเพิ่มเติม...</div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Modals: scan error + camera */}
        {scanError && (
          <ScanErrorSheet
            onRetry={() => { setScanError(false); isLineIAB ? setShowCamera(true) : scanInputRef.current?.click() }}
            onClose={() => setScanError(false)}
          />
        )}
        {showCamera && (
          <CameraCaptureModal
            onCapture={(file) => { setShowCamera(false); processPhoto(file) }}
            onClose={() => setShowCamera(false)}
          />
        )}

        {/* ─── Wanted Banner: yellow card ─── */}
        {wantedBooks.length > 0 && (
          <div style={{ padding: '18px 16px 4px', maxWidth: 500, margin: '0 auto' }}>
            <div style={{ background: '#FEF9C3', border: '1px solid #FDE68A', borderRadius: 18, padding: '14px 14px 4px', position: 'relative', overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, paddingRight: 4 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ width: 28, height: 28, borderRadius: 8, background: 'white', border: '1px solid #FDE68A', display: 'grid', placeItems: 'center' }}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#B45309" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
                      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
                    </svg>
                  </div>
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: '#0F172A', lineHeight: 1.2 }}>มีคนรอซื้ออยู่นะ</div>
                    <div style={{ fontSize: 11.5, color: '#854D0E', lineHeight: 1.4, marginTop: 1 }}>ลองเช็คดู — เผื่อคุณมี</div>
                  </div>
                </div>
                <Link href="/market" style={{ fontSize: 12, fontWeight: 600, color: '#92400E', display: 'inline-flex', alignItems: 'center', gap: 3, textDecoration: 'none' }}>
                  ดู
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#92400E" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 5l7 7-7 7" /></svg>
                </Link>
              </div>
              {wantedBooks.map(b => (
                <Link key={b.id} href={`/book/${b.isbn}`} style={{ textDecoration: 'none', color: 'inherit', display: 'flex', alignItems: 'center', gap: 10, padding: '8px 2px', borderTop: '1px solid rgba(180,83,9,0.1)' }}>
                  <div style={{ width: 34, height: 46, borderRadius: 5, overflow: 'hidden', flexShrink: 0, boxShadow: '0 1px 3px rgba(0,0,0,0.15)' }}>
                    <BookCover isbn={b.isbn} title={b.title} size={46} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: '#0F172A', lineHeight: 1.3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.title}</div>
                    <div style={{ fontSize: 11.5, color: '#92400E', marginTop: 2, fontWeight: 500 }}>
                      {b.wanted_count} คนตามหา · ลงขายวันนี้ขายได้เลย
                    </div>
                  </div>
                  <div style={{ padding: '6px 12px', borderRadius: 999, background: '#0F172A', color: 'white', fontSize: 12, fontWeight: 600, flexShrink: 0 }}>
                    ลงขาย
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* ─── Section header: ลงใหม่วันนี้ ─── */}
        <div style={{ padding: '22px 16px 10px', maxWidth: 500, margin: '0 auto', display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 19, fontWeight: 700, color: '#0F172A', letterSpacing: '-0.02em', lineHeight: 1.2 }}>ลงใหม่วันนี้</div>
            <div style={{ fontSize: 12.5, color: '#64748B', marginTop: 3, lineHeight: 1.4 }}>จากเพื่อนๆ นักอ่านทั่วประเทศ</div>
          </div>
          {!loading && recentListings.length > 0 && (
            <Link href="/browse" style={{ fontSize: 13, fontWeight: 600, color: 'var(--primary)', display: 'inline-flex', alignItems: 'center', gap: 3, textDecoration: 'none' }}>
              ดูทั้งหมด
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 5l7 7-7 7" /></svg>
            </Link>
          )}
        </div>

        {/* ─── Book grid: 2-col cards ─── */}
        <div style={{ padding: '0 16px', maxWidth: 500, margin: '0 auto' }}>
          {loading && <SkeletonList count={4} />}
          {!loading && recentListings.length === 0 && (
            <div style={{ background: 'white', borderRadius: 14, padding: '30px 20px', textAlign: 'center', border: '1px solid #EEF2F7' }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>📚</div>
              <div style={{ fontSize: 14, color: 'var(--ink2)', marginBottom: 16 }}>ยังไม่มีหนังสือในระบบ</div>
              <Link href="/sell"><button className="btn" style={{ maxWidth: 200, margin: '0 auto', display: 'block' }}>ลงขายเป็นคนแรก</button></Link>
            </div>
          )}
          {!loading && recentListings.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              {recentListings.map((l: any) => (
                <Link key={l.id} href={`/book/${l.books?.isbn}`} style={{ textDecoration: 'none', color: 'inherit' }}>
                  <div style={{ background: 'white', borderRadius: 14, overflow: 'hidden', border: '1px solid #EEF2F7', boxShadow: '0 1px 2px rgba(15,23,42,0.04)' }}>
                    <div style={{ aspectRatio: '3/4', background: '#F8FAFC', position: 'relative' }}>
                      {l.photos?.[0] ? (
                        <img src={l.photos[0]} alt={l.books?.title || `ปกหนังสือ ISBN ${l.books?.isbn || ''}`} loading="lazy" decoding="async" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      ) : (
                        <BookCover isbn={l.books?.isbn} title={l.books?.title} size={120} />
                      )}
                    </div>
                    <div style={{ padding: '10px 12px 12px' }}>
                      <div style={{ fontSize: 13.5, fontWeight: 600, color: '#0F172A', lineHeight: 1.3, letterSpacing: '-0.005em', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', minHeight: 36 }}>{l.books?.title}</div>
                      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 8 }}>
                        <div style={{ fontSize: 17, fontWeight: 700, color: '#1D4ED8', letterSpacing: '-0.02em', lineHeight: 1 }}>฿{l.price}</div>
                        {l.price_includes_shipping && (
                          <div style={{ fontSize: 10.5, fontWeight: 600, color: '#16A34A' }}>ส่งฟรี</div>
                        )}
                      </div>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* ─── Sell CTA card (dark gradient) ─── */}
        <div style={{ padding: '22px 16px 6px', maxWidth: 500, margin: '0 auto' }}>
          <Link href="/sell" style={{ textDecoration: 'none', display: 'block' }}>
            <div style={{ borderRadius: 20, padding: 18, background: 'linear-gradient(135deg, #0F172A 0%, #1D4ED8 100%)', color: 'white', position: 'relative', overflow: 'hidden' }}>
              <div style={{ position: 'absolute', top: -30, right: -30, width: 140, height: 140, borderRadius: 999, background: 'radial-gradient(circle, rgba(250,204,21,0.2), transparent 70%)' }} />
              <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 14 }}>
                <div style={{ width: 56, height: 56, borderRadius: 14, background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.15)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#FACC15" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2M4 12h16" />
                  </svg>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 16, fontWeight: 700, letterSpacing: '-0.01em', lineHeight: 1.3 }}>หนังสือกองอยู่บ้าน?</div>
                  <div style={{ fontSize: 12.5, fontWeight: 400, color: 'rgba(255,255,255,0.8)', marginTop: 2, lineHeight: 1.4 }}>สแกน barcode แล้วระบบกรอกให้หมด</div>
                </div>
                <div style={{ padding: '10px 14px', borderRadius: 999, background: '#FACC15', color: '#0F172A', fontSize: 13, fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                  ลงขาย
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#0F172A" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 5l7 7-7 7" /></svg>
                </div>
              </div>
            </div>
          </Link>
        </div>

        <div style={{ height: 20 }} />
        <TermsFooter />
      </div>
      <BottomNav />
    </>
  )
}
