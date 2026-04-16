import { NextResponse } from 'next/server'
import { getSessionUser, getBannedStatus } from '@/lib/session'
import { isAdmin } from '@/lib/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const user = await getSessionUser()
  if (!user) {
    // เช็คว่าโดน ban ไหม (session ยังอยู่แต่ user ถูก block)
    const banStatus = await getBannedStatus()
    if (banStatus?.banned) {
      return NextResponse.json({ user: null, banned: true, banned_reason: banStatus.reason })
    }
    return NextResponse.json({ user: null })
  }
  return NextResponse.json({ user: { ...user, is_admin: isAdmin(user.id) } })
}
