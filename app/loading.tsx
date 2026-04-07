export default function Loading() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '60vh', gap: 14 }}>
      <span className="spin" style={{ width: 28, height: 28 }} />
      <div style={{ fontSize: 14, color: 'var(--ink3)', fontFamily: 'Kanit' }}>กำลังโหลด...</div>
    </div>
  )
}
