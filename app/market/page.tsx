'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { Nav, BottomNav, BookCover, SkeletonList } from '@/components/ui'

interface MarketBook {
  isbn: string
  title: string
  author: string | null
  cover_url: string | null
  wanted_count: number
  active_listings_count: number
  min_price: number | null
}

export default function MarketPage() {
  const [items, setItems] = useState<MarketBook[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    load()
  }, [])

  const load = async () => {
    const { data } = await supabase
      .from('books')
      .select('isbn, title, author, cover_url, wanted_count, active_listings_count, min_price')
      .gt('wanted_count', 0)
      .order('wanted_count', { ascending: false })
      .limit(50)
    setItems(data || [])
    setLoading(false)
  }

  return (
    <>
      <Nav />
      <div className="page">
        <div style={{ background: 'var(--primary)', padding: '28px 20px 32px', color: 'white' }}>
          <div style={{ fontSize: 24, fontWeight: 700, lineHeight: 1.3, letterSpacing: '-0.02em', marginBottom: 8 }}>
            📊 หนังสือที่ตลาดต้องการ
          </div>
          <div style={{ fontSize: 15, lineHeight: 1.6, color: '#E0E7FF' }}>
            หนังสือที่หลายคนกำลังรอซื้อ — ลงขายได้ขายไว
          </div>
        </div>

        <div className="section">
          {loading ? (
            <SkeletonList count={6} />
          ) : items.length === 0 ? (
            <div className="empty">
              <div className="empty-icon">📭</div>
              <div style={{ fontSize: 16, lineHeight: 1.6 }}>ยังไม่มีหนังสือในรายการรอซื้อ</div>
            </div>
          ) : (
            items.map((book, idx) => (
              <Link
                key={book.isbn}
                href={`/book/${book.isbn}`}
                style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}
              >
                <div className="card">
                  <div className="book-card">
                    {/* rank number */}
                    <div
                      style={{
                        width: 32,
                        flexShrink: 0,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: idx < 3 ? 22 : 18,
                        fontWeight: 700,
                        color: idx === 0 ? '#EAB308' : idx === 1 ? '#94A3B8' : idx === 2 ? '#D97706' : 'var(--ink3)',
                        letterSpacing: '-0.02em',
                      }}
                    >
                      {idx + 1}
                    </div>

                    <BookCover isbn={book.isbn} title={book.title} size={64} />

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="book-title" style={{ overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                        {book.title}
                      </div>
                      {book.author && <div className="book-author">{book.author}</div>}

                      {/* demand + supply */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginTop: 6 }}>
                        <span
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 6,
                            background: '#EEF2FF',
                            color: '#1D4ED8',
                            fontSize: 14,
                            fontWeight: 700,
                            padding: '6px 12px',
                            borderRadius: 9999,
                            letterSpacing: '0.02em',
                          }}
                        >
                          🙋 {book.wanted_count} คนรอซื้อ
                        </span>
                        {book.active_listings_count > 0 ? (
                          <span style={{ fontSize: 13, color: 'var(--ink3)', lineHeight: 1.6 }}>
                            มี {book.active_listings_count} ประกาศ
                          </span>
                        ) : (
                          <span
                            style={{
                              fontSize: 13,
                              fontWeight: 600,
                              color: '#16A34A',
                              background: '#E6F4EA',
                              padding: '4px 10px',
                              borderRadius: 9999,
                            }}
                          >
                            ✨ ยังไม่มีคนขาย
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </Link>
            ))
          )}

          {!loading && items.length > 0 && (
            <div
              style={{
                textAlign: 'center',
                padding: '24px 16px 8px',
                fontSize: 13,
                color: 'var(--ink3)',
                lineHeight: 1.6,
              }}
            >
              แสดงสูงสุด 50 อันดับแรก
            </div>
          )}
        </div>
      </div>
      <BottomNav />
    </>
  )
}
