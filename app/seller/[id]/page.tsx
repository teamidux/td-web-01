'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { supabase, Listing, User } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { Nav, BottomNav, BookCover, CondBadge, SkeletonList, useToast, Toast, TrustBadge } from '@/components/ui'

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
  const { user, loginWithLine } = useAuth()
  const [seller, setSeller] = useState<User | null>(null)
  const [listings, setListings] = useState<Listing[]>([])
  const [soldListings, setSoldListings] = useState<Listing[]>([])
  const [tab, setTab] = useState<'active' | 'sold'>('active')
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [contactListing, setContactListing] = useState<Listing | null>(null)
  const [copied, setCopied] = useState(false)
  const [contactLoading, setContactLoading] = useState(false)
  const [showReport, setShowReport] = useState(false)
  const [reportReason, setReportReason] = useState('')
  const [reportDetails, setReportDetails] = useState('')
  const [reportSubmitting, setReportSubmitting] = useState(false)
  // showLogin removed — login goes directly to LINE OAuth
  const { msg, show } = useToast()

  // contact ของแต่ละ listing — ถ้าเป็นเบอร์โทรเปิด tel: ได้, ถ้าไม่ใช่ใช้คัดลอก
  const isPhone = (s?: string) => !!s && /^(\+?66|0)[0-9\s\-]{7,12}$/.test(s.trim())
  const [sellerPII, setSellerPII] = useState<{ line_id: string | null; phone: string | null } | null>(null)
  const sellerLineId = sellerPII?.line_id?.trim() || ''
  const sellerPhone = sellerPII?.phone?.trim() || ''
  const contactValue = contactListing?.contact?.trim() || ''
  const showSellerLine = sellerLineId && sellerLineId !== contactValue
  const showSellerPhone = sellerPhone && !(isPhone(contactValue) && contactValue.replace(/\D/g, '') === sellerPhone.replace(/\D/g, ''))
  const formatPhone = (p: string) => { const d = p.replace(/\D/g, ''); return d.length === 10 ? `${d.slice(0,3)}-${d.slice(3,6)}-${d.slice(6)}` : p }

  const submitReport = async () => {
    if (!user) {
      loginWithLine(typeof window !== 'undefined' ? window.location.pathname : `/seller/${id}`)
      return
    }
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
        const err = data.error || ''
        if (err === 'already reported recently') show('คุณรายงานผู้ขายนี้ไปแล้วในช่วง 24 ชั่วโมง')
        else if (err === 'must be logged in to report') show('กรุณา login ก่อนรายงาน')
        else if (err === 'cannot report yourself') show('ไม่สามารถรายงานตัวเองได้')
        else if (err === 'invalid reason') show('กรุณาเลือกเหตุผลที่ถูกต้อง')
        else if (err.includes('relation') || err.includes('column')) show('ระบบ report ยังไม่พร้อม — admin แก้ให้')
        else show('ส่งไม่สำเร็จ: ' + (err || 'unknown'))
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
      const [userRes, { data: active }, { data: sold }] = await Promise.all([
        fetch(`/api/users/${encodeURIComponent(id)}`, { cache: 'no-store' }).then(r => r.ok ? r.json() : null).catch(() => null),
        supabase
          .from('listings')
          .select('*, books(isbn, title, author, cover_url)')
          .eq('seller_id', id)
          .eq('status', 'active')
          .order('created_at', { ascending: false }),
        supabase
          .from('listings')
          .select('*, books(isbn, title, author, cover_url)')
          .eq('seller_id', id)
          .eq('status', 'sold')
          .order('sold_at', { ascending: false })
          .limit(50),
      ])
      setSeller(userRes?.user || null)
      setListings(active || [])
      setSoldListings(sold || [])
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

      {contactLoading && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.6)', zIndex: 180, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: 'white', borderRadius: 18, padding: '36px 24px', textAlign: 'center' }}>
            <span className="spin" style={{ width: 28, height: 28, marginBottom: 12 }} />
            <div style={{ fontFamily: "'Kanit', sans-serif", fontSize: 15, fontWeight: 700 }}>กำลังโหลดข้อมูลติดต่อ...</div>
          </div>
        </div>
      )}

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
              <div style={{ fontSize: 13, color: 'var(--ink3)', marginTop: 4, textAlign: 'right' }}>{reportDetails.length}/500</div>
            </div>

            {/* Honeypot */}
            <input name="website" autoComplete="off" tabIndex={-1} style={{ position: 'absolute', left: -9999, opacity: 0, height: 0 }} id="hp_report" />

            <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 14, cursor: 'pointer' }}>
              <input type="checkbox" id="report_confirm" style={{ marginTop: 3, width: 16, height: 16, accentColor: '#DC2626', flexShrink: 0 }} />
              <span style={{ fontSize: 13, color: '#374151', lineHeight: 1.6 }}>
                ข้าพเจ้ายืนยันว่าข้อมูลที่ให้ไว้เป็นความจริง การรายงานอันเป็นเท็จหรือกลั่นแกล้งอาจถูกระงับบัญชีและอาจเข้าข่ายความผิดตาม พ.ร.บ.คอมพิวเตอร์
              </span>
            </label>

            <button
              className="btn"
              onClick={() => {
                const confirmed = (document.getElementById('report_confirm') as HTMLInputElement)?.checked
                if (!confirmed) { show('กรุณายืนยันว่าข้อมูลเป็นความจริง'); return }
                submitReport()
              }}
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
        <div onClick={() => { setContactListing(null); setSellerPII(null) }} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.6)', zIndex: 200, display: 'flex', alignItems: 'flex-end' }}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'white', borderRadius: '18px 18px 0 0', padding: '24px 20px 40px', width: '100%', maxWidth: 480, margin: '0 auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <div style={{ fontFamily: "'Kanit', sans-serif", fontSize: 22, fontWeight: 700, color: '#121212', letterSpacing: '-0.02em' }}>ข้อมูลผู้ขาย</div>
              <button onClick={() => { setContactListing(null); setSellerPII(null) }} style={{ background: 'none', border: 'none', fontSize: 24, cursor: 'pointer', color: 'var(--ink3)', lineHeight: 1, minWidth: 44, minHeight: 44 }}>✕</button>
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

            {/* เบอร์โทร — จาก contact field หรือ profile */}
            {(isPhone(contactValue) || showSellerPhone) && (
              <div style={{ background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 12, padding: '14px 16px', marginBottom: 10 }}>
                <div style={{ fontSize: 13, color: 'var(--ink3)', marginBottom: 6 }}>📞 เบอร์โทร</div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                  <div style={{ fontSize: 16, fontWeight: 700 }}>{formatPhone(isPhone(contactValue) ? contactValue : sellerPhone)}</div>
                  <a href={`tel:${(isPhone(contactValue) ? contactValue : sellerPhone).replace(/\D/g, '')}`} style={{ flexShrink: 0, background: 'var(--primary)', borderRadius: 10, padding: '10px 14px', minHeight: 44, color: 'white', fontFamily: 'Kanit', fontWeight: 600, fontSize: 14, textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}>
                    โทรเลย
                  </a>
                </div>
              </div>
            )}

            {/* LINE ID — แสดงถ้ามี */}
            {sellerLineId && (
              <div style={{ background: '#F0FFF4', border: '1px solid #BBF7D0', borderRadius: 12, padding: '14px 16px', marginBottom: 10 }}>
                <div style={{ fontSize: 13, color: 'var(--ink3)', marginBottom: 6 }}>💚 LINE</div>
                <div style={{ fontSize: 16, fontWeight: 700, wordBreak: 'break-all', marginBottom: 10 }}>{sellerLineId}</div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => navigator.clipboard.writeText(sellerLineId).then(() => show('คัดลอก LINE ID แล้ว'))} style={{ flex: 1, background: 'white', border: '1px solid #BBF7D0', borderRadius: 10, padding: '10px 14px', minHeight: 44, color: '#15803D', fontFamily: 'Kanit', fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>
                    คัดลอก
                  </button>
                  <a href={`https://line.me/R/ti/p/~${sellerLineId}`} target="_blank" rel="noopener noreferrer" style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, background: '#06C755', border: 'none', borderRadius: 10, padding: '10px 14px', minHeight: 44, color: 'white', fontFamily: 'Kanit', fontWeight: 600, fontSize: 14, textDecoration: 'none' }}>
                    💚 เพิ่มเพื่อน
                  </a>
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

      <div className="page" style={{ padding: 0, background: '#F8FAFC' }}>
        {/* ─── Profile card (design style — white bg) ─── */}
        <div style={{ background: 'white', padding: '22px 18px 18px', maxWidth: 500, margin: '0 auto' }}>
          <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
            <div style={{ width: 72, height: 72, borderRadius: 999, background: '#DBEAFE', display: 'grid', placeItems: 'center', position: 'relative', flexShrink: 0, overflow: 'hidden' }}>
              {(seller as any)?.avatar_url ? (
                <img src={(seller as any).avatar_url} alt={seller?.display_name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
              ) : (
                <span style={{ fontFamily: 'Kanit', fontSize: 28, fontWeight: 700, color: '#1D4ED8' }}>
                  {(seller?.display_name || '?').slice(0, 1).toUpperCase()}
                </span>
              )}
              {(seller as any)?.is_verified && (
                <div style={{ position: 'absolute', bottom: -2, right: -2, width: 22, height: 22, borderRadius: 999, background: '#2563EB', display: 'grid', placeItems: 'center', border: '2px solid white' }}>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                </div>
              )}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 19, fontWeight: 700, color: '#0F172A', letterSpacing: '-0.01em', lineHeight: 1.3 }}>
                {seller?.display_name}
              </div>
              {(seller as any)?.is_verified && (
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 999, background: '#DBEAFE', marginTop: 4 }}>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#2563EB" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><path d="m9 12 2 2 4-4" /></svg>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#1D4ED8', letterSpacing: '0.02em' }}>ยืนยันตัวตนแล้ว</div>
                </div>
              )}
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginTop: (seller as any)?.is_verified ? 6 : 6 }}>
                {!(seller as any)?.is_verified && <TrustBadge user={seller} size="sm" />}
                {((seller as any)?.is_pioneer || (seller as any)?.pioneer_count > 0) && (
                  <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 4, background: '#FFFBEB', color: '#92400E', border: '1px solid #FDE68A' }}>
                    🏆 ผู้บุกเบิก {(seller as any)?.pioneer_count || ''} เล่ม
                  </span>
                )}
              </div>
            </div>
            {/* Report button — ซ่อนถ้าดู profile ตัวเอง */}
            {user?.id !== id && (
              <button
                onClick={() => setShowReport(true)}
                title="รายงานผู้ขาย"
                style={{ background: '#F1F5F9', border: 'none', borderRadius: 999, width: 36, height: 36, display: 'grid', placeItems: 'center', cursor: 'pointer', color: '#64748B', flexShrink: 0 }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
                  <line x1="4" y1="22" x2="4" y2="15" />
                </svg>
              </button>
            )}
          </div>

          {/* Stats row (design style with dividers) */}
          <div style={{ display: 'flex', marginTop: 18, background: '#F8FAFC', borderRadius: 14, padding: '12px 4px' }}>
            <div style={{ flex: 1, textAlign: 'center' }}>
              <div style={{ fontSize: 20, fontWeight: 800, color: '#0F172A', lineHeight: 1, letterSpacing: '-0.02em' }}>
                {listings.length}
              </div>
              <div style={{ fontSize: 11, color: '#64748B', marginTop: 3 }}>กำลังขาย</div>
            </div>
            <div style={{ width: 1, background: '#E5E7EB' }} />
            <div style={{ flex: 1, textAlign: 'center' }}>
              <div style={{ fontSize: 20, fontWeight: 800, color: '#0F172A', lineHeight: 1, letterSpacing: '-0.02em' }}>
                {seller?.sold_count || 0}
              </div>
              <div style={{ fontSize: 11, color: '#64748B', marginTop: 3 }}>ขายแล้ว</div>
            </div>
            <div style={{ width: 1, background: '#E5E7EB' }} />
            <div style={{ flex: 1, textAlign: 'center' }}>
              <div style={{ fontSize: 16, fontWeight: 800, color: '#0F172A', lineHeight: 1, letterSpacing: '-0.02em' }}>
                {memberSince(seller?.created_at)}
              </div>
              <div style={{ fontSize: 11, color: '#64748B', marginTop: 3 }}>เข้าร่วม</div>
            </div>
          </div>

          {/* Share button */}
          <button
            onClick={async () => {
              const url = window.location.href
              const shareData = {
                title: `${seller?.display_name} — ร้านหนังสือบน BookMatch`,
                text: `ดูหนังสือมือสองที่ ${seller?.display_name} กำลังขาย ${listings.length} เล่ม`,
                url,
              }
              try { if (navigator.share) { await navigator.share(shareData); return } } catch {}
              try { await navigator.clipboard.writeText(url); show('คัดลอกลิงก์ร้านแล้ว') }
              catch {
                const ta = document.createElement('textarea')
                ta.value = url; ta.style.position = 'fixed'; ta.style.opacity = '0'
                document.body.appendChild(ta); ta.select()
                document.execCommand('copy'); document.body.removeChild(ta)
                show('คัดลอกลิงก์ร้านแล้ว')
              }
            }}
            style={{
              width: '100%', marginTop: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              background: '#F1F5F9', border: 'none', borderRadius: 12, padding: '11px 16px', minHeight: 44,
              fontFamily: 'Kanit', fontWeight: 600, fontSize: 14, color: '#334155', cursor: 'pointer',
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#334155" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" /><polyline points="16 6 12 2 8 6" /><line x1="12" y1="2" x2="12" y2="15" /></svg>
            แชร์ร้านนี้
          </button>
        </div>

        <div className="section">
          {/* Tabs: แสดง tab "ขายแล้ว" เฉพาะเมื่อมี sold listing */}
          {soldListings.length > 0 ? (
            <div style={{ display: 'flex', gap: 0, borderBottom: '2px solid var(--border)', marginBottom: 14 }}>
              <button
                onClick={() => setTab('active')}
                style={{
                  flex: 1, padding: '12px 0', minHeight: 44, fontSize: 14, fontWeight: 700,
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: tab === 'active' ? 'var(--primary)' : 'var(--ink3)',
                  borderBottom: tab === 'active' ? '2px solid var(--primary)' : '2px solid transparent',
                  marginBottom: -2, fontFamily: 'Kanit',
                }}
              >
                กำลังขาย ({listings.length})
              </button>
              <button
                onClick={() => setTab('sold')}
                style={{
                  flex: 1, padding: '12px 0', minHeight: 44, fontSize: 14, fontWeight: 700,
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: tab === 'sold' ? 'var(--primary)' : 'var(--ink3)',
                  borderBottom: tab === 'sold' ? '2px solid var(--primary)' : '2px solid transparent',
                  marginBottom: -2, fontFamily: 'Kanit',
                }}
              >
                ขายแล้ว ({soldListings.length})
              </button>
            </div>
          ) : (
            <div className="section-title" style={{ marginBottom: 12 }}>หนังสือที่กำลังขาย ({listings.length} เล่ม)</div>
          )}

          {tab === 'active' && listings.length === 0 && (
            <div className="empty"><div className="empty-icon">📚</div><div>ไม่มีหนังสือที่กำลังขาย</div></div>
          )}

          {tab === 'active' && listings.length >= 5 && (
            <input
              className="input"
              style={{ marginBottom: 12 }}
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="ค้นหาชื่อหนังสือ หรือผู้แต่ง..."
            />
          )}

          {tab === 'active' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
            {listings.filter(l => {
              if (!query.trim()) return true
              const q = query.toLowerCase()
              return l.books?.title?.toLowerCase().includes(q) || l.books?.author?.toLowerCase().includes(q)
            }).map(l => {
              return (
                <div key={l.id} onClick={async () => {
                  // Require login — กัน anonymous scrape contact PII
                  if (!user) {
                    loginWithLine(typeof window !== 'undefined' ? window.location.pathname : `/seller/${id}`)
                    return
                  }
                  setCopied(false)
                  setContactLoading(true)
                  const r = await fetch(`/api/listings/contact-info?seller_id=${l.seller_id}&listing_id=${l.id}`)
                  const ci = r.ok ? await r.json().catch(() => ({})) : {}
                  setSellerPII(ci)
                  setContactListing(l)
                  setContactLoading(false)
                }} style={{ cursor: 'pointer' }}>
                  <div style={{ background: 'white', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
                    <div style={{ width: '100%', aspectRatio: '3/4', background: 'var(--surface)', overflow: 'hidden' }}>
                      {l.photos?.[0] ? (
                        <img src={l.photos[0]} alt={l.books?.title} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      ) : (
                        <BookCover isbn={l.books?.isbn} title={l.books?.title} size={120} />
                      )}
                    </div>
                    <div style={{ padding: '10px 12px' }}>
                      <div style={{ fontSize: 14, fontWeight: 600, color: '#121212', lineHeight: 1.35, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', minHeight: 38 }}>{l.books?.title}</div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
                        <span className="price" style={{ fontSize: 16 }}>฿{l.price}</span>
                        {l.price_includes_shipping && <span style={{ fontSize: 11, color: 'var(--green)', fontWeight: 600 }}>ส่งฟรี</span>}
                      </div>
                      <div style={{ marginTop: 6, background: 'var(--primary)', borderRadius: 8, padding: '6px 0', textAlign: 'center', fontFamily: 'Kanit', fontWeight: 700, fontSize: 12, color: 'white' }}>
                        ติดต่อผู้ขาย
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
            </div>
          )}

          {tab === 'sold' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
            {soldListings.map(l => (
              <Link key={l.id} href={`/book/${l.books?.isbn}`} style={{ textDecoration: 'none', color: 'inherit' }}>
                <div style={{ background: 'white', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden', opacity: 0.65 }}>
                  <div style={{ width: '100%', aspectRatio: '3/4', background: 'var(--surface)', overflow: 'hidden', position: 'relative' }}>
                    {l.photos?.[0] ? (
                      <img src={l.photos[0]} alt={l.books?.title} style={{ width: '100%', height: '100%', objectFit: 'cover', filter: 'grayscale(0.4)' }} />
                    ) : (
                      <BookCover isbn={l.books?.isbn} title={l.books?.title} size={120} />
                    )}
                    <span style={{ position: 'absolute', top: 8, left: 8, background: 'rgba(15,23,42,.85)', color: 'white', fontSize: 11, fontWeight: 800, padding: '3px 8px', borderRadius: 4, letterSpacing: '0.05em' }}>
                      SOLD
                    </span>
                  </div>
                  <div style={{ padding: '10px 12px' }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: '#121212', lineHeight: 1.35, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', minHeight: 38 }}>{l.books?.title}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
                      <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink3)' }}>฿{l.price}</span>
                    </div>
                  </div>
                </div>
              </Link>
            ))}
            </div>
          )}
        </div>
        <div style={{ height: 12 }} />
      </div>
      <BottomNav />
    </>
  )
}
