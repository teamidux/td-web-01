import type { Metadata } from 'next'

// metadata ของ route นี้ (หน้า page เป็น client component ใส่ metadata เองไม่ได้)
export const metadata: Metadata = {
  title: 'ติดต่อเรา',
  description: 'ติดต่อทีมงาน BookMatch แจ้งปัญหาการใช้งาน สอบถามการซื้อขายหนังสือมือสอง หรือส่งข้อเสนอแนะ',
  alternates: { canonical: '/contact' },
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
