// Trust mission logic — compute completion + tier + badge from user object
//
// 5 items, each = 20% completion:
//   1. login_line     → user มี id (always true ถ้า logged in)
//   2. line_id        → users.line_id is not null
//   3. phone_verified → users.phone_verified_at is not null
//   4. id_verified    → users.id_verified_at is not null
//   5. oa_friend      → users.line_oa_friend_at is not null
//
// Tier badge ตามสิ่งที่ user ทำจริง:
//   login อย่างเดียว          → 🆕 ผู้ใช้ใหม่
//   + ใส่ LINE ID             → 👤 ผู้ใช้ทั่วไป
//   + ยืนยันเบอร์โทร          → 📱 ยืนยันมือถือแล้ว
//   + ยืนยันตัวตน (บัตร+บัญชี) → 🛡️ ลงทะเบียนแล้ว
//   + ครบทุกอย่าง             → ✅ Verified Pro

import type { User } from './supabase'

export type TrustItemKey =
  | 'login_line'
  | 'line_id'
  | 'phone_verified'
  | 'id_verified'
  | 'oa_friend'

export type TrustItemStatus = 'done' | 'pending' | 'todo'

export type TrustItem = {
  key: TrustItemKey
  status: TrustItemStatus
  title: string
  benefit: string
  icon: string
  weight: number // % ที่ item นี้คิด
}

export type TrustTier = {
  level: 0 | 1 | 2 | 3 | 4 | 5
  label: string
  shortLabel: string  // ใช้ใน listing card
  emoji: string
  color: string       // hex
  bgColor: string     // hex
}

export type TrustScore = {
  count: number       // completed items
  total: number       // 5
  percent: number     // 0-100
  items: TrustItem[]
  tier: TrustTier
}

export const TRUST_TIERS: TrustTier[] = [
  { level: 0, label: 'ผู้ใช้ใหม่',        shortLabel: '🆕 ใหม่',          emoji: '🆕', color: '#94A3B8', bgColor: '#F1F5F9' },
  { level: 1, label: 'ผู้ใช้ทั่วไป',       shortLabel: '👤 ทั่วไป',        emoji: '👤', color: '#64748B', bgColor: '#F1F5F9' },
  { level: 2, label: 'ยืนยันมือถือแล้ว',    shortLabel: '📱 ยืนยันแล้ว',    emoji: '📱', color: '#0891B2', bgColor: '#ECFEFF' },
  { level: 3, label: 'ลงทะเบียนแล้ว',      shortLabel: '🛡️ ลงทะเบียน',    emoji: '🛡️', color: '#0369A1', bgColor: '#E0F2FE' },
  { level: 4, label: 'Trusted Seller',    shortLabel: '🔵 Trusted',       emoji: '🔵', color: '#1D4ED8', bgColor: '#DBEAFE' },
  { level: 5, label: 'Verified Pro',      shortLabel: '✅ Verified Pro',   emoji: '✅', color: '#15803D', bgColor: '#DCFCE7' },
]

/**
 * คำนวณ trust score จาก user object
 */
export function computeTrustScore(user: Partial<User> | null | undefined): TrustScore {
  if (!user) {
    return {
      count: 0,
      total: 5,
      percent: 0,
      items: [],
      tier: TRUST_TIERS[0],
    }
  }

  const u = user as any
  const items: TrustItem[] = [
    {
      key: 'login_line',
      status: u.id ? 'done' : 'todo',
      title: 'Login ด้วย LINE',
      benefit: 'เข้าสู่ระบบเรียบร้อย',
      icon: '💚',
      weight: 20,
    },
    {
      key: 'line_id',
      status: u.line_id ? 'done' : 'todo',
      title: 'ใส่ LINE ID ของคุณ',
      benefit: 'ใช้ติดต่อระหว่างผู้ซื้อและผู้ขาย — ไม่ต้องเปิดเบอร์โทร',
      icon: '🆔',
      weight: 20,
    },
    {
      key: 'phone_verified',
      status: u.phone_verified_at ? 'done' : 'todo',
      title: 'ยืนยันเบอร์โทร',
      benefit: 'ได้รับป้าย ยืนยันตัวตนด้วยมือถือ 📱✓',
      icon: '📱',
      weight: 20,
    },
    {
      key: 'id_verified',
      status: u.id_verified_at
        ? 'done'
        : u.id_verify_submitted_at
        ? 'pending'
        : 'todo',
      title: 'ยืนยันตัวตน',
      benefit: 'บัตรประชาชน + สมุดบัญชี — รับป้าย ร้านค้าลงทะเบียน 🛡️',
      icon: '🪪',
      weight: 20,
    },
    {
      key: 'oa_friend',
      status: u.line_oa_friend_at ? 'done' : 'todo',
      title: 'รับแจ้งเตือนผ่าน LINE',
      benefit: 'Add @Bookmatch — แจ้งเตือนเมื่อหนังสือ Wanted List มีคนลง',
      icon: '🔔',
      weight: 20,
    },
  ]

  const count = items.filter(i => i.status === 'done').length
  const percent = Math.round((count / items.length) * 100)

  // Tier ตามสิ่งที่ user ทำจริง (ไม่ใช่แค่นับจำนวน)
  const has = (key: TrustItemKey) => items.find(i => i.key === key)?.status === 'done'
  let tierLevel: 0 | 1 | 2 | 3 | 4 | 5 = 0
  if (has('login_line')) tierLevel = 0                          // แค่ login → ผู้ใช้ใหม่
  if (has('login_line') && has('line_id')) tierLevel = 1        // + LINE ID → ผู้ใช้ทั่วไป
  if (tierLevel >= 1 && has('phone_verified')) tierLevel = 2    // + เบอร์โทร → ยืนยันมือถือแล้ว
  if (tierLevel >= 2 && has('id_verified')) tierLevel = 3       // + บัตร+บัญชี → ลงทะเบียนแล้ว
  if (tierLevel >= 3 && has('oa_friend')) tierLevel = 4         // + OA friend → Trusted
  if (count === 5) tierLevel = 5                                // ครบหมด → Verified Pro
  const tier = TRUST_TIERS[tierLevel]

  return {
    count,
    total: items.length,
    percent,
    items,
    tier,
  }
}

/** เลือก tier label สั้นสำหรับแสดงใน listing card / search result */
export function getShortBadge(user: Partial<User> | null | undefined): TrustTier {
  return computeTrustScore(user).tier
}
