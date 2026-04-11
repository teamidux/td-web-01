// Admin: SMS + LINE notification usage stats
// SMS: นับจาก phone_otps table (1 row = 1 SMS attempt)
// LINE: เรียก LINE Messaging API เพื่อขอ quota + consumption + per-day delivery
//
// ใช้คุมต้นทุน:
// - SMS thaibulksms: ~0.40 บาท/ข้อความ
// - LINE: ฟรี 200/เดือน, push เกินต้องอัพเกรด plan

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { isAdmin } from '@/lib/admin'

export const runtime = 'nodejs'

function sb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

async function currentAdmin() {
  const token = cookies().get('bm_session')?.value
  if (!token) return null
  const db = sb()
  const { data } = await db.from('sessions').select('users(id)').eq('token', token).maybeSingle()
  const id = (data as any)?.users?.id
  return id && isAdmin(id) ? id : null
}

const LINE_API = 'https://api.line.me/v2/bot'

async function lineGet(path: string) {
  const token = process.env.LINE_OA_CHANNEL_ACCESS_TOKEN
  if (!token) return null
  try {
    const r = await fetch(`${LINE_API}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    })
    if (!r.ok) return null
    return await r.json()
  } catch {
    return null
  }
}

function ymd(d: Date) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}${m}${day}`
}

export async function GET() {
  if (!(await currentAdmin())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const db = sb()
  const now = new Date()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()

  // ===== SMS — count from phone_otps =====
  const [{ count: smsToday }, { count: smsMonth }] = await Promise.all([
    db.from('phone_otps').select('*', { count: 'exact', head: true }).gte('created_at', todayStart),
    db.from('phone_otps').select('*', { count: 'exact', head: true }).gte('created_at', monthStart),
  ])

  // ===== LINE — query LINE API =====
  const yesterday = new Date(now.getTime() - 86400000)
  const [quota, consumption, todayPush, yesterdayPush, todayReply, yesterdayReply] = await Promise.all([
    lineGet('/message/quota'),
    lineGet('/message/quota/consumption'),
    lineGet(`/message/delivery/push?date=${ymd(now)}`),
    lineGet(`/message/delivery/push?date=${ymd(yesterday)}`),
    lineGet(`/message/delivery/reply?date=${ymd(now)}`),
    lineGet(`/message/delivery/reply?date=${ymd(yesterday)}`),
  ])

  // LINE delivery API: status='ready' = data available, 'unready' = ยังไม่ aggregate
  // วันนี้ไม่ค่อยมี data — ใช้ 'unready' เป็น 0
  const linePushToday = todayPush?.status === 'ready' ? (todayPush.success || 0) : 0
  const linePushYesterday = yesterdayPush?.status === 'ready' ? (yesterdayPush.success || 0) : 0
  const lineReplyToday = todayReply?.status === 'ready' ? (todayReply.success || 0) : 0
  const lineReplyYesterday = yesterdayReply?.status === 'ready' ? (yesterdayReply.success || 0) : 0

  return NextResponse.json({
    sms: {
      today: smsToday || 0,
      month: smsMonth || 0,
      cost_baht: ((smsMonth || 0) * 0.40).toFixed(2),
    },
    line: {
      push_today: linePushToday,
      push_yesterday: linePushYesterday,
      reply_today: lineReplyToday,
      reply_yesterday: lineReplyYesterday,
      month_total: consumption?.totalUsage ?? null,
      month_quota: quota?.value ?? null,
      quota_type: quota?.type ?? null, // 'limited' | 'none'
    },
  })
}
