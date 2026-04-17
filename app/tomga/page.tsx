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
  unreadMessages: number
  pendingReports: number
  recent: {
    contacts: any[]
    listings: any[]
    users: any[]
  }
}

type NotifStats = {
  sms: { today: number; month: number; cost_baht: string }
  line: { push_today: number; push_yesterday: number; reply_today: number; reply_yesterday: number; month_total: number | null; month_quota: number | null; quota_type: string | null }
}

export default function AdminPage() {
  const [data, setData] = useState<DashData | null>(null)
  const [notif, setNotif] = useState<NotifStats | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/tomga/dashboard')
      .then(r => r.json())
      .then(d => { if (!d.error) setData(d) })
      .finally(() => setLoading(false))
    fetch('/api/tomga/notification-stats')
      .then(r => r.json())
      .then(d => { if (!d.error) setNotif(d) })
      .catch(() => {})
  }, [])

  // Tools grouped by purpose — ลด cognitive load
  const toolGroups = [
    {
      title: 'จัดการ User',
      items: [
        { href: '/tomga/verify', icon: '🪪', title: 'ตรวจยืนยันตัวตน', desc: 'อนุมัติ/ปฏิเสธ เอกสาร', badge: data?.pendingVerify || 0 },
        { href: '/tomga/users', icon: '👥', title: 'จัดการ User', desc: 'Ban, delete, detect พฤติกรรม', badge: data?.suspiciousUsers || 0 },
        { href: '/tomga/investigate', icon: '🔍', title: 'ตรวจสอบ User', desc: 'ค้นหาเบอร์/ชื่อ ดูประวัติ ban/delete', badge: 0 },
        { href: '/tomga/messages', icon: '💬', title: 'ข้อความ & รายงาน', desc: 'ข้อความ + รายงานโกง', badge: (data?.unreadMessages || 0) + (data?.pendingReports || 0) },
      ],
    },
    {
      title: 'จัดการ Content',
      items: [
        { href: '/tomga/books', icon: '📖', title: 'ข้อมูลหนังสือ', desc: 'แก้ชื่อ, ผู้แต่ง, รูปปก', badge: 0 },
        { href: '/tomga/reports', icon: '✏️', title: 'รายงานแก้ข้อมูล', desc: 'user รายงานว่าชื่อ/ผู้แต่งผิด', badge: (data as any)?.pendingBookReports || 0 },
        { href: '/tomga/listings', icon: '📦', title: 'Listings', desc: 'ลบ listing ไม่เหมาะสม', badge: 0 },
        { href: '/tomga/import', icon: '📥', title: 'Import หนังสือ', desc: 'Upload CSV เข้า DB', badge: 0 },
      ],
    },
    {
      title: 'วิเคราะห์',
      items: [
        { href: '/tomga/search-logs', icon: '🔍', title: 'Search Logs', desc: 'Keyword ยอดนิยม + demand ที่ไม่มี supply', badge: 0 },
      ],
    },
    {
      title: 'ระบบ',
      items: [
        { href: '/tomga/audit', icon: '📋', title: 'Audit Log', desc: 'ประวัติการทำงาน admin', badge: 0 },
      ],
    },
  ]

  // Alerts — จัดเรียงสิ่งที่ admin ต้องทำตอนนี้
  const alerts = data ? [
    { count: data.pendingVerify, icon: '🪪', label: 'ตรวจยืนยันตัวตนค้าง', href: '/tomga/verify', color: '#2563EB' },
    { count: data.unreadMessages, icon: '📬', label: 'ข้อความใหม่ยังไม่อ่าน', href: '/tomga/messages', color: '#7C3AED' },
    { count: data.pendingReports, icon: '🚨', label: 'รายงานใหม่ยังไม่ตรวจ', href: '/tomga/messages', color: '#DC2626' },
    { count: data.suspiciousUsers, icon: '🚩', label: 'User น่าสงสัย', href: '/tomga/users?tab=suspicious', color: '#D97706' },
    { count: (data as any).pendingBookReports || 0, icon: '✏️', label: 'รายงานแก้ข้อมูลหนังสือ', href: '/tomga/reports', color: '#2563EB' },
  ].filter(a => a.count > 0) : []

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
            {/* 🔥 Alerts — สิ่งที่ admin ต้องทำตอนนี้ */}
            {alerts.length > 0 ? (
              <div style={{ marginBottom: 24 }}>
                <h2 style={{ fontSize: 16, fontWeight: 700, color: '#64748B', marginBottom: 12, letterSpacing: '0.02em' }}>
                  🔥 ต้องทำตอนนี้
                </h2>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 10 }}>
                  {alerts.map((a, i) => (
                    <Link key={i} href={a.href} style={{ textDecoration: 'none', color: 'inherit' }}>
                      <div style={{
                        background: 'white',
                        border: `1px solid ${a.color}33`,
                        borderLeft: `4px solid ${a.color}`,
                        borderRadius: 12,
                        padding: '14px 18px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 14,
                        cursor: 'pointer',
                        transition: 'box-shadow .15s',
                      }}
                      onMouseOver={e => { (e.currentTarget as HTMLElement).style.boxShadow = '0 2px 12px rgba(0,0,0,.06)' }}
                      onMouseOut={e => { (e.currentTarget as HTMLElement).style.boxShadow = 'none' }}
                      >
                        <span style={{ fontSize: 24 }}>{a.icon}</span>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 13, color: '#64748B', marginBottom: 2 }}>{a.label}</div>
                          <div style={{ fontSize: 22, fontWeight: 800, color: a.color, lineHeight: 1 }}>{a.count}</div>
                        </div>
                        <span style={{ fontSize: 18, color: '#CBD5E1' }}>›</span>
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            ) : (
              <div style={{ background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: 12, padding: '14px 18px', marginBottom: 24, fontSize: 14, color: '#15803D', display: 'flex', alignItems: 'center', gap: 10 }}>
                ✓ ไม่มีงานค้างให้ admin จัดการ
              </div>
            )}

            {/* North Star — เล็กลง สีอ่อนลง */}
            <div style={{
              background: 'linear-gradient(135deg, #EFF6FF 0%, #DBEAFE 100%)',
              border: '1px solid #BFDBFE',
              borderRadius: 14,
              padding: '20px 24px',
              marginBottom: 16,
            }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#2563EB', letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: 8 }}>
                ⭐ North Star — กดติดต่อผู้ขาย
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 24, flexWrap: 'wrap' }}>
                <div>
                  <span style={{ fontSize: 36, fontWeight: 800, color: '#1E3A8A', lineHeight: 1, letterSpacing: '-0.02em' }}>{data.northStar.contacts.today}</span>
                  <span style={{ fontSize: 13, color: '#64748B', marginLeft: 6 }}>วันนี้</span>
                </div>
                <div style={{ fontSize: 14, color: '#475569' }}>
                  <span style={{ color: '#94A3B8' }}>7 วัน</span> <b style={{ color: '#1E3A8A', fontSize: 16 }}>{data.northStar.contacts.d7}</b>
                  <span style={{ marginLeft: 14, color: '#94A3B8' }}>30 วัน</span> <b style={{ color: '#1E3A8A', fontSize: 16 }}>{data.northStar.contacts.d30}</b>
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

            {/* Stats — 4 metrics รายวัน focus เฉพาะ rate */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 36 }}>
              {[
                { label: 'ลงขายใหม่', today: data.northStar.listings.today, d7: data.northStar.listings.d7, total: data.totals.activeListings, icon: '📦' },
                { label: 'สมาชิกใหม่', today: data.northStar.users.today, d7: data.northStar.users.d7, total: data.totals.users, icon: '👤' },
                { label: 'ตามหาใหม่', today: data.northStar.wanted.today, d7: data.northStar.wanted.d7, total: data.totals.activeWanted, icon: '🔔' },
                { label: 'หนังสือทั้งหมด', today: null, d7: null, total: data.totals.books, icon: '📚' },
              ].map((m, i) => (
                <div key={i} style={{ background: 'white', border: '1px solid #E2E8F0', borderRadius: 12, padding: '18px 18px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                    <span style={{ fontSize: 18 }}>{m.icon}</span>
                    <span style={{ fontSize: 13, fontWeight: 600, color: '#64748B' }}>{m.label}</span>
                  </div>
                  <div style={{ fontSize: 28, fontWeight: 800, color: '#0F172A', letterSpacing: '-0.02em', lineHeight: 1 }}>
                    {m.total?.toLocaleString()}
                  </div>
                  {m.today !== null && (
                    <div style={{ fontSize: 12, color: '#94A3B8', marginTop: 8, display: 'flex', gap: 12 }}>
                      <span>วันนี้ <b style={{ color: (m.today ?? 0) > 0 ? '#16A34A' : '#94A3B8' }}>+{m.today}</b></span>
                      <span>7d <b style={{ color: '#64748B' }}>+{m.d7}</b></span>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Notification usage — คุมต้นทุน SMS + LINE */}
            {notif && (
              <div style={{ marginBottom: 36 }}>
                <h2 style={{ fontSize: 22, fontWeight: 700, color: '#0F172A', marginBottom: 16 }}>การใช้งาน Notification</h2>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
                  {/* SMS OTP (Firebase) */}
                  <div style={{ background: 'white', border: '1px solid #E2E8F0', borderRadius: 16, padding: '22px 24px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                      <span style={{ fontSize: 22 }}>📱</span>
                      <span style={{ fontSize: 16, fontWeight: 700, color: '#0F172A' }}>SMS OTP</span>
                      <span style={{ marginLeft: 'auto', fontSize: 11, color: '#F59E0B', background: '#FFFBEB', borderRadius: 6, padding: '2px 8px' }}>Firebase</span>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                      <div>
                        <div style={{ fontSize: 12, color: '#94A3B8', marginBottom: 4 }}>วันนี้</div>
                        <div style={{ fontSize: 28, fontWeight: 800, color: '#0F172A', lineHeight: 1 }}>{notif.sms.today}</div>
                      </div>
                      <div>
                        <div style={{ fontSize: 12, color: '#94A3B8', marginBottom: 4 }}>เดือนนี้</div>
                        <div style={{ fontSize: 28, fontWeight: 800, color: '#0F172A', lineHeight: 1 }}>{notif.sms.month} <span style={{ fontSize: 14, color: '#94A3B8', fontWeight: 600 }}>/ 10,000</span></div>
                      </div>
                    </div>
                    <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid #F1F5F9', fontSize: 13, color: '#64748B' }}>
                      {(notif.sms as any).cost_note || 'Firebase free tier 10,000/เดือน'} <span style={{ fontSize: 11, color: '#16A34A' }}>ฟรี</span>
                    </div>
                  </div>

                  {/* LINE */}
                  <div style={{ background: 'white', border: '1px solid #E2E8F0', borderRadius: 16, padding: '22px 24px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                      <span style={{ fontSize: 22 }}>💬</span>
                      <span style={{ fontSize: 16, fontWeight: 700, color: '#0F172A' }}>LINE Messaging</span>
                      <span style={{ marginLeft: 'auto', fontSize: 11, color: '#16A34A', background: '#DCFCE7', borderRadius: 6, padding: '2px 8px' }}>ฟรี</span>
                    </div>
                    {notif.line.month_total !== null && notif.line.month_quota !== null ? (
                      <>
                        <div style={{ fontSize: 12, color: '#94A3B8', marginBottom: 4 }}>ส่งเดือนนี้ / quota</div>
                        <div style={{ fontSize: 28, fontWeight: 800, color: '#0F172A', lineHeight: 1, marginBottom: 8 }}>
                          {notif.line.month_total} <span style={{ fontSize: 16, color: '#94A3B8', fontWeight: 600 }}>/ {notif.line.quota_type === 'none' ? '∞' : notif.line.month_quota}</span>
                        </div>
                        {notif.line.quota_type !== 'none' && (
                          <div style={{ height: 6, background: '#F1F5F9', borderRadius: 3, overflow: 'hidden', marginBottom: 12 }}>
                            <div style={{
                              height: '100%',
                              width: `${Math.min(100, (notif.line.month_total / notif.line.month_quota) * 100)}%`,
                              background: notif.line.month_total / notif.line.month_quota > 0.8 ? '#DC2626' : notif.line.month_total / notif.line.month_quota > 0.5 ? '#D97706' : '#16A34A',
                              transition: 'width .5s',
                            }} />
                          </div>
                        )}
                      </>
                    ) : (
                      <div style={{ fontSize: 13, color: '#94A3B8', marginBottom: 12 }}>ดึง quota จาก LINE API ไม่สำเร็จ — เช็ค LINE_OA_CHANNEL_ACCESS_TOKEN</div>
                    )}
                    <div style={{ paddingTop: 12, borderTop: '1px solid #F1F5F9', fontSize: 12, color: '#64748B', display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                      <span>Push เมื่อวาน: <b>{notif.line.push_yesterday}</b></span>
                      <span>Reply เมื่อวาน: <b>{notif.line.reply_yesterday}</b></span>
                    </div>
                  </div>
                </div>
              </div>
            )}

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

        {/* Tools — grouped 3 หมวด */}
        <h2 style={{ fontSize: 22, fontWeight: 700, color: '#0F172A', marginBottom: 16 }}>เครื่องมือ</h2>
        {toolGroups.map(group => (
          <div key={group.title} style={{ marginBottom: 24 }}>
            <h3 style={{ fontSize: 13, fontWeight: 700, color: '#94A3B8', marginBottom: 10, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
              {group.title}
            </h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 10 }}>
              {group.items.map(m => (
                <Link key={m.href} href={m.href} style={{ textDecoration: 'none', color: 'inherit' }}>
                  <div style={{
                    background: 'white',
                    border: '1px solid #E2E8F0',
                    borderRadius: 12,
                    padding: '16px 18px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 14,
                    transition: 'box-shadow .15s, border-color .15s',
                    cursor: 'pointer',
                  }}
                    onMouseOver={e => { (e.currentTarget as HTMLElement).style.boxShadow = '0 2px 10px rgba(0,0,0,.06)'; (e.currentTarget as HTMLElement).style.borderColor = '#CBD5E1' }}
                    onMouseOut={e => { (e.currentTarget as HTMLElement).style.boxShadow = 'none'; (e.currentTarget as HTMLElement).style.borderColor = '#E2E8F0' }}
                  >
                    <div style={{ fontSize: 26, lineHeight: 1 }}>{m.icon}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 15, fontWeight: 700, color: '#0F172A' }}>{m.title}</div>
                      <div style={{ fontSize: 12, color: '#94A3B8', marginTop: 2 }}>{m.desc}</div>
                    </div>
                    {m.badge ? (
                      <span style={{ background: '#DC2626', color: 'white', borderRadius: 10, padding: '3px 10px', fontSize: 13, fontWeight: 700, minWidth: 24, textAlign: 'center' }}>{m.badge}</span>
                    ) : (
                      <span style={{ fontSize: 18, color: '#CBD5E1', fontWeight: 300 }}>›</span>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          </div>
        ))}
      </div>
    </>
  )
}
