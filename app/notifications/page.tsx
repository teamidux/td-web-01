'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { supabase, Wanted } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { Nav, BottomNav, BookCover, useToast, Toast, MultiLoginButton } from '@/components/ui'
import LineAlertOptin from '@/components/LineAlertOptin'

type Notification = {
  id: string
  type: string
  title: string
  body: string | null
  url: string | null
  read_at: string | null
  created_at: string
  metadata?: { listing_id?: string; book_id?: string; availability?: 'available' | 'sold' } | null
}

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime()
  const min = Math.floor(diff / 60000)
  if (min < 1) return 'เมื่อสักครู่'
  if (min < 60) return `${min} นาที`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr} ชม.`
  const day = Math.floor(hr / 24)
  if (day < 7) return `${day} วัน`
  return `${Math.floor(day / 7)} สัปดาห์`
}

export default function NotificationsPage() {
  const { user } = useAuth()
  const [tab, setTab] = useState<'activity' | 'wanted'>('activity')
  const [notifs, setNotifs] = useState<Notification[]>([])
  const [wanted, setWanted] = useState<Wanted[]>([])
  const [loading, setLoading] = useState(true)
  const [markingAll, setMarkingAll] = useState(false)
  const { msg, show } = useToast()

  useEffect(() => {
    if (!user) { setLoading(false); return }
    loadAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id])

  const loadAll = async () => {
    setLoading(true)
    await Promise.all([loadNotifs(), loadWanted()])
    setLoading(false)
  }

  const loadNotifs = async () => {
    try {
      const r = await fetch('/api/notifications')
      const data = await r.json()
      setNotifs(data.items || [])
    } catch {}
  }

  const loadWanted = async () => {
    if (!user) return
    const { data } = await supabase
      .from('wanted')
      .select('*, books(isbn, title, author, cover_url, active_listings_count, min_price)')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
    setWanted(data || [])
  }

  const markAllRead = async () => {
    if (markingAll) return
    setMarkingAll(true)
    try {
      await fetch('/api/notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ all: true }),
      })
      setNotifs(prev => prev.map(n => ({ ...n, read_at: n.read_at || new Date().toISOString() })))
      window.dispatchEvent(new Event('notifications:read'))
      show('อ่านทั้งหมดแล้ว')
    } finally {
      setMarkingAll(false)
    }
  }

  // ผู้ขายตอบจากแจ้งเตือน "มีคนสนใจ": ยังมี → บันทึกเวลายืนยัน / ขายแล้ว → ปิดประกาศ
  const respondAvailability = async (n: Notification, answer: 'available' | 'sold') => {
    if (!user || !n.metadata?.listing_id) return
    const r = await fetch('/api/listings/mark-sold', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ listingId: n.metadata.listing_id, sellerId: user.id, action: answer === 'sold' ? 'sold' : 'confirm' }),
    })
    const j = await r.json().catch(() => ({}))
    if (!r.ok && j?.error !== 'listing_not_active') { show('ทำรายการไม่สำเร็จ ลองใหม่อีกครั้ง'); return }
    await fetch('/api/notifications/respond', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: n.id, answer }),
    }).catch(() => {})
    setNotifs(prev => prev.map(x => x.id === n.id ? { ...x, read_at: x.read_at || new Date().toISOString(), metadata: { ...(x.metadata || {}), availability: answer } } : x))
    window.dispatchEvent(new Event('notifications:read'))
    show(answer === 'sold' ? 'ปิดประกาศแล้ว' : 'ยืนยันแล้วว่ายังมีอยู่')
  }

  const markRead = async (id: string) => {
    await fetch('/api/notifications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [id] }),
    })
    setNotifs(prev => prev.map(n => n.id === id ? { ...n, read_at: new Date().toISOString() } : n))
    window.dispatchEvent(new Event('notifications:read'))
  }

  const removeWanted = async (id: string) => {
    await fetch('/api/wanted', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wanted_id: id }),
    })
    setWanted(prev => prev.filter(w => w.id !== id))
    show('ลบออกจากรายการตามหาแล้ว')
  }

  if (!user) return (
    <>
      <Nav />
      <div style={{ padding: '48px 20px', textAlign: 'center' }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>🔔</div>
        <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>แจ้งเตือน</div>
        <div style={{ fontSize: 14, color: 'var(--ink3)', marginBottom: 24 }}>เข้าสู่ระบบเพื่อรับแจ้งเตือน</div>
        <MultiLoginButton />
      </div>
      <BottomNav />
    </>
  )

  const unreadCount = notifs.filter(n => !n.read_at).length

  return (
    <>
      <Nav />
      <Toast msg={msg} />
      <div className="page">
        <div style={{ padding: '16px 16px 0' }}>
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <div style={{ fontFamily: "'Kanit', sans-serif", fontSize: 22, fontWeight: 700 }}>
              แจ้งเตือน
              {unreadCount > 0 && (
                <span style={{ fontSize: 14, fontWeight: 600, color: '#EF4444', marginLeft: 8 }}>{unreadCount} ใหม่</span>
              )}
            </div>
            {unreadCount > 0 && (
              <button
                onClick={markAllRead}
                disabled={markingAll}
                style={{ fontSize: 13, color: 'var(--primary)', background: 'none', border: 'none', cursor: markingAll ? 'wait' : 'pointer', fontWeight: 600, opacity: markingAll ? 0.5 : 1, display: 'inline-flex', alignItems: 'center', gap: 6 }}
              >
                {markingAll && <span className="spin" style={{ width: 12, height: 12, borderColor: 'rgba(37,99,235,.2)', borderTopColor: 'var(--primary)' }} />}
                {markingAll ? 'กำลังอ่าน...' : 'อ่านทั้งหมด'}
              </button>
            )}
          </div>

          {/* Tabs */}
          <div style={{ display: 'flex', gap: 0, marginBottom: 16, borderBottom: '2px solid var(--border)' }}>
            <button
              onClick={() => setTab('activity')}
              style={{
                flex: 1, padding: '10px 0', fontSize: 14, fontWeight: 700,
                background: 'none', border: 'none', cursor: 'pointer',
                color: tab === 'activity' ? 'var(--primary)' : '#94A3B8',
                borderBottom: tab === 'activity' ? '2px solid var(--primary)' : '2px solid transparent',
                marginBottom: -2,
              }}
            >
              กิจกรรม {unreadCount > 0 && <span style={{ color: '#EF4444' }}>({unreadCount})</span>}
            </button>
            <button
              onClick={() => setTab('wanted')}
              style={{
                flex: 1, padding: '10px 0', fontSize: 14, fontWeight: 700,
                background: 'none', border: 'none', cursor: 'pointer',
                color: tab === 'wanted' ? 'var(--primary)' : '#94A3B8',
                borderBottom: tab === 'wanted' ? '2px solid var(--primary)' : '2px solid transparent',
                marginBottom: -2,
              }}
            >
              ตามหา ({wanted.length})
            </button>
          </div>

          {loading && (
            <div style={{ textAlign: 'center', padding: 40 }}>
              <span className="spin" style={{ width: 28, height: 28 }} />
            </div>
          )}

          {/* === Tab: กิจกรรม === */}
          {!loading && tab === 'activity' && (
            <>
              {notifs.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '40px 0', color: '#94A3B8' }}>
                  <div style={{ fontSize: 40, marginBottom: 12 }}>🔔</div>
                  <div style={{ fontSize: 14, fontWeight: 500 }}>ยังไม่มีแจ้งเตือน</div>
                  <div style={{ fontSize: 13, marginTop: 6 }}>เมื่อมีคนลงขายหนังสือที่คุณตามหา หรือมีคนสนใจหนังสือของคุณ จะแจ้งที่นี่</div>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {notifs.map(n => (
                    <Link
                      key={n.id}
                      href={n.url || '#'}
                      onClick={() => { if (!n.read_at) markRead(n.id) }}
                      style={{ textDecoration: 'none', color: 'inherit' }}
                    >
                      <div style={{
                        display: 'flex', gap: 12, padding: '14px 12px', borderRadius: 10,
                        background: n.read_at ? 'transparent' : '#EFF6FF',
                        borderLeft: n.read_at ? 'none' : '3px solid #3B82F6',
                      }}>
                        <div style={{ fontSize: 24, lineHeight: 1, flexShrink: 0 }}>
                          {n.type === 'wanted_match' ? '📚'
                            : n.type === 'contact' ? '👤'
                            : n.type === 'report_resolved' ? '✏️'
                            : '🔔'}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 14, fontWeight: n.read_at ? 500 : 700, color: '#0F172A', lineHeight: 1.4 }}>
                            {n.title}
                          </div>
                          {n.body && (
                            <div style={{ fontSize: 13, color: '#64748B', lineHeight: 1.5, marginTop: 2 }}>
                              {n.body}
                            </div>
                          )}
                          {n.type === 'contact' && n.metadata?.listing_id && (
                            <div style={{ marginTop: 8 }} onClick={e => { e.preventDefault(); e.stopPropagation() }}>
                              {n.metadata.availability ? (
                                <span style={{ fontSize: 12, fontWeight: 600, color: n.metadata.availability === 'sold' ? '#64748B' : '#15803D' }}>
                                  {n.metadata.availability === 'sold' ? '✓ ปิดประกาศแล้ว' : '✓ ยืนยันแล้วว่ายังมีอยู่'}
                                </span>
                              ) : (
                                <div style={{ display: 'flex', gap: 8 }}>
                                  <button onClick={() => respondAvailability(n, 'available')} style={{ flex: 1, padding: '8px 10px', borderRadius: 8, border: '1px solid #86EFAC', background: '#F0FDF4', color: '#15803D', fontFamily: 'Kanit', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>ยังมีอยู่</button>
                                  <button onClick={() => respondAvailability(n, 'sold')} style={{ flex: 1, padding: '8px 10px', borderRadius: 8, border: '1px solid #E2E8F0', background: 'white', color: '#475569', fontFamily: 'Kanit', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>ขายแล้ว / ปิดประกาศ</button>
                                </div>
                              )}
                            </div>
                          )}
                          <div style={{ fontSize: 12, color: '#94A3B8', marginTop: 4 }}>
                            {timeAgo(n.created_at)}
                          </div>
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </>
          )}

          {/* === Tab: ตามหา === */}
          {!loading && tab === 'wanted' && (
            <>
              {wanted.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '40px 0', color: '#94A3B8' }}>
                  <div style={{ fontSize: 40, marginBottom: 12 }}>📚</div>
                  <div style={{ fontSize: 14, fontWeight: 500 }}>ยังไม่มีรายการ</div>
                  <div style={{ fontSize: 13, marginTop: 6, marginBottom: 20 }}>ค้นหาหนังสือที่อยากได้แล้วกด "ตามหาเล่มนี้"</div>
                  <Link href="/"><button className="btn" style={{ maxWidth: 200, margin: '0 auto', display: 'block' }}>ค้นหาหนังสือ</button></Link>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {wanted.map(w => {
                    const hasStock = (w.books?.active_listings_count || 0) > 0
                    return (
                      <div key={w.id} className="card" style={{ position: 'relative' }}>
                        <Link href={`/book/${w.books?.isbn || w.isbn}`} style={{ textDecoration: 'none', color: 'inherit' }}>
                          <div style={{ display: 'flex', gap: 12 }}>
                            <BookCover isbn={w.books?.isbn || w.isbn} title={w.books?.title} size={60} />
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div className="book-title" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{w.books?.title}</div>
                              <div style={{ display: 'flex', gap: 8, marginTop: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                                {w.max_price && <span style={{ fontSize: 13, color: 'var(--ink3)' }}>สูงสุด <strong style={{ color: 'var(--primary)' }}>฿{w.max_price}</strong></span>}
                                {hasStock
                                  ? <span className="badge badge-green">มีคนขาย {w.books?.active_listings_count} ราย</span>
                                  : <span className="badge" style={{ background: '#FFF8E1', color: '#E65100' }}>รอคอยอยู่</span>
                                }
                              </div>
                            </div>
                          </div>
                        </Link>
                        <button onClick={() => removeWanted(w.id)} style={{ position: 'absolute', top: 10, right: 10, background: 'none', border: 'none', color: 'var(--ink3)', fontSize: 16, cursor: 'pointer', padding: 4 }}>✕</button>
                      </div>
                    )
                  })}
                </div>
              )}
            </>
          )}

          {/* LINE alert opt-in — smart single button ตาม state + browser */}
          <LineAlertOptin user={user} nextPath="/notifications" />

        </div>
        <div style={{ height: 12 }} />
      </div>
      <BottomNav />
    </>
  )
}
