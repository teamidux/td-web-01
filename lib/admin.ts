// Admin access check — ใช้ env var ADMIN_USER_IDS (comma-separated)
// ตั้งค่าใน Vercel: ADMIN_USER_IDS=uuid1,uuid2

export function isAdmin(userId: string | null | undefined): boolean {
  if (!userId) return false
  const ids = (process.env.ADMIN_USER_IDS || '').split(',').map(s => s.trim()).filter(Boolean)
  return ids.includes(userId)
}
