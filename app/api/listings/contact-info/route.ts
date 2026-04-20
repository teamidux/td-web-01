// ดึง contact info ของผู้ขาย — ต้อง login (กัน bulk scrape PII)
// ใครก็ตามที่ login แล้วกดดูได้ (flow ปกติ ลูกค้า → กดปุ่มติดต่อ → auth → ข้อมูล)
// ถ้าไม่ login จะได้ 401 แล้ว client push ไป LINE OAuth
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { checkRateLimit, getClientIp } from '@/lib/rate-limit'
import { getSessionUser } from '@/lib/session'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  // Session check ก่อน — กัน anonymous scrape PII (LINE/phone)
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  // Rate limit: 20 ครั้ง/นาที/IP กัน burst request (ถึงจะ login ก็กัน)
  if (!checkRateLimit(`contact:${user.id}`, 20, 60_000)) {
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
