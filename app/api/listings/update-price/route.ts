import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getSessionUser } from '@/lib/session'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { listingId, price } = await req.json()
  if (!listingId || !price || isNaN(price) || price <= 0 || price > 999999) {
    return NextResponse.json({ error: 'invalid_price' }, { status: 400 })
  }

  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

  // เช็คว่าเป็นเจ้าของ listing
  const { data: listing } = await sb.from('listings').select('seller_id').eq('id', listingId).maybeSingle()
  if (!listing || listing.seller_id !== user.id) {
    return NextResponse.json({ error: 'not_owner' }, { status: 403 })
  }

  const { error } = await sb.from('listings').update({ price }).eq('id', listingId)
  if (error) { console.error('[update-price] update:', error); return NextResponse.json({ error: 'db_error' }, { status: 500 }) }

  return NextResponse.json({ ok: true })
}
