'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { supabase, Listing, User } from '@/lib/supabase'
import { Nav, BottomNav, BookCover, CondBadge, SkeletonList, useToast, Toast } from '@/components/ui'

interface PageProps {
  params: { id: string }
}

export default function SellerPage({ params }: PageProps) {
  const { id } = params
  const [seller, setSeller] = useState<User | null>(null)
  const [listings, setListings] = useState<Listing[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [contactListing, setContactListing] = useState<Listing | null>(null)
  const [copied, setCopied] = useState(false)
  const { msg, show } = useToast()

  // contact ของแต่ละ listing — ถ้าเป็นเบอร์โทรเปิด tel: ได้, ถ้าไม่ใช่ใช้คัดลอก
  const isPhone = (s?: string) => !!s && /^(\+?66|0)[0-9\s\-]{7,12}$/.test(s.trim())
  const sellerLineId = seller?.line_id?.trim() || ''
  const contactValue = contactListing?.contact?.trim() || ''
  const showSellerLine = sellerLineId && sellerLineId !== contactValue

  useEffect(() => {
    const load = async () => {
      const [{ data: u }, { data: ls }] = await Promise.all([
        supabase.from('users').select('*').eq('id', id).single(),
        supabase
          .from('listings')
          .select('*, books(isbn, title, author, cover_url)')
          .eq('seller_id', id)
          .eq('status', 'active')
          .order('created_at', { ascending: false }),
      ])
      setSeller(u)
      setListings(ls || [])
      setLoading(false)
    }
    load()
  }, [id])

  if (loading) return (
    <>
      <Nav />
      <div className="page" style={{ padding: '16px 16px 80px' }}>
        <div style={{ display: 'flex', gap: 14, alignItems: 'center', marginBottom: 20, background: 'var(--surface)', borderRadius: 14, padding: 16 }}>
          <div className="skeleton" style={{ width: 56, height: 56, borderRadius: '50%', flexShrink: 0 }} />
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div className="skeleton" style={{ height: 16, width: '50%' }} />
            <div className="skeleton" style={{ height: 12, width: '35%' }} />
          </div>
        </div>
        <SkeletonList count={4} />
      </div>
    </>
  )

  return (
    <>
      <Nav />
      <Toast msg={msg} />

      {contactListing && (
        <div onClick={() => setContactListing(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.6)', zIndex: 200, display: 'flex', alignItems: 'flex-end' }}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'white', borderRadius: '18px 18px 0 0', padding: '24px 20px 40px', width: '100%', maxWidth: 480, margin: '0 auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <div style={{ fontFamily: "'Kanit', sans-serif", fontSize: 22, fontWeight: 700, color: '#121212', letterSpacing: '-0.02em' }}>ข้อมูลผู้ขาย</div>
              <button onClick={() => setContactListing(null)} style={{ background: 'none', border: 'none', fontSize: 24, cursor: 'pointer', color: 'var(--ink3)', lineHeight: 1, minWidth: 44, minHeight: 44 }}>✕</button>
            </div>

            {/* หนังสือที่กำลังติดต่อ */}
            <div style={{ background: 'var(--surface)', borderRadius: 12, padding: '12px 14px', marginBottom: 14, display: 'flex', gap: 12, alignItems: 'center' }}>
              <BookCover coverUrl={contactListing.photos?.[0]} isbn={!contactListing.photos?.[0] ? contactListing.books?.isbn : undefined} title={contactListing.books?.title} size={48} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#121212', lineHeight: 1.35, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{contactListing.books?.title}</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: '#1D4ED8', marginTop: 2 }}>฿{contactListing.price}</div>
              </div>
            </div>

            <div style={{ background: 'var(--surface)', borderRadius: 12, padding: '14px 16px', marginBottom: 12 }}>
              <div style={{ fontSize: 13, color: 'var(--ink3)', marginBottom: 4 }}>ผู้ขาย</div>
              <div style={{ fontSize: 16, fontWeight: 600 }}>{seller?.display_name || '—'}</div>
              {seller?.is_verified && <span className="badge badge-blue" style={{ marginTop: 4, display: 'inline-block' }}>✓ Verified</span>}
            </div>

            <div style={{ background: 'var(--surface)', borderRadius: 12, padding: '14px 16px', marginBottom: showSellerLine ? 10 : 16 }}>
              <div style={{ fontSize: 13, color: 'var(--ink3)', marginBottom: 6 }}>{isPhone(contactValue) ? '📞 เบอร์โทร' : '💬 ช่องทางติดต่อ'}</div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                <div style={{ fontSize: 16, fontWeight: 700, wordBreak: 'break-all' }}>{contactValue}</div>
                {isPhone(contactValue) ? (
                  <a href={`tel:${contactValue.replace(/\s/g, '')}`} style={{ flexShrink: 0, background: 'var(--primary)', borderRadius: 10, padding: '10px 14px', minHeight: 44, color: 'white', fontFamily: 'Kanit', fontWeight: 600, fontSize: 14, textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}>
                    โทรเลย
                  </a>
                ) : (
                  <button onClick={() => navigator.clipboard.writeText(contactValue).then(() => show('คัดลอกแล้ว'))} style={{ flexShrink: 0, background: 'var(--primary-light)', border: '1px solid var(--primary)', borderRadius: 10, padding: '10px 14px', minHeight: 44, color: 'var(--primary)', fontFamily: 'Kanit', fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>
                    คัดลอก
                  </button>
                )}
              </div>
            </div>

            {showSellerLine && (
              <div style={{ background: '#F0FFF4', border: '1px solid #BBF7D0', borderRadius: 12, padding: '14px 16px', marginBottom: 16 }}>
                <div style={{ fontSize: 13, color: 'var(--ink3)', marginBottom: 6 }}>💚 Line ID</div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                  <div style={{ fontSize: 16, fontWeight: 700, wordBreak: 'break-all' }}>{sellerLineId}</div>
                  <button onClick={() => navigator.clipboard.writeText(sellerLineId).then(() => show('คัดลอก Line ID แล้ว'))} style={{ flexShrink: 0, background: '#22C55E', border: 'none', borderRadius: 10, padding: '10px 14px', minHeight: 44, color: 'white', fontFamily: 'Kanit', fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>
                    คัดลอก
                  </button>
                </div>
              </div>
            )}

            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16 }}>
              <div style={{ fontSize: 13, color: 'var(--ink3)', lineHeight: 1.6, marginBottom: 10 }}>ส่งลิงก์หนังสือนี้ให้ผู้ขาย เพื่อให้รู้ว่าคุณสนใจเล่มไหน</div>
              <button
                onClick={() => {
                  const url = `${window.location.origin}/book/${contactListing.books?.isbn}`
                  navigator.clipboard.writeText(url).then(() => setCopied(true))
                }}
                style={{ width: '100%', background: copied ? 'var(--green-bg)' : 'var(--primary-light)', border: `1px solid ${copied ? 'var(--green)' : 'var(--primary)'}`, borderRadius: 12, padding: '14px 16px', minHeight: 48, fontFamily: 'Kanit', fontWeight: 600, fontSize: 15, color: copied ? 'var(--green)' : 'var(--primary)', cursor: 'pointer', transition: 'all .2s' }}
              >
                {copied ? '✓ คัดลอกลิงก์แล้ว' : '🔗 คัดลอกลิงก์หนังสือนี้'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="page">
        <Link href="/" className="back-btn">← กลับ</Link>

        <div style={{ background: 'var(--primary)', padding: '20px 16px', display: 'flex', gap: 14, alignItems: 'center' }}>
          <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'rgba(255,255,255,.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, border: '2px solid rgba(255,255,255,.3)', flexShrink: 0 }}>👤</div>
          <div>
            <div style={{ fontFamily: "'Kanit', sans-serif", fontSize: 20, color: 'white', marginBottom: 3 }}>{seller?.display_name}</div>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,.65)', marginBottom: 6 }}>
              ขายแล้ว {seller?.sold_count || 0} ครั้ง · ยืนยันรับแล้ว {seller?.confirmed_count || 0} ครั้ง
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              {seller?.is_verified && <span className="badge" style={{ background: 'rgba(255,255,255,.2)', color: 'white' }}>✓ Verified</span>}
              {seller?.is_pioneer && <span className="badge" style={{ background: 'rgba(255,255,255,.2)', color: 'white' }}>🏆 ผู้บุกเบิก</span>}
            </div>
          </div>
        </div>

        <div style={{ background: 'var(--surface)', padding: '12px 16px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-around' }}>
          <div style={{ textAlign: 'center' }}><div style={{ fontSize: 18, fontWeight: 700, color: 'var(--primary)' }}>{listings.length}</div><div style={{ fontSize: 11, color: 'var(--ink3)' }}>กำลังขาย</div></div>
          <div style={{ textAlign: 'center' }}><div style={{ fontSize: 18, fontWeight: 700, color: 'var(--primary)' }}>{seller?.sold_count || 0}</div><div style={{ fontSize: 11, color: 'var(--ink3)' }}>ขายแล้ว</div></div>
          <div style={{ textAlign: 'center' }}><div style={{ fontSize: 18, fontWeight: 700, color: 'var(--primary)' }}>{seller?.confirmed_count || 0}</div><div style={{ fontSize: 11, color: 'var(--ink3)' }}>ยืนยันรับแล้ว</div></div>
        </div>

        <div className="section">
          <div className="section-title" style={{ marginBottom: 12 }}>หนังสือที่กำลังขาย ({listings.length} เล่ม)</div>

          {listings.length === 0 && (
            <div className="empty"><div className="empty-icon">📭</div><div>ไม่มีหนังสือที่กำลังขาย</div></div>
          )}

          {listings.length > 0 && (
            <input
              className="input"
              style={{ marginBottom: 12 }}
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="ค้นหาชื่อหนังสือ หรือผู้แต่ง..."
            />
          )}

          {listings.filter(l => {
            if (!query.trim()) return true
            const q = query.toLowerCase()
            return l.books?.title?.toLowerCase().includes(q) || l.books?.author?.toLowerCase().includes(q)
          }).map(l => {
            // ใช้รูปจริงที่ผู้ขายอัปโหลด (photos[0]) ถ้ามี — fallback ใช้ proxy ผ่าน isbn
            return (
              <div key={l.id} className="card">
                <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
                  <Link href={`/book/${l.books?.isbn}`} style={{ flexShrink: 0, textDecoration: 'none' }}>
                    <BookCover coverUrl={l.photos?.[0]} isbn={!l.photos?.[0] ? l.books?.isbn : undefined} title={l.books?.title} size={64} />
                  </Link>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <Link href={`/book/${l.books?.isbn}`} style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}>
                      <div className="book-title" style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{l.books?.title}</div>
                      {l.books?.author && <div className="book-author">{l.books.author}</div>}
                    </Link>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8, flexWrap: 'wrap' }}>
                      <span className="price">฿{l.price}</span>
                      <CondBadge cond={l.condition} />
                    </div>
                    <button
                      onClick={() => { setContactListing(l); setCopied(false) }}
                      style={{
                        marginTop: 12,
                        background: 'var(--primary)',
                        border: 'none',
                        borderRadius: 10,
                        padding: '10px 16px',
                        minHeight: 44,
                        fontFamily: 'Kanit',
                        fontWeight: 600,
                        fontSize: 14,
                        color: 'white',
                        cursor: 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 6,
                        boxShadow: '0 1px 4px rgba(0,0,0,0.10)',
                      }}
                    >
                      💬 ติดต่อผู้ขาย
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
        <div style={{ height: 12 }} />
      </div>
      <BottomNav />
    </>
  )
}
