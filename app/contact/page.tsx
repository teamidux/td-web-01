'use client'
import Link from 'next/link'
import { Nav, BottomNav } from '@/components/ui'

export default function ContactPage() {
  return (
    <>
      <Nav />
      <div className="page">
        <div style={{ maxWidth: 480, margin: '0 auto', padding: '24px 16px 80px' }}>
          <div style={{ fontFamily: "'Kanit', sans-serif", fontSize: 22, fontWeight: 700, marginBottom: 6 }}>ติดต่อเรา</div>
          <div style={{ fontSize: 14, color: 'var(--ink3)', marginBottom: 28 }}>มีคำถาม ข้อเสนอแนะ หรืออยากร่วมงานกัน ทักมาได้เลยครับ</div>

          {/* Email */}
          <div style={{ background: 'var(--surface)', borderRadius: 14, padding: 20, marginBottom: 14, display: 'flex', gap: 14, alignItems: 'center' }}>
            <div style={{ width: 44, height: 44, borderRadius: 12, background: 'var(--primary-light)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, flexShrink: 0 }}>📧</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink3)', marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.6px' }}>Email</div>
              <a href="mailto:teamidux@gmail.com" style={{ fontSize: 15, fontWeight: 600, color: 'var(--primary)', textDecoration: 'none' }}>
                teamidux@gmail.com
              </a>
              <div style={{ fontSize: 13, color: 'var(--ink3)', marginTop: 3 }}>ตอบภายใน 1-2 วันทำการ</div>
            </div>
          </div>

          {/* About */}
          <div style={{ background: 'var(--surface)', borderRadius: 14, padding: 20, marginBottom: 28 }}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>เกี่ยวกับ BookMatch</div>
            <div style={{ fontSize: 13, color: 'var(--ink2)', lineHeight: 1.8 }}>
              BookMatch คือตลาดซื้อขายหนังสือมือสองที่ออกแบบมาให้ใช้งานง่ายที่สุด
              ค้นหาด้วยชื่อหนังสือหรือสแกน barcode แล้วเจอคนขายได้ทันที
            </div>
          </div>

          <Link href="/">
            <button className="btn btn-ghost" style={{ width: '100%' }}>← กลับหน้าหลัก</button>
          </Link>
        </div>
      </div>
      <BottomNav />
    </>
  )
}
