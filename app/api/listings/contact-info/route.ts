// ดึง contact info ของผู้ขาย — ต้อง login เท่านั้น
// แยกจาก /api/listings เพื่อไม่ให้ LINE ID/เบอร์โทรหลุดใน public API
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getSessionUser } from '@/lib/session'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const sessionUser = await getSessionUser()
  if (!sessionUser) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const sellerId = req.nextUrl.searchParams.get('seller_id')
  if (!sellerId) {
    return NextResponse.json({ error: 'missing seller_id' }, { status: 400 })
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  const { data } = await supabase
    .from('users')
    .select('line_id, phone')
    .eq('id', sellerId)
    .maybeSingle()

  return NextResponse.json({
    line_id: data?.line_id || null,
    phone: data?.phone || null,
  })
}
