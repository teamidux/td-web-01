'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { supabase, Listing } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { Nav, BottomNav, BookCover, LoginModal, useToast, Toast } from '@/components/ui'

export default function ProfilePage() {
  const { user, logout, updateUser } = useAuth()
  const [listings, setListings] = useState<Listing[]>([])
  const [showLogin, setShowLogin] = useState(false)
  const [confirmSoldId, setConfirmSoldId] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [editName, setEditName] = useState('')
  const [editLine, setEditLine] = useState('')
  const [saving, setSaving] = useState(false)
  const { msg, show } = useToast()

  const startEdit = () => {
    setEditName(user?.display_name || '')
    setEditLine(user?.line_id || '')
    setEditing(true)
  }

  const saveProfile = async () => {
    if (!editName.trim()) { show('กรุณาใส่ชื่อ'); return }
    setSaving(true)
    await updateUser({ display_name: editName.trim(), line_id: editLine.trim() || undefined })
    setSaving(false)
    setEditing(false)
    show('บันทึกแล้ว ✓')
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
    await supabase.from('listings').update({ status: 'sold', sold_at: new Date().toISOString() }).eq('id', id)
    setListings(prev => prev.map(l => l.id === id ? { ...l, status: 'sold' as any } : l))
    setConfirmSoldId(null)
    show('อัปเดตสถานะเรียบร้อย ✓')
  }

  const reactivate = async (id: string) => {
    const listing = listings.find(l => l.id === id)
    if (!listing?.sold_at) return
    if (Date.now() - new Date(listing.sold_at).getTime() > 24 * 60 * 60 * 1000) {
      show('ไม่สามารถเปิดคืนได้หลัง 24 ชั่วโมง')
      return
    }
    await supabase.from('listings').update({ status: 'active', sold_at: null }).eq('id', id)
    setListings(prev => prev.map(l => l.id === id ? { ...l, status: 'active' as any, sold_at: undefined } : l))
    show('เปิดประกาศขายอีกครั้งแล้ว')
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

  return (
    <>
      <Nav />
      <Toast msg={msg} />

      {confirmSoldId && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.6)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div style={{ background: 'white', borderRadius: 16, padding: 24, width: '100%', maxWidth: 340 }}>
            <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 18, marginBottom: 8 }}>ยืนยันการขาย</div>
            <div style={{ fontSize: 14, color: 'var(--ink2)', marginBottom: 20, lineHeight: 1.6 }}>
              หนังสือเล่มนี้ขายไปแล้วใช่ไหม?<br />
              <span style={{ fontSize: 12, color: 'var(--ink3)' }}>เปิดคืนได้ภายใน 24 ชั่วโมง</span>
            </div>
            <button className="btn" style={{ background: '#DC2626', marginBottom: 8 }} onClick={() => markSold(confirmSoldId)}>✓ ขายไปแล้ว</button>
            <button className="btn btn-ghost" onClick={() => setConfirmSoldId(null)}>ยกเลิก</button>
          </div>
        </div>
      )}

      {editing && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.6)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div style={{ background: 'white', borderRadius: 16, padding: 24, width: '100%', maxWidth: 340 }}>
            <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 18, marginBottom: 20 }}>แก้ไขข้อมูล</div>
            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink2)', display: 'block', marginBottom: 6 }}>ชื่อที่แสดง</label>
              <input
                className="search-input"
                style={{ width: '100%', boxSizing: 'border-box', color: 'var(--ink1)' }}
                value={editName}
                onChange={e => setEditName(e.target.value)}
                placeholder="ชื่อของคุณ"
              />
            </div>
            <div style={{ marginBottom: 24 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink2)', display: 'block', marginBottom: 6 }}>Line ID</label>
              <input
                className="search-input"
                style={{ width: '100%', boxSizing: 'border-box', color: 'var(--ink1)' }}
                value={editLine}
                onChange={e => setEditLine(e.target.value)}
                placeholder="@lineid หรือ lineid"
              />
            </div>
            <button className="btn" style={{ marginBottom: 8 }} onClick={saveProfile} disabled={saving}>
              {saving ? 'กำลังบันทึก...' : 'บันทึก'}
            </button>
            <button className="btn btn-ghost" onClick={() => setEditing(false)}>ยกเลิก</button>
          </div>
        </div>
      )}

      <div className="page">
        <div style={{ background: 'var(--primary)', padding: '24px 16px', display: 'flex', gap: 14, alignItems: 'center' }}>
          <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'rgba(255,255,255,.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, border: '2px solid rgba(255,255,255,.3)' }}>👤</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 20, color: 'white', marginBottom: 3 }}>{user.display_name}</div>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,.65)', marginBottom: 2 }}>{user.phone}</div>
            {user.line_id && <div style={{ fontSize: 12, color: 'rgba(255,255,255,.75)', marginBottom: 4 }}>Line: {user.line_id}</div>}
            <div style={{ display: 'flex', gap: 6 }}>
              <span className="badge" style={{ background: 'rgba(255,255,255,.2)', color: 'white', fontSize: 11 }}>📚 Free Plan</span>
              {user.is_pioneer && <span className="badge" style={{ background: 'rgba(255,255,255,.2)', color: 'white', fontSize: 11 }}>🏆 ผู้บุกเบิก</span>}
            </div>
          </div>
          <button onClick={startEdit} style={{ background: 'rgba(255,255,255,.15)', border: '1.5px solid rgba(255,255,255,.3)', borderRadius: 8, padding: '7px 12px', color: 'white', fontFamily: 'Sarabun', fontWeight: 600, fontSize: 12, cursor: 'pointer' }}>
            แก้ไข
          </button>
        </div>

        <div style={{ background: 'var(--surface)', padding: '12px 16px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-around' }}>
          <div style={{ textAlign: 'center' }}><div className="stat-n">{active.length}</div><div className="stat-l">กำลังขาย</div></div>
          <div style={{ textAlign: 'center' }}><div className="stat-n">{user.sold_count || 0}</div><div className="stat-l">ขายแล้ว</div></div>
          <div style={{ textAlign: 'center' }}><div className="stat-n">{user.confirmed_count || 0}</div><div className="stat-l">ยืนยันรับแล้ว</div></div>
        </div>

        <div className="section">
          <div className="section-hd" style={{ marginBottom: 12 }}>
            <div className="section-title">กำลังขาย ({active.length})</div>
            <Link href="/sell" className="section-link">+ ลงขายเพิ่ม</Link>
          </div>

          {active.length === 0 && (
            <div className="empty">
              <div className="empty-icon">📭</div>
              <div style={{ marginBottom: 12 }}>ยังไม่มีหนังสือที่ลงขาย</div>
              <Link href="/sell"><button className="btn" style={{ maxWidth: 200, margin: '0 auto', display: 'block' }}>ลงขายเลย</button></Link>
            </div>
          )}

          {active.map(l => (
            <div key={l.id} className="card" style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <BookCover coverUrl={l.books?.cover_url} title={l.books?.title} size={48} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="book-title" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{l.books?.title}</div>
                <div className="price" style={{ marginTop: 3 }}>฿{l.price}</div>
                <span className="badge badge-green" style={{ marginTop: 3, display: 'inline-block' }}>กำลังขาย</span>
              </div>
              <button onClick={() => setConfirmSoldId(l.id)} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '7px 10px', fontFamily: 'Sarabun', fontWeight: 700, fontSize: 11, cursor: 'pointer', whiteSpace: 'nowrap', color: 'var(--ink2)' }}>
                ขายแล้ว?
              </button>
            </div>
          ))}
        </div>

        {sold.length > 0 && (
          <div className="section" style={{ marginTop: 8 }}>
            <div className="section-title" style={{ marginBottom: 12 }}>ขายแล้ว ({sold.length})</div>
            {sold.map(l => {
              const canReactivate = l.sold_at && Date.now() - new Date(l.sold_at).getTime() < 24 * 60 * 60 * 1000
              return (
                <div key={l.id} className="card" style={{ display: 'flex', gap: 12, alignItems: 'center', opacity: 0.7 }}>
                  <BookCover coverUrl={l.books?.cover_url} title={l.books?.title} size={48} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="book-title" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{l.books?.title}</div>
                    <div className="price" style={{ marginTop: 3 }}>฿{l.price}</div>
                    <span className="badge" style={{ background: '#FCE4EC', color: '#AD1457', marginTop: 3, display: 'inline-block' }}>ขายแล้ว ✓</span>
                  </div>
                  {canReactivate && (
                    <button onClick={() => reactivate(l.id)} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '7px 10px', fontFamily: 'Sarabun', fontWeight: 700, fontSize: 11, cursor: 'pointer', whiteSpace: 'nowrap', color: 'var(--ink2)' }}>
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
