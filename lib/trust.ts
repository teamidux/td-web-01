// Trust mission logic — compute completion + tier + badge from user object
//
// 3 visible items (แสดงใน mission card):
//   1. line_id        → ใส่ LINE ID (ซ่อนถ้าทำแล้ว)
//   2. phone_verified → ยืนยันเบอร์โทร
//   3. id_verified    → ยืนยันตัวตน (บัตร+สมุดบัญชี)
//
// Tier badge ตามสิ่งที่ user ทำจริง:
//   login อย่างเดียว          → 🆕 ผู้ใช้ใหม่
//   + ใส่ LINE ID             → 👤 ผู้ใช้ทั่วไป
//   + ยืนยันเบอร์โทร          → 📱 ยืนยันมือถือแล้ว
//   + ยืนยันตัวตน (บัตร+บัญชี) → 🛡️ ลงทะเบียนแล้ว
//   ครบทั้ง 3                  → ✅ Verified Pro

import type { User } from './supabase'

export type TrustItemKey =
  | 'line_id'
  | 'phone_verified'
  | 'id_verified'

export type TrustItemStatus = 'done' | 'pending' | 'todo'

export type TrustItem = {
  key: TrustItemKey
  status: TrustItemStatus
  title: string
  benefit: string
  icon: string
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
  total: number       // visible items count
  percent: number     // 0-100
  items: TrustItem[]  // เฉพาะ items ที่ยังต้องแสดง
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
      total: 3,
      percent: 0,
      items: [],
      tier: TRUST_TIERS[0],
    }
  }

  const u = user as any

  // All items สำหรับคำนวณ tier
  const hasLineId = !!u.line_id
  const hasPhone = !!u.phone_verified_at
  const hasId = !!u.id_verified_at
  const idPending = !hasId && !!u.id_verify_submitted_at

  // Visible items — ซ่อน line_id ถ้าทำแล้ว (เพราะทุกคนกรอกตอน onboarding)
  const items: TrustItem[] = []

  if (!hasLineId) {
    items.push({
      key: 'line_id',
      status: 'todo',
      title: 'ใส่ LINE ID ของคุณ',
      benefit: 'ใช้ติดต่อระหว่างผู้ซื้อและผู้ขาย — ไม่ต้องเปิดเบอร์โทร',
      icon: '🆔',
    })
  }

  items.push({
    key: 'phone_verified',
    status: hasPhone ? 'done' : 'todo',
    title: 'ยืนยันเบอร์โทร',
    benefit: 'ได้รับป้าย ยืนยันตัวตนด้วยมือถือ 📱',
    icon: '📱',
  })

  items.push({
    key: 'id_verified',
    status: hasId ? 'done' : idPending ? 'pending' : 'todo',
    title: 'ยืนยันตัวตน',
    benefit: 'บัตรประชาชน + สมุดบัญชี — รับป้าย ลงทะเบียนแล้ว 🛡️',
    icon: '🪪',
  })

  const doneCount = items.filter(i => i.status === 'done').length
  const total = items.length
  const percent = total > 0 ? Math.round((doneCount / total) * 100) : 100

  // Tier ตามสิ่งที่ user ทำจริง
  let tierLevel: 0 | 1 | 2 | 3 | 4 | 5 = 0
  if (hasLineId) tierLevel = 1              // LINE ID → ผู้ใช้ทั่วไป
  if (hasLineId && hasPhone) tierLevel = 2  // + เบอร์โทร → ยืนยันมือถือแล้ว
  if (tierLevel >= 2 && hasId) tierLevel = 3 // + บัตร+บัญชี → ลงทะเบียนแล้ว
  if (doneCount === 3) tierLevel = 5        // ครบทั้ง 3 → Verified Pro
  const tier = TRUST_TIERS[tierLevel]

  return {
    count: doneCount,
    total,
    percent,
    items,
    tier,
  }
}

/** เลือก tier label สั้นสำหรับแสดงใน listing card / search result */
export function getShortBadge(user: Partial<User> | null | undefined): TrustTier {
  return computeTrustScore(user).tier
}
