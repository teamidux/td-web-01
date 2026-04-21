// Browse listings — รองรับ filter + sort + pagination (infinite scroll)
// Public endpoint — อ่าน active listings เท่านั้น + กรอง banned/deleted sellers
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { checkRateLimit, getClientIp } from '@/lib/rate-limit'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  if (!checkRateLimit(`browse:${getClientIp(req)}`, 60, 60_000)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 })
  }

  const params = req.nextUrl.searchParams
  const limit = Math.min(Math.max(1, Number(params.get('limit') || 24)), 100)
  const offset = Math.max(0, Number(params.get('offset') || 0))
  const sort = (params.get('sort') || 'newest') as 'newest' | 'price_asc' | 'price_desc' | 'popular'
  const condition = params.get('condition') // brand_new | new | good | fair | null
  const lang = params.get('lang') // th | en | null
  const minPrice = params.get('minPrice') ? Number(params.get('minPrice')) : null
  const maxPrice = params.get('maxPrice') ? Number(params.get('maxPrice')) : null

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  let q = supabase
    .from('listings')
    .select('id, seller_id, price, condition, price_includes_shipping, photos, created_at, books!inner(id, isbn, title, author, cover_url, language, wanted_count), users!seller_id(banned_at, deleted_at)', { count: 'exact' })
    .eq('status', 'active')
    .is('users.banned_at', null)
    .is('users.deleted_at', null)

  // filter — whitelist เท่านั้น กัน injection
  if (condition && ['brand_new', 'new', 'good', 'fair'].includes(condition)) {
    q = q.eq('condition', condition)
  }
  if (lang && ['th', 'en'].includes(lang)) {
    q = q.eq('books.language', lang)
  }
  if (minPrice !== null && !isNaN(minPrice) && minPrice >= 0) {
    q = q.gte('price', minPrice)
  }
  if (maxPrice !== null && !isNaN(maxPrice) && maxPrice > 0 && maxPrice <= 999999) {
    q = q.lte('price', maxPrice)
  }

  // sort
  if (sort === 'price_asc') q = q.order('price', { ascending: true })
  else if (sort === 'price_desc') q = q.order('price', { ascending: false })
  else if (sort === 'popular') q = q.order('books(wanted_count)', { ascending: false }).order('created_at', { ascending: false })
  else q = q.order('created_at', { ascending: false })

  q = q.range(offset, offset + limit - 1)

  const { data, count, error } = await q
  if (error) { console.error('[listings/browse] query:', error); return NextResponse.json({ error: 'db_error', listings: [] }, { status: 500 }) }

  const clean = (data || []).map((l: any) => { const { users, ...rest } = l; return rest })
  return NextResponse.json({
    listings: clean,
    total: count || 0,
    hasMore: (offset + clean.length) < (count || 0),
  })
}
