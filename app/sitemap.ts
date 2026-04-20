// Dynamic sitemap.xml — auto-generate จาก books table + static pages
// Next.js 14 จะ serve ที่ /sitemap.xml อัตโนมัติ
//
// รวม books ทุกเล่มใน DB (ไม่กรอง listing/wanted) — ให้ Google index long-tail
// ถ้า > 50K records จะ split เป็น multiple sitemap files อัตโนมัติ (generateSitemaps)
//
// Refresh: revalidate ทุก 1 ชั่วโมง
import type { MetadataRoute } from 'next'
import { createClient } from '@supabase/supabase-js'

export const revalidate = 3600 // 1 ชั่วโมง

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://bookmatch.app'
const CHUNK_SIZE = 50000 // Google limit = 50K URLs/sitemap file

function db() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}

// Next.js 14+ pattern: split into multiple sitemap files ถ้า records เยอะ
// จะ generate /sitemap/0.xml, /sitemap/1.xml, ... + /sitemap.xml (index)
export async function generateSitemaps() {
  const sb = db()
  const { count } = await sb.from('books').select('*', { count: 'exact', head: true })
  const total = count || 0
  const chunks = Math.max(1, Math.ceil(total / CHUNK_SIZE))
  return Array.from({ length: chunks }, (_, i) => ({ id: i }))
}

export default async function sitemap({ id }: { id: number }): Promise<MetadataRoute.Sitemap> {
  const sb = db()
  const from = id * CHUNK_SIZE
  const to = from + CHUNK_SIZE - 1

  // Static pages เฉพาะ chunk แรก
  const staticPages: MetadataRoute.Sitemap = id === 0 ? [
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
  ] : []

  // ดึงทุก book ใน chunk — รวม books ที่ไม่มี listing (long-tail SEO)
  const { data: books } = await sb
    .from('books')
    .select('isbn, created_at, active_listings_count, wanted_count')
    .order('created_at', { ascending: false })
    .range(from, to)

  const bookPages: MetadataRoute.Sitemap = (books || [])
    .filter(b => b.isbn) // กัน null isbn
    .map(b => {
      const hasListings = (b.active_listings_count || 0) > 0
      const hasInterest = hasListings || (b.wanted_count || 0) > 0
      return {
        url: `${SITE_URL}/book/${b.isbn}`,
        lastModified: new Date(b.created_at),
        // หนังสือที่มี activity → crawl บ่อย / ไม่มี → crawl น้อยลง (ประหยัด crawl budget)
        changeFrequency: (b.active_listings_count || 0) > 5 ? 'daily' : hasInterest ? 'weekly' : 'monthly',
        priority: hasListings ? 0.8 : hasInterest ? 0.5 : 0.3,
      }
    })

  return [...staticPages, ...bookPages]
}
