import type { Metadata } from 'next'

// metadata ของ route นี้ (หน้า page เป็น client component ใส่ metadata เองไม่ได้)
export const metadata: Metadata = {
  // หน้าส่วนตัว/ขั้นตอนใช้งาน — ไม่ให้ติด index (robots.txt กัน crawl อยู่แล้ว นี่คือชั้นที่สอง)
  robots: { index: false, follow: false },
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
