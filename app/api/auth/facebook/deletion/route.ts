// Facebook Data Deletion Callback
// Facebook เรียก endpoint นี้เมื่อ user ร้องขอลบข้อมูลผ่าน Facebook Settings
// https://developers.facebook.com/docs/development/create-an-app/app-dashboard/data-deletion-callback
//
// Security: ตรวจ signed_request ด้วย app secret เพื่อยืนยันว่ามาจาก Facebook จริง

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createHmac, timingSafeEqual } from 'crypto'

export const runtime = 'nodejs'

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

function parseSignedRequest(signedRequest: string, secret: string): any | null {
  const [encodedSig, payload] = signedRequest.split('.', 2)
  if (!encodedSig || !payload) return null

  // Verify signature ด้วย timingSafeEqual (กัน timing attack)
  const sig = Buffer.from(encodedSig.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
  const expectedSig = createHmac('sha256', secret).update(payload).digest()
  if (sig.length !== expectedSig.length) return null
  if (!timingSafeEqual(sig, expectedSig)) return null

  // Decode payload
  const json = Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
  return JSON.parse(json)
}

export async function POST(req: NextRequest) {
  const formData = await req.formData()
  const signedRequest = formData.get('signed_request') as string | null

  if (!signedRequest) {
    return NextResponse.json({ error: 'missing_signed_request' }, { status: 400 })
  }

  const appSecret = process.env.FACEBOOK_APP_SECRET!
  const data = parseSignedRequest(signedRequest, appSecret)
  if (!data || !data.user_id) {
    return NextResponse.json({ error: 'invalid_signed_request' }, { status: 400 })
  }

  const fbUserId: string = data.user_id

  // ลบ facebook_id ออกจาก user record (ไม่ลบ user ทั้ง record เพราะอาจมี login อื่นอยู่)
  const sb = admin()
  await sb
    .from('users')
    .update({ facebook_id: null })
    .eq('facebook_id', fbUserId)

  // Facebook ต้องการ response format นี้
  const confirmationCode = `bm_del_${fbUserId}_${Date.now()}`
  return NextResponse.json({
    url: `${process.env.NEXT_PUBLIC_SITE_URL || 'https://bookmatch.app'}/facebook-deletion?code=${confirmationCode}`,
    confirmation_code: confirmationCode,
  })
}
