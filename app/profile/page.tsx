'use client'
import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { useSearchParams, useRouter } from 'next/navigation'
import { supabase, Listing } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { Nav, BottomNav, BookCover, PhoneVerifyModal, useToast, Toast, TrustMission, TrustBadge, IdentityVerifyWizard, MultiLoginButton, ConfirmModal } from '@/components/ui'
import { parseLineId } from '@/lib/line-id'
import { formatMemberSince } from '@/lib/format'
import { compressAvatarImage } from '@/lib/image'

export default function ProfilePage() {
  const { user, loading: authLoading, logout, updateUser, syncUser, loginWithLine } = useAuth()
  const router = useRouter()
  const searchParams = useSearchParams()
  const [listings, setListings] = useState<Listing[]>([])
  // showLogin removed — login goes directly to LINE OAuth
  const [showPhoneVerify, setShowPhoneVerify] = useState(false)
  const [showContact, setShowContact] = useState(false)
  const [contactMsg, setContactMsg] = useState('')
  const [contactSending, setContactSending] = useState(false)
  const [contactSent, setContactSent] = useState(false)
  const [showIdentityWizard, setShowIdentityWizard] = useState(false)
  const [confirmSoldId, setConfirmSoldId] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [editName, setEditName] = useState('')
  // editLine ตัดออก — LINE ID มี flow แยก (re-auth required)
  const [saving, setSaving] = useState(false)
  const [query, setQuery] = useState('')
  // LINE ID edit (separate from main edit modal)
  const [showLineConfirm, setShowLineConfirm] = useState(false)  // confirm re-auth dialog
  const [editingLineId, setEditingLineId] = useState(false)       // หลัง re-auth — เปิด form
  const [newLineId, setNewLineId] = useState('')
  const [lineError, setLineError] = useState('')
  const [savingLine, setSavingLine] = useState(false)
  const { msg, show } = useToast()

  // ตรวจ ?reauth=line param → user เพิ่ง re-auth สำเร็จ → เปิด LINE edit form
  useEffect(() => {
    if (searchParams.get('reauth') === 'line') {
      setEditingLineId(true)
      setNewLineId(user?.line_id || '')
      // ลบ param ออกจาก URL (history clean)
      router.replace('/profile')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  // Alias เก่า → ใช้ lib/format
  const memberSince = formatMemberSince

  const avatarInputRef = useRef<HTMLInputElement | null>(null)
  const [uploadingAvatar, setUploadingAvatar] = useState(false)

  // Compress + resize image → max 400×400, <100KB
  // compress avatar ใช้จาก lib/image (400×400 square crop, 100KB)
  const compressAvatar = compressAvatarImage

  const uploadAvatar = async (file: File) => {
    if (!user) return
    setUploadingAvatar(true)
    try {
      const compressed = await compressAvatar(file)
      const path = `avatars/${user.id}/${Date.now()}.jpg`
      const { error: upErr } = await supabase.storage
        .from('listing-photos')
        .upload(path, compressed, { contentType: 'image/jpeg', upsert: false })
      if (upErr) { show('อัปโหลดไม่สำเร็จ: ' + upErr.message); return }
      const { data: { publicUrl } } = supabase.storage.from('listing-photos').getPublicUrl(path)
      // Update ผ่าน /api/user/update (service role bypass RLS)
      const res = await fetch('/api/user/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id, data: { avatar_url: publicUrl } }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) {
        show('บันทึกไม่สำเร็จ: ' + (d.error || d.message || 'unknown'))
        return
      }
      syncUser({ avatar_url: publicUrl })
      show('เปลี่ยนรูป profile แล้ว')
    } finally {
      setUploadingAvatar(false)
    }
  }

  const startEdit = () => {
    setEditName(user?.display_name || '')
    setEditing(true)
  }

  const saveProfile = async () => {
    if (!editName.trim()) { show('กรุณาใส่ชื่อ'); return }
    setSaving(true)
    try {
      await updateUser({ display_name: editName.trim() })
      setEditing(false)
      show('บันทึกแล้ว ✓')
    } catch (e: unknown) {
      show(e instanceof Error ? e.message : 'บันทึกไม่สำเร็จ')
    } finally {
      setSaving(false)
    }
  }

  // เริ่ม re-auth flow เพื่อเปลี่ยน LINE ID
  const startLineReauth = () => {
    setShowLineConfirm(false)
    // redirect ไป LINE OAuth → callback จะตั้ง bm_line_reauth cookie แล้ว redirect กลับ
    loginWithLine('/profile?reauth=line')
  }

  // Save LINE ID หลัง re-auth
  const saveLineId = async () => {
    setLineError('')
    const trimmed = newLineId.trim()
    if (trimmed) {
      const parsed = parseLineId(trimmed)
      if (!parsed) {
        setLineError('LINE ID ต้องเป็น 4-20 ตัวอักษร (a-z, 0-9, จุด ขีด ขีดเส้นใต้)')
        return
      }
    }
    setSavingLine(true)
    try {
      await updateUser({ line_id: trimmed || (null as any) } as any)
      setEditingLineId(false)
      show('เปลี่ยน LINE ID แล้ว ✓')
    } catch (e: any) {
      setLineError(e?.message || 'บันทึกไม่สำเร็จ')
    } finally {
      setSavingLine(false)
    }
  }

  useEffect(() => {
    if (user) loadListings()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id])

  const loadListings = async () => {
    if (!user) return
    const { data } = await supabase
      .from('listings')
      .select('*, books(isbn, title, author, cover_url, view_count)')
      .eq('seller_id', user.id)
      .neq('status', 'removed')
      .order('created_at', { ascending: false })
    setListings(data || [])
  }

  const markSold = async (id: string) => {
    if (!user) return
    const res = await fetch('/api/listings/mark-sold', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ listingId: id, sellerId: user.id, action: 'sold' }),
    })
    const body = await res.json()
    if (!res.ok) { show(body.error || 'เกิดข้อผิดพลาด'); return }
    setListings(prev => prev.map(l => l.id === id ? { ...l, status: 'sold' as any, sold_at: new Date().toISOString() } : l))
    if (body.sold_count !== undefined) syncUser({ sold_count: body.sold_count })
    setConfirmSoldId(null)
    show('อัปเดตสถานะเรียบร้อย ✓')
  }

  const reactivate = async (id: string) => {
    if (!user) return
    const res = await fetch('/api/listings/mark-sold', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ listingId: id, sellerId: user.id, action: 'reactivate' }),
    })
    const body = await res.json()
    if (!res.ok) { show(body.error || 'เกิดข้อผิดพลาด'); return }
    setListings(prev => prev.map(l => l.id === id ? { ...l, status: 'active' as any, sold_at: undefined } : l))
    if (body.sold_count !== undefined) syncUser({ sold_count: body.sold_count })
    show('เปิดประกาศขายอีกครั้งแล้ว')
  }

  const deleteListing = async (id: string) => {
    if (!user) return
    const res = await fetch('/api/listings/mark-sold', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ listingId: id, sellerId: user.id, action: 'remove' }),
    })
    if (!res.ok) { show('เกิดข้อผิดพลาด'); return }
    setListings(prev => prev.filter(l => l.id !== id))
    setConfirmDeleteId(null)
    show('ลบประกาศแล้ว')
  }

  // Auth loading — อย่า flash login page ก่อน
  if (authLoading) return (
    <>
      <Nav />
      <div style={{ padding: '80px 20px', textAlign: 'center', color: '#94A3B8' }}>
        <span className="spin" style={{ width: 28, height: 28 }} />
      </div>
      <BottomNav />
    </>
  )

  if (!user) return (
    <>
      <Nav />
      <div style={{ padding: '48px 20px', textAlign: 'center' }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>👤</div>
        <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>เข้าสู่ระบบก่อน</div>
        <div style={{ fontSize: 14, color: 'var(--ink3)', marginBottom: 24 }}>เพื่อดูและจัดการหนังสือที่ลงขาย</div>
        <MultiLoginButton />
      </div>
      <BottomNav />
    </>
  )

  const active = listings.filter(l => l.status === 'active')
  const sold = listings.filter(l => l.status === 'sold')

  const filterListings = (ls: Listing[]) => {
    if (!query.trim()) return ls
    const q = query.toLowerCase()
    return ls.filter(l =>
      l.books?.title?.toLowerCase().includes(q) ||
      l.books?.author?.toLowerCase().includes(q)
    )
  }

  return (
    <>
      <Nav />
      <Toast msg={msg} />
      {showPhoneVerify && <PhoneVerifyModal onClose={() => setShowPhoneVerify(false)} onDone={() => setShowPhoneVerify(false)} />}

      {showContact && (
        <div onClick={() => { setShowContact(false); setContactSent(false) }} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.6)', zIndex: 200, display: 'flex', alignItems: 'flex-end' }}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'white', borderRadius: '18px 18px 0 0', padding: '24px 20px 36px', width: '100%', maxWidth: 480, margin: '0 auto' }}>
            <div style={{ fontFamily: "'Kanit', sans-serif", fontSize: 18, fontWeight: 700, marginBottom: 4 }}>💬 ติดต่อเรา</div>
            <div style={{ fontSize: 13, color: 'var(--ink3)', marginBottom: 16 }}>แจ้งปัญหา เสนอแนะ หรือสอบถาม</div>

            {contactSent ? (
              <div style={{ textAlign: 'center', padding: '20px 0' }}>
                <div style={{ fontSize: 40, marginBottom: 10 }}>✅</div>
                <div style={{ fontSize: 15, fontWeight: 600, color: '#15803D', marginBottom: 6 }}>ส่งข้อความแล้ว</div>
                <div style={{ fontSize: 13, color: 'var(--ink3)' }}>เราจะตอบกลับโดยเร็วที่สุด</div>
                <button className="btn btn-ghost" style={{ marginTop: 16 }} onClick={() => { setShowContact(false); setContactSent(false); setContactMsg('') }}>ปิด</button>
              </div>
            ) : (
              <>
                <textarea
                  value={contactMsg}
                  onChange={e => setContactMsg(e.target.value)}
                  placeholder="พิมพ์ข้อความ..."
                  maxLength={2000}
                  rows={4}
                  style={{ width: '100%', boxSizing: 'border-box', border: '1px solid var(--border)', borderRadius: 10, padding: '12px 14px', fontSize: 14, fontFamily: 'Kanit', resize: 'vertical', marginBottom: 4 }}
                />
                {/* Honeypot — ซ่อนจากคน bot จะกรอก */}
                <input name="website" autoComplete="off" tabIndex={-1} style={{ position: 'absolute', left: -9999, opacity: 0, height: 0 }} id="hp_contact" />
                <div style={{ fontSize: 13, color: '#94A3B8', marginBottom: 14, textAlign: 'right' }}>{contactMsg.length}/2000</div>
                <button
                  className="btn"
                  disabled={contactSending || contactMsg.trim().length < 5}
                  onClick={async () => {
                    setContactSending(true)
                    const hp = (document.getElementById('hp_contact') as HTMLInputElement)?.value
                    try {
                      const r = await fetch('/api/contact', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ message: contactMsg, website: hp || undefined }),
                      })
                      if (r.ok) {
                        setContactSent(true)
                      } else {
                        const body = await r.json().catch(() => ({}))
                        show(body.error || 'ส่งไม่สำเร็จ')
                      }
                    } catch { show('ส่งไม่สำเร็จ') }
                    finally { setContactSending(false) }
                  }}
                  style={{ marginBottom: 8 }}
                >
                  {contactSending ? 'กำลังส่ง...' : 'ส่งข้อความ'}
                </button>
                <button className="btn btn-ghost" onClick={() => setShowContact(false)}>ยกเลิก</button>
              </>
            )}
          </div>
        </div>
      )}
      {showIdentityWizard && <IdentityVerifyWizard onClose={() => setShowIdentityWizard(false)} onDone={() => show('ส่งเอกสารเรียบร้อย รอตรวจสอบ ✓')} />}

      {confirmSoldId && (
        <ConfirmModal
          title="ยืนยันการขาย"
          message="หนังสือเล่มนี้ขายไปแล้วใช่ไหม? (เปิดคืนได้ภายใน 24 ชั่วโมง)"
          confirmLabel="✓ ขายไปแล้ว"
          variant="danger"
          onConfirm={() => markSold(confirmSoldId)}
          onCancel={() => setConfirmSoldId(null)}
        />
      )}

      {confirmDeleteId && (
        <ConfirmModal
          title="ลบประกาศ"
          message="ต้องการลบประกาศนี้ใช่ไหม? (ลบแล้วไม่สามารถกู้คืนได้)"
          confirmLabel="🗑️ ลบประกาศ"
          variant="danger"
          onConfirm={() => deleteListing(confirmDeleteId)}
          onCancel={() => setConfirmDeleteId(null)}
        />
      )}

      {/* Confirm re-auth dialog ก่อนเปลี่ยน LINE ID */}
      {showLineConfirm && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.6)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div style={{ background: 'white', borderRadius: 16, padding: 24, width: '100%', maxWidth: 360 }}>
            <div style={{ fontSize: 32, textAlign: 'center', marginBottom: 12 }}>🔒</div>
            <div style={{ fontFamily: "'Kanit', sans-serif", fontSize: 18, marginBottom: 10, textAlign: 'center' }}>ยืนยันด้วย LINE</div>
            <div style={{ fontSize: 13, color: 'var(--ink2)', marginBottom: 20, lineHeight: 1.7, textAlign: 'center' }}>
              เพื่อความปลอดภัย ระบบจะให้คุณ<br />
              login LINE อีกครั้งก่อนเปลี่ยน LINE ID
            </div>
            <button onClick={startLineReauth} style={{ width: '100%', background: '#06C755', border: 'none', borderRadius: 12, padding: '14px 16px', color: 'white', fontFamily: 'Kanit', fontWeight: 700, fontSize: 15, cursor: 'pointer', marginBottom: 8 }}>
              💚 ยืนยันด้วย LINE
            </button>
            <button className="btn btn-ghost" onClick={() => setShowLineConfirm(false)}>ยกเลิก</button>
          </div>
        </div>
      )}

      {/* LINE ID edit form (หลัง re-auth) */}
      {editingLineId && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.6)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div style={{ background: 'white', borderRadius: 16, padding: 24, width: '100%', maxWidth: 360 }}>
            <div style={{ fontFamily: "'Kanit', sans-serif", fontSize: 18, marginBottom: 6 }}>เปลี่ยน LINE ID</div>
            <div style={{ fontSize: 13, color: 'var(--ink3)', marginBottom: 16 }}>✓ ยืนยัน LINE สำเร็จ</div>
            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink2)', display: 'block', marginBottom: 6 }}>LINE ID ใหม่</label>
              <input
                className="search-input"
                style={{ width: '100%', boxSizing: 'border-box', color: 'var(--ink1)' }}
                value={newLineId}
                onChange={e => { setNewLineId(e.target.value); setLineError('') }}
                placeholder="เช่น somchai_books"
                autoFocus
              />
              <div style={{ fontSize: 13, color: 'var(--ink3)', marginTop: 6 }}>
                💡 4-20 ตัวอักษร (a-z, 0-9, จุด ขีด ขีดเส้นใต้)
              </div>
              {lineError && <div style={{ fontSize: 13, color: 'var(--red)', marginTop: 6 }}>⚠️ {lineError}</div>}
            </div>
            <button className="btn" style={{ marginBottom: 8 }} onClick={saveLineId} disabled={savingLine}>
              {savingLine ? 'กำลังบันทึก...' : '✓ บันทึก'}
            </button>
            <button className="btn btn-ghost" onClick={() => setEditingLineId(false)} disabled={savingLine}>ยกเลิก</button>
          </div>
        </div>
      )}

      {editing && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.6)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div style={{ background: 'white', borderRadius: 16, padding: 24, width: '100%', maxWidth: 340 }}>
            <div style={{ fontFamily: "'Kanit', sans-serif", fontSize: 18, marginBottom: 20 }}>แก้ไขข้อมูล</div>
            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink2)', display: 'block', marginBottom: 6 }}>ชื่อที่แสดง</label>
              <input className="search-input" style={{ width: '100%', boxSizing: 'border-box', color: 'var(--ink1)' }} value={editName} onChange={e => setEditName(e.target.value)} placeholder="ชื่อของคุณ หรือชื่อร้าน" />
            </div>
            {/* เบอร์โทร */}
            <div style={{ marginBottom: 14, background: '#F8FAFC', borderRadius: 10, padding: '12px 14px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <div>
                  <label style={{ fontSize: 12, color: '#94A3B8', display: 'block' }}>เบอร์โทร</label>
                  <div style={{ fontSize: 15, fontWeight: 600, color: user?.phone ? 'var(--ink)' : '#94A3B8', marginTop: 2 }}>
                    {user?.phone || 'ยังไม่มีเบอร์'}
                  </div>
                  {user?.phone && (
                    <div style={{ fontSize: 12, color: user?.phone_verified_at ? '#15803D' : '#F59E0B', fontWeight: 600, marginTop: 2 }}>
                      {user?.phone_verified_at ? 'ยืนยันแล้ว' : 'ยังไม่ได้ยืนยัน'}
                    </div>
                  )}
                </div>
                <button
                  onClick={() => { setEditing(false); setShowPhoneVerify(true) }}
                  style={{ background: 'var(--primary-light)', border: '1px solid var(--primary)', borderRadius: 8, padding: '6px 14px', fontFamily: 'Kanit', fontWeight: 600, fontSize: 12, color: 'var(--primary)', cursor: 'pointer', whiteSpace: 'nowrap' }}
                >
                  {!user?.phone ? 'เพิ่มเบอร์' : user?.phone_verified_at ? 'เปลี่ยนเบอร์' : 'ยืนยันเบอร์'}
                </button>
              </div>
            </div>

            {/* LINE ID */}
            <div style={{ marginBottom: 14, background: '#F8FAFC', borderRadius: 10, padding: '12px 14px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <div>
                  <label style={{ fontSize: 12, color: '#94A3B8', display: 'block' }}>LINE ID <span style={{ fontSize: 11 }}>(ไม่บังคับ)</span></label>
                  <div style={{ fontSize: 15, fontWeight: 600, color: user?.line_id ? 'var(--ink)' : '#94A3B8', marginTop: 2 }}>
                    {user?.line_id || 'ยังไม่มี'}
                  </div>
                </div>
                <button
                  onClick={() => {
                    setEditing(false)
                    if (user?.line_id) setShowLineConfirm(true)
                    else { setEditingLineId(true); setNewLineId('') }
                  }}
                  style={{ background: '#F0FFF4', border: '1px solid #BBF7D0', borderRadius: 8, padding: '6px 14px', fontFamily: 'Kanit', fontWeight: 600, fontSize: 12, color: '#15803D', cursor: 'pointer', whiteSpace: 'nowrap' }}
                >
                  {user?.line_id ? 'เปลี่ยน' : 'เพิ่ม LINE ID'}
                </button>
              </div>
            </div>

            <button className="btn" style={{ marginBottom: 8 }} onClick={saveProfile} disabled={saving}>
              {saving ? 'กำลังบันทึก...' : 'บันทึก'}
            </button>
            <button className="btn btn-ghost" onClick={() => setEditing(false)}>ยกเลิก</button>
          </div>
        </div>
      )}

      <div className="page" style={{ padding: 0, background: '#F8FAFC' }}>
        {/* ─── Profile card (design style — white bg) ─── */}
        <div style={{ background: 'white', padding: '22px 18px 18px', maxWidth: 500, margin: '0 auto' }}>
          <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
            <div
              onClick={() => !uploadingAvatar && avatarInputRef.current?.click()}
              style={{ width: 68, height: 68, borderRadius: 999, background: '#DBEAFE', display: 'grid', placeItems: 'center', flexShrink: 0, cursor: 'pointer', position: 'relative', overflow: 'hidden' }}
              title="คลิกเพื่อเปลี่ยนรูป"
            >
              {user.avatar_url ? (
                <img src={user.avatar_url} alt={user.display_name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
              ) : (
                <span style={{ fontFamily: 'Kanit', fontSize: 26, fontWeight: 700, color: '#1D4ED8' }}>
                  {(user.display_name || '?').slice(0, 1).toUpperCase()}
                </span>
              )}

              {/* Verified badge bottom-right (design style) */}
              {user.is_verified && !uploadingAvatar && (
                <div style={{ position: 'absolute', bottom: -2, right: -2, width: 22, height: 22, borderRadius: 999, background: '#2563EB', display: 'grid', placeItems: 'center', border: '2px solid white' }}>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                </div>
              )}

              {/* Camera overlay hint */}
              {!uploadingAvatar && (
                <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: '32%', background: 'rgba(15,23,42,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: 11, fontWeight: 700, pointerEvents: 'none' }}>
                  +
                </div>
              )}

              {uploadingAvatar && (
                <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <span className="spin" style={{ width: 20, height: 20, borderColor: 'white', borderTopColor: 'transparent' }} />
                </div>
              )}
            </div>
            <input
              ref={avatarInputRef} type="file" accept="image/*"
              style={{ display: 'none' }}
              onChange={e => { const f = e.target.files?.[0]; if (f) uploadAvatar(f); e.target.value = '' }}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 18, fontWeight: 700, color: '#0F172A', letterSpacing: '-0.01em', lineHeight: 1.3 }}>
                {user.display_name}
              </div>
              {user.is_verified && (
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 999, background: '#DBEAFE', marginTop: 4 }}>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#2563EB" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><path d="m9 12 2 2 4-4" /></svg>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#1D4ED8', letterSpacing: '0.02em' }}>ยืนยันตัวตนแล้ว</div>
                </div>
              )}
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginTop: user.is_verified ? 4 : 6 }}>
                {!user.is_verified && <TrustBadge user={user} size="sm" />}
                {(user.is_pioneer || user.pioneer_count > 0) && (
                  <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 4, background: '#FFFBEB', color: '#92400E', border: '1px solid #FDE68A' }}>
                    🏆 ผู้บุกเบิก {user.pioneer_count} เล่ม
                  </span>
                )}
              </div>
              <div style={{ fontSize: 11.5, color: '#64748B', marginTop: 4 }}>
                อยู่ BookMatch {memberSince(user.created_at)}
              </div>
            </div>
            <button
              onClick={startEdit}
              style={{ background: '#F1F5F9', border: 'none', borderRadius: 8, padding: '7px 12px', color: '#475569', fontFamily: 'Kanit', fontWeight: 600, fontSize: 13, cursor: 'pointer', flexShrink: 0 }}
            >
              แก้ไข
            </button>
          </div>

          {/* Stats row: กำลังขาย / ขายไปแล้ว / เข้าร่วม (design style with dividers) */}
          <div style={{ display: 'flex', marginTop: 18, background: '#F8FAFC', borderRadius: 14, padding: '12px 4px' }}>
            <div style={{ flex: 1, textAlign: 'center' }}>
              <div style={{ fontSize: 20, fontWeight: 800, color: '#0F172A', lineHeight: 1, letterSpacing: '-0.02em' }}>
                {active.length}
              </div>
              <div style={{ fontSize: 11, color: '#64748B', marginTop: 3 }}>กำลังขาย</div>
            </div>
            <div style={{ width: 1, background: '#E5E7EB' }} />
            <div style={{ flex: 1, textAlign: 'center' }}>
              <div style={{ fontSize: 20, fontWeight: 800, color: '#0F172A', lineHeight: 1, letterSpacing: '-0.02em' }}>
                {user.sold_count || 0}
              </div>
              <div style={{ fontSize: 11, color: '#64748B', marginTop: 3 }}>ขายไปแล้ว</div>
            </div>
            <div style={{ width: 1, background: '#E5E7EB' }} />
            <div style={{ flex: 1, textAlign: 'center' }}>
              <div style={{ fontSize: 16, fontWeight: 800, color: '#0F172A', lineHeight: 1, letterSpacing: '-0.02em' }}>
                {memberSince(user.created_at)}
              </div>
              <div style={{ fontSize: 11, color: '#64748B', marginTop: 3 }}>เข้าร่วม</div>
            </div>
          </div>
        </div>

        {/* ปุ่มเข้าหน้าร้านตัวเอง — แชร์ได้จากหน้า seller */}
        <div style={{ padding: '12px 16px 0' }}>
          <Link
            href={`/seller/${user.id}`}
            style={{
              width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              background: 'linear-gradient(135deg, #2563EB 0%, #1D4ED8 100%)', borderRadius: 12,
              padding: '13px 16px', fontFamily: 'Kanit', fontWeight: 700, fontSize: 15,
              color: 'white', textDecoration: 'none', boxShadow: '0 2px 8px rgba(37,99,235,.25)',
            }}
          >
            ร้านของฉัน
          </Link>
          <div style={{ fontSize: 12, color: 'var(--ink3)', textAlign: 'center', marginTop: 6 }}>
            ดูหน้าร้านของคุณแบบที่ลูกค้าเห็น
          </div>
        </div>

        {/* Stats row ย้ายไปอยู่ใน profile card ด้านบนแล้ว */}

        {/* Market demand insight — push sellers to /market page */}
        <Link href="/market" style={{ textDecoration: 'none', color: 'inherit', display: 'block', padding: '14px 16px 0' }}>
          <div
            style={{
              background: 'linear-gradient(135deg, #EEF2FF 0%, #E0E7FF 100%)',
              border: '1px solid #C7D2FE',
              borderRadius: 14,
              padding: 16,
              display: 'flex',
              alignItems: 'center',
              gap: 14,
              boxShadow: '0 2px 8px rgba(0,0,0,0.05)',
            }}
          >
            <div style={{ fontSize: 32, lineHeight: 1 }}>📊</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#1D4ED8', lineHeight: 1.3, letterSpacing: '-0.02em', marginBottom: 4 }}>
                หนังสือที่ตลาดต้องการ
              </div>
              <div style={{ fontSize: 13, color: '#475569', lineHeight: 1.6 }}>
                ดูว่าคนกำลังรอซื้อเล่มไหน — มีโอกาสขายไว
              </div>
            </div>
            <div style={{ fontSize: 22, color: '#1D4ED8', fontWeight: 700, lineHeight: 1 }}>›</div>
          </div>
        </Link>

        {/* Trust Mission — ยืนยันตัวตน */}
        <div style={{ padding: '14px 16px 0' }}>
          <TrustMission user={user} onAction={(key) => {
            if (key === 'phone_verified') setShowPhoneVerify(true)
            else if (key === 'id_verified') setShowIdentityWizard(true)
          }} />
        </div>

        {listings.length >= 5 && (
          <div style={{ padding: '10px 16px 0' }}>
            <input
              className="input"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="ค้นหาชื่อหนังสือ หรือผู้แต่ง..."
            />
          </div>
        )}

        <div className="section">
          <div className="section-hd" style={{ marginBottom: 12 }}>
            <div className="section-title">กำลังขาย ({active.length})</div>
            <Link href="/sell" className="section-link">+ ลงขายเพิ่ม</Link>
          </div>

          {active.length === 0 && !query && (
            <div className="empty">
              <div className="empty-icon">📚</div>
              <div style={{ marginBottom: 12 }}>ยังไม่มีหนังสือที่ลงขาย</div>
              <Link href="/sell"><button className="btn" style={{ maxWidth: 200, margin: '0 auto', display: 'block' }}>ลงขายเลย</button></Link>
            </div>
          )}

          {filterListings(active).map(l => (
            <div key={l.id} className="card" style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <BookCover coverUrl={l.photos?.[0]} isbn={!l.photos?.[0] ? l.books?.isbn : undefined} title={l.books?.title} size={56} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="book-title" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{l.books?.title}</div>
                <div className="price" style={{ marginTop: 3 }}>฿{l.price}</div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 4, flexWrap: 'wrap' }}>
                  <span className="badge badge-green">กำลังขาย</span>
                  {(l.books as any)?.view_count > 0 && (
                    <span style={{ fontSize: 13, color: 'var(--ink3)', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                      👁 {(l.books as any).view_count}
                    </span>
                  )}
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <button onClick={() => {
                  const newPrice = prompt(`แก้ราคา "${l.books?.title}"\nราคาปัจจุบัน: ฿${l.price}\n\nใส่ราคาใหม่:`, String(l.price))
                  if (!newPrice) return
                  const p = parseFloat(newPrice)
                  if (isNaN(p) || p <= 0) { show('ราคาไม่ถูกต้อง'); return }
                  fetch('/api/listings/update-price', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ listingId: l.id, price: p }),
                  }).then(r => r.json()).then(d => {
                    if (d.ok) { setListings(prev => prev.map(x => x.id === l.id ? { ...x, price: p } : x)); show('แก้ราคาแล้ว') }
                    else show(d.error || 'แก้ราคาไม่สำเร็จ')
                  })
                }} style={{ background: 'var(--primary-light)', border: '1px solid var(--primary)', borderRadius: 8, padding: '7px 10px', fontFamily: 'Kanit', fontWeight: 700, fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap', color: 'var(--primary)' }}>
                  ฿ แก้ราคา
                </button>
                <button onClick={() => setConfirmSoldId(l.id)} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '7px 10px', fontFamily: 'Kanit', fontWeight: 700, fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap', color: 'var(--ink2)' }}>
                  ขายแล้ว?
                </button>
                <button onClick={() => setConfirmDeleteId(l.id)} style={{ background: 'white', border: '1px solid #FECACA', borderRadius: 8, padding: '7px 10px', fontFamily: 'Kanit', fontWeight: 700, fontSize: 12, cursor: 'pointer', color: 'var(--red)' }}>
                  🗑️ ลบ
                </button>
              </div>
            </div>
          ))}

          {query && filterListings(active).length === 0 && (
            <div style={{ textAlign: 'center', padding: '20px 0', color: 'var(--ink3)', fontSize: 14 }}>ไม่พบหนังสือที่ตรงกัน</div>
          )}
        </div>

        {sold.length > 0 && (
          <div className="section" style={{ marginTop: 8 }}>
            <div className="section-title" style={{ marginBottom: 12 }}>ขายแล้ว ({sold.length})</div>
            {filterListings(sold).map(l => {
              const canReactivate = l.sold_at && Date.now() - new Date(l.sold_at).getTime() < 24 * 60 * 60 * 1000
              return (
                <div key={l.id} className="card" style={{ display: 'flex', gap: 12, alignItems: 'center', opacity: 0.7 }}>
                  <BookCover coverUrl={l.photos?.[0]} isbn={!l.photos?.[0] ? l.books?.isbn : undefined} title={l.books?.title} size={56} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="book-title" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{l.books?.title}</div>
                    <div className="price" style={{ marginTop: 3 }}>฿{l.price}</div>
                    <span className="badge" style={{ background: '#FCE4EC', color: '#AD1457', marginTop: 3, display: 'inline-block' }}>ขายแล้ว ✓</span>
                  </div>
                  {canReactivate && (
                    <button onClick={() => reactivate(l.id)} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '7px 10px', fontFamily: 'Kanit', fontWeight: 700, fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap', color: 'var(--ink2)' }}>
                      เปิดคืน
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        )}

        <div className="section" style={{ marginTop: 12 }}>
          {/* "รายการที่คุณตามหา" ตัดออก — BottomNav มี 🔔 ตามหา อยู่แล้ว */}
          <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }} onClick={() => setShowContact(true)}>
            <span style={{ fontSize: 20 }}>💬</span>
            <div style={{ flex: 1 }}><div style={{ fontSize: 14, fontWeight: 600 }}>ติดต่อเรา / แจ้งปัญหา</div></div>
            <span style={{ color: 'var(--ink3)' }}>›</span>
          </div>
          <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }} onClick={logout}>
            <span style={{ fontSize: 20 }}>🚪</span>
            <div style={{ fontSize: 14, fontWeight: 600 }}>ออกจากระบบ</div>
          </div>
        </div>
        <div style={{ height: 12 }} />
      </div>
      <BottomNav />
    </>
  )
}
