// Log contact event — north star metric
// เก็บทุกครั้งที่ผู้ซื้อกด "ติดต่อ" ผู้ขาย
// ไม่ต้อง auth — guest ก็กดได้ (เก็บ buyer_id ถ้า login)

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getSessionUser } from '@/lib/session'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  try {
    const { listing_id, book_id, seller_id } = await req.json()
    if (!listing_id) return NextResponse.json({ error: 'missing listing_id' }, { status: 400 })

    const user = await getSessionUser().catch(() => null)

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )

    await supabase.from('contact_events').insert({
      listing_id,
      book_id: book_id || null,
      seller_id: seller_id || null,
      buyer_id: user?.id || null,
    })

    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ ok: true }) // ไม่ให้ tracking error block UX
  }
}
