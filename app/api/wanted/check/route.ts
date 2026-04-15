// เช็คว่า user ปัจจุบันตามหา book นี้หรือไม่
// ใช้แทน client supabase.from('wanted') direct query (RLS block แล้ว)

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getSessionUser } from '@/lib/session'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ wanted: false })

  const bookId = req.nextUrl.searchParams.get('book_id')
  if (!bookId) return NextResponse.json({ wanted: false })

  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { data } = await sb
    .from('wanted')
    .select('id')
    .eq('user_id', user.id)
    .eq('book_id', bookId)
    .maybeSingle()

  return NextResponse.json({ wanted: !!data })
}
