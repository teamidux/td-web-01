'use client'
import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { supabase, Book, Listing, fetchBookByISBN, CONDITIONS } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { Nav, BottomNav, BookCover, CondBadge, LoginModal, useToast, Toast, SkeletonList } from '@/components/ui'

export default function BookDetailClient({ isbn, initialBook }: { isbn: string; initialBook?: Partial<Book> | null }) {
  const { user } = useAuth()
  const [book, setBook] = useState<Book | null>((initialBook as Book) ?? null)
  const [listings, setListings] = useState<Listing[]>([])
  const [isWanted, setIsWanted] = useState(false)
  const [loading, setLoading] = useState(true)
  const [showLogin, setShowLogin] = useState(false)
  const [showWantedForm, setShowWantedForm] = useState(false)
  const [wantedPrice, setWantedPrice] = useState('')
  const [lightbox, setLightbox] = useState('')
  const [contactListing, setContactListing] = useState<Listing | null>(null)
  const [copied, setCopied] = useState(false)
  const { msg, show } = useToast()
  const bookIdRef = useRef<string | null>(null)

  useEffect(() => { loadData() }, [isbn])

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

  const loadData = async () => {
    setLoading(true)
    const { data: dbBook } = await supabase.from('books').select('*').eq('isbn', isbn).maybeSingle()

    if (!dbBook) {
      // ถ้าไม่อยู่ใน DB แต่มี initialBook จาก server (Google Books) → ใช้ได้เลย ไม่ต้อง fetch ซ้ำ
      if (!book) {
        const fetched = await fetchBookByISBN(isbn)
        if (fetched) setBook(fetched as Book)
      }
    } else {
      setBook(dbBook)
      bookIdRef.current = dbBook.id
      await loadListings(dbBook.id)
      if (user) {
        const { data: w } = await supabase.from('wanted').select('id').eq('user_id', user.id).eq('book_id', dbBook.id).maybeSingle()
        setIsWanted(!!w)
      }
    }
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

  // ถ้า book ยังไม่อยู่ใน DB (มาจาก Google Books) → save ก่อนแล้วคืน bookId
  const ensureBookInDB = async (): Promise<string | null> => {
    if (book?.id) return book.id
    if (!book?.title) return null
    const { data: existing } = await supabase.from('books').select('id').eq('isbn', isbn).maybeSingle()
    if (existing?.id) {
      setBook(b => b ? { ...b, id: existing.id } : b)
      bookIdRef.current = existing.id
      return existing.id
    }
    const { data: newBook, error } = await supabase.from('books').insert({
      isbn,
      title: book.title,
      author: book.author || '',
      publisher: book.publisher || '',
      cover_url: book.cover_url || '',
      language: book.language || 'th',
      source: 'community',
    }).select('id').single()
    if (error || !newBook) return null
    setBook(b => b ? { ...b, id: newBook.id } : b)
    bookIdRef.current = newBook.id
    return newBook.id
  }

  const toggleWanted = async () => {
    if (!user) { setShowLogin(true); return }
    if (isWanted && book?.id) {
      // DB trigger จะลด books.wanted_count ให้อัตโนมัติ — แค่ลบ row ใน wanted
      await supabase.from('wanted').delete().eq('user_id', user.id).eq('book_id', book.id)
      const newCount = Math.max(0, (book.wanted_count || 1) - 1)
      setIsWanted(false)
      setBook(b => b ? { ...b, wanted_count: newCount } : b)
      show('ลบออกจาก Wanted List แล้ว')
    } else {
      setShowWantedForm(true)
    }
  }

  const confirmWanted = async () => {
    if (!user) return
    const bookId = await ensureBookInDB()
    if (!bookId) { show('เกิดข้อผิดพลาด ลองใหม่อีกครั้ง'); return }
    // DB trigger จะเพิ่ม books.wanted_count ให้อัตโนมัติ — แค่ insert wanted row
    await supabase.from('wanted').insert({
      user_id: user.id,
      book_id: bookId,
      isbn,
      max_price: wantedPrice ? parseFloat(wantedPrice) : null,
      status: 'waiting',
    })
    const newCount = (book?.wanted_count || 0) + 1
    setIsWanted(true)
    setBook(b => b ? { ...b, wanted_count: newCount } : b)
    setShowWantedForm(false)
    show('เพิ่มใน Wanted List แล้ว 🔔')
  }

  const contactPhone = contactListing ? /^(\+?66|0)[0-9\s\-]{7,12}$/.test(contactListing.contact?.trim() || '') : false
  const contactProfileLine = contactListing?.users?.line_id?.trim() || ''
  const showProfileLine = contactProfileLine && contactProfileLine !== (contactListing?.contact?.trim() || '')

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
              <div style={{ fontSize: 12, color: '#92400E', marginTop: 2 }}>ISBN: {isbn}</div>
            </div>
          </div>
          <div style={{ background: 'var(--primary-light)', border: '1.5px solid var(--primary)', borderRadius: 12, padding: '16px 18px' }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--primary-dark)', marginBottom: 4 }}>คุณมีหนังสือเล่มนี้อยู่ไหม?</div>
            <div style={{ fontSize: 13, color: 'var(--ink)', marginBottom: 14, lineHeight: 1.7 }}>
              ลงขายและเพิ่มข้อมูลหนังสือเล่มนี้เข้าระบบ — เป็นคนแรกที่ขาย โอกาสขายได้เร็วมาก
            </div>
            <Link href={`/sell?isbn=${isbn}`}>
              <button className="btn" style={{ width: '100%' }}>📖 ลงขายเล่มนี้เลย</button>
            </Link>
          </div>
        </div>
      </div>
    </>
  )

  return (
    <>
      <Nav />
      <Toast msg={msg} />
      {showLogin && <LoginModal onClose={() => setShowLogin(false)} onDone={() => { setShowLogin(false); loadData() }} />}

      {showWantedForm && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.6)', zIndex: 200, display: 'flex', alignItems: 'flex-end' }} onClick={() => setShowWantedForm(false)}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'white', borderRadius: '18px 18px 0 0', padding: '24px 20px 40px', width: '100%', maxWidth: 480, margin: '0 auto' }}>
            <div style={{ fontFamily: "'Kanit', sans-serif", fontSize: 18, marginBottom: 4 }}>เพิ่มใน Wanted List</div>
            <div style={{ fontSize: 13, color: 'var(--ink3)', marginBottom: 16 }}>เราจะแจ้งเตือนเมื่อมีคนลงขายเล่มนี้</div>
            <div className="form-group">
              <label className="label">ราคาสูงสุดที่ยอมจ่าย (ไม่บังคับ)</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontWeight: 700, color: 'var(--ink3)' }}>฿</span>
                <input className="input" type="number" value={wantedPrice} onChange={e => setWantedPrice(e.target.value)} placeholder="เช่น 200" />
              </div>
            </div>
            <button className="btn" onClick={confirmWanted}>เพิ่มใน Wanted List 🔔</button>
            <button className="btn btn-ghost" style={{ marginTop: 8 }} onClick={() => setShowWantedForm(false)}>ยกเลิก</button>
          </div>
        </div>
      )}

      {contactListing && (
        <div onClick={() => setContactListing(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.6)', zIndex: 200, display: 'flex', alignItems: 'flex-end' }}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'white', borderRadius: '18px 18px 0 0', padding: '24px 20px 40px', width: '100%', maxWidth: 480, margin: '0 auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <div style={{ fontFamily: "'Kanit', sans-serif", fontSize: 18 }}>ข้อมูลผู้ขาย</div>
              <button onClick={() => setContactListing(null)} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--ink3)', lineHeight: 1 }}>✕</button>
            </div>

            <div style={{ background: 'var(--surface)', borderRadius: 12, padding: '14px 16px', marginBottom: 12 }}>
              <div style={{ fontSize: 12, color: 'var(--ink3)', marginBottom: 4 }}>ผู้ขาย</div>
              <div style={{ fontSize: 15, fontWeight: 700 }}>{contactListing.users?.display_name || '—'}</div>
              {contactListing.users?.is_verified && <span className="badge badge-blue" style={{ marginTop: 4, display: 'inline-block' }}>✓ Verified</span>}
            </div>

            <div style={{ background: 'var(--surface)', borderRadius: 12, padding: '14px 16px', marginBottom: showProfileLine ? 10 : 16 }}>
              <div style={{ fontSize: 12, color: 'var(--ink3)', marginBottom: 6 }}>{contactPhone ? '📞 เบอร์โทร' : '💬 ช่องทางติดต่อ'}</div>
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

            {showProfileLine && (
              <div style={{ background: '#F0FFF4', border: '1px solid #BBF7D0', borderRadius: 12, padding: '14px 16px', marginBottom: 16 }}>
                <div style={{ fontSize: 12, color: 'var(--ink3)', marginBottom: 6 }}>💚 Line ID</div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                  <div style={{ fontSize: 16, fontWeight: 700, wordBreak: 'break-all' }}>{contactProfileLine}</div>
                  <button onClick={() => navigator.clipboard.writeText(contactProfileLine).then(() => show('คัดลอก Line ID แล้ว'))} style={{ flexShrink: 0, background: '#22C55E', border: 'none', borderRadius: 8, padding: '8px 14px', color: 'white', fontFamily: 'Kanit', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
                    คัดลอก
                  </button>
                </div>
              </div>
            )}

            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16 }}>
              <div style={{ fontSize: 12, color: 'var(--ink3)', marginBottom: 8 }}>ส่งลิงก์หนังสือนี้ให้ผู้ขาย เพื่อให้รู้ว่าคุณสนใจเล่มไหน</div>
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
            <div style={{ fontSize: 12, color: '#BFDBFE', fontWeight: 600, letterSpacing: '0.02em', marginTop: 4, marginBottom: 12 }}>ISBN: {isbn}</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button onClick={toggleWanted} style={{ background: isWanted ? 'white' : 'rgba(255,255,255,.15)', border: '1px solid rgba(255,255,255,.3)', borderRadius: 10, padding: '10px 14px', minHeight: 44, fontFamily: 'Kanit', fontWeight: 600, fontSize: 13, color: isWanted ? 'var(--primary)' : 'white', cursor: 'pointer' }}>
                {isWanted ? '🔔 อยู่ใน Wanted' : '🔔 ต้องการเล่มนี้'}
              </button>
              <Link href={`/sell?isbn=${isbn}`}>
                <button style={{ background: 'white', border: 'none', borderRadius: 10, padding: '10px 14px', minHeight: 44, fontFamily: 'Kanit', fontWeight: 600, fontSize: 13, color: 'var(--primary)', cursor: 'pointer' }}>
                  ขายเล่มนี้
                </button>
              </Link>
            </div>
          </div>
        </div>

        {prices.length > 0 && (
          <div style={{ background: 'var(--surface)', padding: '12px 16px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-around' }}>
            <div style={{ textAlign: 'center' }}><div className="price">฿{minP}</div><div style={{ fontSize: 11, color: 'var(--ink3)' }}>ต่ำสุด</div></div>
            <div style={{ textAlign: 'center' }}><div className="price">฿{avgP}</div><div style={{ fontSize: 11, color: 'var(--ink3)' }}>กลาง</div></div>
            <div style={{ textAlign: 'center' }}><div className="price">฿{maxP}</div><div style={{ fontSize: 11, color: 'var(--ink3)' }}>สูงสุด</div></div>
            <div style={{ textAlign: 'center' }}><div className="price">{book.wanted_count || 0}</div><div style={{ fontSize: 11, color: 'var(--ink3)' }}>คนรอซื้อ</div></div>
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
                  <div style={{ fontSize: 12, color: '#92400E', marginTop: 2 }}>กด "ต้องการเล่มนี้" เพื่อรับแจ้งเตือนเมื่อมีคนนำมาขาย</div>
                </div>
              </div>

              {/* เชิญชวนลงขาย */}
              <div style={{ background: 'var(--primary-light)', border: '1.5px solid var(--primary)', borderRadius: 12, padding: '16px 18px', marginBottom: 14 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--primary-dark)', marginBottom: 4 }}>คุณมีหนังสือเล่มนี้อยู่ไหม?</div>
                <div style={{ fontSize: 13, color: 'var(--ink)', marginBottom: 14, lineHeight: 1.7 }}>
                  มีคนรอซื้ออยู่แล้ว — เป็นคนแรกที่ลงขาย โอกาสขายได้เร็วมาก
                </div>
                <Link href={`/sell?isbn=${isbn}`}>
                  <button className="btn" style={{ width: '100%' }}>📖 ลงขายเล่มนี้เลย</button>
                </Link>
              </div>
            </>
          )}

          {listings.map(l => {
            const isStore = (l.users as any)?.seller_type === 'store'
            const sellerName = isStore ? ((l.users as any)?.store_name || l.users?.display_name) : l.users?.display_name
            return (
            <div key={l.id} className="card">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                <div style={{ width: 38, height: 38, borderRadius: '50%', background: isStore ? '#FFF7ED' : 'var(--primary-light)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, flexShrink: 0 }}>{isStore ? '🏪' : '👤'}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Link href={`/seller/${l.seller_id}`} style={{ fontSize: 14, fontWeight: 600, color: 'var(--primary)', textDecoration: 'none' }}>
                      {sellerName}
                    </Link>
                    {l.users?.is_verified && <span className="badge badge-blue">✓ Verified</span>}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--ink3)', marginTop: 2 }}>
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
                    <div key={i} onClick={() => setLightbox(p)} style={{ width: 56, height: 56, borderRadius: 8, border: '1px solid var(--border)', overflow: 'hidden', flexShrink: 0, cursor: 'zoom-in' }}>
                      <img src={p} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    </div>
                  ))}
                </div>
              )}

              {l.notes && (
                <div style={{ fontSize: 12, color: 'var(--ink2)', background: 'var(--surface)', borderRadius: 8, padding: '7px 10px', marginBottom: 10, lineHeight: 1.5 }}>
                  📝 {l.notes}
                </div>
              )}

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ fontSize: 12, color: 'var(--ink3)' }}>{l.price_includes_shipping ? '✓ ส่งฟรี' : 'ผู้ซื้อจ่ายค่าส่ง'}</div>
                <button onClick={() => { setContactListing(l); setCopied(false) }} style={{ background: 'var(--primary)', border: 'none', borderRadius: 8, padding: '8px 16px', color: 'white', fontFamily: 'Kanit', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
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
