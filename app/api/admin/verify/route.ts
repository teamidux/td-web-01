// Admin: list pending verifications + approve/reject
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getSessionUser } from '@/lib/session'

export const runtime = 'nodejs'

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

// GET — list users with id_verify_submitted_at but no id_verified_at
export async function GET() {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const sb = admin()
  const { data, error } = await sb
    .from('users')
    .select('id, display_name, phone, line_id, id_verify_submitted_at, id_verified_at, created_at')
    .not('id_verify_submitted_at', 'is', null)
    .is('id_verified_at', null)
    .order('id_verify_submitted_at', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // For each user, get signed URLs for their docs
  const pending = []
  for (const u of data || []) {
    // List files in identity-docs/{user_id}/
    const { data: files } = await sb.storage
      .from('identity-docs')
      .list(u.id, { limit: 10, sortBy: { column: 'created_at', order: 'desc' } })

    const docs: { name: string; url: string }[] = []
    for (const f of files || []) {
      const { data: signed } = await sb.storage
        .from('identity-docs')
        .createSignedUrl(`${u.id}/${f.name}`, 3600) // 1 hour
      if (signed?.signedUrl) {
        docs.push({ name: f.name, url: signed.signedUrl })
      }
    }

    pending.push({ ...u, docs })
  }

  return NextResponse.json({ pending })
}

// POST — approve or reject
export async function POST(req: NextRequest) {
  const currentUser = await getSessionUser()
  if (!currentUser) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { userId, action } = await req.json()
  if (!userId || !['approve', 'reject'].includes(action)) {
    return NextResponse.json({ error: 'invalid params' }, { status: 400 })
  }

  const sb = admin()

  if (action === 'approve') {
    const { error } = await sb
      .from('users')
      .update({ id_verified_at: new Date().toISOString() })
      .eq('id', userId)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  } else {
    // reject — clear submitted_at so user can re-submit
    const { error } = await sb
      .from('users')
      .update({ id_verify_submitted_at: null })
      .eq('id', userId)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, action })
}
