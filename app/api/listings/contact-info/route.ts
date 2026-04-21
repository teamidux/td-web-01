// ดึง contact info ของผู้ขาย — ไม่ต้อง login (เพื่อ conversion)
// Business decision: open access > PII protection
// กัน scrape ด้วย rate limit ต่อ IP + middleware bot UA block (gptbot/scrapy ฯลฯ)
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { checkRateLimit, getClientIp } from '@/lib/rate-limit'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  // Rate limit: 20 ครั้ง/นาที/IP — กัน bulk scrape
  // (login ไม่บังคับ → ใช้ IP-based ชั้นเดียว)
  if (!checkRateLimit(`contact:${getClientIp(req)}`, 20, 60_000)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 })
  }

  const sellerId = req.nextUrl.searchParams.get('seller_id')
  const listingId = req.nextUrl.searchParams.get('listing_id')
  if (!sellerId || !listingId) {
    return NextResponse.json({ error: 'missing seller_id and listing_id' }, { status: 400 })
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  // Query พร้อมกัน — เร็วขึ้น 2x
  const [{ data: listing }, { data: userData }] = await Promise.all([
    supabase.from('listings').select('id').eq('id', listingId).eq('seller_id', sellerId).eq('status', 'active').maybeSingle(),
    supabase.from('users').select('line_id, phone').eq('id', sellerId).maybeSingle(),
  ])

  if (!listing) {
    return NextResponse.json({ error: 'listing not found' }, { status: 404 })
  }

  return NextResponse.json({
    line_id: userData?.line_id || null,
    phone: userData?.phone || null,
  })
}
