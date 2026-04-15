// Firebase Phone Auth backend verify
// Flow:
// 1. Client (PhoneVerifyModal) เรียก signInWithPhoneNumber() → get confirmationResult
// 2. User ใส่ OTP → confirmationResult.confirm(code) → ได้ Firebase user
// 3. Client เรียก user.getIdToken() → ส่ง ID token ไปที่นี่
// 4. Server verify ID token ด้วย admin SDK → เอา phone_number มา set users.phone + phone_verified_at

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getSessionUser } from '@/lib/session'
import { getAdminAuth } from '@/lib/firebase-admin'

export const runtime = 'nodejs'

function db() {
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

  const { idToken } = await req.json()
  if (!idToken || typeof idToken !== 'string') {
    return NextResponse.json({ error: 'missing_id_token' }, { status: 400 })
  }

  // Verify Firebase ID token → ได้ phone number ที่ Google ยืนยันแล้ว
  let phoneNumber: string | undefined
  try {
    const decoded = await getAdminAuth().verifyIdToken(idToken)
    phoneNumber = decoded.phone_number
  } catch (e: any) {
    console.warn('[firebase-confirm] verify failed:', e?.message || e)
    return NextResponse.json({ error: 'invalid_token' }, { status: 401 })
  }

  if (!phoneNumber) {
    return NextResponse.json({ error: 'no_phone_in_token' }, { status: 400 })
  }

  // Normalize: Firebase ส่งเป็น E.164 "+66812345678" → เก็บใน DB เป็น "0812345678"
  // เพื่อให้ match กับ user อื่นที่กรอกเข้ามาในรูปแบบเดียว
  const cleaned = phoneNumber.replace(/^\+66/, '0').replace(/\D/g, '')
  if (!/^0\d{9}$/.test(cleaned)) {
    return NextResponse.json({ error: 'invalid_phone_format', raw: phoneNumber }, { status: 400 })
  }

  const sb = db()

  // Check uniqueness — กันเบอร์เดียวกันใช้หลาย account
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

  // Update users record
  const now = new Date().toISOString()
  const { error } = await sb
    .from('users')
    .update({
      phone: cleaned,
      phone_verified_at: now,
    })
    .eq('id', user.id)

  if (error) {
    console.error('[firebase-confirm] db error:', error.message)
    return NextResponse.json({ error: 'db_error' }, { status: 500 })
  }

  // Return updated fields ให้ client sync context ได้ทันที (กัน race condition)
  return NextResponse.json({
    ok: true,
    phone: cleaned,
    phone_verified_at: now,
  })
}
