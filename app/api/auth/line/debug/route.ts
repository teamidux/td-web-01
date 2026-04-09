// DEBUG only — show what redirect_uri the start route would build
// ลบออกหลัง verify ว่า LINE login work
import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const NEXT_PUBLIC_SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || null
  const host = req.headers.get('host')
  const xForwardedHost = req.headers.get('x-forwarded-host')
  const xForwardedProto = req.headers.get('x-forwarded-proto')

  const siteUrl = NEXT_PUBLIC_SITE_URL || `https://${host}`
  const redirectUri = `${siteUrl}/api/auth/line/callback`

  return NextResponse.json({
    redirectUri_actual_sent_to_LINE: redirectUri,
    siteUrl_used: siteUrl,
    debug: {
      NEXT_PUBLIC_SITE_URL,
      hasNextPublicSiteUrl: !!NEXT_PUBLIC_SITE_URL,
      host,
      xForwardedHost,
      xForwardedProto,
      LINE_CHANNEL_ID_prefix: process.env.LINE_CHANNEL_ID
        ? `${process.env.LINE_CHANNEL_ID.slice(0, 4)}...${process.env.LINE_CHANNEL_ID.slice(-2)}`
        : null,
      LINE_CHANNEL_ID_length: process.env.LINE_CHANNEL_ID?.length || 0,
    },
    instruction: 'Copy redirectUri_actual_sent_to_LINE → ใส่ใน LINE Login channel → Callback URL → Save',
  })
}
