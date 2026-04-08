// Handles return from LINE OAuth — exchanges code for token, creates user + session.
import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createClient } from '@supabase/supabase-js'
import { createSession } from '@/lib/session'

export const runtime = 'nodejs'

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code')
  const state = req.nextUrl.searchParams.get('state')
  const errorParam = req.nextUrl.searchParams.get('error')

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || `https://${req.headers.get('host')}`
  const redirectError = (msg: string) => NextResponse.redirect(`${siteUrl}/?login_error=${encodeURIComponent(msg)}`)

  if (errorParam) return redirectError(errorParam)
  if (!code || !state) return redirectError('missing_params')

  // Validate state
  const stateCookie = cookies().get('bm_oauth_state')?.value
  if (!stateCookie) return redirectError('state_expired')
  let savedState: { state: string; next: string }
  try {
    savedState = JSON.parse(stateCookie)
  } catch {
    return redirectError('state_invalid')
  }
  if (savedState.state !== state) return redirectError('state_mismatch')
  cookies().delete('bm_oauth_state')

  const channelId = process.env.LINE_CHANNEL_ID!
  const channelSecret = process.env.LINE_CHANNEL_SECRET!
  const redirectUri = `${siteUrl}/api/auth/line/callback`

  // Exchange code for access token
  let tokenRes: Response
  try {
    tokenRes = await fetch('https://api.line.me/oauth2/v2.1/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: channelId,
        client_secret: channelSecret,
      }),
    })
  } catch {
    return redirectError('line_unreachable')
  }
  if (!tokenRes.ok) return redirectError('token_exchange_failed')
  const tokenJson = await tokenRes.json()
  const accessToken: string = tokenJson.access_token
  if (!accessToken) return redirectError('no_access_token')

  // Get profile
  const profileRes = await fetch('https://api.line.me/v2/profile', {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!profileRes.ok) return redirectError('profile_fetch_failed')
  const profile = await profileRes.json()
  const lineUserId: string = profile.userId
  const displayName: string = profile.displayName || 'นักอ่าน'
  const pictureUrl: string | null = profile.pictureUrl || null

  if (!lineUserId) return redirectError('no_line_user_id')

  // Find or create user
  const sb = admin()
  const { data: existing } = await sb.from('users').select('*').eq('line_user_id', lineUserId).maybeSingle()

  let userId: string
  if (existing) {
    userId = existing.id
    // Refresh display name + avatar if changed
    await sb
      .from('users')
      .update({ display_name: existing.display_name || displayName, avatar_url: pictureUrl })
      .eq('id', userId)
  } else {
    const { data: newUser, error } = await sb
      .from('users')
      .insert({
        line_user_id: lineUserId,
        display_name: displayName,
        avatar_url: pictureUrl,
        plan: 'free',
        listings_limit: 20,
        seller_type: 'individual',
      })
      .select('id')
      .single()
    if (error || !newUser) return redirectError('user_create_failed')
    userId = newUser.id
  }

  // Create session
  await createSession(userId, {
    ua: req.headers.get('user-agent') || undefined,
    ip: req.headers.get('x-forwarded-for') || undefined,
  })

  return NextResponse.redirect(`${siteUrl}${savedState.next || '/'}`)
}
