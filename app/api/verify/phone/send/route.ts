import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getSessionUser } from '@/lib/session'
import { sendSMS, generateOTP, normalizeThaiPhone } from '@/lib/thaibulksms'

export const runtime = 'nodejs'

const OTP_TTL_MIN = 10
const RATE_LIMIT_MIN = 1 // ต้องห่างกัน 1 นาทีต่อ user/phone

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (user.phone_verified_at) {
    return NextResponse.json({ error: 'already_verified' }, { status: 400 })
  }

  const { phone } = await req.json()
  if (!phone || typeof phone !== 'string') {
    return NextResponse.json({ error: 'missing phone' }, { status: 400 })
  }
  const cleaned = phone.replace(/\D/g, '')
  if (!/^0\d{9}$/.test(cleaned)) {
    return NextResponse.json({ error: 'invalid_phone' }, { status: 400 })
  }

  const sb = admin()

  // Check phone uniqueness — กันคนใช้เบอร์เดียวกันสมัครหลาย account
  const { data: existing } = await sb
    .from('users')
    .select('id')
    .eq('phone', cleaned)
    .not('phone_verified_at', 'is', null)
    .neq('id', user.id)
    .maybeSingle()
  if (existing) {
    return NextResponse.json({ error: 'phone_in_use' }, { status: 409 })
  }

  // Rate limit
  const cutoff = new Date(Date.now() - RATE_LIMIT_MIN * 60 * 1000).toISOString()
  const { data: recent } = await sb
    .from('phone_otps')
    .select('id')
    .eq('user_id', user.id)
    .gte('created_at', cutoff)
    .limit(1)
  if (recent && recent.length > 0) {
    return NextResponse.json({ error: 'rate_limited', retry_after: RATE_LIMIT_MIN * 60 }, { status: 429 })
  }

  const code = generateOTP()
  const expires = new Date(Date.now() + OTP_TTL_MIN * 60 * 1000).toISOString()

  const { error: insertErr } = await sb.from('phone_otps').insert({
    user_id: user.id,
    phone: cleaned,
    code,
    expires_at: expires,
  })
  if (insertErr) {
    return NextResponse.json({ error: 'db_error' }, { status: 500 })
  }

  const message = `BookMatch รหัสยืนยัน: ${code} (ใช้ภายใน ${OTP_TTL_MIN} นาที)`
  const smsRes = await sendSMS(cleaned, message)
  if (!smsRes.ok) {
    console.error('[OTP send]', smsRes.error)
    return NextResponse.json({ error: 'sms_failed' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, expires_in: OTP_TTL_MIN * 60 })
}
