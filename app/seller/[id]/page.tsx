'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { supabase, Listing, User } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { Nav, BottomNav, BookCover, CondBadge, SkeletonList, useToast, Toast, LoginModal } from '@/components/ui'

interface PageProps {
  params: { id: string }
}

const REPORT_REASONS = [
  { key: 'scam',          label: '💰 หลอกโอนเงิน / ไม่ส่งของ' },
  { key: 'fake_book',     label: '📕 หนังสือไม่ตรงปก / ปลอม' },
  { key: 'no_ship',       label: '📦 รับเงินแล้วไม่ส่ง' },
  { key: 'inappropriate', label: '⚠️ ขายของผิดกฎ / ไม่เหมาะสม' },
  { key: 'other',         label: '❓ อื่นๆ' },
]

export default function SellerPage({ params }: PageProps) {
  const { id } = params
  const { user } = useAuth()
  const [seller, setSeller] = useState<User | null>(null)
  const [listings, setListings] = useState<Listing[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [contactListing, setContactListing] = useState<Listing | null>(null)
  const [copied, setCopied] = useState(false)
  const [showReport, setShowReport] = useState(false)
  const [reportReason, setReportReason] = useState('')
  const [reportDetails, setReportDetails] = useState('')
  const [reportSubmitting, setReportSubmitting] = useState(false)
  const [showLogin, setShowLogin] = useState(false)
  const { msg, show } = useToast()

  // contact ของแต่ละ listing — ถ้าเป็นเบอร์โทรเปิด tel: ได้, ถ้าไม่ใช่ใช้คัดลอก
  const isPhone = (s?: string) => !!s && /^(\+?66|0)[0-9\s\-]{7,12}$/.test(s.trim())
  const sellerLineId = seller?.line_id?.trim() || ''
  const contactValue = contactListing?.contact?.trim() || ''
  const showSellerLine = sellerLineId && sellerLineId !== contactValue

  const submitReport = async () => {
    if (!user) { setShowLogin(true); return }
    if (!reportReason) { show('กรุณาเลือกเหตุผล'); return }
    setReportSubmitting(true)
    try {
      const r = await fetch('/api/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reportedUserId: id,
          reporterUserId: user.id,
          reason: reportReason,
          details: reportDetails,
        }),
      })
      if (!r.ok) {
        const data = await r.json().catch(() => ({}))
        if (data.error === 'already reported recently') show('คุณรายงานผู้ขายนี้ไปแล้วในช่วง 24 ชั่วโมง')
        else show('ส่งรายงานไม่สำเร็จ ลองใหม่')
      } else {
        show('ขอบคุณที่แจ้ง — ทีมงานจะตรวจสอบโดยเร็ว 🙏')
        setShowReport(false)
        setReportReason('')
        setReportDetails('')
      }
    } finally {
      setReportSubmitting(false)
    }
  }

  // แปลงวันที่เข้าร่วมเป็นข้อความสั้นๆ
  const memberSince = (createdAt?: string): string => {
    if (!createdAt) return '—'
    const days = Math.floor((Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60 * 24))
    if (days < 1) return 'วันนี้'
    if (days < 7) return `${days} วัน`
    if (days < 30) return `${Math.floor(days / 7)} สัปดาห์`
    if (days < 365) return `${Math.floor(days / 30)} เดือน`
    return `${Math.floor(days / 365)} ปี`
  }

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
      {showLogin && <LoginModal onClose={() => setShowLogin(false)} onDone={() => setShowLogin(false)} />}

      {showReport && (
        <div onClick={() => setShowReport(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.6)', zIndex: 200, display: 'flex', alignItems: 'flex-end' }}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'white', borderRadius: '18px 18px 0 0', padding: '24px 20px 32px', width: '100%', maxWidth: 480, margin: '0 auto', maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <div style={{ fontFamily: "'Kanit', sans-serif", fontSize: 22, fontWeight: 700, color: '#121212', letterSpacing: '-0.02em' }}>🚨 รายงานผู้ขาย</div>
              <button onClick={() => setShowReport(false)} style={{ background: 'none', border: 'none', fontSize: 24, cursor: 'pointer', color: 'var(--ink3)', minWidth: 44, minHeight: 44 }}>✕</button>
            </div>
            <div style={{ fontSize: 14, color: 'var(--ink3)', lineHeight: 1.6, marginBottom: 18 }}>
              ทีมงานจะตรวจสอบและระงับบัญชีหากพบความผิดจริง
            </div>

            <div style={{ marginBottom: 16 }}>
              <label className="label">เหตุผล</label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {REPORT_REASONS.map(r => (
                  <button key={r.key} onClick={() => setReportReason(r.key)} style={{
                    padding: '14px 16px',
                    minHeight: 48,
                    borderRadius: 12,
                    border: `2px solid ${reportReason === r.key ? 'var(--red)' : 'var(--border)'}`,
                    background: reportReason === r.key ? '#FEF2F2' : 'white',
                    fontFamily: 'Kanit',
                    fontSize: 15,
                    fontWeight: 500,
                    color: reportReason === r.key ? '#DC2626' : 'var(--ink)',
                    cursor: 'pointer',
                    textAlign: 'left',
                  }}>
                    {r.label}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ marginBottom: 20 }}>
              <label className="label">รายละเอียดเพิ่มเติม (ไม่บังคับ)</label>
              <textarea
                value={reportDetails}
                onChange={e => setReportDetails(e.target.value)}
                placeholder="เช่น โอนเงินไปแล้วไม่ได้รับของ ติดต่อไม่ได้..."
                rows={4}
                maxLength={500}
                style={{
                  width: '100%',
                  fontFamily: 'Kanit',
                  fontSize: 15,
                  lineHeight: 1.5,
                  padding: '12px 14px',
                  borderRadius: 12,
                  border: '1.5px solid var(--border)',
                  resize: 'vertical',
                  outline: 'none',
                  color: 'var(--ink)',
                }}
              />
              <div style={{ fontSize: 12, color: 'var(--ink3)', marginTop: 4, textAlign: 'right' }}>{reportDetails.length}/500</div>
            </div>

            <button
              className="btn"
              onClick={submitReport}
              disabled={reportSubmitting || !reportReason}
              style={{ background: '#DC2626', marginBottom: 8 }}
            >
              {reportSubmitting ? <><span className="spin" />กำลังส่ง...</> : '🚨 ส่งรายงาน'}
            </button>
            <button className="btn btn-ghost" onClick={() => setShowReport(false)}>ยกเลิก</button>
          </div>
        </div>
      )}

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

        <div style={{ background: 'var(--primary)', padding: '20px 16px', display: 'flex', gap: 14, alignItems: 'flex-start' }}>
          <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'rgba(255,255,255,.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, border: '2px solid rgba(255,255,255,.3)', flexShrink: 0 }}>{seller?.seller_type === 'store' ? '🏪' : '👤'}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: "'Kanit', sans-serif", fontSize: 20, fontWeight: 700, color: 'white', lineHeight: 1.3, letterSpacing: '-0.02em', marginBottom: 4 }}>{seller?.display_name}</div>
            {(seller as any)?.phone_verified_at && (seller as any)?.phone && (
              <div style={{ fontSize: 13, color: 'rgba(255,255,255,.85)', marginBottom: 6, lineHeight: 1.5 }}>
                📱 {(seller as any).phone.slice(0, 3)}-xxx-{(seller as any).phone.slice(-4)}
              </div>
            )}
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,.75)', marginBottom: 8, lineHeight: 1.5 }}>
              ขายไปแล้ว {seller?.sold_count || 0} ครั้ง
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {(seller as any)?.id_verified_at && <span className="badge" style={{ background: '#10B981', color: 'white' }}>✅ ยืนยันตัวตน</span>}
              {(seller as any)?.phone_verified_at && !(seller as any)?.id_verified_at && <span className="badge" style={{ background: 'rgba(255,255,255,.25)', color: 'white' }}>📱 ยืนยันเบอร์</span>}
              {seller?.is_pioneer && <span className="badge" style={{ background: 'rgba(255,255,255,.2)', color: 'white' }}>🏆 ผู้บุกเบิก</span>}
            </div>
          </div>
          <button
            onClick={() => setShowReport(true)}
            style={{
              background: 'rgba(255,255,255,.15)',
              border: '1px solid rgba(255,255,255,.3)',
              borderRadius: 10,
              padding: '8px 12px',
              minHeight: 40,
              color: 'white',
              fontFamily: 'Kanit',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
              flexShrink: 0,
              whiteSpace: 'nowrap',
            }}
            title="รายงานผู้ขาย"
          >
            🚨 รายงาน
          </button>
        </div>

        <div style={{ background: 'var(--surface)', padding: '18px 16px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-around' }}>
          <div style={{ textAlign: 'center' }}><div className="stat-n">{listings.length}</div><div className="stat-l">กำลังขาย</div></div>
          <div style={{ textAlign: 'center' }}><div className="stat-n">{seller?.sold_count || 0}</div><div className="stat-l">ขายไปแล้ว</div></div>
          <div style={{ textAlign: 'center' }}>
            <div className="stat-n" style={{ fontSize: 18 }}>{memberSince(seller?.created_at)}</div>
            <div className="stat-l">เข้าร่วมเมื่อ</div>
          </div>
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
