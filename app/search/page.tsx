import type { Metadata } from 'next'
import SearchClient from './SearchClient'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://bookmatch.app'

// Dynamic metadata — แต่ละ query ได้ title/description ของตัวเอง (SEO)
export async function generateMetadata({
  searchParams,
}: {
  searchParams: { q?: string }
}): Promise<Metadata> {
  const q = searchParams.q?.trim() || ''
  const title = q ? `ค้นหา "${q}" — หนังสือมือสอง` : 'ค้นหาหนังสือ'
  const description = q
    ? `ผลการค้นหา "${q}" บน BookMatch — หนังสือมือสอง ราคาถูก ค้นด้วย ISBN หรือชื่อหนังสือ`
    : 'ค้นหาหนังสือมือสองบน BookMatch ด้วย ISBN หรือชื่อหนังสือ ราคาดี หาง่าย เจอผู้ขายจริง'
  const url = q ? `${SITE_URL}/search?q=${encodeURIComponent(q)}` : `${SITE_URL}/search`
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: { title, description, url, type: 'website' },
    twitter: { card: 'summary', title, description },
  }
}

export default function Page() {
  return <SearchClient />
}
