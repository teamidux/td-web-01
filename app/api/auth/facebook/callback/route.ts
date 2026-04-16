// Handles return from Facebook OAuth — exchanges code for token, creates user + session.
//
// Security:
// - State parameter validated against cookie (CSRF protection)
// - Access token exchanged server-side (secret never exposed to client)
// - Facebook user ID is unique and immutable (safe as identifier)
// - appsecret_proof sent with Graph API calls (prevents token hijacking)

import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createClient } from '@supabase/supabase-js'
import { createSession, getSessionUser } from '@/lib/session'
import { createHmac } from 'crypto'

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
  console.log('[facebook/callback] hit', { hasCode: !!code, hasState: !!state, errorParam, siteUrl, host: req.headers.get('host') })
  const redirectError = (msg: string) => {
    console.error('[facebook/callback] error:', msg)
    return NextResponse.redirect(`${siteUrl}/?login_error=${encodeURIComponent(msg)}`)
  }

  if (errorParam) return redirectError(errorParam)
  if (!code || !state) return redirectError('missing_params')

  // Validate state (CSRF protection)
  const stateCookie = cookies().get('bm_fb_oauth_state')?.value
  if (!stateCookie) return redirectError('state_expired')
  let savedState: { state: string; next: string }
  try {
    savedState = JSON.parse(stateCookie)
  } catch {
    return redirectError('state_invalid')
  }
  if (savedState.state !== state) return redirectError('state_mismatch')
  cookies().delete('bm_fb_oauth_state')

  const appId = process.env.FACEBOOK_APP_ID!
  const appSecret = process.env.FACEBOOK_APP_SECRET!
  const redirectUri = `${siteUrl}/api/auth/facebook/callback`

  // Exchange code for access token
  let tokenRes: Response
  try {
    const params = new URLSearchParams({
      client_id: appId,
      client_secret: appSecret,
      redirect_uri: redirectUri,
      code,
    })
    tokenRes = await fetch(`https://graph.facebook.com/v21.0/oauth/access_token?${params.toString()}`)
  } catch {
    return redirectError('facebook_unreachable')
  }
  if (!tokenRes.ok) return redirectError('token_exchange_failed')
  const tokenJson = await tokenRes.json()
  const accessToken: string = tokenJson.access_token
  if (!accessToken) return redirectError('no_access_token')

  // Generate appsecret_proof — prevents token hijacking
  // https://developers.facebook.com/docs/graph-api/securing-requests
  const appsecretProof = createHmac('sha256', appSecret).update(accessToken).digest('hex')

  // Get profile (name + picture)
  const profileRes = await fetch(
    `https://graph.facebook.com/v21.0/me?fields=id,name,picture.width(200).height(200)&access_token=${accessToken}&appsecret_proof=${appsecretProof}`
  )
  if (!profileRes.ok) return redirectError('profile_fetch_failed')
  const profile = await profileRes.json()
  const fbUserId: string = profile.id
  const displayName: string = profile.name || `นักอ่าน${Math.floor(Math.random() * 9000) + 1000}`
  const pictureUrl: string | null = profile.picture?.data?.url || null

  if (!fbUserId) return redirectError('no_fb_user_id')

  const sb = admin()
  const isLinking = savedState.next?.includes('link=1')

  // Account linking flow — user already logged in, wants to connect Facebook
  if (isLinking) {
    const currentUser = await getSessionUser()
    if (!currentUser) return redirectError('not_logged_in')

    // Check if this FB account is already linked to someone else
    const { data: fbOwner } = await sb
      .from('users')
      .select('id')
      .eq('facebook_id', fbUserId)
      .neq('id', currentUser.id)
      .maybeSingle()
    if (fbOwner) return redirectError('facebook_already_linked')

    // Link Facebook to current user
    await sb.from('users').update({ facebook_id: fbUserId }).eq('id', currentUser.id)
    const cleanNext = savedState.next.replace(/[?&]link=1/, '').replace(/\?$/, '') || '/profile'
    return NextResponse.redirect(`${siteUrl}${cleanNext}`)
  }

  // Normal login flow — find or create user
  const { data: existing, error: selectErr } = await sb
    .from('users')
    .select('id, display_name, avatar_url, facebook_id')
    .eq('facebook_id', fbUserId)
    .maybeSingle()

  if (selectErr) {
    console.error('[facebook/callback] select error:', selectErr)
    return redirectError('select_failed')
  }

  let userId: string

  if (existing) {
    userId = existing.id
    // Only fill in missing fields — never overwrite data the user already has
    const patch: Record<string, string> = {}
    if (!existing.display_name) patch.display_name = displayName
    if (!existing.avatar_url && pictureUrl) patch.avatar_url = pictureUrl
    if (Object.keys(patch).length > 0) {
      await sb.from('users').update(patch).eq('id', userId)
    }
  } else {
    // ถ้า user login อยู่แล้ว (เช่น login ด้วยเบอร์มาก่อน) → link FB เข้า account เดิม
    const currentUser = await getSessionUser()
    if (currentUser) {
      await sb.from('users').update({ facebook_id: fbUserId }).eq('id', currentUser.id)
      userId = currentUser.id
    } else {
      const { data: newUser, error: insertErr } = await sb
        .from('users')
        .insert({
          facebook_id: fbUserId,
          display_name: displayName,
          avatar_url: pictureUrl,
          plan: 'free',
          listings_limit: 20,
          seller_type: 'individual',
        })
        .select('id')
        .single()

      if (insertErr || !newUser) {
        console.error('[facebook/callback] insert error:', insertErr)
        return redirectError('user_create_failed')
      }
      userId = newUser.id
    }
  }

  // Create session
  const sessionResult = await createSession(userId, {
    ua: req.headers.get('user-agent') || undefined,
    ip: req.headers.get('x-forwarded-for') || undefined,
  })
  if (sessionResult.error) {
    return redirectError(`session_failed:${sessionResult.error}`)
  }

  return NextResponse.redirect(`${siteUrl}${savedState.next || '/'}`)
}
