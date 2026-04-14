// เช็คว่า user เป็นเพื่อนกับ BookMatch OA หรือยัง (ทาง LINE API)
// ใช้เมื่อ webhook "follow" ไม่ fire (user add OA ก่อน login)
//
// Flow: GET → เช็ค LINE API → ถ้าเป็นเพื่อน: update line_oa_friend_at
//       แล้ว return { isFriend: true }

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getSessionUser } from '@/lib/session'

export const runtime = 'nodejs'

export async function POST() {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const lineUserId = (user as any).line_user_id
  if (!lineUserId) {
    return NextResponse.json({ isFriend: false, error: 'no_line_linked' })
  }

  // ถ้า flag อยู่แล้ว → return เลย
  if ((user as any).line_oa_friend_at) {
    return NextResponse.json({ isFriend: true })
  }

  const token = process.env.LINE_OA_CHANNEL_ACCESS_TOKEN
  if (!token) return NextResponse.json({ error: 'line_not_configured' }, { status: 500 })

  // ลอง GET profile ของ user — ถ้า 200 = เป็นเพื่อน, 404 = ไม่เป็น
  try {
    const r = await fetch(`https://api.line.me/v2/bot/profile/${lineUserId}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (r.status === 200) {
      // เป็นเพื่อน → update DB
      const sb = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
      )
      await sb
        .from('users')
        .update({ line_oa_friend_at: new Date().toISOString() })
        .eq('id', user.id)
      return NextResponse.json({ isFriend: true })
    }
    return NextResponse.json({ isFriend: false })
  } catch (e: any) {
    return NextResponse.json({ error: 'line_api_error', detail: e?.message || 'unknown' }, { status: 500 })
  }
}
