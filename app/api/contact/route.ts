// Contact form — ส่ง email ผ่าน Supabase Edge Function หรือ log ไว้ใน DB
// ตอนนี้เก็บใน DB ก่อน (ไม่ต้อง email service) — admin ดูใน dashboard

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getSessionUser } from '@/lib/session'

export const runtime = 'nodejs'

function db() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser().catch(() => null)

  const { subject, message, email, website } = await req.json()
  // Honeypot — bot จะกรอก field นี้ คนจริงไม่เห็น
  if (website) return NextResponse.json({ ok: true }) // ตอบ success เงียบๆ ไม่เก็บ
  if (!message || typeof message !== 'string' || message.trim().length < 5) {
    return NextResponse.json({ error: 'ข้อความสั้นเกินไป' }, { status: 400 })
  }
  if (message.length > 2000) {
    return NextResponse.json({ error: 'ข้อความยาวเกิน 2000 ตัวอักษร' }, { status: 400 })
  }

  // Rate limit — 3 ข้อความ/ชั่วโมง per user or IP
  const sb = db()
  const oneHourAgo = new Date(Date.now() - 3600000).toISOString()
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'

  if (user) {
    const { count } = await sb.from('contact_messages').select('*', { count: 'exact', head: true }).eq('user_id', user.id).gte('created_at', oneHourAgo)
    if ((count || 0) >= 3) return NextResponse.json({ error: 'ส่งได้ไม่เกิน 3 ข้อความ/ชั่วโมง' }, { status: 429 })
  } else {
    const { count } = await sb.from('contact_messages').select('*', { count: 'exact', head: true }).eq('ip', ip).gte('created_at', oneHourAgo)
    if ((count || 0) >= 2) return NextResponse.json({ error: 'ส่งได้ไม่เกิน 2 ข้อความ/ชั่วโมง' }, { status: 429 })
  }

  await sb.from('contact_messages').insert({
    user_id: user?.id || null,
    display_name: user?.display_name || null,
    email: email?.trim() || null,
    subject: subject?.trim() || null,
    message: message.trim(),
    ip,
  })

  return NextResponse.json({ ok: true })
}
