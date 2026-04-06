import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function POST(req: NextRequest) {
  const { userId, subscription } = await req.json()
  if (!userId || !subscription?.endpoint) {
    return NextResponse.json({ error: 'missing fields' }, { status: 400 })
  }
  // ตรวจว่า userId มีในระบบจริง ป้องกัน upsert ด้วย id แปลกปลอม
  const supabase = getSupabase()
  const { data: user } = await supabase.from('users').select('id').eq('id', userId).maybeSingle()
  if (!user) return NextResponse.json({ error: 'user not found' }, { status: 403 })

  const { error } = await supabase
    .from('push_subscriptions')
    .upsert({ user_id: userId, subscription }, { onConflict: 'user_id' })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  const { userId } = await req.json()
  if (!userId) return NextResponse.json({ error: 'missing userId' }, { status: 400 })
  await getSupabase().from('push_subscriptions').delete().eq('user_id', userId)
  return NextResponse.json({ ok: true })
}
