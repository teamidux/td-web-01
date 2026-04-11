// Initiates LINE OAuth — generates state, redirects user to LINE authorize URL.
import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { cookies } from 'next/headers'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const channelId = process.env.LINE_CHANNEL_ID
  if (!channelId) {
    return NextResponse.json({ error: 'LINE_CHANNEL_ID not configured' }, { status: 500 })
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || `https://${req.headers.get('host')}`
  const redirectUri = `${siteUrl}/api/auth/line/callback`
  const state = randomBytes(16).toString('hex')
  const next = req.nextUrl.searchParams.get('next') || '/'

  // Store state + next in a short-lived cookie so callback can validate
  cookies().set('bm_oauth_state', JSON.stringify({ state, next }), {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 600, // 10 min
  })

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: channelId,
    redirect_uri: redirectUri,
    state,
    scope: 'profile openid',
    // aggressive: โชว์ checkbox "Add @BookMatch เป็นเพื่อน" บนหน้า LINE consent
    // pre-checked → user กดยืนยัน login ก็ add OA ให้เลย → notification ใช้งานได้ทันที
    // ทั้งผู้ซื้อ (รับแจ้ง wanted-match) และ seller (รับแจ้งมีคนติดต่อ) ต้องการ OA เท่ากัน
    bot_prompt: 'aggressive',
  })
  const lineUrl = `https://access.line.me/oauth2/v2.1/authorize?${params.toString()}`
  return NextResponse.redirect(lineUrl)
}
