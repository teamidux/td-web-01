import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { checkRateLimit, getClientIp } from '@/lib/rate-limit'

export async function GET(req: NextRequest) {
  if (!checkRateLimit(`recent:${getClientIp(req)}`, 30, 60_000)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 })
  }
  const limit = Math.min(Number(req.nextUrl.searchParams.get('limit') || 10), 20)

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  const { data, error } = await supabase
    .from('listings')
    .select('id, price, condition, price_includes_shipping, photos, created_at, books(id, isbn, title, author, cover_url), users!seller_id(banned_at, deleted_at)')
    .eq('status', 'active')
    .is('users.banned_at', null)
    .is('users.deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) {
    // Fallback ถ้า filter ไม่ work (บาง Supabase version ไม่รองรับ nested filter)
    const { data: fallback } = await supabase
      .from('listings')
      .select('id, price, condition, price_includes_shipping, photos, created_at, books(id, isbn, title, author, cover_url)')
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(limit)
    return NextResponse.json({ listings: fallback || [] })
  }

  const clean = (data || []).map((l: any) => { const { users, ...rest } = l; return rest })
  return NextResponse.json({ listings: clean })
}
