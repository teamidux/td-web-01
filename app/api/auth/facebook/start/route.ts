// Initiates Facebook OAuth — generates state, redirects user to Facebook authorize URL.
import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { cookies } from 'next/headers'
import { safeNext } from '@/lib/safe-next'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const appId = process.env.FACEBOOK_APP_ID
  if (!appId) {
    return NextResponse.json({ error: 'FACEBOOK_APP_ID not configured' }, { status: 500 })
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || `https://${req.headers.get('host')}`
  const redirectUri = `${siteUrl}/api/auth/facebook/callback`
  const state = randomBytes(16).toString('hex')
  const next = safeNext(req.nextUrl.searchParams.get('next'))

  // Store state + next in a short-lived cookie so callback can validate
  cookies().set('bm_fb_oauth_state', JSON.stringify({ state, next }), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 600, // 10 min
  })

  const params = new URLSearchParams({
    client_id: appId,
    redirect_uri: redirectUri,
    state,
    scope: 'public_profile',
    response_type: 'code',
  })
  const fbUrl = `https://www.facebook.com/v21.0/dialog/oauth?${params.toString()}`
  return NextResponse.redirect(fbUrl)
}
