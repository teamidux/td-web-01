// Trust mission logic — 2 items เท่านั้น
//   1. ยืนยันเบอร์โทร (ถ้า login ด้วย OTP ผ่านเลย)
//   2. ยืนยันตัวตน (บัตร + หน้าบัญชี)
//
// LINE ID ไม่อยู่ในนี้แล้ว — เป็น optional ใน edit profile

import type { User } from './supabase'

export type TrustItemKey =
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
  level: number
  label: string
  shortLabel: string
  emoji: string
  color: string
  bgColor: string
}

export type TrustScore = {
  count: number
  total: number
  percent: number
  items: TrustItem[]
  tier: TrustTier
}

export const TRUST_TIERS: Record<string, TrustTier> = {
  member:     { level: 0, label: 'สมาชิก',              shortLabel: '👤 สมาชิก',            emoji: '👤', color: '#64748B', bgColor: '#F1F5F9' },
  phone:      { level: 1, label: 'ลงทะเบียนมือถือแล้ว',   shortLabel: '📱 ลงทะเบียนแล้ว',    emoji: '📱', color: '#0891B2', bgColor: '#ECFEFF' },
  id:         { level: 1, label: 'ยืนยันตัวตนแล้ว',       shortLabel: '🪪 ยืนยันตัวตนแล้ว',  emoji: '🪪', color: '#D97706', bgColor: '#FEF3C7' },
  verified:   { level: 2, label: 'Verified Seller',     shortLabel: '🛡️ Verified Seller',  emoji: '🛡️', color: '#1D4ED8', bgColor: '#DBEAFE' },
  admin:      { level: 99, label: 'Admin',              shortLabel: '🛡️ Admin',            emoji: '⚡', color: '#7C3AED', bgColor: '#F3E8FF' },
}

export function computeTrustScore(user: Partial<User> | null | undefined): TrustScore {
  if (!user) {
    return { count: 0, total: 2, percent: 0, items: [], tier: TRUST_TIERS.member }
  }

  const u = user as any

  // Admin → ข้าม verify ทั้งหมด แสดงป้าย Admin
  if (u.is_admin) {
    return { count: 2, total: 2, percent: 100, items: [], tier: TRUST_TIERS.admin }
  }

  const hasPhone = !!u.phone_verified_at
  const hasId = !!u.id_verified_at
  const idPending = !hasId && !!u.id_verify_submitted_at

  const items: TrustItem[] = []

  items.push({
    key: 'phone_verified',
    status: hasPhone ? 'done' : 'todo',
    title: 'ยืนยันเบอร์โทร',
    benefit: 'รับป้าย — ลูกค้ามั่นใจว่าเบอร์โทรใช้งานได้จริง',
    icon: '📱',
  })

  items.push({
    key: 'id_verified',
    status: hasId ? 'done' : idPending ? 'pending' : 'todo',
    title: 'ยืนยันตัวตน',
    benefit: 'รับป้าย — บัตรประชาชน + สมุดบัญชี ลูกค้ากล้าสั่งมากขึ้น',
    icon: '🪪',
  })

  const doneCount = items.filter(i => i.status === 'done').length
  const total = items.length
  const percent = total > 0 ? Math.round((doneCount / total) * 100) : 100

  // Tier — ต้องครบ "ทั้งคู่" ถึงจะเป็น Verified Seller
  let tier = TRUST_TIERS.member
  if (hasPhone && !hasId) tier = TRUST_TIERS.phone
  else if (hasId && !hasPhone) tier = TRUST_TIERS.id
  else if (hasPhone && hasId) tier = TRUST_TIERS.verified

  return { count: doneCount, total, percent, items, tier }
}

export function getShortBadge(user: Partial<User> | null | undefined): TrustTier {
  return computeTrustScore(user).tier
}
