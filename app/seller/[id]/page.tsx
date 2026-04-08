'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { supabase, Listing, User } from '@/lib/supabase'
import { Nav, BottomNav, BookCover, CondBadge, SkeletonList } from '@/components/ui'

interface PageProps {
  params: { id: string }
}

export default function SellerPage({ params }: PageProps) {
  const { id } = params
  const [seller, setSeller] = useState<User | null>(null)
  const [listings, setListings] = useState<Listing[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)

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
            // ใช้รูปจริงที่ผู้ขายอัปโหลด (photos[0]) ถ้ามี — fallback เป็น cover ของหนังสือ
            const displayImage = l.photos?.[0] || l.books?.cover_url
            return (
              <Link key={l.id} href={`/book/${l.books?.isbn}`} style={{ textDecoration: 'none', color: 'inherit' }}>
                <div className="card">
                  <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
                    <BookCover coverUrl={displayImage} title={l.books?.title} size={64} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="book-title" style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{l.books?.title}</div>
                      {l.books?.author && <div className="book-author">{l.books.author}</div>}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8, flexWrap: 'wrap' }}>
                        <span className="price">฿{l.price}</span>
                        <CondBadge cond={l.condition} />
                      </div>
                    </div>
                  </div>
                </div>
              </Link>
            )
          })}
        </div>
        <div style={{ height: 12 }} />
      </div>
      <BottomNav />
    </>
  )
}
