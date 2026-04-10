import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/session'
import { isAdmin } from '@/lib/admin'

export const runtime = 'nodejs'

export async function GET() {
  const user = await getSessionUser()
  return NextResponse.json({ isAdmin: isAdmin(user?.id) })
}
