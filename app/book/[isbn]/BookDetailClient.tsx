'use client'
import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { supabase, Book, Listing, CONDITIONS } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { Nav, BottomNav, BookCover, CondBadge, useToast, Toast, SkeletonList, TrustBadge } from '@/components/ui'
import { parseLineId } from '@/lib/line-id'

export default function BookDetailClient({ isbn, initialBook }: { isbn: string; initialBook?: Partial<Book> | null }) {
  const { user, loginWithLine } = useAuth()
  const [book, setBook] = useState<Book | null>((initialBook as Book) ?? null)
  const [listings, setListings] = useState<Listing[]>([])
  const [isWanted, setIsWanted] = useState(false)
  const [loading, setLoading] = useState(true)
  // showLogin removed — login goes directly to LINE OAuth
  const [showWantedForm, setShowWantedForm] = useState(false)
  const [wantedPrice, setWantedPrice] = useState('')
  const [lightbox, setLightbox] = useState('')
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
      const res = await fetch(`/api/listings?book_id=${bookId}`)
      const { listings } = await res.json()
      setListings(listings || [])
    } catch (err) {
      console.error('[loadListings]', err)
      setListings([])
    }
  }

  const loadData = async (cancelled = false) => {
    setLoading(true)

    // ใช้ initialBook จาก server ถ้ามี id (= อยู่ใน DB แล้ว) → ไม่ต้อง query ซ้ำ
    // ถ้าไม่มี id (= มาจาก Google Books) หรือไม่มีเลย → query DB เพื่อเช็คว่ามีใครเพิ่มไปแล้วหรือยัง
    const bookId = (initialBook as any)?.id
    const dbBook = bookId
      ? initialBook // server ส่งมาจาก DB แล้ว ใช้เลย
      : (await supabase.from('books').select('*').eq('isbn', isbn).maybeSingle()).data
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
    // ไม่ต้องเรียก Google ซ้ำ — server ทำไปแล้ว
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
      // ลบ wanted ผ่าน API (กัน anon key abuse)
      await fetch('/api/wanted', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ book_id: book.id }) })
      const newCount = Math.max(0, (book.wanted_count || 1) - 1)
      setIsWanted(false)
      setBook(b => b ? { ...b, wanted_count: newCount } : b)
      show('ลบออกจากรายการตามหาแล้ว')
    } else {
      setShowWantedForm(true)
    }
  }

  const confirmWanted = async () => {
    if (!user) return
    const bookId = await ensureBookInDB()
    if (!bookId) { show('เกิดข้อผิดพลาด ลองใหม่อีกครั้ง'); return }
    // เพิ่ม wanted ผ่าน API (กัน anon key abuse)
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
  }

  const contactPhone = contactListing ? /^(\+?66|0)[0-9\s\-]{7,12}$/.test(contactListing.contact?.trim() || '') : false
  // ตรวจว่า contact field เป็น LINE ID มั้ย → ถ้าใช่ มีปุ่ม Add LINE
  const contactLineInfo = contactListing && !contactPhone ? parseLineId(contactListing.contact || '') : null
  // LINE ID จาก profile (ดึงจาก contactPII ที่ fetch แยก — ต้อง login)
  const contactProfileLine = contactPII?.line_id?.trim() || ''
  const profileLineInfo = contactProfileLine ? parseLineId(contactProfileLine) : null
  // แสดง LINE ID จาก profile เสมอถ้ามี (แม้จะซ้ำกับ contact field — เพื่อให้มีปุ่ม Add LINE)
  const showProfileLine = !!profileLineInfo

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
        <Link href="/" className="back-btn">← กลับ</Link>
        <div style={{ padding: '0 16px 80px' }}>
          <div style={{ background: '#FEF9C3', border: '1px solid #FDE047', borderRadius: 12, padding: '14px 16px', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 22, flexShrink: 0 }}>🔍</span>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#713F12' }}>ยังไม่มีข้อมูลหนังสือเล่มนี้ในระบบ</div>
              <div style={{ fontSize: 13, color: '#92400E', marginTop: 2 }}>ISBN: {isbn}</div>
            </div>
          </div>
          <div style={{ background: 'var(--primary-light)', border: '1.5px solid var(--primary)', borderRadius: 12, padding: '16px 18px' }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--primary-dark)', marginBottom: 4 }}>คุณมีหนังสือเล่มนี้อยู่ไหม?</div>
            <div style={{ fontSize: 13, color: 'var(--ink)', marginBottom: 14, lineHeight: 1.7 }}>
              ลงขายและเพิ่มข้อมูลหนังสือเล่มนี้เข้าระบบ — เป็นคนแรกที่ขาย โอกาสขายได้เร็วมาก
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
            <button className="btn" onClick={confirmWanted}>เพิ่มในรายการตามหา 🔔</button>
            <button className="btn btn-ghost" style={{ marginTop: 8 }} onClick={() => setShowWantedForm(false)}>ยกเลิก</button>
          </div>
        </div>
      )}

      {contactListing && (
        <div onClick={() => { setContactListing(null); setContactPII(null) }} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.6)', zIndex: 200, display: 'flex', alignItems: 'flex-end' }}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'white', borderRadius: '18px 18px 0 0', padding: '24px 20px 40px', width: '100%', maxWidth: 480, margin: '0 auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <div style={{ fontFamily: "'Kanit', sans-serif", fontSize: 18 }}>ข้อมูลผู้ขาย</div>
              <button onClick={() => { setContactListing(null); setContactPII(null) }} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--ink3)', lineHeight: 1 }}>✕</button>
            </div>

            <div style={{ background: 'var(--surface)', borderRadius: 12, padding: '14px 16px', marginBottom: 12 }}>
              <div style={{ fontSize: 13, color: 'var(--ink3)', marginBottom: 4 }}>ผู้ขาย</div>
              <div style={{ fontSize: 15, fontWeight: 700 }}>{contactListing.users?.display_name || '—'}</div>
              {contactListing.users?.is_verified && <span className="badge badge-blue" style={{ marginTop: 4, display: 'inline-block' }}>✓ Verified</span>}
            </div>

            {/* Main contact: phone, LINE, หรือ generic text */}
            {contactLineInfo ? (
              <div style={{ background: '#F0FFF4', border: '1px solid #BBF7D0', borderRadius: 12, padding: '14px 16px', marginBottom: showProfileLine ? 10 : 16 }}>
                <div style={{ fontSize: 13, color: 'var(--ink3)', marginBottom: 6 }}>💚 LINE ID</div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 10 }}>
                  <div style={{ fontSize: 16, fontWeight: 700, wordBreak: 'break-all', color: '#15803D' }}>{contactLineInfo.display}</div>
                  <button onClick={() => navigator.clipboard.writeText(contactLineInfo.raw).then(() => show('คัดลอก LINE ID แล้ว'))} style={{ flexShrink: 0, background: 'white', border: '1px solid #BBF7D0', borderRadius: 8, padding: '8px 14px', color: '#15803D', fontFamily: 'Kanit', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
                    คัดลอก
                  </button>
                </div>
                <a href={contactLineInfo.addUrl} target="_blank" rel="noopener noreferrer" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, width: '100%', background: '#06C755', border: 'none', borderRadius: 10, padding: '12px 16px', color: 'white', fontFamily: 'Kanit', fontWeight: 700, fontSize: 14, textDecoration: 'none', boxShadow: '0 2px 6px rgba(6,199,85,.25)' }}>
                  💚 เพิ่มเพื่อนใน LINE
                </a>
              </div>
            ) : (
              <div style={{ background: 'var(--surface)', borderRadius: 12, padding: '14px 16px', marginBottom: showProfileLine ? 10 : 16 }}>
                <div style={{ fontSize: 13, color: 'var(--ink3)', marginBottom: 6 }}>{contactPhone ? '📞 เบอร์โทร' : '💬 ช่องทางติดต่อ'}</div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                  <div style={{ fontSize: 16, fontWeight: 700, wordBreak: 'break-all' }}>{contactListing.contact}</div>
                  {contactPhone ? (
                    <a href={`tel:${contactListing.contact.replace(/\s/g, '')}`} style={{ flexShrink: 0, background: 'var(--primary)', borderRadius: 8, padding: '8px 14px', color: 'white', fontFamily: 'Kanit', fontWeight: 700, fontSize: 13, textDecoration: 'none' }}>
                      โทรเลย
                    </a>
                  ) : (
                    <button onClick={() => navigator.clipboard.writeText(contactListing.contact).then(() => show('คัดลอกแล้ว'))} style={{ flexShrink: 0, background: 'var(--primary-light)', border: '1px solid var(--primary)', borderRadius: 8, padding: '8px 14px', color: 'var(--primary)', fontFamily: 'Kanit', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
                      คัดลอก
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Profile LINE ID (รองจาก contact field) — แสดงถ้าต่างจาก contact ที่กรอก */}
            {showProfileLine && profileLineInfo && (
              <div style={{ background: '#F0FFF4', border: '1px solid #BBF7D0', borderRadius: 12, padding: '14px 16px', marginBottom: 16 }}>
                <div style={{ fontSize: 13, color: 'var(--ink3)', marginBottom: 6 }}>💚 LINE ผู้ขาย</div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 10 }}>
                  <div style={{ fontSize: 16, fontWeight: 700, wordBreak: 'break-all', color: '#15803D' }}>{profileLineInfo.display}</div>
                  <button onClick={() => navigator.clipboard.writeText(profileLineInfo.raw).then(() => show('คัดลอก LINE ID แล้ว'))} style={{ flexShrink: 0, background: 'white', border: '1px solid #BBF7D0', borderRadius: 8, padding: '8px 14px', color: '#15803D', fontFamily: 'Kanit', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
                    คัดลอก
                  </button>
                </div>
                <a href={profileLineInfo.addUrl} target="_blank" rel="noopener noreferrer" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, width: '100%', background: '#06C755', border: 'none', borderRadius: 10, padding: '12px 16px', color: 'white', fontFamily: 'Kanit', fontWeight: 700, fontSize: 14, textDecoration: 'none', boxShadow: '0 2px 6px rgba(6,199,85,.25)' }}>
                  💚 เพิ่มเพื่อนใน LINE
                </a>
              </div>
            )}

            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16 }}>
              <div style={{ fontSize: 13, color: 'var(--ink3)', marginBottom: 8 }}>ส่งลิงก์หนังสือนี้ให้ผู้ขาย เพื่อให้รู้ว่าคุณสนใจเล่มไหน</div>
              <button
                onClick={() => navigator.clipboard.writeText(window.location.href).then(() => setCopied(true))}
                style={{ width: '100%', background: copied ? 'var(--green-bg)' : 'var(--primary-light)', border: `1px solid ${copied ? 'var(--green)' : 'var(--primary)'}`, borderRadius: 10, padding: '11px 16px', fontFamily: 'Kanit', fontWeight: 700, fontSize: 14, color: copied ? 'var(--green)' : 'var(--primary)', cursor: 'pointer', transition: 'all .2s' }}
              >
                {copied ? '✓ คัดลอกลิงก์แล้ว' : '🔗 คัดลอกลิงก์หนังสือนี้'}
              </button>
            </div>
          </div>
        </div>
      )}

      {lightbox && (
        <div onClick={() => setLightbox('')} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.88)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <button onClick={() => setLightbox('')} style={{ position: 'absolute', top: 16, right: 16, background: 'rgba(255,255,255,.15)', border: 'none', borderRadius: '50%', width: 36, height: 36, color: 'white', fontSize: 18, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
          <img onClick={e => e.stopPropagation()} src={lightbox} alt="" style={{ maxWidth: '92vw', maxHeight: '88vh', borderRadius: 10, objectFit: 'contain' }} />
        </div>
      )}

      <div className="page">
        <Link href="/" className="back-btn">← กลับ</Link>

        <div style={{ background: 'var(--primary)', padding: '18px 16px', display: 'flex', gap: 14 }}>
          <BookCover isbn={isbn} title={book.title} size={84} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: "'Kanit', sans-serif", fontSize: 18, fontWeight: 700, color: 'white', lineHeight: 1.3, letterSpacing: '-0.01em', marginBottom: 6 }}>{book.title}</div>
            {book.author && (
              <div style={{ fontSize: 14, fontWeight: 500, color: 'rgba(255,255,255,.92)', lineHeight: 1.5, marginBottom: 2 }}>
                <span style={{ opacity: 0.7 }}>ผู้เขียน </span>{book.author}
              </div>
            )}
            {book.translator && (
              <div style={{ fontSize: 13, fontWeight: 500, color: 'rgba(255,255,255,.85)', lineHeight: 1.5, marginBottom: 2 }}>
                <span style={{ opacity: 0.7 }}>แปลโดย </span>{book.translator}
              </div>
            )}
            <div style={{ fontSize: 13, color: '#BFDBFE', fontWeight: 600, letterSpacing: '0.02em', marginTop: 4, marginBottom: 12 }}>ISBN: {isbn}</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button onClick={toggleWanted} style={{ background: isWanted ? 'white' : 'rgba(255,255,255,.15)', border: '1px solid rgba(255,255,255,.3)', borderRadius: 10, padding: '10px 14px', minHeight: 44, fontFamily: 'Kanit', fontWeight: 600, fontSize: 13, color: isWanted ? 'var(--primary)' : 'white', cursor: 'pointer' }}>
                {isWanted ? '✕ เลิกตามหา' : '🔔 ตามหาเล่มนี้'}
              </button>
              <button onClick={goSell} style={{ background: '#16A34A', border: 'none', borderRadius: 10, padding: '10px 16px', minHeight: 44, fontFamily: 'Kanit', fontWeight: 700, fontSize: 13, color: 'white', cursor: 'pointer', boxShadow: '0 2px 8px rgba(22,163,74,.3)' }}>
                💰 ขายเล่มนี้
              </button>
            </div>
          </div>
        </div>

        {prices.length > 0 && (
          <div style={{ background: 'var(--surface)', padding: '12px 16px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-around' }}>
            <div style={{ textAlign: 'center' }}><div className="price">฿{minP}</div><div style={{ fontSize: 13, color: 'var(--ink3)' }}>ต่ำสุด</div></div>
            <div style={{ textAlign: 'center' }}><div className="price">฿{avgP}</div><div style={{ fontSize: 13, color: 'var(--ink3)' }}>กลาง</div></div>
            <div style={{ textAlign: 'center' }}><div className="price">฿{maxP}</div><div style={{ fontSize: 13, color: 'var(--ink3)' }}>สูงสุด</div></div>
            <div style={{ textAlign: 'center' }}><div className="price">{book.wanted_count || 0}</div><div style={{ fontSize: 13, color: 'var(--ink3)' }}>คนตามหา</div></div>
          </div>
        )}

        <div className="section">
          {listings.length > 0 && (
            <div className="section-title" style={{ marginBottom: 12 }}>{listings.length} คนกำลังขายอยู่</div>
          )}

          {listings.length === 0 && (
            <>
              {/* สถานะ: ยังไม่มีผู้ขาย */}
              <div style={{ background: '#FEF9C3', border: '1px solid #FDE047', borderRadius: 12, padding: '14px 16px', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 22, flexShrink: 0 }}>📭</span>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#713F12' }}>ยังไม่มีผู้ลงขายตอนนี้</div>
                  <div style={{ fontSize: 13, color: '#92400E', marginTop: 2 }}>กด "ตามหาเล่มนี้" เพื่อรับแจ้งเตือนเมื่อมีคนนำมาขาย</div>
                </div>
              </div>

              {/* เชิญชวนลงขาย */}
              <div style={{ background: 'var(--primary-light)', border: '1.5px solid var(--primary)', borderRadius: 12, padding: '16px 18px', marginBottom: 14 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--primary-dark)', marginBottom: 4 }}>คุณมีหนังสือเล่มนี้อยู่ไหม?</div>
                <div style={{ fontSize: 13, color: 'var(--ink)', marginBottom: 14, lineHeight: 1.7 }}>
                  มีคนรอซื้ออยู่แล้ว — เป็นคนแรกที่ลงขาย โอกาสขายได้เร็วมาก
                </div>
                <button className="btn" onClick={goSell} style={{ width: '100%' }}>📖 ลงขายเล่มนี้เลย</button>
              </div>
            </>
          )}

          {listings.map(l => {
            const sellerName = l.users?.display_name
            const avatarUrl = (l.users as any)?.avatar_url
            return (
            <div key={l.id} className="card">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                {avatarUrl ? (
                  <img src={avatarUrl} alt={sellerName || ''} style={{ width: 38, height: 38, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
                ) : (
                  <div style={{ width: 38, height: 38, borderRadius: '50%', background: 'var(--primary-light)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, flexShrink: 0 }}>👤</div>
                )}
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <Link href={`/seller/${l.seller_id}`} style={{ fontSize: 14, fontWeight: 600, color: 'var(--primary)', textDecoration: 'none' }}>
                      {sellerName}
                    </Link>
                    <TrustBadge user={l.users} size="sm" />
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--ink3)', marginTop: 2 }}>
                    {`ขายแล้ว ${l.users?.sold_count || 0} · ยืนยัน ${l.users?.confirmed_count || 0} ครั้ง`}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div className="price">฿{l.price}</div>
                  <CondBadge cond={l.condition} />
                </div>
              </div>

              {l.photos?.length > 0 && (
                <div style={{ display: 'flex', gap: 6, marginBottom: 10, overflowX: 'auto' }}>
                  {l.photos.filter(p => p).map((p, i) => (
                    <div key={i} onClick={() => setLightbox(p)} style={{ width: 60, height: 90, borderRadius: 8, border: '1px solid var(--border)', overflow: 'hidden', flexShrink: 0, cursor: 'zoom-in' }}>
                      <img src={p} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    </div>
                  ))}
                </div>
              )}

              {l.notes && (
                <div style={{ fontSize: 13, color: 'var(--ink2)', background: 'var(--surface)', borderRadius: 8, padding: '7px 10px', marginBottom: 10, lineHeight: 1.5 }}>
                  📝 {l.notes}
                </div>
              )}

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ fontSize: 13, color: 'var(--ink3)' }}>{l.price_includes_shipping ? '✓ ส่งฟรี' : 'ผู้ซื้อจ่ายค่าส่ง'}</div>
                <button onClick={async () => {
                  setCopied(false)
                  // fetch contact info (line_id, phone) แยก — ต้องรู้ทั้ง listing_id + seller_id
                  const [ciRes] = await Promise.all([
                    fetch(`/api/listings/contact-info?seller_id=${l.seller_id}&listing_id=${l.id}`).then(r => r.json()).catch(() => ({})),
                    fetch('/api/listings/contact', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ listing_id: l.id, book_id: book?.id, seller_id: l.seller_id }),
                    }).catch(() => {}),
                  ])
                  setContactPII(ciRes)
                  setContactListing(l)
                }} style={{ background: 'var(--primary)', border: 'none', borderRadius: 8, padding: '8px 16px', color: 'white', fontFamily: 'Kanit', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
                  ติดต่อ
                </button>
              </div>
            </div>
          )})}
        </div>
        <div style={{ height: 12 }} />
      </div>
      <BottomNav />
    </>
  )
}
