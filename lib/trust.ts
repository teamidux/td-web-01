// Trust mission logic — compute completion + tier + badge from user object
//
// Tier badge (ต้องครบ "ทั้งคู่" ถึงจะเป็น Verified Seller):
//   login ด้วย LINE                     → 👤 สมาชิก
//   + ยืนยันเบอร์โทร (ไม่มี ID)          → 📱 ลงทะเบียนมือถือแล้ว
//   + ยืนยันตัวตน (ไม่มี phone)         → 🪪 ยืนยันตัวตนแล้ว
//   + ครบทั้ง phone + ID                → 🛡️ Verified Seller
//
// Mission items (แสดงใน profile):
//   - LINE ID (แสดงเฉพาะคนยังไม่กรอก)
//   - ยืนยันเบอร์โทร
//   - ยืนยันตัวตน

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
}

export function computeTrustScore(user: Partial<User> | null | undefined): TrustScore {
  if (!user) {
    return { count: 0, total: 2, percent: 0, items: [], tier: TRUST_TIERS.member }
  }

  const u = user as any
  const hasLineId = !!u.line_id
  const hasPhone = !!u.phone_verified_at
  const hasId = !!u.id_verified_at
  const idPending = !hasId && !!u.id_verify_submitted_at

  // Visible items — ซ่อน line_id ถ้าทำแล้ว
  const items: TrustItem[] = []

  if (!hasLineId) {
    items.push({
      key: 'line_id',
      status: 'todo',
      title: 'ใส่ LINE ID ของคุณ',
      benefit: 'ผู้ซื้อจะติดต่อคุณได้ — ไม่มี LINE ID ลูกค้าหาคุณไม่เจอ',
      icon: '🆔',
    })
  }

  items.push({
    key: 'phone_verified',
    status: hasPhone ? 'done' : 'todo',
    title: 'ยืนยันเบอร์โทร',
    benefit: 'ได้รับป้าย 📱 ลงทะเบียนมือถือแล้ว',
    icon: '📱',
  })

  items.push({
    key: 'id_verified',
    status: hasId ? 'done' : idPending ? 'pending' : 'todo',
    title: 'ยืนยันตัวตน',
    benefit: 'บัตรประชาชน + สมุดบัญชี — ได้ป้าย 🛡️ Verified Seller',
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
