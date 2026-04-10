'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { Nav } from '@/components/ui'

type DashData = {
  totals: { books: number; users: number; activeListings: number; activeWanted: number }
  northStar: {
    contacts: { today: number; d7: number; d30: number }
    listings: { today: number; d7: number }
    users: { today: number; d7: number }
    wanted: { today: number; d7: number }
  }
  pendingVerify: number
  recent: {
    contacts: any[]
    listings: any[]
    users: any[]
  }
}

export default function AdminPage() {
  const [data, setData] = useState<DashData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/tomga/dashboard')
      .then(r => r.json())
      .then(d => { if (!d.error) setData(d) })
      .finally(() => setLoading(false))
  }, [])

  const menus = [
    { href: '/tomga/verify', icon: '🪪', title: 'ตรวจยืนยันตัวตน', desc: 'อนุมัติ/ปฏิเสธ เอกสาร', badge: data?.pendingVerify },
    { href: '/tomga/messages', icon: '💬', title: 'ข้อความ & รายงาน', desc: 'ข้อความจากสมาชิก + รายงานโกง', badge: 0 },
    { href: '/tomga/import', icon: '📥', title: 'Import หนังสือ', desc: 'Upload CSV เข้าฐานข้อมูล', badge: 0 },
  ]

  const timeSince = (dt: string) => {
    const mins = Math.floor((Date.now() - new Date(dt).getTime()) / 60000)
    if (mins < 1) return 'เมื่อกี้'
    if (mins < 60) return `${mins} นาที`
    const hrs = Math.floor(mins / 60)
    if (hrs < 24) return `${hrs} ชม.`
    return `${Math.floor(hrs / 24)} วัน`
  }

  return (
    <>
      <Nav />
      <div style={{ padding: '32px 0 80px' }}>

        {/* Header */}
        <div style={{ marginBottom: 28 }}>
          <h1 style={{ fontFamily: "'Kanit', sans-serif", fontSize: 28, fontWeight: 800, color: '#0F172A', letterSpacing: '-0.03em', margin: 0 }}>
            Dashboard
          </h1>
          <p style={{ fontSize: 14, color: '#94A3B8', marginTop: 4 }}>
            {new Date().toLocaleDateString('th-TH', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
          </p>
        </div>

        {loading && <div style={{ textAlign: 'center', padding: 60, color: '#94A3B8', fontSize: 15 }}>Loading...</div>}

        {data && (
          <>
            {/* North Star */}
            <div style={{
              background: 'linear-gradient(135deg, #1E3A8A 0%, #2563EB 50%, #3B82F6 100%)',
              borderRadius: 20,
              padding: '28px 24px',
              marginBottom: 20,
              color: 'white',
              boxShadow: '0 4px 24px rgba(37,99,235,.25)',
            }}>
              <div style={{ fontSize: 13, fontWeight: 500, opacity: 0.75, letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: 8 }}>
                North Star — กดติดต่อผู้ขาย
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 16 }}>
                <span style={{ fontSize: 48, fontWeight: 800, lineHeight: 1, letterSpacing: '-0.02em' }}>{data.northStar.contacts.today}</span>
                <span style={{ fontSize: 16, fontWeight: 500, opacity: 0.7 }}>วันนี้</span>
              </div>
              <div style={{ display: 'flex', gap: 24, fontSize: 14, opacity: 0.85 }}>
                <div>
                  <span style={{ opacity: 0.6 }}>7 วัน</span>
                  <span style={{ fontWeight: 700, marginLeft: 6 }}>{data.northStar.contacts.d7}</span>
                </div>
                <div>
                  <span style={{ opacity: 0.6 }}>30 วัน</span>
                  <span style={{ fontWeight: 700, marginLeft: 6 }}>{data.northStar.contacts.d30}</span>
                </div>
              </div>
            </div>

            {/* Metrics grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 28 }}>
              {[
                { label: 'ลงขายใหม่', today: data.northStar.listings.today, d7: data.northStar.listings.d7, total: data.totals.activeListings, icon: '📦', color: '#2563EB' },
                { label: 'สมาชิกใหม่', today: data.northStar.users.today, d7: data.northStar.users.d7, total: data.totals.users, icon: '👤', color: '#7C3AED' },
                { label: 'ตามหาใหม่', today: data.northStar.wanted.today, d7: data.northStar.wanted.d7, total: data.totals.activeWanted, icon: '🔔', color: '#D97706' },
                { label: 'หนังสือในระบบ', today: null, d7: null, total: data.totals.books, icon: '📚', color: '#059669' },
              ].map((m, i) => (
                <div key={i} style={{
                  background: 'white',
                  border: '1px solid #E2E8F0',
                  borderRadius: 16,
                  padding: '20px 18px',
                  transition: 'box-shadow .2s',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                    <span style={{ fontSize: 18 }}>{m.icon}</span>
                    <span style={{ fontSize: 13, fontWeight: 600, color: '#64748B' }}>{m.label}</span>
                  </div>
                  <div style={{ fontSize: 28, fontWeight: 800, color: '#0F172A', letterSpacing: '-0.02em', lineHeight: 1 }}>
                    {m.total?.toLocaleString()}
                  </div>
                  {m.today !== null && (
                    <div style={{ fontSize: 13, color: '#94A3B8', marginTop: 8, display: 'flex', gap: 12 }}>
                      <span>วันนี้ <b style={{ color: (m.today ?? 0) > 0 ? '#16A34A' : '#94A3B8' }}>+{m.today}</b></span>
                      <span>7d <b style={{ color: '#64748B' }}>+{m.d7}</b></span>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Recent activity */}
            <div style={{ marginBottom: 28 }}>
              <h2 style={{ fontSize: 18, fontWeight: 700, color: '#0F172A', marginBottom: 16 }}>Activity ล่าสุด</h2>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
                {/* กดติดต่อ */}
                <div style={{ background: 'white', border: '1px solid #E2E8F0', borderRadius: 14, padding: '18px 16px' }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#64748B', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#2563EB' }} />
                    กดติดต่อ
                  </div>
                  {data.recent.contacts.length === 0 && <div style={{ fontSize: 13, color: '#CBD5E1', padding: '8px 0' }}>ยังไม่มี</div>}
                  {data.recent.contacts.map((c: any, i: number) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: i < data.recent.contacts.length - 1 ? '1px solid #F1F5F9' : 'none' }}>
                      <span style={{ fontSize: 13, color: '#334155', fontWeight: 500 }}>{(c.listings as any)?.books?.title || '—'}</span>
                      <span style={{ fontSize: 12, color: '#94A3B8', flexShrink: 0, marginLeft: 8 }}>{timeSince(c.created_at)}</span>
                    </div>
                  ))}
                </div>

                {/* ลงขายใหม่ */}
                <div style={{ background: 'white', border: '1px solid #E2E8F0', borderRadius: 14, padding: '18px 16px' }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#64748B', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#16A34A' }} />
                    ลงขายใหม่
                  </div>
                  {data.recent.listings.length === 0 && <div style={{ fontSize: 13, color: '#CBD5E1', padding: '8px 0' }}>ยังไม่มี</div>}
                  {data.recent.listings.map((l: any, i: number) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: i < data.recent.listings.length - 1 ? '1px solid #F1F5F9' : 'none' }}>
                      <span style={{ fontSize: 13, color: '#334155', fontWeight: 500 }}>{l.books?.title || '—'}</span>
                      <span style={{ fontSize: 13, fontWeight: 700, color: '#16A34A', flexShrink: 0, marginLeft: 8 }}>฿{l.price}</span>
                    </div>
                  ))}
                </div>

                {/* สมาชิกใหม่ */}
                <div style={{ background: 'white', border: '1px solid #E2E8F0', borderRadius: 14, padding: '18px 16px' }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#64748B', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#7C3AED' }} />
                    สมาชิกใหม่
                  </div>
                  {data.recent.users.length === 0 && <div style={{ fontSize: 13, color: '#CBD5E1', padding: '8px 0' }}>ยังไม่มี</div>}
                  {data.recent.users.map((u: any, i: number) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: i < data.recent.users.length - 1 ? '1px solid #F1F5F9' : 'none' }}>
                      <span style={{ fontSize: 13, color: '#334155', fontWeight: 500 }}>{u.display_name}</span>
                      <span style={{ fontSize: 12, color: '#94A3B8', flexShrink: 0, marginLeft: 8 }}>{timeSince(u.created_at)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </>
        )}

        {/* Menu */}
        <h2 style={{ fontSize: 18, fontWeight: 700, color: '#0F172A', marginBottom: 12 }}>เครื่องมือ</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 10 }}>
          {menus.map(m => (
            <Link key={m.href} href={m.href} style={{ textDecoration: 'none', color: 'inherit' }}>
              <div style={{
                background: 'white',
                border: '1px solid #E2E8F0',
                borderRadius: 14,
                padding: '18px 20px',
                display: 'flex',
                alignItems: 'center',
                gap: 16,
                transition: 'box-shadow .15s, border-color .15s',
                cursor: 'pointer',
              }}
                onMouseOver={e => { (e.currentTarget as HTMLElement).style.boxShadow = '0 2px 12px rgba(0,0,0,.08)'; (e.currentTarget as HTMLElement).style.borderColor = '#CBD5E1' }}
                onMouseOut={e => { (e.currentTarget as HTMLElement).style.boxShadow = 'none'; (e.currentTarget as HTMLElement).style.borderColor = '#E2E8F0' }}
              >
                <div style={{ fontSize: 28, lineHeight: 1 }}>{m.icon}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: '#0F172A' }}>{m.title}</div>
                  <div style={{ fontSize: 13, color: '#94A3B8', marginTop: 2 }}>{m.desc}</div>
                </div>
                {m.badge ? (
                  <span style={{ background: '#DC2626', color: 'white', borderRadius: 12, padding: '3px 10px', fontSize: 13, fontWeight: 700, minWidth: 24, textAlign: 'center' }}>{m.badge}</span>
                ) : (
                  <span style={{ fontSize: 18, color: '#CBD5E1', fontWeight: 300 }}>›</span>
                )}
              </div>
            </Link>
          ))}
        </div>
      </div>
    </>
  )
}
