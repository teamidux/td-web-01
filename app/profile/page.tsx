'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { supabase, Listing } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { Nav, BottomNav, BookCover, LoginModal, PhoneVerifyModal, IdVerifyModal, useToast, Toast } from '@/components/ui'

export default function ProfilePage() {
  const { user, logout, updateUser, syncUser } = useAuth()
  const [listings, setListings] = useState<Listing[]>([])
  const [showLogin, setShowLogin] = useState(false)
  const [showPhoneVerify, setShowPhoneVerify] = useState(false)
  const [showIdVerify, setShowIdVerify] = useState(false)
  const [confirmSoldId, setConfirmSoldId] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [editName, setEditName] = useState('')
  const [editLine, setEditLine] = useState('')
  const [editSellerType, setEditSellerType] = useState<'individual' | 'store'>('individual')
  const [editStoreName, setEditStoreName] = useState('')
  const [saving, setSaving] = useState(false)
  const [query, setQuery] = useState('')
  const { msg, show } = useToast()

  // เข้าร่วมเมื่อ — แสดงเป็นข้อความสั้นๆ
  const memberSince = (createdAt?: string): string => {
    if (!createdAt) return '—'
    const days = Math.floor((Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60 * 24))
    if (days < 1) return 'วันนี้'
    if (days < 7) return `${days} วัน`
    if (days < 30) return `${Math.floor(days / 7)} สัปดาห์`
    if (days < 365) return `${Math.floor(days / 30)} เดือน`
    return `${Math.floor(days / 365)} ปี`
  }

  const startEdit = () => {
    setEditName(user?.display_name || '')
    setEditLine(user?.line_id || '')
    setEditSellerType(user?.seller_type || 'individual')
    setEditStoreName(user?.store_name || '')
    setEditing(true)
  }

  const saveProfile = async () => {
    if (editSellerType === 'store' && !editStoreName.trim()) { show('กรุณาใส่ชื่อร้าน'); return }
    if (editSellerType === 'individual' && !editName.trim()) { show('กรุณาใส่ชื่อ'); return }
    setSaving(true)
    try {
      const storeName = editSellerType === 'store' ? editStoreName.trim() : undefined
      await updateUser({
        // ถ้าเป็นร้านค้า ให้ sync display_name = store_name เพื่อให้ชื่อที่แสดงตรงกันทุกที่
        display_name: editSellerType === 'store' ? editStoreName.trim() : editName.trim(),
        line_id: editLine.trim() || undefined,
        seller_type: editSellerType,
        store_name: storeName,
      })
      setEditing(false)
      show('บันทึกแล้ว ✓')
    } catch (e: unknown) {
      show(e instanceof Error ? e.message : 'บันทึกไม่สำเร็จ')
    } finally {
      setSaving(false)
    }
  }

  useEffect(() => {
    if (user) loadListings()
  }, [user])

  const loadListings = async () => {
    if (!user) return
    const { data } = await supabase
      .from('listings')
      .select('*, books(isbn, title, author, cover_url)')
      .eq('seller_id', user.id)
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

  if (!user) return (
    <>
      <Nav />
      <div style={{ padding: '48px 20px', textAlign: 'center' }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>👤</div>
        <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>เข้าสู่ระบบก่อน</div>
        <div style={{ fontSize: 14, color: 'var(--ink3)', marginBottom: 24 }}>เพื่อดูและจัดการหนังสือที่ลงขาย</div>
        <button className="btn" style={{ maxWidth: 200, margin: '0 auto' }} onClick={() => setShowLogin(true)}>เข้าสู่ระบบ</button>
      </div>
      {showLogin && <LoginModal onClose={() => setShowLogin(false)} onDone={() => setShowLogin(false)} />}
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
      {showIdVerify && <IdVerifyModal onClose={() => setShowIdVerify(false)} onDone={() => setShowIdVerify(false)} />}

      {confirmSoldId && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.6)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div style={{ background: 'white', borderRadius: 16, padding: 24, width: '100%', maxWidth: 340 }}>
            <div style={{ fontFamily: "'Kanit', sans-serif", fontSize: 18, marginBottom: 8 }}>ยืนยันการขาย</div>
            <div style={{ fontSize: 14, color: 'var(--ink2)', marginBottom: 20, lineHeight: 1.6 }}>
              หนังสือเล่มนี้ขายไปแล้วใช่ไหม?<br />
              <span style={{ fontSize: 12, color: 'var(--ink3)' }}>เปิดคืนได้ภายใน 24 ชั่วโมง</span>
            </div>
            <button className="btn" style={{ background: '#DC2626', marginBottom: 8 }} onClick={() => markSold(confirmSoldId)}>✓ ขายไปแล้ว</button>
            <button className="btn btn-ghost" onClick={() => setConfirmSoldId(null)}>ยกเลิก</button>
          </div>
        </div>
      )}

      {confirmDeleteId && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.6)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div style={{ background: 'white', borderRadius: 16, padding: 24, width: '100%', maxWidth: 340 }}>
            <div style={{ fontFamily: "'Kanit', sans-serif", fontSize: 18, marginBottom: 8 }}>ลบประกาศ</div>
            <div style={{ fontSize: 14, color: 'var(--ink2)', marginBottom: 20, lineHeight: 1.6 }}>
              ต้องการลบประกาศนี้ใช่ไหม?<br />
              <span style={{ fontSize: 12, color: 'var(--ink3)' }}>ลบแล้วไม่สามารถกู้คืนได้</span>
            </div>
            <button className="btn" style={{ background: 'var(--red)', marginBottom: 8 }} onClick={() => deleteListing(confirmDeleteId)}>🗑️ ลบประกาศ</button>
            <button className="btn btn-ghost" onClick={() => setConfirmDeleteId(null)}>ยกเลิก</button>
          </div>
        </div>
      )}

      {editing && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.6)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div style={{ background: 'white', borderRadius: 16, padding: 24, width: '100%', maxWidth: 340 }}>
            <div style={{ fontFamily: "'Kanit', sans-serif", fontSize: 18, marginBottom: 20 }}>แก้ไขข้อมูล</div>
            {editSellerType !== 'store' && (
              <div style={{ marginBottom: 14 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink2)', display: 'block', marginBottom: 6 }}>ชื่อที่แสดง</label>
                <input className="search-input" style={{ width: '100%', boxSizing: 'border-box', color: 'var(--ink1)' }} value={editName} onChange={e => setEditName(e.target.value)} placeholder="ชื่อของคุณ" />
              </div>
            )}
            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink2)', display: 'block', marginBottom: 6 }}>Line ID</label>
              <input className="search-input" style={{ width: '100%', boxSizing: 'border-box', color: 'var(--ink1)' }} value={editLine} onChange={e => setEditLine(e.target.value)} placeholder="@lineid หรือ lineid" />
            </div>
            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink2)', display: 'block', marginBottom: 8 }}>ประเภทผู้ขาย</label>
              <div style={{ display: 'flex', gap: 8 }}>
                {(['individual', 'store'] as const).map(t => (
                  <button key={t} onClick={() => setEditSellerType(t)}
                    style={{ flex: 1, padding: '10px 8px', borderRadius: 10, border: `2px solid ${editSellerType === t ? 'var(--primary)' : 'var(--border)'}`, background: editSellerType === t ? 'var(--primary-light)' : 'white', fontFamily: 'Kanit', fontSize: 13, fontWeight: 600, color: editSellerType === t ? 'var(--primary)' : 'var(--ink2)', cursor: 'pointer' }}>
                    {t === 'individual' ? '👤 บุคคลทั่วไป' : '🏪 ร้านค้า / สำนักพิมพ์'}
                  </button>
                ))}
              </div>
            </div>
            {editSellerType === 'store' && (
              <div style={{ marginBottom: 14 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink2)', display: 'block', marginBottom: 6 }}>ชื่อร้าน / สำนักพิมพ์ <span style={{ color: 'var(--red)' }}>*</span></label>
                <input className="search-input" style={{ width: '100%', boxSizing: 'border-box', color: 'var(--ink1)' }} value={editStoreName} onChange={e => setEditStoreName(e.target.value)} placeholder="เช่น ร้านหนังสือบ้านหนังสือ" />
              </div>
            )}
            <div style={{ marginBottom: 24 }} />
            <button className="btn" style={{ marginBottom: 8 }} onClick={saveProfile} disabled={saving}>
              {saving ? 'กำลังบันทึก...' : 'บันทึก'}
            </button>
            <button className="btn btn-ghost" onClick={() => setEditing(false)}>ยกเลิก</button>
          </div>
        </div>
      )}

      <div className="page">
        <div style={{ background: 'var(--primary)', padding: '24px 16px', display: 'flex', gap: 14, alignItems: 'center' }}>
          <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'rgba(255,255,255,.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, border: '2px solid rgba(255,255,255,.3)' }}>{user.seller_type === 'store' ? '🏪' : '👤'}</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: "'Kanit', sans-serif", fontSize: 20, color: 'white', marginBottom: 3 }}>
              {user.seller_type === 'store' && user.store_name ? user.store_name : user.display_name}
            </div>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,.65)', marginBottom: 2 }}>{user.phone}</div>
            {user.line_id && <div style={{ fontSize: 12, color: 'rgba(255,255,255,.75)', marginBottom: 4 }}>Line: {user.line_id}</div>}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {user.seller_type === 'store'
                ? <span className="badge" style={{ background: 'rgba(255,255,255,.2)', color: 'white', fontSize: 11 }}>🏪 ร้านค้า / สำนักพิมพ์</span>
                : <span className="badge" style={{ background: 'rgba(255,255,255,.2)', color: 'white', fontSize: 11 }}>📚 Free Plan</span>
              }
              {user.is_pioneer && <span className="badge" style={{ background: 'rgba(255,255,255,.2)', color: 'white', fontSize: 11 }}>🏆 ผู้บุกเบิก</span>}
            </div>
          </div>
          <button onClick={startEdit} style={{ background: 'rgba(255,255,255,.15)', border: '1.5px solid rgba(255,255,255,.3)', borderRadius: 8, padding: '7px 12px', color: 'white', fontFamily: 'Kanit', fontWeight: 600, fontSize: 12, cursor: 'pointer' }}>
            แก้ไข
          </button>
        </div>

        <div style={{ background: 'var(--surface)', padding: '18px 16px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-around' }}>
          <div style={{ textAlign: 'center' }}><div className="stat-n">{active.length}</div><div className="stat-l">กำลังขาย</div></div>
          <div style={{ textAlign: 'center' }}><div className="stat-n">{user.sold_count || 0}</div><div className="stat-l">ขายไปแล้ว</div></div>
          <div style={{ textAlign: 'center' }}>
            <div className="stat-n" style={{ fontSize: 18 }}>{memberSince(user.created_at)}</div>
            <div className="stat-l">เข้าร่วมเมื่อ</div>
          </div>
        </div>

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

        {/* Verification status — show actions for not-yet-verified */}
        <div style={{ padding: '14px 16px 0' }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink2)', marginBottom: 10, letterSpacing: '0.02em' }}>การยืนยันตัวตน</div>

          {(user as any).phone_verified_at ? (
            <div style={{ background: 'var(--green-bg)', border: '1px solid #BBF7D0', borderRadius: 12, padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
              <span style={{ fontSize: 22 }}>📱</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#15803D' }}>ยืนยันเบอร์โทรแล้ว</div>
                <div style={{ fontSize: 12, color: 'var(--ink3)' }}>{user.phone}</div>
              </div>
              <span style={{ fontSize: 18, color: '#15803D' }}>✓</span>
            </div>
          ) : (
            <button
              onClick={() => setShowPhoneVerify(true)}
              style={{ width: '100%', background: '#FEF3C7', border: '1.5px solid #FDE68A', borderRadius: 12, padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10, cursor: 'pointer', fontFamily: 'Kanit', textAlign: 'left' }}
            >
              <span style={{ fontSize: 22 }}>📱</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#92400E' }}>ยืนยันเบอร์โทร</div>
                <div style={{ fontSize: 12, color: '#B45309', marginTop: 2 }}>จำเป็นสำหรับการลงประกาศ</div>
              </div>
              <span style={{ fontSize: 18, color: '#92400E' }}>›</span>
            </button>
          )}

          {(user as any).id_verified_at ? (
            <div style={{ background: 'var(--green-bg)', border: '1px solid #BBF7D0', borderRadius: 12, padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ fontSize: 22 }}>🪪</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#15803D' }}>ยืนยันตัวตนแล้ว</div>
                <div style={{ fontSize: 12, color: 'var(--ink3)' }}>Badge สีเขียวบนโปรไฟล์</div>
              </div>
              <span style={{ fontSize: 18, color: '#15803D' }}>✓</span>
            </div>
          ) : (
            <button
              onClick={() => setShowIdVerify(true)}
              style={{ width: '100%', background: 'white', border: '1.5px solid var(--border)', borderRadius: 12, padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer', fontFamily: 'Kanit', textAlign: 'left' }}
            >
              <span style={{ fontSize: 22 }}>🪪</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)' }}>ยืนยันตัวตน (ไม่บังคับ)</div>
                <div style={{ fontSize: 12, color: 'var(--ink3)', marginTop: 2 }}>เพิ่ม Badge ความน่าเชื่อถือบนโปรไฟล์</div>
              </div>
              <span style={{ fontSize: 18, color: 'var(--ink3)' }}>›</span>
            </button>
          )}
        </div>

        {listings.length > 0 && (
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
              <div className="empty-icon">📭</div>
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
                <span className="badge badge-green" style={{ marginTop: 3, display: 'inline-block' }}>กำลังขาย</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <button onClick={() => setConfirmSoldId(l.id)} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '7px 10px', fontFamily: 'Kanit', fontWeight: 700, fontSize: 11, cursor: 'pointer', whiteSpace: 'nowrap', color: 'var(--ink2)' }}>
                  ขายแล้ว?
                </button>
                <button onClick={() => setConfirmDeleteId(l.id)} style={{ background: 'white', border: '1px solid #FECACA', borderRadius: 8, padding: '7px 10px', fontFamily: 'Kanit', fontWeight: 700, fontSize: 11, cursor: 'pointer', color: 'var(--red)' }}>
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
                    <button onClick={() => reactivate(l.id)} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '7px 10px', fontFamily: 'Kanit', fontWeight: 700, fontSize: 11, cursor: 'pointer', whiteSpace: 'nowrap', color: 'var(--ink2)' }}>
                      เปิดคืน
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        )}

        <div className="section" style={{ marginTop: 12 }}>
          <Link href="/wanted" style={{ textDecoration: 'none', color: 'inherit' }}>
            <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ fontSize: 20 }}>🔔</span>
              <div style={{ flex: 1 }}><div style={{ fontSize: 14, fontWeight: 600 }}>Wanted List</div></div>
              <span style={{ color: 'var(--ink3)' }}>›</span>
            </div>
          </Link>
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
