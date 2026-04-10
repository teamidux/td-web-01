// Admin dashboard — north star metrics
import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getSessionUser } from '@/lib/session'
import { isAdmin } from '@/lib/admin'

export const runtime = 'nodejs'

function db() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function GET() {
  const user = await getSessionUser()
  if (!user || !isAdmin(user.id)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const sb = db()
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString()
  const d7 = new Date(now.getTime() - 7 * 86400000).toISOString()
  const d30 = new Date(now.getTime() - 30 * 86400000).toISOString()

  // Run all queries in parallel
  const [
    { count: totalBooks },
    { count: totalUsers },
    { count: totalListings },
    { count: totalWanted },
    { count: contactsToday },
    { count: contacts7d },
    { count: contacts30d },
    { count: listingsToday },
    { count: listings7d },
    { count: usersToday },
    { count: users7d },
    { count: wantedToday },
    { count: wanted7d },
    { count: pendingVerify },
    { data: recentContacts },
    { data: recentListings },
    { data: recentUsers },
  ] = await Promise.all([
    // Totals
    sb.from('books').select('*', { count: 'exact', head: true }),
    sb.from('users').select('*', { count: 'exact', head: true }),
    sb.from('listings').select('*', { count: 'exact', head: true }).eq('status', 'active'),
    sb.from('wanted').select('*', { count: 'exact', head: true }).eq('status', 'waiting'),
    // Contacts (north star)
    sb.from('contact_events').select('*', { count: 'exact', head: true }).gte('created_at', today),
    sb.from('contact_events').select('*', { count: 'exact', head: true }).gte('created_at', d7),
    sb.from('contact_events').select('*', { count: 'exact', head: true }).gte('created_at', d30),
    // Listings
    sb.from('listings').select('*', { count: 'exact', head: true }).gte('created_at', today),
    sb.from('listings').select('*', { count: 'exact', head: true }).gte('created_at', d7),
    // Users
    sb.from('users').select('*', { count: 'exact', head: true }).gte('created_at', today),
    sb.from('users').select('*', { count: 'exact', head: true }).gte('created_at', d7),
    // Wanted
    sb.from('wanted').select('*', { count: 'exact', head: true }).gte('created_at', today),
    sb.from('wanted').select('*', { count: 'exact', head: true }).gte('created_at', d7),
    // Pending verify
    sb.from('users').select('*', { count: 'exact', head: true }).not('id_verify_submitted_at', 'is', null).is('id_verified_at', null),
    // Recent activity
    sb.from('contact_events').select('listing_id, created_at, listings(books(title))').order('created_at', { ascending: false }).limit(5),
    sb.from('listings').select('id, created_at, price, books(title)').order('created_at', { ascending: false }).limit(5),
    sb.from('users').select('id, display_name, created_at').order('created_at', { ascending: false }).limit(5),
  ])

  return NextResponse.json({
    totals: {
      books: totalBooks || 0,
      users: totalUsers || 0,
      activeListings: totalListings || 0,
      activeWanted: totalWanted || 0,
    },
    northStar: {
      contacts: { today: contactsToday || 0, d7: contacts7d || 0, d30: contacts30d || 0 },
      listings: { today: listingsToday || 0, d7: listings7d || 0 },
      users: { today: usersToday || 0, d7: users7d || 0 },
      wanted: { today: wantedToday || 0, d7: wanted7d || 0 },
    },
    pendingVerify: pendingVerify || 0,
    recent: {
      contacts: recentContacts || [],
      listings: recentListings || [],
      users: recentUsers || [],
    },
  })
}
