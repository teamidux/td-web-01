'use client'
import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { supabase, Book, Listing, CONDITIONS } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { Nav, BottomNav, BookCover, CondBadge, useToast, Toast, SkeletonList, TrustBadge } from '@/components/ui'
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
      {contactLoading && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.6)', zIndex: 180, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div style={{ background: 'white', borderRadius: 18, padding: '32px 28px', textAlign: 'center', maxWidth: 300, width: '100%' }}>
            <span className="spin" style={{ width: 28, height: 28, marginBottom: 12 }} />
            <div style={{ fontFamily: "'Kanit', sans-serif", fontSize: 15, fontWeight: 700 }}>กำลังโหลดข้อมูลติดต่อ...</div>
            <div style={{ fontSize: 13, color: 'var(--ink3)', marginTop: 4 }}>รอสักครู่</div>
          </div>
        </div>
      )}

      {/* Wanted busy overlay — ตามหา/ลบตามหา */}
      {wantedBusy && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.6)', zIndex: 180, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div style={{ background: 'white', borderRadius: 18, padding: '32px 28px', textAlign: 'center', maxWidth: 300, width: '100%' }}>
            <span className="spin" style={{ width: 28, height: 28, marginBottom: 12 }} />
            <div style={{ fontFamily: "'Kanit', sans-serif", fontSize: 15, fontWeight: 700 }}>กำลังบันทึก...</div>
          </div>
        </div>
      )}

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

            {/* LINE cards — แสดงทุก LINE ID (deduplicated) */}
            {allLines.map((line, i) => line && (
              <div key={line.raw} style={{ background: '#F0FFF4', border: '1px solid #BBF7D0', borderRadius: 12, padding: '14px 16px', marginBottom: 10 }}>
                <div style={{ fontSize: 13, color: 'var(--ink3)', marginBottom: 6 }}>💚 LINE {allLines.length > 1 ? `(${i + 1})` : ''}</div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 10 }}>
                  <div style={{ fontSize: 16, fontWeight: 700, wordBreak: 'break-all', color: '#15803D' }}>{line.display}</div>
                  <button onClick={() => navigator.clipboard.writeText(line.raw).then(() => show('คัดลอก LINE ID แล้ว'))} style={{ flexShrink: 0, background: 'white', border: '1px solid #BBF7D0', borderRadius: 8, padding: '8px 14px', color: '#15803D', fontFamily: 'Kanit', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
                    คัดลอก
                  </button>
                </div>
                <a href={line.addUrl} target="_blank" rel="noopener noreferrer" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, width: '100%', background: '#06C755', border: 'none', borderRadius: 10, padding: '12px 16px', color: 'white', fontFamily: 'Kanit', fontWeight: 700, fontSize: 14, textDecoration: 'none', boxShadow: '0 2px 6px rgba(6,199,85,.25)' }}>
                  💚 เพิ่มเพื่อนใน LINE
                </a>
              </div>
            ))}

            {/* Phone cards — แสดงทุกเบอร์โทร (deduplicated) */}
            {allPhones.map((ph, i) => (
              <div key={ph} style={{ background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 12, padding: '14px 16px', marginBottom: 10 }}>
                <div style={{ fontSize: 13, color: 'var(--ink3)', marginBottom: 6 }}>📞 เบอร์โทร {allPhones.length > 1 ? `(${i + 1})` : ''}</div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                  <div style={{ fontSize: 16, fontWeight: 700, wordBreak: 'break-all' }}>{ph.length === 10 ? `${ph.slice(0,3)}-${ph.slice(3,6)}-${ph.slice(6)}` : ph}</div>
                  <a href={`tel:${ph}`} style={{ flexShrink: 0, background: 'var(--primary)', borderRadius: 8, padding: '8px 14px', color: 'white', fontFamily: 'Kanit', fontWeight: 700, fontSize: 13, textDecoration: 'none' }}>
                    โทรเลย
                  </a>
                </div>
              </div>
            ))}

            {/* Fallback — contact field ไม่ใช่ทั้ง LINE/เบอร์ (เช่น ข้อความทั่วไป) */}
            {allLines.length === 0 && allPhones.length === 0 && contactListing?.contact && (
              <div style={{ background: 'var(--surface)', borderRadius: 12, padding: '14px 16px', marginBottom: 10 }}>
                <div style={{ fontSize: 13, color: 'var(--ink3)', marginBottom: 6 }}>💬 ช่องทางติดต่อ</div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                  <div style={{ fontSize: 16, fontWeight: 700, wordBreak: 'break-all' }}>{contactListing.contact}</div>
                  <button onClick={() => navigator.clipboard.writeText(contactListing.contact).then(() => show('คัดลอกแล้ว'))} style={{ flexShrink: 0, background: 'var(--primary-light)', border: '1px solid var(--primary)', borderRadius: 8, padding: '8px 14px', color: 'var(--primary)', fontFamily: 'Kanit', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
                    คัดลอก
                  </button>
                </div>
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
        <div onClick={() => setLightbox(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.92)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
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
            style={{ maxWidth: '92vw', maxHeight: '88vh', borderRadius: 10, objectFit: 'contain' }}
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
            </>
          )}
        </div>
      )}

      <div className="page" style={{ padding: 0, background: '#F8FAFC' }}>
        {/* ─── Top bar: back / ISBN / share ─── */}
        <div style={{ height: 52, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 14px', background: 'white', borderBottom: '1px solid #F1F5F9' }}>
          <button
            onClick={goBack}
            aria-label="กลับ"
            style={{ width: 36, height: 36, borderRadius: 999, border: 'none', background: '#F1F5F9', display: 'grid', placeItems: 'center', cursor: 'pointer' }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#334155" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
          </button>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#64748B', letterSpacing: '-0.005em' }}>
            ISBN {isbn}
          </div>
          <button
            onClick={() => {
              const url = window.location.href
              if (navigator.share) {
                navigator.share({ title: book.title, url }).catch(() => {})
              } else {
                navigator.clipboard.writeText(url).then(() => show('คัดลอกลิงก์แล้ว'))
              }
            }}
            aria-label="แชร์"
            style={{ width: 36, height: 36, borderRadius: 999, border: 'none', background: '#F1F5F9', display: 'grid', placeItems: 'center', cursor: 'pointer' }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#334155" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
              <polyline points="16 6 12 2 8 6" />
              <line x1="12" y1="2" x2="12" y2="15" />
            </svg>
          </button>
        </div>

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

        <div className="section">
          {listings.length > 0 && (
            <div className="section-title" style={{ marginBottom: 12 }}>{listings.length} คนกำลังขายอยู่</div>
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

              {/* Primary CTA: ตามหาเล่มนี้ (capture demand) */}
              {!isWanted && (
                <button
                  onClick={toggleWanted}
                  style={{
                    width: '100%',
                    background: 'var(--primary)',
                    border: 'none',
                    borderRadius: 12,
                    padding: '16px',
                    color: 'white',
                    fontFamily: 'Kanit',
                    fontWeight: 700,
                    fontSize: 16,
                    cursor: 'pointer',
                    marginBottom: 12,
                    boxShadow: '0 4px 14px rgba(22,163,74,.25)',
                  }}
                >
                  🔔 ตามหาเล่มนี้ — แจ้งเตือนเมื่อมีคนมาขาย
                </button>
              )}

              {/* Secondary: เชิญชวนลงขาย */}
              <div style={{ background: 'var(--primary-light)', border: '1.5px solid var(--primary)', borderRadius: 12, padding: '16px 18px', marginBottom: 14 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--primary-dark)', marginBottom: 4 }}>คุณมีหนังสือเล่มนี้อยู่ไหม?</div>
                <div style={{ fontSize: 13, color: 'var(--ink)', marginBottom: 14, lineHeight: 1.7 }}>
                  มีคนรอซื้ออยู่แล้ว — เป็นคนแรกที่ลงขาย โอกาสขายได้เร็วมาก
                </div>
                <button className="btn" onClick={goSell} style={{ width: '100%' }}>📖 ลงขายเล่มนี้เลย</button>
              </div>
            </>
          )}

          {/* Strip: ขายล่าสุด (แสดงเมื่อมี active + มี sold history) */}
          {listings.length > 0 && lastSold && (
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 14px', marginBottom: 12, fontSize: 13, color: 'var(--ink2)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 14 }}>📊</span>
              <span>ขายครั้งล่าสุดในราคา <b style={{ color: 'var(--ink)' }}>฿{lastSold.price}</b></span>
            </div>
          )}

          {/* ป้ายผู้บุกเบิก — ผูกกับ pioneerUserId (คนแรกที่เคยลงเล่มนี้) */}
          {listings.map(l => {
            const sellerName = l.users?.display_name
            const isPioneerListing = pioneerUserId && l.seller_id === pioneerUserId
            const avatarUrl = (l.users as any)?.avatar_url
            return (
            <div key={l.id} className="card" style={{ padding: 0, overflow: 'hidden' }}>
              {/* Header: ผู้ขาย + ราคา */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderBottom: '1px solid var(--border-light)' }}>
                {avatarUrl ? (
                  <img src={avatarUrl} alt={sellerName || ''} style={{ width: 36, height: 36, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
                ) : (
                  <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'var(--primary-light)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, flexShrink: 0 }}>👤</div>
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <Link href={`/seller/${l.seller_id}`} style={{ fontSize: 14, fontWeight: 600, color: 'var(--primary)', textDecoration: 'none' }}>
                    {sellerName}
                  </Link>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap', marginTop: 2 }}>
                    <TrustBadge user={l.users} size="sm" />
                    {isPioneerListing && <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 5px', borderRadius: 4, background: '#FFFBEB', color: '#92400E', border: '1px solid #FDE68A' }}>🏆 ผู้บุกเบิกเล่มนี้</span>}
                  </div>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--primary)', letterSpacing: '-0.02em' }}>฿{l.price}</div>
                  <div style={{ fontSize: 12, color: l.price_includes_shipping ? 'var(--green)' : 'var(--ink3)', fontWeight: 600 }}>{l.price_includes_shipping ? 'ส่งฟรี' : 'ไม่รวมส่ง'}</div>
                </div>
              </div>

              {/* Body: รูป + สภาพ + notes */}
              <div style={{ padding: '10px 14px' }}>
                <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                  {/* รูปหนังสือ — โชว์ 2 thumb, รูปที่ 2 มี "+N" badge ถ้าเกิน */}
                  {(() => {
                    const allPhotos = (l.photos || []).filter((p: string) => p)
                    if (allPhotos.length === 0) return null
                    const visible = allPhotos.slice(0, 2)
                    const extra = allPhotos.length - 2
                    return (
                      <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                        {visible.map((p: string, i: number) => {
                          const isLastVisible = i === visible.length - 1
                          const showOverlay = isLastVisible && extra > 0
                          return (
                            <div
                              key={i}
                              onClick={() => setLightbox({ photos: allPhotos, index: i })}
                              style={{ width: 52, height: 72, borderRadius: 6, border: '1px solid var(--border)', overflow: 'hidden', cursor: 'zoom-in', position: 'relative', background: 'var(--surface)' }}
                            >
                              <img src={p} alt={`รูป ${i + 1}`} loading="lazy" decoding="async" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                              {showOverlay && (
                                <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: 14, fontWeight: 700, fontFamily: 'Kanit' }}>
                                  +{extra}
                                </div>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    )
                  })()}
                  {/* สภาพ + notes */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <CondBadge cond={l.condition} />
                    {l.notes && !l.notes.includes('ค่าส่งประมาณ') && (
                      <div style={{ fontSize: 12, color: 'var(--ink2)', marginTop: 6, lineHeight: 1.5 }}>
                        {l.notes}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Footer: ปุ่มติดต่อ */}
              <button
                disabled={contactLoading}
                onClick={async () => {
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
                style={{ width: '100%', background: 'var(--primary)', border: 'none', borderTop: 'none', borderRadius: '0 0 12px 12px', padding: '11px 16px', color: 'white', fontFamily: 'Kanit', fontWeight: 700, fontSize: 14, cursor: contactLoading ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, opacity: contactLoading ? 0.7 : 1 }}
              >
                💬 ติดต่อผู้ขาย
              </button>
            </div>
          )})}
        </div>
        <div style={{ height: 12 }} />
      </div>
      <BottomNav />
    </>
  )
}
