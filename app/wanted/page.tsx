'use client'
import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { supabase, Wanted } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { Nav, BottomNav, BookCover, LoginModal, useToast, Toast, SkeletonList } from '@/components/ui'
import { registerSW, getPushState, subscribePush, unsubscribePush } from '@/lib/push'

export default function WantedPage() {
  const { user } = useAuth()
  const [items, setItems] = useState<Wanted[]>([])
  const [showLogin, setShowLogin] = useState(false)
  const [loading, setLoading] = useState(true)
  const [pushState, setPushState] = useState<'unsupported' | 'denied' | 'subscribed' | 'unsubscribed' | 'loading'>('loading')
  const swReg = useRef<ServiceWorkerRegistration | null>(null)
  const { msg, show } = useToast()

  useEffect(() => {
    if (user) load()
    else setLoading(false)
  }, [user])

  useEffect(() => {
    if (!user) return
    registerSW().then(reg => {
      if (!reg) { setPushState('unsupported'); return }
      swReg.current = reg
      getPushState(reg).then(setPushState)
    })
  }, [user])

  const togglePush = async () => {
    if (!swReg.current || !user) return
    if (pushState === 'subscribed') {
      const ok = await unsubscribePush(swReg.current, user.id)
      if (ok) { setPushState('unsubscribed'); show('ปิดการแจ้งเตือนแล้ว') }
    } else {
      setPushState('loading')
      const ok = await subscribePush(swReg.current, user.id)
      if (ok) { setPushState('subscribed'); show('เปิดการแจ้งเตือนแล้ว 🔔') }
      else {
        const state = await getPushState(swReg.current)
        setPushState(state)
        if (state === 'denied') show('กรุณาอนุญาต Notification ในการตั้งค่าเบราว์เซอร์')
      }
    }
  }

  const load = async () => {
    if (!user) return
    const { data } = await supabase
      .from('wanted')
      .select('*, books(isbn, title, author, cover_url, active_listings_count, min_price)')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
    setItems(data || [])
    setLoading(false)
  }

  const remove = async (id: string) => {
    await supabase.from('wanted').delete().eq('id', id)
    setItems(prev => prev.filter(w => w.id !== id))
    show('ลบออกจาก Wanted List แล้ว')
  }

  if (!user) return (
    <>
      <Nav />
      <div style={{ padding: '48px 20px', textAlign: 'center' }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>🔔</div>
        <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>Wanted List</div>
        <div style={{ fontSize: 14, color: 'var(--ink3)', marginBottom: 24 }}>เข้าสู่ระบบเพื่อเพิ่มหนังสือที่ต้องการ</div>
        <button className="btn" style={{ maxWidth: 200, margin: '0 auto' }} onClick={() => setShowLogin(true)}>เข้าสู่ระบบ</button>
      </div>
      {showLogin && <LoginModal onClose={() => setShowLogin(false)} onDone={() => setShowLogin(false)} />}
      <BottomNav />
    </>
  )

  return (
    <>
      <Nav />
      <Toast msg={msg} />
      <div className="page">
        <div style={{ padding: '16px 16px 0' }}>
          <div style={{ fontFamily: "'Kanit', sans-serif", fontSize: 22, marginBottom: 4 }}>Wanted List</div>
          <div style={{ fontSize: 13, color: 'var(--ink3)', marginBottom: 16 }}>เราจะแจ้งเตือนเมื่อมีคนลงขายหนังสือที่คุณต้องการ</div>

          {pushState !== 'unsupported' && pushState !== 'loading' && (
            <div style={{ background: pushState === 'subscribed' ? 'var(--green-bg)' : 'var(--primary-light)', border: `1px solid ${pushState === 'subscribed' ? '#BBF7D0' : '#BFDBFE'}`, borderRadius: 12, padding: '12px 14px', marginBottom: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: pushState === 'subscribed' ? 'var(--green)' : 'var(--primary-dark)' }}>
                  {pushState === 'subscribed' ? '🔔 การแจ้งเตือนเปิดอยู่' : pushState === 'denied' ? '🔕 การแจ้งเตือนถูกบล็อก' : '🔔 รับการแจ้งเตือนทันที'}
                </div>
                <div style={{ fontSize: 11, color: 'var(--ink3)', marginTop: 2 }}>
                  {pushState === 'subscribed' ? 'คุณจะได้รับแจ้งเมื่อมีหนังสือที่ต้องการ' : pushState === 'denied' ? 'เปิดใน Settings > Safari/Chrome > Notifications' : 'แจ้งเตือนเมื่อมีคนลงขายหนังสือที่คุณรอ'}
                </div>
              </div>
              {pushState !== 'denied' && (
                <button onClick={togglePush} style={{ background: pushState === 'subscribed' ? 'white' : 'var(--primary)', border: `1px solid ${pushState === 'subscribed' ? '#BBF7D0' : 'transparent'}`, borderRadius: 8, padding: '7px 14px', fontFamily: 'Kanit', fontWeight: 700, fontSize: 12, color: pushState === 'subscribed' ? 'var(--ink2)' : 'white', cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}>
                  {pushState === 'subscribed' ? 'ปิด' : 'เปิด'}
                </button>
              )}
            </div>
          )}

          {loading && <SkeletonList count={3} />}

          {!loading && items.length === 0 && (
            <div className="empty">
              <div className="empty-icon">🔔</div>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>ยังไม่มีรายการ</div>
              <div style={{ fontSize: 13, marginBottom: 20 }}>ค้นหาหนังสือที่อยากได้แล้วกด "ต้องการเล่มนี้"</div>
              <Link href="/"><button className="btn" style={{ maxWidth: 200, margin: '0 auto', display: 'block' }}>ค้นหาหนังสือ</button></Link>
            </div>
          )}

          {items.map(w => {
            const hasStock = (w.books?.active_listings_count || 0) > 0
            return (
              <div key={w.id} className="card" style={{ position: 'relative' }}>
                <Link href={`/book/${w.books?.isbn || w.isbn}`} style={{ textDecoration: 'none', color: 'inherit' }}>
                  <div style={{ display: 'flex', gap: 12 }}>
                    <BookCover coverUrl={w.books?.cover_url} title={w.books?.title} size={60} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="book-title" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{w.books?.title}</div>
                      <div style={{ display: 'flex', gap: 8, marginTop: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                        {w.max_price && <span style={{ fontSize: 12, color: 'var(--ink3)' }}>สูงสุด <strong style={{ color: 'var(--primary)' }}>฿{w.max_price}</strong></span>}
                        {hasStock
                          ? <span className="badge badge-green">✓ มีคนขาย {w.books?.active_listings_count} ราย</span>
                          : <span className="badge" style={{ background: '#FFF8E1', color: '#E65100' }}>รอคอยอยู่</span>
                        }
                      </div>
                    </div>
                  </div>
                </Link>
                <button onClick={() => remove(w.id)} style={{ position: 'absolute', top: 10, right: 10, background: 'none', border: 'none', color: 'var(--ink3)', fontSize: 16, cursor: 'pointer', padding: 4 }}>✕</button>
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
