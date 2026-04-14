'use client'
import { useEffect, useState } from 'react'

// Banner สำหรับ LINE browser — แนะนำให้เปิดใน Chrome/Safari
// แสดงครั้งเดียว ถ้า user กดปิดแล้วจำใน localStorage
export default function LineBrowserBanner() {
  const [show, setShow] = useState(false)
  const [isIos, setIsIos] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const ua = navigator.userAgent
    const isLine = /Line\//.test(ua)
    if (!isLine) return
    // เช็คว่า user ปิด banner ไปแล้วหรือยัง
    if (localStorage.getItem('bm_line_banner_dismissed') === '1') return
    setIsIos(/iPhone|iPad|iPod/.test(ua))
    setShow(true)
  }, [])

  const dismiss = () => {
    localStorage.setItem('bm_line_banner_dismissed', '1')
    setShow(false)
  }

  const openExternal = () => {
    const url = window.location.href
    if (isIos) {
      // iOS: ไม่มี intent URL มาตรฐาน แค่ copy + แนะนำ user
      // LINE iOS มีปุ่ม ... มุมขวาบน → "Open in Safari"
      alert('กดปุ่ม ••• (มุมขวาบน) แล้วเลือก "Open in Safari"')
      return
    }
    // Android: ใช้ intent URL เปิด Chrome
    window.location.href = `intent://${url.replace(/^https?:\/\//, '')}#Intent;scheme=https;package=com.android.chrome;end`
  }

  if (!show) return null

  return (
    <div style={{
      background: 'linear-gradient(135deg, #1E3A8A 0%, #1E40AF 100%)',
      color: 'white',
      padding: '10px 12px',
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      fontSize: 13,
      lineHeight: 1.4,
    }}>
      <span style={{ fontSize: 18, flexShrink: 0 }}>💡</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700 }}>เปิดใน {isIos ? 'Safari' : 'Chrome'} ใช้ได้เต็ม</div>
        <div style={{ fontSize: 11, opacity: .85, marginTop: 1 }}>สแกน barcode + ถ่ายรูปบัตรได้</div>
      </div>
      <button
        onClick={openExternal}
        style={{
          background: 'white',
          color: '#1E40AF',
          border: 'none',
          borderRadius: 8,
          padding: '6px 12px',
          fontSize: 12,
          fontWeight: 700,
          fontFamily: 'Kanit',
          cursor: 'pointer',
          whiteSpace: 'nowrap',
          flexShrink: 0,
        }}
      >
        เปิด
      </button>
      <button
        onClick={dismiss}
        aria-label="ปิด"
        style={{
          background: 'rgba(255,255,255,.15)',
          color: 'white',
          border: 'none',
          borderRadius: 8,
          width: 28,
          height: 28,
          fontSize: 14,
          fontWeight: 700,
          cursor: 'pointer',
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        ✕
      </button>
    </div>
  )
}
