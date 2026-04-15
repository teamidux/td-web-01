// Public user info — ใช้แทน client supabase.from('users') direct query
// ไม่ return phone / line_id / facebook_id (sensitive)

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { data, error } = await sb
    .from('users')
    .select('id, display_name, avatar_url, is_verified, sold_count, confirmed_count, phone_verified_at, id_verified_at, line_oa_friend_at, created_at, plan, listings_limit, is_pioneer, pioneer_count')
    .eq('id', params.id)
    .maybeSingle()

  if (error) {
    console.error('[users/:id] db error:', error.message)
    return NextResponse.json({ error: 'db_error' }, { status: 500 })
  }
  if (!data) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  return NextResponse.json({ user: data })
}
