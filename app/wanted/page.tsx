'use client'
import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { supabase, Wanted } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { Nav, BottomNav, BookCover, useToast, Toast, SkeletonList, LoginButton } from '@/components/ui'
import { registerSW, getPushState, subscribePush, unsubscribePush } from '@/lib/push'

export default function WantedPage() {
  const { user, loginWithLine, reloadUser } = useAuth()
  const [items, setItems] = useState<Wanted[]>([])
  const [refreshingOa, setRefreshingOa] = useState(false)
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
    show('ลบออกจากรายการตามหาแล้ว')
  }

  if (!user) return (
    <>
      <Nav />
      <div style={{ padding: '48px 20px', textAlign: 'center' }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>🔔</div>
        <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>รายการที่คุณตามหา</div>
        <div style={{ fontSize: 14, color: 'var(--ink3)', marginBottom: 24 }}>เข้าสู่ระบบเพื่อเพิ่มหนังสือที่ต้องการ</div>
        <LoginButton onClick={() => loginWithLine('/wanted')} />
      </div>
      <BottomNav />
    </>
  )

  return (
    <>
      <Nav />
      <Toast msg={msg} />
      <div className="page">
        <div style={{ padding: '16px 16px 0' }}>
          <div style={{ fontFamily: "'Kanit', sans-serif", fontSize: 22, marginBottom: 4 }}>รายการที่คุณตามหา</div>
          <div style={{ fontSize: 13, color: 'var(--ink3)', marginBottom: 16 }}>เราจะแจ้งเตือนเมื่อมีคนลงขายหนังสือที่คุณต้องการ</div>

          {/* LINE OA Add CTA — แสดงถ้า user ยังไม่ add @Bookmatch เป็นเพื่อน */}
          {!(user as any)?.line_oa_friend_at && (
            <div style={{
              background: 'linear-gradient(135deg, #ECFDF5 0%, #D1FAE5 100%)',
              border: '1.5px solid #6EE7B7',
              borderRadius: 14,
              padding: '16px 18px',
              marginBottom: 16,
              boxShadow: '0 2px 8px rgba(6,199,85,0.08)',
            }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 12 }}>
                <div style={{ fontSize: 32, lineHeight: 1, flexShrink: 0 }}>💚</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: "'Kanit', sans-serif", fontSize: 15, fontWeight: 700, color: '#065F46', lineHeight: 1.35, marginBottom: 4 }}>
                    รับแจ้งเตือนผ่าน LINE
                  </div>
                  <div style={{ fontSize: 12.5, color: '#047857', lineHeight: 1.6 }}>
                    Add <b>@Bookmatch</b> เป็นเพื่อน → เราจะส่งข้อความหาคุณทุกครั้งที่หนังสือที่คุณตามหามีคนลงขาย
                  </div>
                </div>
              </div>
              <a
                href={`https://line.me/R/ti/p/${process.env.NEXT_PUBLIC_LINE_OA_BASIC_ID || '@521qvzrv'}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  width: '100%',
                  background: '#06C755',
                  border: 'none',
                  borderRadius: 10,
                  padding: '13px 16px',
                  color: 'white',
                  fontFamily: 'Kanit',
                  fontWeight: 700,
                  fontSize: 14,
                  textDecoration: 'none',
                  boxShadow: '0 2px 6px rgba(6,199,85,.3)',
                  marginBottom: 8,
                }}
              >
                💚 เพิ่มเพื่อนใน LINE
              </a>

              {/* ปุ่ม refresh — สำหรับ user ที่ add แล้วต้องการเช็คทันที */}
              <button
                onClick={async () => {
                  setRefreshingOa(true)
                  await reloadUser()
                  setTimeout(() => setRefreshingOa(false), 300)
                }}
                disabled={refreshingOa}
                style={{
                  width: '100%',
                  background: 'white',
                  border: '1px solid #6EE7B7',
                  borderRadius: 10,
                  padding: '10px 16px',
                  color: '#047857',
                  fontFamily: 'Kanit',
                  fontWeight: 600,
                  fontSize: 13,
                  cursor: 'pointer',
                }}
              >
                {refreshingOa ? 'กำลังตรวจสอบ...' : '✓ Add แล้ว ตรวจสอบสถานะ'}
              </button>
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
                    <BookCover isbn={w.books?.isbn || w.isbn} title={w.books?.title} size={60} />
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
