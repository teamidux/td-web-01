'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'

type DashData = {
  totals: { books: number; users: number; activeListings: number; activeWanted: number }
  northStar: {
    contacts: { today: number; d7: number; d30: number }
    listings: { today: number; d7: number }
    users: { today: number; d7: number }
    wanted: { today: number; d7: number }
  }
  pendingVerify: number
  suspiciousUsers: number
  bannedUsers: number
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
    { href: '/tomga/users', icon: '👥', title: 'จัดการ User', desc: data?.suspiciousUsers ? `🚩 ${data.suspiciousUsers} น่าสงสัย · ${data.bannedUsers || 0} banned` : 'Ban, soft delete, ระบบ detect พฤติกรรมน่าสงสัย', badge: data?.suspiciousUsers || 0 },
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
      {/* Admin Nav */}
      <nav style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 0', borderBottom: '1px solid #E2E8F0', marginBottom: 8 }}>
        <Link href="/tomga" style={{ fontFamily: "'Kanit', sans-serif", fontSize: 20, fontWeight: 700, color: '#2563EB', textDecoration: 'none' }}>
          BookMatch <span style={{ fontSize: 14, color: '#94A3B8', fontWeight: 500 }}>Admin</span>
        </Link>
        <Link href="/" style={{ fontSize: 15, color: '#64748B', textDecoration: 'none', fontFamily: 'Kanit' }}>← กลับหน้าเว็บ</Link>
      </nav>

      <div style={{ padding: '24px 0 80px' }}>

        {/* Header */}
        <div style={{ marginBottom: 32 }}>
          <h1 style={{ fontFamily: "'Kanit', sans-serif", fontSize: 32, fontWeight: 800, color: '#0F172A', letterSpacing: '-0.03em', margin: 0 }}>
            Dashboard
          </h1>
          <p style={{ fontSize: 16, color: '#94A3B8', marginTop: 6 }}>
            {new Date().toLocaleDateString('th-TH', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
          </p>
        </div>

        {loading && <div style={{ textAlign: 'center', padding: 80, color: '#94A3B8', fontSize: 18 }}>Loading...</div>}

        {data && (
          <>
            {/* North Star */}
            <div style={{
              background: 'linear-gradient(135deg, #1E3A8A 0%, #2563EB 50%, #3B82F6 100%)',
              borderRadius: 20,
              padding: '36px 32px',
              marginBottom: 24,
              color: 'white',
              boxShadow: '0 4px 24px rgba(37,99,235,.25)',
            }}>
              <div style={{ fontSize: 15, fontWeight: 600, opacity: 0.75, letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: 12 }}>
                North Star — กดติดต่อผู้ขาย
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, marginBottom: 20 }}>
                <span style={{ fontSize: 64, fontWeight: 800, lineHeight: 1, letterSpacing: '-0.02em' }}>{data.northStar.contacts.today}</span>
                <span style={{ fontSize: 20, fontWeight: 500, opacity: 0.7 }}>วันนี้</span>
              </div>
              <div style={{ display: 'flex', gap: 32, fontSize: 17 }}>
                <div>
                  <span style={{ opacity: 0.6 }}>7 วัน</span>
                  <span style={{ fontWeight: 700, marginLeft: 8, fontSize: 20 }}>{data.northStar.contacts.d7}</span>
                </div>
                <div>
                  <span style={{ opacity: 0.6 }}>30 วัน</span>
                  <span style={{ fontWeight: 700, marginLeft: 8, fontSize: 20 }}>{data.northStar.contacts.d30}</span>
                </div>
              </div>
            </div>

            {/* Phase indicator */}
            {(() => {
              const weeklyContacts = data.northStar.contacts.d7
              const phase = weeklyContacts >= 200 ? 3 : weeklyContacts >= 50 ? 2 : 1
              const phases = [
                { n: 1, label: 'Match & Connect', target: '50 กดติดต่อ/สัปดาห์', focus: 'หา user, เพิ่ม catalog, distribution', color: '#2563EB' },
                { n: 2, label: 'Trust & Track Record', target: '200 ดีล/สัปดาห์', focus: 'ระบบ confirm ขายสำเร็จ, review/rating', color: '#7C3AED' },
                { n: 3, label: 'Escrow & Logistics', target: 'Scale', focus: 'เงินผ่านระบบ, ขนส่ง, ทีม dispute', color: '#059669' },
              ]
              const current = phases[phase - 1]
              const next = phases[phase] || null
              return (
                <div style={{ background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 16, padding: '20px 24px', marginBottom: 24 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                    <span style={{ background: current.color, color: 'white', borderRadius: 8, padding: '4px 14px', fontSize: 14, fontWeight: 700 }}>Phase {phase}</span>
                    <span style={{ fontSize: 17, fontWeight: 700, color: '#92400E' }}>{current.label}</span>
                  </div>
                  <div style={{ fontSize: 15, color: '#78350F', lineHeight: 1.7, marginBottom: 8 }}>
                    โฟกัส: <b>{current.focus}</b>
                  </div>
                  <div style={{ display: 'flex', gap: 16, fontSize: 14, color: '#92400E' }}>
                    <span>กดติดต่อ 7 วัน: <b style={{ fontSize: 16 }}>{weeklyContacts}</b></span>
                    {next && <span>เป้าถัดไป: <b style={{ fontSize: 16 }}>{next.target}</b></span>}
                  </div>
                  {next && (
                    <div style={{ marginTop: 12 }}>
                      <div style={{ height: 8, background: '#FDE68A', borderRadius: 4, overflow: 'hidden' }}>
                        <div style={{ height: '100%', background: current.color, borderRadius: 4, width: `${Math.min(100, (weeklyContacts / (phase === 1 ? 50 : 200)) * 100)}%`, transition: 'width .5s' }} />
                      </div>
                    </div>
                  )}
                </div>
              )
            })()}

            {/* Metrics grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16, marginBottom: 36 }}>
              {[
                { label: 'ลงขายใหม่', today: data.northStar.listings.today, d7: data.northStar.listings.d7, total: data.totals.activeListings, icon: '📦', color: '#2563EB' },
                { label: 'สมาชิกใหม่', today: data.northStar.users.today, d7: data.northStar.users.d7, total: data.totals.users, icon: '👤', color: '#7C3AED' },
                { label: 'ตามหาใหม่', today: data.northStar.wanted.today, d7: data.northStar.wanted.d7, total: data.totals.activeWanted, icon: '🔔', color: '#D97706' },
                { label: 'หนังสือในระบบ', today: null, d7: null, total: data.totals.books, icon: '📚', color: '#059669' },
                { label: 'User น่าสงสัย', today: null, d7: null, total: data.suspiciousUsers, icon: '🚩', color: '#DC2626' },
                { label: 'User ถูก Ban', today: null, d7: null, total: data.bannedUsers, icon: '🛑', color: '#991B1B' },
              ].map((m, i) => (
                <div key={i} style={{
                  background: 'white',
                  border: '1px solid #E2E8F0',
                  borderRadius: 16,
                  padding: '24px 22px',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                    <span style={{ fontSize: 22 }}>{m.icon}</span>
                    <span style={{ fontSize: 15, fontWeight: 600, color: '#64748B' }}>{m.label}</span>
                  </div>
                  <div style={{ fontSize: 36, fontWeight: 800, color: '#0F172A', letterSpacing: '-0.02em', lineHeight: 1 }}>
                    {m.total?.toLocaleString()}
                  </div>
                  {m.today !== null && (
                    <div style={{ fontSize: 15, color: '#94A3B8', marginTop: 10, display: 'flex', gap: 16 }}>
                      <span>วันนี้ <b style={{ color: (m.today ?? 0) > 0 ? '#16A34A' : '#94A3B8' }}>+{m.today}</b></span>
                      <span>7d <b style={{ color: '#64748B' }}>+{m.d7}</b></span>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Recent activity */}
            <div style={{ marginBottom: 36 }}>
              <h2 style={{ fontSize: 22, fontWeight: 700, color: '#0F172A', marginBottom: 20 }}>Activity ล่าสุด</h2>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 20 }}>
                {/* กดติดต่อ */}
                <div style={{ background: 'white', border: '1px solid #E2E8F0', borderRadius: 16, padding: '22px 20px' }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: '#475569', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#2563EB' }} />
                    กดติดต่อ
                  </div>
                  {data.recent.contacts.length === 0 && <div style={{ fontSize: 15, color: '#CBD5E1', padding: '10px 0' }}>ยังไม่มี</div>}
                  {data.recent.contacts.map((c: any, i: number) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: i < data.recent.contacts.length - 1 ? '1px solid #F1F5F9' : 'none' }}>
                      <span style={{ fontSize: 15, color: '#334155', fontWeight: 500 }}>{(c.listings as any)?.books?.title || '—'}</span>
                      <span style={{ fontSize: 14, color: '#94A3B8', flexShrink: 0, marginLeft: 12 }}>{timeSince(c.created_at)}</span>
                    </div>
                  ))}
                </div>

                {/* ลงขายใหม่ */}
                <div style={{ background: 'white', border: '1px solid #E2E8F0', borderRadius: 16, padding: '22px 20px' }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: '#475569', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#16A34A' }} />
                    ลงขายใหม่
                  </div>
                  {data.recent.listings.length === 0 && <div style={{ fontSize: 15, color: '#CBD5E1', padding: '10px 0' }}>ยังไม่มี</div>}
                  {data.recent.listings.map((l: any, i: number) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: i < data.recent.listings.length - 1 ? '1px solid #F1F5F9' : 'none' }}>
                      <span style={{ fontSize: 15, color: '#334155', fontWeight: 500 }}>{l.books?.title || '—'}</span>
                      <span style={{ fontSize: 15, fontWeight: 700, color: '#16A34A', flexShrink: 0, marginLeft: 12 }}>฿{l.price}</span>
                    </div>
                  ))}
                </div>

                {/* สมาชิกใหม่ */}
                <div style={{ background: 'white', border: '1px solid #E2E8F0', borderRadius: 16, padding: '22px 20px' }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: '#475569', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#7C3AED' }} />
                    สมาชิกใหม่
                  </div>
                  {data.recent.users.length === 0 && <div style={{ fontSize: 15, color: '#CBD5E1', padding: '10px 0' }}>ยังไม่มี</div>}
                  {data.recent.users.map((u: any, i: number) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: i < data.recent.users.length - 1 ? '1px solid #F1F5F9' : 'none' }}>
                      <span style={{ fontSize: 15, color: '#334155', fontWeight: 500 }}>{u.display_name}</span>
                      <span style={{ fontSize: 14, color: '#94A3B8', flexShrink: 0, marginLeft: 12 }}>{timeSince(u.created_at)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </>
        )}

        {/* Menu */}
        <h2 style={{ fontSize: 22, fontWeight: 700, color: '#0F172A', marginBottom: 16 }}>เครื่องมือ</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 14 }}>
          {menus.map(m => (
            <Link key={m.href} href={m.href} style={{ textDecoration: 'none', color: 'inherit' }}>
              <div style={{
                background: 'white',
                border: '1px solid #E2E8F0',
                borderRadius: 16,
                padding: '22px 24px',
                display: 'flex',
                alignItems: 'center',
                gap: 18,
                transition: 'box-shadow .15s, border-color .15s',
                cursor: 'pointer',
              }}
                onMouseOver={e => { (e.currentTarget as HTMLElement).style.boxShadow = '0 2px 12px rgba(0,0,0,.08)'; (e.currentTarget as HTMLElement).style.borderColor = '#CBD5E1' }}
                onMouseOut={e => { (e.currentTarget as HTMLElement).style.boxShadow = 'none'; (e.currentTarget as HTMLElement).style.borderColor = '#E2E8F0' }}
              >
                <div style={{ fontSize: 32, lineHeight: 1 }}>{m.icon}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 17, fontWeight: 700, color: '#0F172A' }}>{m.title}</div>
                  <div style={{ fontSize: 14, color: '#94A3B8', marginTop: 3 }}>{m.desc}</div>
                </div>
                {m.badge ? (
                  <span style={{ background: '#DC2626', color: 'white', borderRadius: 12, padding: '4px 12px', fontSize: 15, fontWeight: 700, minWidth: 28, textAlign: 'center' }}>{m.badge}</span>
                ) : (
                  <span style={{ fontSize: 22, color: '#CBD5E1', fontWeight: 300 }}>›</span>
                )}
              </div>
            </Link>
          ))}
        </div>
      </div>
    </>
  )
}
