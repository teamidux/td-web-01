import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/session'
import { isAdmin } from '@/lib/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ user: null })
  // Inject is_admin flag สำหรับ client (เช่น trust badge, skip verify)
  return NextResponse.json({ user: { ...user, is_admin: isAdmin(user.id) } })
}
