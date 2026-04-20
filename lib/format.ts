// Formatting helpers — extract จากซ้ำๆในหลายไฟล์

// Thai phone validation — 10 digits starting with 0, หรือ +66 format
// Accepts: 0812345678, 081-234-5678, 081 234 5678, +66812345678
export function isValidPhone(s?: string | null): boolean {
  return !!s && /^(\+?66|0)[0-9\s\-]{7,12}$/.test(s.trim())
}

// Format phone: 0812345678 → 081-234-5678 (10 หลัก)
export function formatPhone(p?: string | null): string {
  if (!p) return ''
  const d = p.replace(/\D/g, '')
  return d.length === 10 ? `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}` : p
}

// Member since duration in Thai — "3 วัน", "2 สัปดาห์", "5 เดือน", "2 ปี"
export function formatMemberSince(createdAt?: string | null): string {
  if (!createdAt) return '—'
  const days = Math.floor((Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60 * 24))
  if (days < 1) return 'วันนี้'
  if (days < 7) return `${days} วัน`
  if (days < 30) return `${Math.floor(days / 7)} สัปดาห์`
  if (days < 365) return `${Math.floor(days / 30)} เดือน`
  return `${Math.floor(days / 365)} ปี`
}

// Time ago in Thai — "15 นาที", "3 ชั่วโมง", "2 วัน"
export function formatTimeAgo(dt?: string | null): string {
  if (!dt) return ''
  const mins = Math.floor((Date.now() - new Date(dt).getTime()) / 60000)
  if (mins < 1) return 'เมื่อกี้'
  if (mins < 60) return `${mins} นาทีที่แล้ว`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs} ชั่วโมงที่แล้ว`
  return `${Math.floor(hrs / 24)} วันที่แล้ว`
}
