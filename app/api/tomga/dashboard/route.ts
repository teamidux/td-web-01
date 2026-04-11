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
    { count: bannedCount },
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
    // Banned users
    sb.from('users').select('*', { count: 'exact', head: true }).not('banned_at', 'is', null),
    // Recent activity
    sb.from('contact_events').select('listing_id, created_at, listings(books(title))').order('created_at', { ascending: false }).limit(5),
    sb.from('listings').select('id, created_at, price, books(title)').order('created_at', { ascending: false }).limit(5),
    sb.from('users').select('id, display_name, created_at').order('created_at', { ascending: false }).limit(5),
  ])

  // Suspicious count — รวม 3 heuristic: bot, duplicate phone/line, reported
  const [{ data: activeUsers }, { data: allListings }, { data: allReports }] = await Promise.all([
    sb.from('users').select('id, phone, line_id').is('deleted_at', null).is('banned_at', null),
    sb.from('listings').select('seller_id, created_at'),
    sb.from('reports').select('reported_user_id'),
  ])

  const pCount: Record<string, number> = {}
  const lCount: Record<string, number> = {}
  for (const u of activeUsers || []) {
    if (u.phone) pCount[u.phone] = (pCount[u.phone] || 0) + 1
    if (u.line_id) lCount[u.line_id] = (lCount[u.line_id] || 0) + 1
  }

  const listingsBySeller: Record<string, number[]> = {}
  for (const l of allListings || []) {
    const sid = (l as any).seller_id
    if (!listingsBySeller[sid]) listingsBySeller[sid] = []
    listingsBySeller[sid].push(new Date((l as any).created_at).getTime())
  }

  const reportedSet = new Set((allReports || []).map((r: any) => r.reported_user_id))

  const HOUR = 60 * 60 * 1000
  const BOT_THRESHOLD = 20
  let suspiciousCount = 0
  for (const u of activeUsers || []) {
    let flagged = false
    if ((u.phone && pCount[u.phone] > 1) || (u.line_id && lCount[u.line_id] > 1)) flagged = true
    if (!flagged && reportedSet.has((u as any).id)) flagged = true
    if (!flagged) {
      const times = (listingsBySeller[(u as any).id] || []).sort((a, b) => a - b)
      for (let i = 0; i + BOT_THRESHOLD - 1 < times.length; i++) {
        if (times[i + BOT_THRESHOLD - 1] - times[i] <= HOUR) { flagged = true; break }
      }
    }
    if (flagged) suspiciousCount++
  }

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
    suspiciousUsers: suspiciousCount,
    bannedUsers: bannedCount || 0,
    recent: {
      contacts: recentContacts || [],
      listings: recentListings || [],
      users: recentUsers || [],
    },
  })
}
