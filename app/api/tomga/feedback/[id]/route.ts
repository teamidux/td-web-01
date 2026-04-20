// Admin: ลบ feedback entry (spam cleanup)
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getSessionUser } from '@/lib/session'
import { isAdmin } from '@/lib/admin'

export const runtime = 'nodejs'

function db() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getSessionUser()
  if (!user || !isAdmin(user.id)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const id = params.id
  if (!id) return NextResponse.json({ error: 'missing_id' }, { status: 400 })

  const sb = db()
  const { error } = await sb.from('feedback').delete().eq('id', id)
  if (error) {
    console.error('[admin feedback delete]', error.message)
    return NextResponse.json({ error: 'db_error' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
