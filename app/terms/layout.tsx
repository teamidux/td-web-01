import type { Metadata } from 'next'

// metadata ของ route นี้ (หน้า page เป็น client component ใส่ metadata เองไม่ได้)
export const metadata: Metadata = {
  title: 'ข้อตกลงและเงื่อนไขการใช้บริการ',
  description: 'ข้อตกลงและเงื่อนไขการใช้บริการ BookMatch ตลาดหนังสือมือสองออนไลน์ สิทธิ หน้าที่ และความรับผิดชอบของผู้ซื้อ ผู้ขาย และแพลตฟอร์ม',
  alternates: { canonical: '/terms' },
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
