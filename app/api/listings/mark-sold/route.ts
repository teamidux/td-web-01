import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const getSupabase = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export async function POST(req: NextRequest) {
  const { listingId, sellerId, action } = await req.json()
  // action: 'sold' | 'reactivate' | 'remove'
  if (!listingId || !sellerId || !action) {
    return NextResponse.json({ error: 'missing fields' }, { status: 400 })
  }

  // ต้องเป็นเจ้าของ listing เท่านั้น
  const { getSessionUser } = await import('@/lib/session')
  const sessionUser = await getSessionUser()
  if (!sessionUser || sessionUser.id !== sellerId) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const sb = getSupabase()

  // ตรวจว่า listing นั้นเป็นของ seller จริง
  const { data: listing } = await sb
    .from('listings')
    .select('id, status, sold_at, seller_id, created_at')
    .eq('id', listingId)
    .eq('seller_id', sellerId)
    .maybeSingle()

  if (!listing) return NextResponse.json({ error: 'listing not found' }, { status: 404 })

  if (action === 'sold') {
    if (listing.status === 'sold') return NextResponse.json({ ok: true })

    const now = new Date()
    const createdAt = new Date(listing.created_at)
    const days_to_sell = Math.floor((now.getTime() - createdAt.getTime()) / 86400000)

    await sb.from('listings').update({ status: 'sold', sold_at: now.toISOString(), days_to_sell }).eq('id', listingId)
    // Atomic increment — กัน lost update ถ้ามี concurrent mark-sold (race condition)
    const { data: newCount } = await sb.rpc('adjust_sold_count', { p_user_id: sellerId, p_delta: 1 })
    return NextResponse.json({ ok: true, sold_count: newCount })
  }

  if (action === 'reactivate') {
    if (!listing.sold_at) return NextResponse.json({ error: 'no sold_at' }, { status: 400 })
    if (Date.now() - new Date(listing.sold_at).getTime() > 24 * 60 * 60 * 1000) {
      return NextResponse.json({ error: 'ไม่สามารถเปิดคืนได้หลัง 24 ชั่วโมง' }, { status: 400 })
    }
    if (listing.status !== 'sold') return NextResponse.json({ ok: true })

    await sb.from('listings').update({ status: 'active', sold_at: null }).eq('id', listingId)
    // Atomic decrement — RPC มี greatest(0, ...) ป้องกัน sold_count ติดลบ
    const { data: newCount } = await sb.rpc('adjust_sold_count', { p_user_id: sellerId, p_delta: -1 })
    return NextResponse.json({ ok: true, sold_count: newCount })
  }

  if (action === 'remove') {
    await sb.from('listings').update({ status: 'removed' }).eq('id', listingId)
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'invalid action' }, { status: 400 })
}
