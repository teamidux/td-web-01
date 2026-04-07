// Server-side helper to log a missing ISBN.
// Uses service role key — must only be imported from server components / API routes.
import { createClient } from '@supabase/supabase-js'

export async function logMissingIsbnServer(
  isbn: string,
  source: string,
  userId: string | null = null
): Promise<void> {
  if (!/^(978|979)\d{10}$/.test(isbn)) return
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
    await supabase.rpc('log_missing_isbn', {
      p_isbn: isbn,
      p_source: source,
      p_user_id: userId,
    })
  } catch (err) {
    // fire-and-forget — don't crash the page if logging fails
    console.error('[logMissingIsbn] failed:', err)
  }
}
