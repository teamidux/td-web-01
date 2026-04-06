'use client'
import { useEffect } from 'react'
import { registerSW } from '@/lib/push'

export default function PwaInit() {
  useEffect(() => { registerSW() }, [])
  return null
}
