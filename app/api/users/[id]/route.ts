// Public user info — ใช้แทน client supabase.from('users') direct query
// ไม่ return phone / line_id / facebook_id (sensitive)

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { checkRateLimit, getClientIp } from '@/lib/rate-limit'

export const runtime = 'nodejs'

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  if (!checkRateLimit(`user:${getClientIp(_req)}`, 30, 60_000)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 })
  }
  // Use service role — RLS บน users block anon read (rls_policies_secure.sql)
  // เราคัด public columns เองใน select ด้านล่าง → ไม่มี PII หลุด (phone/line_id/facebook_id ไม่ได้ถูก select)
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  const { data, error } = await sb
    .from('users')
    .select('id, display_name, avatar_url, is_verified, sold_count, confirmed_count, phone_verified_at, id_verified_at, line_oa_friend_at, created_at, plan, listings_limit, is_pioneer, pioneer_count, banned_at')
    .eq('id', params.id)
    .maybeSingle()

  if (error) {
    console.error('[users/:id] db error:', error.message)
    return NextResponse.json({ error: 'db_error' }, { status: 500 })
  }
  if (!data) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  return NextResponse.json({ user: data })
}
