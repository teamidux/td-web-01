// Scheduled cleanup — sessions + old notifications + expired OTP
// ตั้ง Vercel Cron: vercel.json → crons: [{ path: '/api/cron/cleanup', schedule: '0 3 * * *' }]
// รันทุกวันตี 3

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  // Auth: ใช้ CRON_SECRET เพื่อกันใครเรียกมั่ว
  const authHeader = req.headers.get('authorization')
  const secret = process.env.CRON_SECRET
  if (secret && authHeader !== `Bearer ${secret}`) {
    // Vercel Cron จะส่ง Bearer header ถ้าตั้ง CRON_SECRET ไว้
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const now = new Date().toISOString()
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()

  // 1. ลบ sessions ที่ expired แล้ว
  const { count: expiredSessions } = await sb
    .from('sessions')
    .delete({ count: 'exact' })
    .lt('expires_at', now)

  // 2. ลบ notifications ที่อ่านแล้วเกิน 30 วัน
  const { count: oldReadNotifs } = await sb
    .from('notifications')
    .delete({ count: 'exact' })
    .lt('read_at', thirtyDaysAgo)

  // 3. ลบ notifications เก่ามากกว่า 90 วัน (แม้ยังไม่อ่าน)
  const { count: veryOldNotifs } = await sb
    .from('notifications')
    .delete({ count: 'exact' })
    .lt('created_at', ninetyDaysAgo)

  // 4. ลบ phone_otps ที่หมดอายุแล้ว
  const { count: expiredOtps } = await sb
    .from('phone_otps')
    .delete({ count: 'exact' })
    .lt('expires_at', now)

  return NextResponse.json({
    ok: true,
    cleaned: {
      expiredSessions: expiredSessions || 0,
      oldReadNotifs: oldReadNotifs || 0,
      veryOldNotifs: veryOldNotifs || 0,
      expiredOtps: expiredOtps || 0,
    },
  })
}
