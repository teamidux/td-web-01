import type { Metadata } from 'next'
import HomeClient from './HomeClient'

// หน้าแรก — server wrapper เพื่อใส่ metadata/canonical (ตัว UI อยู่ใน HomeClient ไม่เปลี่ยน)
export const metadata: Metadata = {
  alternates: { canonical: '/' },
}

export default function HomePage() {
  return <HomeClient />
}
