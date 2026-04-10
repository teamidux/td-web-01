'use client'
import Link from 'next/link'
import { Nav } from '@/components/ui'

export default function AdminPage() {
  const menus = [
    { href: '/tomga/verify', icon: '🪪', title: 'ตรวจยืนยันตัวตน', desc: 'อนุมัติ/ปฏิเสธ บัตรประชาชน + สมุดบัญชี' },
    { href: '/tomga/import', icon: '📥', title: 'Import หนังสือ', desc: 'Upload CSV เข้าฐานข้อมูล' },
  ]

  return (
    <>
      <Nav />
      <div className="page" style={{ padding: '16px 16px 80px' }}>
        <div style={{ fontFamily: "'Kanit', sans-serif", fontSize: 22, fontWeight: 700, marginBottom: 16 }}>
          Admin
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {menus.map(m => (
            <Link key={m.href} href={m.href} style={{ textDecoration: 'none', color: 'inherit' }}>
              <div style={{ background: 'white', border: '1px solid var(--border)', borderRadius: 14, padding: 16, display: 'flex', alignItems: 'center', gap: 14, boxShadow: '0 1px 3px rgba(0,0,0,.04)' }}>
                <div style={{ fontSize: 28, lineHeight: 1 }}>{m.icon}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: '#121212' }}>{m.title}</div>
                  <div style={{ fontSize: 12, color: 'var(--ink3)', marginTop: 2 }}>{m.desc}</div>
                </div>
                <div style={{ fontSize: 18, color: 'var(--ink3)' }}>›</div>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </>
  )
}
