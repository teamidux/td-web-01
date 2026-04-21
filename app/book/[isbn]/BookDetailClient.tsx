'use client'
import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { supabase, Book, Listing, CONDITIONS } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { Nav, BottomNav, BookCover, CondBadge, useToast, Toast, SkeletonList, TrustBadge, LoadingOverlay } from '@/components/ui'
import { parseLineId } from '@/lib/line-id'

export default function BookDetailClient({ isbn, initialBook }: { isbn: string; initialBook?: Partial<Book> | null }) {
  const router = useRouter()
  const { user, loginWithLine } = useAuth()
  // Back button: ถ้ามี history (มาจาก /search) กลับหน้าเดิม ไม่งั้นไปหน้าแรก
  const goBack = () => {
    if (typeof window !== 'undefined' && window.history.length > 1) {
      router.back()
    } else {
      router.push('/')
    }
  }
  const [book, setBook] = useState<Book | null>((initialBook as Book) ?? null)
  const [listings, setListings] = useState<Listing[]>([])
  const [lastSold, setLastSold] = useState<Listing | null>(null)
  const [pioneerUserId, setPioneerUserId] = useState<string | null>(null)
  const [isWanted, setIsWanted] = useState(false)
  const [loading, setLoading] = useState(true)
  // showLogin removed — login goes directly to LINE OAuth
  const [showWantedForm, setShowWantedForm] = useState(false)
  const [wantedPrice, setWantedPrice] = useState('')
  const [lightbox, setLightbox] = useState<{ photos: string[]; index: number } | null>(null)
  const [contactLoading, setContactLoading] = useState(false)
  const [wantedBusy, setWantedBusy] = useState(false)
  const [contactListing, setContactListing] = useState<Listing | null>(null)
  const [contactPII, setContactPII] = useState<{ line_id: string | null; phone: string | null } | null>(null)
  const [copied, setCopied] = useState(false)
  const { msg, show } = useToast()
  const bookIdRef = useRef<string | null>(null)

  useEffect(() => {
    let cancelled = false
    loadData(cancelled)
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isbn])

  // หลัง login กลับมาพร้อม ?action=wanted → เปิดฟอร์มตามหาอัตโนมัติ
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!user || !book || isWanted) return
    const params = new URLSearchParams(window.location.search)
    if (params.get('action') === 'wanted') {
      setShowWantedForm(true)
      // ล้าง query string ออก ไม่ให้ refresh แล้วเด้งซ้ำ
      window.history.replaceState({}, '', window.location.pathname)
    }
  }, [user, book, isWanted])

  // Auto-save book + increment view_count
  // Throttle: นับ 1 ครั้งต่อ ISBN ต่อ session (กัน refresh spam)
  useEffect(() => {
    if (!book?.title) return
    const key = `bm_viewed_${isbn}`
    if (sessionStorage.getItem(key)) return
    sessionStorage.setItem(key, '1')
    fetch('/api/books/view', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        isbn,
        title: book.title,
        author: book.author,
        cover_url: book.cover_url,
        publisher: book.publisher,
        language: book.language,
        category: (book as any).category || null,
        list_price: (book as any).list_price || null,
      }),
    }).catch(() => {})
  }, [isbn, book?.title])

  const loadListings = async (bookId: string) => {
    try {
      // Pioneer = คนแรกที่เคยลงเล่มนี้ (ทุกสถานะ) — ผูกกับ user ไม่ใช่ listing
      // เพื่อให้ขายแล้วกลับมาลงใหม่ยังได้ป้าย + คนต่อมาไม่แย่งตำแหน่ง
      const [{ listings }, soldRes, pioneerRes] = await Promise.all([
        fetch(`/api/listings?book_id=${bookId}`).then(r => r.json()),
        supabase
          .from('listings')
          .select('id, price, sold_at')
          .eq('book_id', bookId)
          .eq('status', 'sold')
          .order('sold_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from('listings')
          .select('seller_id')
          .eq('book_id', bookId)
          .order('created_at', { ascending: true })
          .limit(1)
          .maybeSingle(),
      ])
      setListings(listings || [])
      setLastSold((soldRes.data as any) || null)
      setPioneerUserId((pioneerRes.data as any)?.seller_id || null)
    } catch (err) {
      console.error('[loadListings]', err)
      setListings([])
    }
  }

  const loadData = async (cancelled = false) => {
    setLoading(true)

    // Query DB สดเสมอ — ไม่ใช้ initialBook เพื่อให้ admin ที่แก้ cover_url / title เห็นผลทันที
    // (initialBook ใช้แค่ first-paint จาก SSR — ไม่ใช่ source of truth)
    const { data: dbBook } = await supabase.from('books').select('*').eq('isbn', isbn).maybeSingle()
    if (cancelled) return

    if (dbBook?.id) {
      setBook(dbBook as Book)
      bookIdRef.current = dbBook.id as string
      await loadListings(dbBook.id as string)
      if (cancelled) return
      if (user) {
        const r = await fetch(`/api/wanted/check?book_id=${encodeURIComponent(dbBook.id)}`, { cache: 'no-store' })
        const w = r.ok ? await r.json() : null
        if (cancelled) return
        setIsWanted(!!w?.wanted)
      }
    }
    // ถ้าไม่มีใน DB → book state ยังเป็น initialBook (จาก Google) หรือ null
    setLoading(false)
  }

  // Realtime: รีเฟรช listings อัตโนมัติเมื่อมีการลงขายใหม่
  useEffect(() => {
    const channel = supabase
      .channel(`listings:${isbn}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'listings' }, () => {
        if (bookIdRef.current) loadListings(bookIdRef.current)
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [isbn])

  // ถ้า book ยังไม่อยู่ใน DB (มาจาก Google Books) → save ผ่าน API แล้วดึง id กลับ
  const ensureBookInDB = async (): Promise<string | null> => {
    if (book?.id) return book.id
    if (!book?.title) return null
    // ใช้ /api/books/view ที่มีอยู่แล้ว — มันจะ insert ถ้ายังไม่มี
    await fetch('/api/books/view', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isbn, title: book.title, author: book.author, cover_url: book.cover_url, publisher: book.publisher, language: book.language }),
    })
    // ดึง id กลับมา
    const { data: existing } = await supabase.from('books').select('id').eq('isbn', isbn).maybeSingle()
    if (!existing?.id) return null
    setBook(b => b ? { ...b, id: existing.id } : b)
    bookIdRef.current = existing.id
    return existing.id
  }

  // ปุ่ม "ขายเล่มนี้" → ถ้ายังไม่ login ให้ trigger LINE login เลย ไม่ใช่พาไป /sell แล้วโผล่ login box
  const goSell = () => {
    const target = `/sell?isbn=${isbn}`
    if (!user) {
      loginWithLine(target)
      return
    }
    window.location.href = target
  }

  const toggleWanted = async () => {
    if (!user) {
      // ติด action=wanted ไปใน next URL → หลัง login กลับมา auto เปิดฟอร์มตามหา
      const next = typeof window !== 'undefined' ? `${window.location.pathname}?action=wanted` : '/'
      loginWithLine(next)
      return
    }
    if (isWanted && book?.id) {
      setWantedBusy(true)
      try {
        await fetch('/api/wanted', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ book_id: book.id }) })
        const newCount = Math.max(0, (book.wanted_count || 1) - 1)
        setIsWanted(false)
        setBook(b => b ? { ...b, wanted_count: newCount } : b)
        show('ลบออกจากรายการตามหาแล้ว')
      } finally {
        setWantedBusy(false)
      }
    } else {
      setShowWantedForm(true)
    }
  }

  const confirmWanted = async () => {
    if (!user) return
    setWantedBusy(true)
    try {
      const bookId = await ensureBookInDB()
      if (!bookId) { show('เกิดข้อผิดพลาด ลองใหม่อีกครั้ง'); return }
      await fetch('/api/wanted', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ book_id: bookId, isbn, max_price: wantedPrice ? parseFloat(wantedPrice) : null }),
      })
      const newCount = (book?.wanted_count || 0) + 1
      setIsWanted(true)
      setBook(b => b ? { ...b, wanted_count: newCount } : b)
      setShowWantedForm(false)
      show('เพิ่มในรายการตามหาแล้ว 🔔')
    } finally {
      setWantedBusy(false)
    }
  }

  // รวบ LINE + Phone ทั้งหมดจาก contact field + profile → deduplicate
  const allLines: ReturnType<typeof parseLineId>[] = []
  const allPhones: string[] = []
  if (contactListing) {
    const ct = contactListing.contact?.trim() || ''
    const isPhone = /^(\+?66|0)[0-9\s\-]{7,12}$/.test(ct)
    if (isPhone) {
      allPhones.push(ct.replace(/\D/g, ''))
    } else {
      const parsed = parseLineId(ct)
      if (parsed) allLines.push(parsed)
    }
  }
  if (contactPII?.line_id?.trim()) {
    const parsed = parseLineId(contactPII.line_id.trim())
    if (parsed && !allLines.some(l => l?.raw === parsed.raw)) allLines.push(parsed)
  }
  if (contactPII?.phone?.trim()) {
    const cleaned = contactPII.phone.trim().replace(/\D/g, '')
    if (cleaned && !allPhones.includes(cleaned)) allPhones.push(cleaned)
  }

  const prices = listings.map(l => l.price)
  const minP = prices.length ? Math.min(...prices) : null
  const maxP = prices.length ? Math.max(...prices) : null
  const avgP = prices.length ? Math.round(prices.reduce((a, b) => a + b) / prices.length) : null

  if (loading) return (
    <>
      <Nav />
      <div className="page">
        <div style={{ padding: '16px 16px 0' }}>
          <div style={{ display: 'flex', gap: 14, marginBottom: 20 }}>
            <div className="skeleton" style={{ width: 90, height: 120, borderRadius: 10, flexShrink: 0 }} />
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 4 }}>
              <div className="skeleton" style={{ height: 18, width: '80%' }} />
              <div className="skeleton" style={{ height: 13, width: '55%' }} />
              <div className="skeleton" style={{ height: 13, width: '40%' }} />
              <div className="skeleton" style={{ height: 30, width: '60%', borderRadius: 8, marginTop: 4 }} />
            </div>
          </div>
        </div>
        <div style={{ padding: '0 16px' }}><SkeletonList count={3} /></div>
      </div>
    </>
  )

  if (!book) return (
    <>
      <Nav />
      <div className="page">
        <button onClick={goBack} className="back-btn" style={{ background: 'none', border: 'none', padding: 0, fontFamily: 'inherit', fontSize: 'inherit', color: 'inherit', cursor: 'pointer' }}>← กลับ</button>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 'calc(100vh - 160px)', padding: '16px' }}>
          <div style={{ background: 'white', borderRadius: 20, boxShadow: '0 8px 32px rgba(0,0,0,.1)', padding: '32px 24px', maxWidth: 380, width: '100%', textAlign: 'center' }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>📖</div>
            <div style={{ fontFamily: "'Kanit', sans-serif", fontSize: 20, fontWeight: 700, color: 'var(--ink)', marginBottom: 6 }}>
              ไม่พบข้อมูลหนังสือเล่มนี้
            </div>
            <div style={{ fontSize: 13, color: 'var(--ink3)', marginBottom: 20 }}>ISBN: {isbn}</div>

            <div style={{ background: '#F8FAFC', borderRadius: 12, padding: '14px 16px', marginBottom: 16, textAlign: 'left' }}>
              <div style={{ fontFamily: "'Kanit', sans-serif", fontSize: 14, fontWeight: 600, color: 'var(--ink)', marginBottom: 6 }}>
                หนังสือบางเล่มอาจเป็น:
              </div>
              <div style={{ fontSize: 14, color: 'var(--ink2)', lineHeight: 1.9, paddingLeft: 4 }}>
                &bull; สำนักพิมพ์อิสระที่ไม่ได้ลงทะเบียนออนไลน์<br/>
                &bull; หนังสือเก่าหรือหายากที่พิมพ์จำนวนน้อย<br/>
                &bull; หนังสืองานศพหรือสิ่งพิมพ์พิเศษ
              </div>
            </div>

            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)', marginBottom: 4 }}>คุณมีหนังสือเล่มนี้อยู่ไหม?</div>
            <div style={{ fontSize: 13, color: 'var(--ink2)', marginBottom: 16, lineHeight: 1.7 }}>
              เป็นคนแรกที่ขาย โอกาสขายได้เร็วมาก
            </div>
            <button className="btn" onClick={goSell} style={{ width: '100%' }}>📖 ลงขายเล่มนี้เลย</button>
          </div>
        </div>
      </div>
    </>
  )

  return (
    <>
      <Nav />
      <Toast msg={msg} />

      {/* Contact loading overlay — กันคนงงตอนกด "ติดต่อผู้ขาย" แล้วเงียบ */}
      {contactLoading && <LoadingOverlay message="กำลังโหลดข้อมูลติดต่อ..." sub="รอสักครู่" />}

      {/* Wanted busy overlay — ตามหา/ลบตามหา */}
      {wantedBusy && <LoadingOverlay message="กำลังบันทึก..." />}

      {showWantedForm && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.6)', zIndex: 200, display: 'flex', alignItems: 'flex-end' }} onClick={() => setShowWantedForm(false)}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'white', borderRadius: '18px 18px 0 0', padding: '24px 20px 40px', width: '100%', maxWidth: 480, margin: '0 auto' }}>
            <div style={{ fontFamily: "'Kanit', sans-serif", fontSize: 18, marginBottom: 4 }}>ตามหาเล่มนี้</div>
            <div style={{ fontSize: 13, color: 'var(--ink3)', marginBottom: 16 }}>เราจะแจ้งเตือนเมื่อมีคนลงขายเล่มนี้</div>
            <div className="form-group">
              <label className="label">ราคาสูงสุดที่ยอมจ่าย (ไม่บังคับ)</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontWeight: 700, color: 'var(--ink3)' }}>฿</span>
                <input className="input" type="number" value={wantedPrice} onChange={e => setWantedPrice(e.target.value)} placeholder="เช่น 200" />
              </div>
            </div>
            <button className="btn" onClick={confirmWanted} disabled={wantedBusy} style={{ opacity: wantedBusy ? 0.6 : 1 }}>{wantedBusy ? 'กำลังบันทึก...' : 'เพิ่มในรายการตามหา 🔔'}</button>
            <button className="btn btn-ghost" style={{ marginTop: 8 }} onClick={() => setShowWantedForm(false)}>ยกเลิก</button>
          </div>
        </div>
      )}

      {contactListing && (() => {
        const sellerName = contactListing.users?.display_name || '—'
        const avatarUrl = (contactListing.users as any)?.avatar_url
        const initial = sellerName.slice(0, 1).toUpperCase()
        return (
        <div onClick={() => { setContactListing(null); setContactPII(null) }} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.5)', zIndex: 200, display: 'flex', alignItems: 'flex-end' }}>
          <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 480, margin: '0 auto', background: 'white', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: '10px 20px 28px', maxHeight: '92vh', overflowY: 'auto' }}>
            {/* Drag handle */}
            <div style={{ width: 40, height: 4, borderRadius: 999, background: '#CBD5E1', margin: '0 auto 14px' }} />

            {/* Seller header */}
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', paddingBottom: 16, borderBottom: '1px solid #F1F5F9' }}>
              {avatarUrl ? (
                <img src={avatarUrl} alt={sellerName} style={{ width: 44, height: 44, borderRadius: 999, objectFit: 'cover' }} />
              ) : (
                <div style={{ width: 44, height: 44, borderRadius: 999, background: '#DBEAFE', display: 'grid', placeItems: 'center' }}>
                  <span style={{ fontSize: 17, fontWeight: 700, color: '#1D4ED8' }}>{initial}</span>
                </div>
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: '#0F172A' }}>{sellerName}</div>
                  {contactListing.users?.is_verified && (
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#2563EB" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><path d="m9 12 2 2 4-4" /></svg>
                  )}
                </div>
                <div style={{ fontSize: 12, color: '#64748B', marginTop: 1 }}>
                  ฿{contactListing.price} · {contactListing.price_includes_shipping ? 'ส่งฟรี' : 'ไม่รวมส่ง'}
                </div>
              </div>
              <button
                onClick={() => { setContactListing(null); setContactPII(null) }}
                aria-label="ปิด"
                style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: '#94A3B8', lineHeight: 1, padding: 4 }}
              >
                ✕
              </button>
            </div>

            {/* Disclaimer */}
            <div style={{ padding: '14px 0 4px', fontSize: 12, color: '#64748B', lineHeight: 1.5 }}>
              ติดต่อผู้ขายด้วยตัวเองตามช่องทางด้านล่าง BookMatch ไม่รับฝากชำระเงิน
            </div>

            {/* LINE cards — keep multi-LINE support */}
            {allLines.map((line, i) => line && (
              <div key={line.raw} style={{ marginTop: 10 }}>
                {allLines.length > 1 && (
                  <div style={{ fontSize: 11, color: '#94A3B8', marginBottom: 4, fontWeight: 600 }}>LINE ({i + 1})</div>
                )}
                <a
                  href={line.addUrl} target="_blank" rel="noopener noreferrer"
                  style={{
                    width: '100%', padding: '14px 16px', background: '#06C755', color: 'white',
                    border: 'none', borderRadius: 12, fontFamily: 'Kanit', fontSize: 15, fontWeight: 700,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                    textDecoration: 'none', boxShadow: '0 2px 6px rgba(6,199,85,.25)',
                  }}
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="white"><path d="M12 2C6.48 2 2 5.85 2 10.6c0 2.77 1.56 5.22 3.98 6.82v3.32c0 .32.35.51.62.34l3.77-2.4c.53.07 1.07.12 1.63.12 5.52 0 10-3.85 10-8.6S17.52 2 12 2z" /></svg>
                  ส่ง LINE หาผู้ขาย
                </a>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, padding: '0 4px' }}>
                  <div style={{ flex: 1, fontSize: 13, color: '#64748B', wordBreak: 'break-all' }}>ID: {line.display}</div>
                  <button
                    onClick={() => navigator.clipboard.writeText(line.raw).then(() => show('คัดลอก LINE ID แล้ว'))}
                    style={{ background: 'none', border: 'none', color: '#2563EB', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'Kanit', padding: '2px 8px' }}
                  >
                    คัดลอก
                  </button>
                </div>
              </div>
            ))}

            {/* Phone cards — keep multi-phone support */}
            {allPhones.map((ph, i) => (
              <div key={ph} style={{ marginTop: 10 }}>
                {allPhones.length > 1 && (
                  <div style={{ fontSize: 11, color: '#94A3B8', marginBottom: 4, fontWeight: 600 }}>เบอร์โทร ({i + 1})</div>
                )}
                <a
                  href={`tel:${ph}`}
                  style={{
                    width: '100%', padding: '12px 16px', background: '#F1F5F9', color: '#0F172A',
                    border: 'none', borderRadius: 12, fontFamily: 'Kanit', fontSize: 14, fontWeight: 600,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                    textDecoration: 'none',
                  }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#0F172A" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" /></svg>
                  โทร {ph.length === 10 ? `${ph.slice(0,3)}-${ph.slice(3,6)}-${ph.slice(6)}` : ph}
                </a>
              </div>
            ))}

            {/* Fallback — other contact info */}
            {allLines.length === 0 && allPhones.length === 0 && contactListing?.contact && (
              <div style={{ marginTop: 10, background: '#F1F5F9', borderRadius: 12, padding: '12px 14px' }}>
                <div style={{ fontSize: 11, color: '#64748B', marginBottom: 4, fontWeight: 600 }}>ช่องทางติดต่อ</div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, wordBreak: 'break-all', color: '#0F172A' }}>{contactListing.contact}</div>
                  <button
                    onClick={() => navigator.clipboard.writeText(contactListing.contact).then(() => show('คัดลอกแล้ว'))}
                    style={{ flexShrink: 0, background: 'white', border: '1px solid #E5E7EB', borderRadius: 8, padding: '6px 12px', color: '#2563EB', fontFamily: 'Kanit', fontWeight: 600, fontSize: 12, cursor: 'pointer' }}
                  >
                    คัดลอก
                  </button>
                </div>
              </div>
            )}

            {/* Copy link — help seller know which book */}
            <button
              onClick={() => navigator.clipboard.writeText(window.location.href).then(() => setCopied(true))}
              style={{
                width: '100%', padding: '12px 16px', marginTop: 14,
                background: copied ? '#DCFCE7' : '#F1F5F9',
                color: copied ? '#166534' : '#0F172A',
                border: copied ? '1px solid #86EFAC' : 'none', borderRadius: 12,
                fontFamily: 'Kanit', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                transition: 'all .2s',
              }}
            >
              {copied ? '✓ คัดลอกลิงก์แล้ว — ส่งให้ผู้ขาย' : '🔗 คัดลอกลิงก์หนังสือเล่มนี้'}
            </button>

            <button
              onClick={() => { setContactListing(null); setContactPII(null) }}
              style={{
                width: '100%', padding: '12px 16px', marginTop: 6,
                background: 'transparent', color: '#94A3B8', border: 'none',
                fontFamily: 'Kanit', fontSize: 13, fontWeight: 500, cursor: 'pointer',
              }}
            >
              ปิด
            </button>
          </div>
        </div>
        )
      })()}

      {lightbox && (() => {
        const nextPhoto = () => setLightbox(prev => prev ? { ...prev, index: (prev.index + 1) % prev.photos.length } : null)
        const prevPhoto = () => setLightbox(prev => prev ? { ...prev, index: (prev.index - 1 + prev.photos.length) % prev.photos.length } : null)
        // Touch swipe state — track start position + threshold 50px
        const SWIPE_THRESHOLD = 50
        let touchStartX = 0
        let touchStartY = 0
        const onTouchStart = (e: React.TouchEvent) => {
          touchStartX = e.touches[0].clientX
          touchStartY = e.touches[0].clientY
        }
        const onTouchEnd = (e: React.TouchEvent) => {
          const dx = e.changedTouches[0].clientX - touchStartX
          const dy = e.changedTouches[0].clientY - touchStartY
          // ignore vertical swipes (scroll intent)
          if (Math.abs(dy) > Math.abs(dx)) return
          if (Math.abs(dx) < SWIPE_THRESHOLD) return
          if (dx < 0) nextPhoto(); else prevPhoto()
        }
        return (
        <div
          onClick={() => setLightbox(null)}
          onTouchStart={lightbox.photos.length > 1 ? onTouchStart : undefined}
          onTouchEnd={lightbox.photos.length > 1 ? onTouchEnd : undefined}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.92)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', touchAction: 'pan-y' }}
        >
          <button
            onClick={() => setLightbox(null)}
            aria-label="ปิด"
            style={{ position: 'absolute', top: 16, right: 16, background: 'rgba(255,255,255,.15)', border: 'none', borderRadius: '50%', width: 44, height: 44, color: 'white', fontSize: 18, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2 }}
          >
            ✕
          </button>
          <img
            onClick={e => e.stopPropagation()}
            src={lightbox.photos[lightbox.index]}
            alt={`รูป ${lightbox.index + 1}`}
            style={{ maxWidth: '92vw', maxHeight: '88vh', borderRadius: 10, objectFit: 'contain', userSelect: 'none' }}
            draggable={false}
          />
          {lightbox.photos.length > 1 && (
            <>
              {/* Prev */}
              <button
                onClick={e => { e.stopPropagation(); setLightbox(prev => prev ? { ...prev, index: (prev.index - 1 + prev.photos.length) % prev.photos.length } : null) }}
                aria-label="ก่อนหน้า"
                style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', background: 'rgba(255,255,255,.15)', border: 'none', borderRadius: '50%', width: 44, height: 44, color: 'white', fontSize: 22, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2 }}
              >
                ‹
              </button>
              {/* Next */}
              <button
                onClick={e => { e.stopPropagation(); setLightbox(prev => prev ? { ...prev, index: (prev.index + 1) % prev.photos.length } : null) }}
                aria-label="ถัดไป"
                style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'rgba(255,255,255,.15)', border: 'none', borderRadius: '50%', width: 44, height: 44, color: 'white', fontSize: 22, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2 }}
              >
                ›
              </button>
              {/* Dots indicator */}
              <div style={{ position: 'absolute', bottom: 20, left: 0, right: 0, display: 'flex', justifyContent: 'center', gap: 6, zIndex: 2 }}>
                {lightbox.photos.map((_, i) => (
                  <span
                    key={i}
                    style={{
                      width: 8, height: 8, borderRadius: '50%',
                      background: i === lightbox.index ? 'white' : 'rgba(255,255,255,.4)',
                      transition: 'background .15s',
                    }}
                  />
                ))}
              </div>
              {/* Counter */}
              <div style={{ position: 'absolute', top: 24, left: 20, color: 'white', fontSize: 14, fontFamily: 'Kanit', fontWeight: 600, background: 'rgba(0,0,0,.4)', padding: '4px 10px', borderRadius: 12 }}>
                {lightbox.index + 1} / {lightbox.photos.length}
              </div>
              {/* Swipe hint — แสดงครั้งแรกที่เปิด lightbox */}
              <div style={{ position: 'absolute', top: 24, right: 80, color: 'rgba(255,255,255,0.6)', fontSize: 11, fontFamily: 'Kanit' }}>
                ← ปัดเพื่อเปลี่ยนรูป →
              </div>
            </>
          )}
        </div>
        )
      })()}

      <div className="page" style={{ padding: 0, background: '#F8FAFC' }}>
        {/* ─── Book header: cover + info + price summary ─── */}
        <div style={{ padding: '18px 18px 16px', background: 'white' }}>
          <div style={{ display: 'flex', gap: 14 }}>
            <div style={{ width: 108, aspectRatio: '3/4', borderRadius: 8, overflow: 'hidden', boxShadow: '0 4px 12px rgba(15,23,42,0.12)', flexShrink: 0 }}>
              <BookCover coverUrl={book.cover_url} isbn={isbn} title={book.title} size={108} />
            </div>
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
              <div style={{ fontSize: 17, fontWeight: 700, color: '#0F172A', lineHeight: 1.3, letterSpacing: '-0.01em' }}>
                {book.title}
              </div>
              {book.author && (
                <div style={{ fontSize: 13, color: '#64748B', marginTop: 4, lineHeight: 1.4 }}>
                  {book.author}
                </div>
              )}
              {book.translator && (
                <div style={{ fontSize: 12, color: '#94A3B8', marginTop: 2 }}>
                  แปลโดย {book.translator}
                </div>
              )}
              {(book.publisher || book.language) && (
                <div style={{ fontSize: 12, color: '#94A3B8', marginTop: 2 }}>
                  {book.publisher}{book.publisher && book.language ? ' · ' : ''}{book.language === 'th' ? 'ไทย' : book.language === 'en' ? 'อังกฤษ' : book.language}
                </div>
              )}

              {/* Price summary card */}
              {prices.length > 0 && (
                <div style={{ marginTop: 10, padding: '10px 12px', borderRadius: 12, background: 'linear-gradient(135deg, #EEF2FF 0%, #DBEAFE 100%)', border: '1px solid #C7D2FE' }}>
                  <div style={{ fontSize: 10.5, fontWeight: 600, color: '#4338CA', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                    ราคาในระบบ
                  </div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 3 }}>
                    <div style={{ fontSize: 22, fontWeight: 800, color: '#1D4ED8', letterSpacing: '-0.02em', lineHeight: 1 }}>
                      ฿{minP}
                    </div>
                    {minP !== maxP && (
                      <div style={{ fontSize: 12, color: '#4338CA', fontWeight: 500 }}>
                        ถึง ฿{maxP}
                      </div>
                    )}
                  </div>
                  <div style={{ fontSize: 11, color: '#4338CA', marginTop: 2 }}>
                    เฉลี่ย ฿{avgP}{lastSold && ` · ขายล่าสุด ฿${lastSold.price}`}
                  </div>
                </div>
              )}

              {/* ชื่อไม่ถูกต้อง? — subtle text link */}
              <button
                onClick={() => {
                  const correct = prompt(`ชื่อหนังสือปัจจุบัน: "${book.title}"\n\nกรอกชื่อที่ถูกต้อง:`)
                  if (!correct?.trim()) return
                  fetch('/api/books/report-name', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ bookId: book.id, isbn, currentTitle: book.title, suggestedTitle: correct.trim() }),
                  }).then(() => show('ส่งแล้ว ขอบคุณที่ช่วยแก้ไข!')).catch(() => show('ส่งไม่สำเร็จ'))
                }}
                style={{ background: 'none', border: 'none', fontSize: 11, color: '#94A3B8', cursor: 'pointer', padding: '6px 0 0', fontFamily: 'Kanit', textAlign: 'left', textDecoration: 'underline' }}
              >
                ชื่อไม่ถูกต้อง?
              </button>
            </div>
          </div>

          {/* Quick stats row: ตามหา / ลงขาย / เข้าดู */}
          <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
            <div style={{ flex: 1, padding: '10px 12px', borderRadius: 12, background: '#F8FAFC', border: '1px solid #EEF2F7' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#B45309" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /></svg>
                <div style={{ fontSize: 10.5, color: '#92400E', fontWeight: 600, letterSpacing: '0.02em' }}>ตามหา</div>
              </div>
              <div style={{ fontSize: 18, fontWeight: 700, color: '#0F172A', marginTop: 1, lineHeight: 1 }}>{book.wanted_count || 0} คน</div>
            </div>
            <div style={{ flex: 1, padding: '10px 12px', borderRadius: 12, background: '#F8FAFC', border: '1px solid #EEF2F7' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#16A34A" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20.59 13.41 13.42 20.58a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" /><circle cx="7" cy="7" r="1.5" fill="#16A34A" stroke="none" /></svg>
                <div style={{ fontSize: 10.5, color: '#166534', fontWeight: 600, letterSpacing: '0.02em' }}>ลงขาย</div>
              </div>
              <div style={{ fontSize: 18, fontWeight: 700, color: '#0F172A', marginTop: 1, lineHeight: 1 }}>{listings.length} ราย</div>
            </div>
            <div style={{ flex: 1, padding: '10px 12px', borderRadius: 12, background: '#F8FAFC', border: '1px solid #EEF2F7' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#64748B" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>
                <div style={{ fontSize: 10.5, color: '#475569', fontWeight: 600, letterSpacing: '0.02em' }}>เข้าดู</div>
              </div>
              <div style={{ fontSize: 18, fontWeight: 700, color: '#0F172A', marginTop: 1, lineHeight: 1 }}>{((book as any).view_count || 0).toLocaleString()}</div>
            </div>
          </div>
        </div>

        {/* ─── Wanted toggle card (yellow when active) ─── */}
        <div style={{ padding: '12px 16px 4px' }}>
          <button
            type="button"
            onClick={toggleWanted}
            disabled={wantedBusy}
            style={{
              width: '100%', display: 'flex', alignItems: 'center', gap: 12,
              padding: '12px 14px', borderRadius: 14,
              background: isWanted ? '#FEF9C3' : 'white',
              border: isWanted ? '1px solid #FDE68A' : '1px solid #E5E7EB',
              cursor: wantedBusy ? 'wait' : 'pointer', fontFamily: 'Kanit', textAlign: 'left',
              opacity: wantedBusy ? 0.7 : 1,
            }}
          >
            <div style={{ width: 38, height: 38, borderRadius: 10, background: isWanted ? '#FBBF24' : '#F1F5F9', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={isWanted ? 'white' : '#64748B'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /></svg>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#0F172A', lineHeight: 1.3 }}>
                {isWanted ? 'กำลังตามหาอยู่' : 'กดตามหาเล่มนี้'}
              </div>
              <div style={{ fontSize: 11.5, color: isWanted ? '#92400E' : '#64748B', marginTop: 2, lineHeight: 1.4 }}>
                {isWanted ? 'เดี๋ยวมีคนลง จะส่ง LINE ไปให้เลย' : 'มีคนลง เราส่งแจ้งเตือนผ่าน LINE ให้'}
              </div>
            </div>
            <div style={{ width: 38, height: 22, borderRadius: 999, position: 'relative', background: isWanted ? 'var(--primary)' : '#E5E7EB', flexShrink: 0, transition: 'background 0.2s' }}>
              <div style={{ position: 'absolute', top: 2, left: isWanted ? 18 : 2, width: 18, height: 18, borderRadius: 999, background: 'white', boxShadow: '0 1px 3px rgba(0,0,0,0.2)', transition: 'left 0.2s' }} />
            </div>
          </button>
        </div>

        {/* ─── "ขายเล่มนี้" secondary CTA ─── */}
        <div style={{ padding: '0 16px 4px' }}>
          <button
            onClick={goSell}
            style={{ width: '100%', background: '#16A34A', border: 'none', borderRadius: 12, padding: '12px 16px', minHeight: 48, color: 'white', fontFamily: 'Kanit', fontWeight: 700, fontSize: 14, cursor: 'pointer', boxShadow: '0 2px 8px rgba(22,163,74,.25)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
          >
            💰 ฉันมีเล่มนี้ — ลงขายเลย
          </button>
        </div>

        <div style={{ padding: '18px 16px 4px' }}>
          {listings.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 10 }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#0F172A', letterSpacing: '-0.01em' }}>
                มีคนลงขาย {listings.length} ราย
              </div>
              <div style={{ fontSize: 12, fontWeight: 500, color: '#64748B', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                เรียงตามราคา
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#64748B" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
              </div>
            </div>
          )}

          {listings.length === 0 && (
            <>
              {/* สถานะ: ยังไม่มีผู้ขาย + ประวัติราคา (ถ้ามี) */}
              <div style={{ background: '#FEF9C3', border: '1px solid #FDE047', borderRadius: 12, padding: '14px 16px', marginBottom: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 22, flexShrink: 0 }}>📭</span>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: '#713F12' }}>ยังไม่มีผู้ลงขายตอนนี้</div>
                    {lastSold ? (
                      <div style={{ fontSize: 13, color: '#92400E', marginTop: 2 }}>
                        ขายครั้งล่าสุดในราคา <b>฿{lastSold.price}</b> — กดตามหาเพื่อรับแจ้งเตือน
                      </div>
                    ) : (
                      <div style={{ fontSize: 13, color: '#92400E', marginTop: 2 }}>กดตามหาเล่มนี้เพื่อรับแจ้งเตือนเมื่อมีคนนำมาขาย</div>
                    )}
                  </div>
                </div>
              </div>

              {/* CTA ส่วนนี้ซ้ำกับปุ่ม wanted toggle + "ขายเล่มนี้" ด้านบน — ตัดออก */}
            </>
          )}

          {/* Strip: ขายล่าสุด (แสดงเมื่อมี active + มี sold history) */}
          {listings.length > 0 && lastSold && (
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 14px', marginBottom: 12, fontSize: 13, color: 'var(--ink2)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 14 }}>📊</span>
              <span>ขายครั้งล่าสุดในราคา <b style={{ color: 'var(--ink)' }}>฿{lastSold.price}</b></span>
            </div>
          )}

          {/* Listings list — "ถูกสุด" badge on cheapest (listings sorted by price asc) */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {listings.map((l, idx) => {
            const sellerName = l.users?.display_name
            const isPioneerListing = pioneerUserId && l.seller_id === pioneerUserId
            const avatarUrl = (l.users as any)?.avatar_url
            const isCheapest = idx === 0 && listings.length > 1
            const allPhotos = (l.photos || []).filter((p: string) => p)
            return (
            <div key={l.id} style={{ background: 'white', borderRadius: 14, border: isCheapest ? '1.5px solid #16A34A' : '1px solid #EEF2F7', overflow: 'hidden', position: 'relative' }}>
              {isCheapest && (
                <div style={{ position: 'absolute', top: 10, right: 10, padding: '3px 8px', borderRadius: 999, background: '#16A34A', fontSize: 10, fontWeight: 700, color: 'white', letterSpacing: '0.02em', zIndex: 1 }}>
                  ถูกสุด
                </div>
              )}

              <div style={{ padding: 14 }}>
                {/* Row 1: avatar + seller + price */}
                <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                  {avatarUrl ? (
                    <img src={avatarUrl} alt={sellerName || ''} style={{ width: 42, height: 42, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
                  ) : (
                    <div style={{ width: 42, height: 42, borderRadius: '50%', background: '#DBEAFE', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                      <span style={{ fontSize: 16, fontWeight: 700, color: '#1D4ED8' }}>
                        {(sellerName || '?').slice(0, 1).toUpperCase()}
                      </span>
                    </div>
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                      <Link href={`/seller/${l.seller_id}`} style={{ fontSize: 14, fontWeight: 600, color: '#0F172A', textDecoration: 'none', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {sellerName}
                      </Link>
                      <TrustBadge user={l.users} size="sm" />
                      {isPioneerListing && <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 5px', borderRadius: 4, background: '#FFFBEB', color: '#92400E', border: '1px solid #FDE68A' }}>🏆 ผู้บุกเบิก</span>}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 6 }}>
                      <div style={{ fontSize: 22, fontWeight: 800, color: '#1D4ED8', letterSpacing: '-0.02em', lineHeight: 1 }}>
                        ฿{l.price}
                      </div>
                      <div style={{ fontSize: 11.5, fontWeight: 600, color: l.price_includes_shipping ? '#16A34A' : '#64748B' }}>
                        {l.price_includes_shipping ? 'ส่งฟรี' : 'ไม่รวมส่ง'}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Row 2: condition + photos count */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
                  <CondBadge cond={l.condition} />
                  {allPhotos.length > 0 && (
                    <span style={{ fontSize: 11, color: '#64748B' }}>{allPhotos.length} รูป</span>
                  )}
                </div>

                {/* Row 3: photos thumbs */}
                {allPhotos.length > 0 && (
                  <div style={{ display: 'flex', gap: 4, marginTop: 10 }}>
                    {allPhotos.slice(0, 4).map((p: string, i: number) => {
                      const isLastVisible = i === 3
                      const extra = allPhotos.length - 4
                      const showOverlay = isLastVisible && extra > 0
                      return (
                        <div
                          key={i}
                          onClick={() => setLightbox({ photos: allPhotos, index: i })}
                          style={{ width: 64, height: 64, borderRadius: 8, border: '1px solid #EEF2F7', overflow: 'hidden', cursor: 'zoom-in', position: 'relative', background: '#F8FAFC', flexShrink: 0 }}
                        >
                          <img src={p} alt={`รูป ${i + 1}`} loading="lazy" decoding="async" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                          {showOverlay && (
                            <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: 13, fontWeight: 700 }}>
                              +{extra}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}

                {/* Row 4: notes */}
                {l.notes && !l.notes.includes('ค่าส่งประมาณ') && (
                  <div style={{ fontSize: 12.5, color: '#475569', marginTop: 10, lineHeight: 1.5, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                    {l.notes}
                  </div>
                )}

                {/* Contact button — dark (design spec) */}
                <button
                  disabled={contactLoading}
                  onClick={async () => {
                    // ไม่ต้อง require login — เพิ่ม conversion
                    // (กัน scrape ด้วย rate limit ฝั่ง API + bot UA block)
                    setCopied(false)
                    setContactLoading(true)
                    try {
                      const [ci] = await Promise.all([
                        fetch(`/api/listings/contact-info?seller_id=${l.seller_id}&listing_id=${l.id}`).then(r => r.json()).catch(() => ({})),
                        fetch('/api/listings/contact', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ listing_id: l.id, book_id: book?.id, seller_id: l.seller_id }),
                        }).catch(() => {}),
                      ])
                      setContactPII(ci)
                      setContactListing(l)
                    } finally {
                      setContactLoading(false)
                    }
                  }}
                  style={{ marginTop: 10, width: '100%', padding: '10px 12px', background: '#0F172A', color: 'white', border: 'none', borderRadius: 10, fontFamily: 'Kanit', fontSize: 13, fontWeight: 600, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, cursor: contactLoading ? 'wait' : 'pointer', opacity: contactLoading ? 0.7 : 1 }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
                  ติดต่อผู้ขาย
                </button>
              </div>
            </div>
            )
          })}
          </div>
        </div>
        <div style={{ height: 20 }} />
      </div>
      <BottomNav />
    </>
  )
}
