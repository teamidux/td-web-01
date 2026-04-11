// Dynamic sitemap.xml — auto-generate จาก books table + static pages
// Next.js 14 จะ serve ที่ /sitemap.xml อัตโนมัติ
//
// Refresh: revalidate ทุก 1 ชั่วโมง (book ใหม่จะ index ใน Google ภายใน ~1 ชม.)
import type { MetadataRoute } from 'next'
import { createClient } from '@supabase/supabase-js'

export const revalidate = 3600 // 1 ชั่วโมง

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://bookmatch.app'

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  // Static pages
  const staticPages: MetadataRoute.Sitemap = [
    {
      url: SITE_URL,
      lastModified: new Date(),
      changeFrequency: 'daily',
      priority: 1.0,
    },
    {
      url: `${SITE_URL}/terms`,
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 0.3,
    },
  ]

  // ดึงทุก book ที่มี active listing หรือ wanted (มีคนสนใจ = น่า index)
  // ถ้าไม่มีคนสนใจเลย → ไม่ลง sitemap (ลด crawl budget)
  const { data: books } = await sb
    .from('books')
    .select('isbn, created_at, active_listings_count, wanted_count')
    .or('active_listings_count.gt.0,wanted_count.gt.0')
    .order('created_at', { ascending: false })
    .limit(5000) // sitemap limit ของ Google = 50k URL/file

  const bookPages: MetadataRoute.Sitemap = (books || []).map(b => ({
    url: `${SITE_URL}/book/${b.isbn}`,
    lastModified: new Date(b.created_at),
    // หนังสือที่มีคน list เยอะ → priority สูงกว่า
    changeFrequency: b.active_listings_count > 5 ? 'daily' : 'weekly',
    priority: b.active_listings_count > 0 ? 0.8 : 0.5,
  }))

  return [...staticPages, ...bookPages]
}
