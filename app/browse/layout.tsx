import type { Metadata } from 'next'

// metadata ของ route นี้ (หน้า page เป็น client component ใส่ metadata เองไม่ได้)
export const metadata: Metadata = {
  title: 'หนังสือมือสองพร้อมขายทั้งหมด',
  description: 'รวมหนังสือมือสองที่กำลังลงขายบน BookMatch เรียงตามล่าสุด ราคาถูก-แพง หรือยอดนิยม ดูราคาและติดต่อผู้ขายได้ทันที ส่งทั่วไทย',
  alternates: { canonical: '/browse' },
  openGraph: { title: 'หนังสือมือสองพร้อมขายทั้งหมด — BookMatch', description: 'รวมหนังสือมือสองที่กำลังลงขายบน BookMatch ดูราคาและติดต่อผู้ขายได้ทันที', url: '/browse', type: 'website' },
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
