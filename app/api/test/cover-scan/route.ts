// Spike: Vertex AI Gemini cover scan — test only, ไม่ทำ persistence
// ใช้สำหรับหน้า /test/cover-scan เท่านั้น
import { NextRequest, NextResponse } from 'next/server'
import { extractFromCover, ALLOWED_MODELS } from '@/lib/cover-vision'
import { checkRateLimit, checkUserActionLimit, getClientIp } from '@/lib/rate-limit'
import { getSessionUser } from '@/lib/session'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function POST(req: NextRequest) {
  if (process.env.NEXT_PUBLIC_ENABLE_COVER_SCAN !== '1') {
    return NextResponse.json({ error: 'feature_disabled' }, { status: 404 })
  }
  // Auth required — ป้องกัน bot spam Gemini call (~฿0.003/call burn money)
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  // 2-tier rate limit per user: burst 30/min + sustained 600/hr
  // Loose setting — shop ถ่ายซ้ำ retry ได้สบาย, cap แค่ AI cost abuse
  // (600/hr ≈ ฿1.8/hr burn cap/user)
  const userLimit = checkUserActionLimit(user.id, 'scan', { perMin: 30, perHr: 600, actionLabel: 'อ่านปก' })
  if (userLimit.ok === false) {
    return NextResponse.json({ error: 'rate_limited', message: userLimit.message }, {
      status: 429, headers: { 'Retry-After': String(userLimit.retryAfter) },
    })
  }
  // IP-level burst limit กัน botnet farm ใต้ IP เดียว
  if (!checkRateLimit(`scan-ip:${getClientIp(req)}`, 50, 60_000)) {
    return NextResponse.json({ error: 'rate_limited', message: 'ช่วงนี้มีการใช้จาก IP นี้เยอะมาก รอสักครู่แล้วลองใหม่' }, { status: 429 })
  }
  let body: { imageBase64?: string; mimeType?: string; model?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  const { imageBase64, mimeType = 'image/jpeg' } = body
  if (!imageBase64 || typeof imageBase64 !== 'string') {
    return NextResponse.json({ error: 'imageBase64 required' }, { status: 400 })
  }
  if (imageBase64.length > 7_000_000) {
    return NextResponse.json({ error: 'image_too_large' }, { status: 413 })
  }

  const modelId = body.model && ALLOWED_MODELS.has(body.model) ? body.model : undefined
  try {
    const result = await extractFromCover({ imageBase64, mimeType, modelId })
    return NextResponse.json(result)
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown_error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
