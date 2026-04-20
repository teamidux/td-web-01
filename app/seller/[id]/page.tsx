import type { Metadata } from 'next'
import { createClient } from '@supabase/supabase-js'
import SellerClient from './SellerClient'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://bookmatch.app'

interface PageProps {
  params: { id: string }
}

// Dynamic metadata — แต่ละ seller ได้ title/description ของตัวเอง (SEO)
// Google เห็นชื่อ seller ใน search results + FB/LINE share ได้ OG ถูก
export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  try {
    const sb = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )
    const { data } = await sb
      .from('users')
      .select('display_name, sold_count, avatar_url, is_verified')
      .eq('id', params.id)
      .maybeSingle()

    if (!data) {
      return { title: 'ไม่พบผู้ขาย', description: 'ผู้ขายนี้ไม่มีในระบบ' }
    }

    const name = data.display_name || 'ผู้ขาย'
    const verified = data.is_verified ? ' (ยืนยันตัวตน)' : ''
    const title = `${name}${verified} — ร้านหนังสือบน BookMatch`
    const description = `ดูหนังสือมือสองที่ ${name} กำลังขาย${
      data.sold_count ? ` · ขายไปแล้ว ${data.sold_count} เล่ม` : ''
    }`
    const url = `${SITE_URL}/seller/${params.id}`

    return {
      title,
      description,
      alternates: { canonical: url },
      openGraph: {
        title, description, url,
        type: 'profile',
        images: data.avatar_url ? [{ url: data.avatar_url }] : undefined,
      },
      twitter: { card: 'summary', title, description },
      robots: { index: true, follow: true },
    }
  } catch {
    return { title: 'ร้านหนังสือบน BookMatch' }
  }
}

export default function Page({ params }: PageProps) {
  return <SellerClient params={params} />
}
