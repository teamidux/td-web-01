// Sitemap — เฉพาะหน้าที่ควร index จริง (canonical + ตอบ 200 + มีเนื้อหา)
//
// หนังสือใน DB มี ~51K เล่ม แต่ ~98% ไม่มีปก ไม่มีคนขาย ไม่มีคำอธิบาย (thin page)
// ใส่ทั้งหมดจะเปลือง crawl budget และดึงคุณภาพรวมลง → จัดลำดับเป็น tier:
//   A: มีคนขายอยู่ (active_listings_count > 0)      priority 0.8  weekly
//   B: มีคนตามหา   (wanted_count > 0)               priority 0.6  weekly
//   C: มีภาพปก (cover_url)                          priority 0.5  monthly
// เล่มอื่นๆ ให้ Google เจอเองผ่าน internal link / search
//
// PostgREST cap 1000 แถวต่อคำขอ → ต้อง paginate ด้วย .range()
import { MetadataRoute } from 'next'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'
export const revalidate = 3600

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://bookmatch.app'
const PAGE = 1000
const MAX_PER_TIER = 20000

type BookRow = {
  isbn: string | null
  created_at: string
  updated_at: string | null
  active_listings_count: number | null
  wanted_count: number | null
}

type Tier = {
  filter: (q: any) => any
  priority: number
  changeFrequency: 'daily' | 'weekly' | 'monthly'
}

const TIERS: Tier[] = [
  { filter: q => q.gt('active_listings_count', 0), priority: 0.8, changeFrequency: 'weekly' },
  { filter: q => q.gt('wanted_count', 0), priority: 0.6, changeFrequency: 'weekly' },
  { filter: q => q.not('cover_url', 'is', null).neq('cover_url', ''), priority: 0.5, changeFrequency: 'monthly' },
]

async function fetchTier(sb: any, tier: Tier): Promise<BookRow[]> {
  const rows: BookRow[] = []
  for (let from = 0; from < MAX_PER_TIER; from += PAGE) {
    const base = sb
      .from('books')
      .select('isbn, created_at, updated_at, active_listings_count, wanted_count')
      .order('active_listings_count', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })
      .range(from, from + PAGE - 1)
    const { data, error } = await tier.filter(base)
    if (error) {
      console.error('[sitemap] supabase error:', error.message)
      break
    }
    if (!data || data.length === 0) break
    rows.push(...(data as BookRow[]))
    if (data.length < PAGE) break
  }
  return rows
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date()
  const staticPages: MetadataRoute.Sitemap = [
    { url: SITE_URL, lastModified: now, changeFrequency: 'daily', priority: 1 },
    { url: `${SITE_URL}/browse`, lastModified: now, changeFrequency: 'daily', priority: 0.9 },
    { url: `${SITE_URL}/market`, lastModified: now, changeFrequency: 'daily', priority: 0.8 },
    { url: `${SITE_URL}/impact`, lastModified: now, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${SITE_URL}/contact`, lastModified: now, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${SITE_URL}/terms`, lastModified: now, changeFrequency: 'yearly', priority: 0.2 },
  ]

  try {
    const sb = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )

    const seen = new Set<string>()
    const bookPages: MetadataRoute.Sitemap = []
    for (const tier of TIERS) {
      const rows = await fetchTier(sb, tier)
      for (const b of rows) {
        if (!b.isbn || seen.has(b.isbn)) continue   // tier สูงกว่าชนะ (ไม่ซ้ำ)
        seen.add(b.isbn)
        bookPages.push({
          url: `${SITE_URL}/book/${encodeURIComponent(b.isbn)}`,
          lastModified: new Date(b.updated_at || b.created_at),
          changeFrequency: (b.active_listings_count || 0) > 5 ? 'daily' : tier.changeFrequency,
          priority: tier.priority,
        })
      }
    }

    return [...staticPages, ...bookPages]
  } catch (err) {
    console.error('[sitemap] generation failed:', err)
    return staticPages
  }
}
