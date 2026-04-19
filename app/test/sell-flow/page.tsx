'use client'
// Sell flow v2: Entry page — เลือกวิธีลงขาย (barcode / cover)
// ทดสอบแยกจาก /sell เดิม — ไม่แตะ production
import Link from 'next/link'

export default function SellFlowEntryPage() {
  return (
    <div style={{ padding: 16, paddingBottom: 80 }}>
      <header style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 11, color: 'var(--accent-dark)', fontWeight: 600, marginBottom: 4 }}>
          🧪 TEST FLOW
        </div>
        <h1 style={{ fontSize: 22, fontWeight: 700 }}>ลงขายหนังสือ</h1>
        <p style={{ fontSize: 13, color: 'var(--ink3)', marginTop: 4 }}>
          เลือกวิธีที่สะดวก — บาร์โค้ดเร็วที่สุด ถ้าไม่มีใช้ถ่ายปก
        </p>
      </header>

      {/* Primary: Barcode */}
      <Link href="/sell" style={{ textDecoration: 'none' }}>
        <button type="button" style={primaryCard}>
          <div style={{ fontSize: 40, marginBottom: 8 }}>📷</div>
          <div style={{ fontSize: 17, fontWeight: 700, color: 'white' }}>สแกนบาร์โค้ด ISBN</div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.85)', marginTop: 4 }}>
            เร็วที่สุด · ใช้ได้กับหนังสือที่มีบาร์โค้ด
          </div>
        </button>
      </Link>

      {/* Divider */}
      <div style={{ textAlign: 'center', margin: '16px 0', color: 'var(--ink3)', fontSize: 13, position: 'relative' }}>
        <span style={{ background: 'white', padding: '0 12px', position: 'relative', zIndex: 1 }}>หรือ</span>
        <div style={{ position: 'absolute', top: '50%', left: 0, right: 0, height: 1, background: 'var(--border)', zIndex: 0 }} />
      </div>

      {/* Secondary: Cover scan */}
      <Link href="/test/sell-flow/cover" style={{ textDecoration: 'none' }}>
        <button type="button" style={secondaryCard}>
          <div style={{ position: 'absolute', top: 10, right: 10, background: 'var(--accent)', color: 'var(--ink)', fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 10 }}>
            🆕 ใหม่
          </div>
          <div style={{ fontSize: 40, marginBottom: 8 }}>📖</div>
          <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--ink)' }}>ถ่ายหน้าปก</div>
          <div style={{ fontSize: 12, color: 'var(--ink3)', marginTop: 4 }}>
            สำหรับหนังสือเก่า ไม่มีบาร์โค้ด
          </div>
        </button>
      </Link>

      {/* Info */}
      <div style={{ marginTop: 24, padding: 12, background: 'var(--surface)', borderRadius: 8, fontSize: 12, color: 'var(--ink3)', lineHeight: 1.6 }}>
        💡 <strong>ทิป:</strong> ถ้าสแกนบาร์โค้ดแล้วไม่เจอข้อมูลในระบบ
        จะเปิดให้ถ่ายหน้าปกต่อเพื่อเพิ่มข้อมูลอัตโนมัติ
      </div>
    </div>
  )
}

const primaryCard: React.CSSProperties = {
  width: '100%', padding: '24px 16px', borderRadius: 12,
  background: 'var(--primary)', color: 'white', border: 0, cursor: 'pointer',
  textAlign: 'center', fontFamily: 'inherit', boxShadow: 'var(--shadow-sm)',
  position: 'relative',
}
const secondaryCard: React.CSSProperties = {
  width: '100%', padding: '24px 16px', borderRadius: 12,
  background: 'white', color: 'var(--ink)', border: '2px solid var(--primary)',
  cursor: 'pointer', textAlign: 'center', fontFamily: 'inherit',
  position: 'relative',
}
