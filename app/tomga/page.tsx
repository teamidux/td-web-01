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
    { href: '/tomga/import', icon: '📥', title: 'Import หนังสือ', desc: 'Upload CSV เข้าฐานข้อมูล' },
  ]

  const timeSince = (dt: string) => {
    const mins = Math.floor((Date.now() - new Date(dt).getTime()) / 60000)
    if (mins < 1) return 'เมื่อกี้'
    if (mins < 60) return `${mins}m`
    const hrs = Math.floor(mins / 60)
    if (hrs < 24) return `${hrs}h`
    return `${Math.floor(hrs / 24)}d`
  }

  return (
    <>
      <Nav />
      <div className="page" style={{ padding: '16px 16px 80px' }}>
        <div style={{ fontFamily: "'Kanit', sans-serif", fontSize: 22, fontWeight: 700, marginBottom: 16 }}>
          Dashboard
        </div>

        {loading && <div style={{ textAlign: 'center', padding: 40, color: '#94A3B8' }}>Loading...</div>}

        {data && (
          <>
            {/* North Star — กดติดต่อ */}
            <div style={{ background: 'linear-gradient(135deg, #1D4ED8 0%, #2563EB 100%)', borderRadius: 16, padding: '20px 18px', marginBottom: 12, color: 'white' }}>
              <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 4 }}>NORTH STAR — กดติดต่อผู้ขาย</div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                <span style={{ fontSize: 36, fontWeight: 700 }}>{data.northStar.contacts.today}</span>
                <span style={{ fontSize: 14, opacity: 0.8 }}>วันนี้</span>
              </div>
              <div style={{ display: 'flex', gap: 16, marginTop: 8, fontSize: 13, opacity: 0.85 }}>
                <span>7 วัน: <b>{data.northStar.contacts.d7}</b></span>
                <span>30 วัน: <b>{data.northStar.contacts.d30}</b></span>
              </div>
            </div>

            {/* Metrics grid */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 16 }}>
              {[
                { label: 'Listings ใหม่', today: data.northStar.listings.today, d7: data.northStar.listings.d7, total: data.totals.activeListings, icon: '📦' },
                { label: 'Users ใหม่', today: data.northStar.users.today, d7: data.northStar.users.d7, total: data.totals.users, icon: '👤' },
                { label: 'ตามหาใหม่', today: data.northStar.wanted.today, d7: data.northStar.wanted.d7, total: data.totals.activeWanted, icon: '🔔' },
                { label: 'หนังสือในระบบ', today: null, d7: null, total: data.totals.books, icon: '📚' },
              ].map((m, i) => (
                <div key={i} style={{ background: 'white', border: '1px solid var(--border)', borderRadius: 12, padding: '14px 12px' }}>
                  <div style={{ fontSize: 11, color: 'var(--ink3)', marginBottom: 6 }}>{m.icon} {m.label}</div>
                  <div style={{ fontSize: 22, fontWeight: 700, color: '#121212' }}>{m.total?.toLocaleString()}</div>
                  {m.today !== null && (
                    <div style={{ fontSize: 11, color: 'var(--ink3)', marginTop: 4 }}>
                      วันนี้ <b style={{ color: m.today > 0 ? '#15803D' : '#94A3B8' }}>+{m.today}</b> · 7d <b>+{m.d7}</b>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Recent activity */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#121212', marginBottom: 10 }}>Activity ล่าสุด</div>

              {data.recent.contacts.length > 0 && (
                <div style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: 11, color: 'var(--ink3)', marginBottom: 6 }}>กดติดต่อ</div>
                  {data.recent.contacts.map((c: any, i: number) => (
                    <div key={i} style={{ fontSize: 12, color: 'var(--ink2)', padding: '4px 0', borderBottom: '1px solid #F1F5F9' }}>
                      📞 {(c.listings as any)?.books?.title || 'Unknown'} <span style={{ color: '#94A3B8', marginLeft: 4 }}>{timeSince(c.created_at)}</span>
                    </div>
                  ))}
                </div>
              )}

              {data.recent.listings.length > 0 && (
                <div style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: 11, color: 'var(--ink3)', marginBottom: 6 }}>ลงขายใหม่</div>
                  {data.recent.listings.map((l: any, i: number) => (
                    <div key={i} style={{ fontSize: 12, color: 'var(--ink2)', padding: '4px 0', borderBottom: '1px solid #F1F5F9' }}>
                      📦 {l.books?.title || 'Unknown'} — ฿{l.price} <span style={{ color: '#94A3B8', marginLeft: 4 }}>{timeSince(l.created_at)}</span>
                    </div>
                  ))}
                </div>
              )}

              {data.recent.users.length > 0 && (
                <div>
                  <div style={{ fontSize: 11, color: 'var(--ink3)', marginBottom: 6 }}>สมาชิกใหม่</div>
                  {data.recent.users.map((u: any, i: number) => (
                    <div key={i} style={{ fontSize: 12, color: 'var(--ink2)', padding: '4px 0', borderBottom: '1px solid #F1F5F9' }}>
                      👤 {u.display_name} <span style={{ color: '#94A3B8', marginLeft: 4 }}>{timeSince(u.created_at)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}

        {/* Menu */}
        <div style={{ fontSize: 14, fontWeight: 700, color: '#121212', marginBottom: 10 }}>เครื่องมือ</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {menus.map(m => (
            <Link key={m.href} href={m.href} style={{ textDecoration: 'none', color: 'inherit' }}>
              <div style={{ background: 'white', border: '1px solid var(--border)', borderRadius: 14, padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 14 }}>
                <div style={{ fontSize: 24, lineHeight: 1 }}>{m.icon}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#121212' }}>{m.title}</div>
                  <div style={{ fontSize: 12, color: 'var(--ink3)', marginTop: 1 }}>{m.desc}</div>
                </div>
                {m.badge ? (
                  <span style={{ background: '#DC2626', color: 'white', borderRadius: 10, padding: '2px 8px', fontSize: 12, fontWeight: 700 }}>{m.badge}</span>
                ) : (
                  <span style={{ fontSize: 16, color: 'var(--ink3)' }}>›</span>
                )}
              </div>
            </Link>
          ))}
        </div>
      </div>
    </>
  )
}
