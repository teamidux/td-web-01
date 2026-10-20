import type { Metadata } from 'next'

// metadata ของ route นี้ (หน้า page เป็น client component ใส่ metadata เองไม่ได้)
export const metadata: Metadata = {
  title: 'หนังสือที่มีคนตามหา — ลงขายแล้วมีคนรอซื้อ',
  description: 'รายการหนังสือที่มีคนกำลังตามหาบน BookMatch ถ้าคุณมีเล่มนี้อยู่ ลงขายแล้วมีผู้ซื้อรออยู่ทันที ขายหนังสือมือสองได้เร็ว',
  alternates: { canonical: '/market' },
  openGraph: { title: 'หนังสือที่มีคนตามหา — BookMatch', description: 'หนังสือที่มีคนกำลังตามหา ลงขายแล้วมีผู้ซื้อรออยู่ทันที', url: '/market', type: 'website' },
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
