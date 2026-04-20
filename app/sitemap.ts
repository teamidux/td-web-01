// Dynamic sitemap.xml — Next.js จะ serve ที่ /sitemap.xml อัตโนมัติ
// รวม books ทุกเล่มใน DB (long-tail SEO)
//
// Note: ใช้ single-file sitemap (limit 50K เท่ากับ Google limit) แทน generateSitemaps
// เพราะ generateSitemaps ทำ /sitemap/<id>.xml ไม่ได้สร้าง /sitemap.xml อัตโนมัติ
// ซึ่งทำให้ submit Google Search Console ไม่ได้ (404)
//
// ถ้า DB > 50K ค่อย migrate ไป generateSitemaps + manual sitemap index route

import type { MetadataRoute } from 'next'
import { createClient } from '@supabase/supabase-js'

// Force dynamic — generate on-demand (ไม่ pre-render ตอน build)
// เพื่อกัน build fail ถ้า DB query ช้า/timeout ใน Vercel's build step
// revalidate ทำให้ cache 1 ชั่วโมง — request ส่วนใหญ่ได้จาก cache
export const dynamic = 'force-dynamic'
export const revalidate = 3600

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://bookmatch.app'

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
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

  // Wrap DB call ใน try/catch — ถ้า DB query fail ก็ return static pages อย่างน้อย
  // (กัน 404 ทั้งหน้าถ้า Supabase ล่ม/timeout)
  try {
    const sb = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )

    // ดึง books ทุกเล่ม — limit 50K (Google sitemap spec)
    // เรียงตาม active_listings_count desc เพื่อ high-value books อยู่ก่อน
    const { data: books, error } = await sb
      .from('books')
      .select('isbn, created_at, active_listings_count, wanted_count')
      .order('active_listings_count', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })
      .limit(50000)

    if (error) {
      console.error('[sitemap] supabase error:', error.message)
      return staticPages
    }

    const bookPages: MetadataRoute.Sitemap = (books || [])
      .filter(b => b.isbn)
      .map(b => {
        const hasListings = (b.active_listings_count || 0) > 0
        const hasInterest = hasListings || (b.wanted_count || 0) > 0
        return {
          url: `${SITE_URL}/book/${b.isbn}`,
          lastModified: new Date(b.created_at),
          changeFrequency: (b.active_listings_count || 0) > 5 ? 'daily' : hasInterest ? 'weekly' : 'monthly',
          priority: hasListings ? 0.8 : hasInterest ? 0.5 : 0.3,
        }
      })

    return [...staticPages, ...bookPages]
  } catch (err) {
    console.error('[sitemap] generation failed:', err)
    return staticPages
  }
}
