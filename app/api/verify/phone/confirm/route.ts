import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getSessionUser } from '@/lib/session'

export const runtime = 'nodejs'

const MAX_ATTEMPTS = 5

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { code } = await req.json()
  if (!code || typeof code !== 'string' || !/^\d{6}$/.test(code)) {
    return NextResponse.json({ error: 'invalid_code_format' }, { status: 400 })
  }

  const sb = admin()
  // Latest unconsumed, unexpired OTP for this user
  const { data: otp } = await sb
    .from('phone_otps')
    .select('*')
    .eq('user_id', user.id)
    .is('consumed_at', null)
    .gte('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!otp) {
    return NextResponse.json({ error: 'no_active_otp' }, { status: 400 })
  }
  if (otp.attempts >= MAX_ATTEMPTS) {
    return NextResponse.json({ error: 'too_many_attempts' }, { status: 429 })
  }

  if (otp.code !== code) {
    await sb.from('phone_otps').update({ attempts: otp.attempts + 1 }).eq('id', otp.id)
    return NextResponse.json({ error: 'wrong_code', attempts_left: MAX_ATTEMPTS - otp.attempts - 1 }, { status: 400 })
  }

  // Success — mark consumed + update user
  const now = new Date().toISOString()
  await sb.from('phone_otps').update({ consumed_at: now }).eq('id', otp.id)
  await sb.from('users').update({ phone: otp.phone, phone_verified_at: now }).eq('id', user.id)

  // Audit log
  await sb.from('phone_changes_log').insert({
    user_id: user.id,
    old_phone: user.phone || null,
    new_phone: otp.phone,
    changed_by: 'user',
  })

  return NextResponse.json({ ok: true })
}
