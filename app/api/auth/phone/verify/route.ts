// Phone OTP Login — Firebase ID token → find or create user → create session
// Flow:
// 1. Client: signInWithPhoneNumber() → confirm OTP → getIdToken()
// 2. Client: POST this route with { idToken }
// 3. Server: verify token → extract phone → find user by phone or create new → session cookie
//
// Security:
// - Firebase ID token is verified server-side (cryptographic, not spoofable)
// - Phone number comes from Firebase (user cannot tamper)
// - Rate limited by Firebase reCAPTCHA + SMS quotas
// - Session uses HTTP-only secure cookie (same as LINE login)

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createSession, getSessionUser } from '@/lib/session'
import { getAdminAuth } from '@/lib/firebase-admin'

export const runtime = 'nodejs'

function db() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function POST(req: NextRequest) {
  // Parse & validate input
  let idToken: string
  try {
    const body = await req.json()
    idToken = body.idToken
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
  }
  if (!idToken || typeof idToken !== 'string') {
    return NextResponse.json({ error: 'missing_id_token' }, { status: 400 })
  }

  // Verify Firebase ID token → ได้ phone number ที่ Google ยืนยันแล้ว
  let phoneNumber: string | undefined
  try {
    const decoded = await getAdminAuth().verifyIdToken(idToken)
    phoneNumber = decoded.phone_number
  } catch (e: any) {
    console.warn('[auth/phone] verify failed:', e?.message || e)
    return NextResponse.json({ error: 'invalid_token' }, { status: 401 })
  }

  if (!phoneNumber) {
    return NextResponse.json({ error: 'no_phone_in_token' }, { status: 400 })
  }

  // Normalize: Firebase ส่งเป็น E.164 "+66812345678" → เก็บเป็น "0812345678"
  const cleaned = phoneNumber.replace(/^\+66/, '0').replace(/\D/g, '')
  if (!/^0\d{9}$/.test(cleaned)) {
    return NextResponse.json({ error: 'invalid_phone_format', raw: phoneNumber }, { status: 400 })
  }

  const sb = db()

  // Find existing user by phone (verified)
  const { data: existing, error: selectErr } = await sb
    .from('users')
    .select('*')
    .eq('phone', cleaned)
    .not('phone_verified_at', 'is', null)
    .maybeSingle()

  if (selectErr) {
    console.error('[auth/phone] select error:', selectErr)
    return NextResponse.json({ error: 'db_error' }, { status: 500 })
  }

  let userId: string
  let isNewUser = false

  if (existing) {
    // Existing user with this phone → login
    userId = existing.id
  } else {
    // ถ้า user login อยู่แล้ว (เช่น login ด้วย FB/LINE มาก่อน) → link เบอร์เข้า account เดิม
    const currentUser = await getSessionUser()
    const now = new Date().toISOString()
    if (currentUser) {
      await sb.from('users').update({ phone: cleaned, phone_verified_at: now }).eq('id', currentUser.id)
      userId = currentUser.id
    } else {
      // New user → create with phone already verified
      const { data: newUser, error: insertErr } = await sb
        .from('users')
        .insert({
          phone: cleaned,
          phone_verified_at: now,
          display_name: `นักอ่าน${Math.floor(Math.random() * 9000) + 1000}`,
          plan: 'free',
          listings_limit: 20,
          seller_type: 'individual',
        })
        .select('id')
        .single()

      if (insertErr || !newUser) {
        console.error('[auth/phone] insert error:', insertErr)
        return NextResponse.json({ error: 'user_create_failed' }, { status: 500 })
      }
      userId = newUser.id
      isNewUser = true
    }
  }

  // Create session (HTTP-only cookie)
  const sessionResult = await createSession(userId, {
    ua: req.headers.get('user-agent') || undefined,
    ip: req.headers.get('x-forwarded-for') || undefined,
  })
  if (sessionResult.error) {
    return NextResponse.json({ error: `session_failed:${sessionResult.error}` }, { status: 500 })
  }

  return NextResponse.json({
    ok: true,
    isNewUser,
    userId,
  })
}
