// Unread notification count — lightweight endpoint สำหรับจุดแดง
// ดึงแค่จำนวน ไม่ดึง content → เบา เรียกบ่อยได้

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getSessionUser } from '@/lib/session'

export const runtime = 'nodejs'

export async function GET() {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ unread: 0 })

  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { count } = await sb
    .from('notifications')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .not('type', 'in', '("new_book","book_name_report")')
    .is('read_at', null)

  return NextResponse.json({ unread: count || 0 })
}
