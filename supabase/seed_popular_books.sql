-- Seed: หนังสือยอดนิยมไทย จาก Google Books (filtered + ranked)
-- Generated: 2026-04-08, จาก local Thailand IP โดย Claude
-- รัน: paste ใน Supabase SQL Editor หรือ psql แล้ว run
-- Safe to re-run: ON CONFLICT (isbn) DO NOTHING

-- =====================================================
-- Total: 51 เล่ม
-- Breakdown:
--   ขุนช้างขุนแผน: 10
--   เพชรพระอุมา: 9
--   แฮร์รี่ พอตเตอร์: 8
--   เจ้าชายน้อย: 7
--   สามก๊ก: 7
--   สตีฟ จ็อบส์: 6
--   สี่แผ่นดิน: 4
-- =====================================================

INSERT INTO public.books (isbn, title, author, publisher, cover_url, language, source) VALUES
  ('9789749601754', 'แฮร์รี่ พอตเตอร์ กับศิลาอาถรรพ์', NULL, NULL, NULL, 'th', 'google_books_seed'),
  ('9789749656020', 'แฮร์รี่ พอตเตอร์กับภาคีนกฟีนิกซ์', 'J. K. Rowling, Sumālī', NULL, NULL, 'th', 'google_books_seed'),
  ('9789749601822', 'แฮร์รี่ พอตเตอร์กับถ้วยอัคนี', 'J.K. Rowling', NULL, NULL, 'th', 'google_books_seed'),
  ('9786160418190', 'แฮรี่ พอตเตอร์กับเจ้าชายเลือดผสม', 'J. K. Rowling', NULL, NULL, 'th', 'google_books_seed'),
  ('9786160417926', 'แฮรี่ พอตเตอร์กับศิลาอาถรรพ์', 'J. K. Rowling', NULL, NULL, 'th', 'google_books_seed'),
  ('9786160417940', 'แฮรี่ พอตเตอร์กับเครื่องรางยมทูต', 'J. K. Rowling', NULL, NULL, 'th', 'google_books_seed'),
  ('9786160417919', 'แฮร์รี่ พอตเตอร์กับศิลาอาถรรพ์', 'เจ. เค โรว์ลิ่ง', NULL, NULL, 'th', 'google_books_seed'),
  ('9786160418183', 'แฮรี่ พอตเตอร์กับภาคีนกฟีนิกซ์', 'J. K. Rowling', NULL, NULL, 'th', 'google_books_seed'),
  ('9789743895951', 'ขุนช้างขุนแผน', 'สุภฤกษ์ บุญทอง', 'Skybook Co.,Ltd', 'https://books.google.com/books/content?id=N64tCgAAQBAJ&printsec=frontcover&img=1&zoom=1&source=gbs_api', 'th', 'google_books_seed'),
  ('9786162130878', 'ขุนช้างขุนแผน ตอน พลายแก้วยกทัพ', 'สุรศักดิ์ ตรีนนท์, พิศาล เพ็งทรวง', 'Skybook Co.,Ltd', 'https://books.google.com/books/content?id=NgQuCgAAQBAJ&printsec=frontcover&img=1&zoom=1&source=gbs_api', 'th', 'google_books_seed'),
  ('9786162131059', 'ขุนช้างขุนแผน ตอน การเดินทางของพลายน้อย', 'สุรศักดิ์ ตรีนนท์, พิศาล เพ็งทรวง', 'Skybook Co.,Ltd', 'https://books.google.com/books/content?id=BgAuCgAAQBAJ&printsec=frontcover&img=1&zoom=1&source=gbs_api', 'th', 'google_books_seed'),
  ('9786161300784', 'เสภาเรื่องขุนช้างขุนแผน', NULL, NULL, NULL, 'th', 'google_books_seed'),
  ('9789748797632', 'เล่าเรื่องขุนช้างขุนแผน', NULL, NULL, NULL, 'th', 'google_books_seed'),
  ('9789742462963', 'ขุนช้าง ขุนแผน', 'Prēmsērī', NULL, NULL, 'th', 'google_books_seed'),
  ('9789747813098', 'เล่าเรื่องขุนช้างขุนแผน', NULL, NULL, NULL, 'th', 'google_books_seed'),
  ('9786164344051', 'ขุนช้างขุนแผน ฉบับย่อ', 'สาละ บุญคง', NULL, NULL, 'th', 'google_books_seed'),
  ('9789745426092', 'แก่นเรื่องจากวรรณคดีเรื่องขุนช้างขุนแผน', NULL, NULL, NULL, 'th', 'google_books_seed'),
  ('9786163881168', 'เล่าเรื่องขุนช้างขุนแผน', NULL, NULL, NULL, 'th', 'google_books_seed'),
  ('9786162148002', 'เพชรพระอุมา', NULL, NULL, NULL, 'th', 'google_books_seed'),
  ('9786162147807', 'เพชรพระอุมา', 'ฉัตรชัย วิเศษสุวรรณภูมิ', NULL, NULL, 'th', 'google_books_seed'),
  ('9789744466143', 'เพชรพระอุมา', 'ัฉตรัชย ิวเศษุสวรรณูภิม', NULL, NULL, 'th', 'google_books_seed'),
  ('9789744466020', 'เพชรพระอุมา', 'ัฉตรัชย ิวเศษุสวรรณูภิม', NULL, NULL, 'th', 'google_books_seed'),
  ('9786162147999', 'เพชรพระอุมา', NULL, NULL, NULL, 'th', 'google_books_seed'),
  ('9786162148293', 'เพชรพระอุมา', NULL, NULL, NULL, 'th', 'google_books_seed'),
  ('9789744465962', 'เพชรพระอุมา', NULL, NULL, NULL, 'th', 'google_books_seed'),
  ('9789744466471', 'เพชรพระอุมา', 'ัฉตรัชย ิวเศษุสวรรณูภิม', NULL, NULL, 'th', 'google_books_seed'),
  ('9786162148033', 'เพชรพระอุมา', NULL, NULL, NULL, 'th', 'google_books_seed'),
  ('9789740200581', 'สี่แผ่นดินกับเรื่องจริงฯ', 'ศันสนีย์ วีระศิลป์ชัย', 'Matichon Public Company Limited', 'https://books.google.com/books/content?id=x-dVDwAAQBAJ&printsec=frontcover&img=1&zoom=1&source=gbs_api', 'th', 'google_books_seed'),
  ('9786160460700', 'สี่แผ่นดิน', 'คึกฤทธิ์ ปราโมช (ม.ร.ว.)', NULL, NULL, 'th', 'google_books_seed'),
  ('9789746038539', 'สี่แผ่นดิน', 'Khưkrit Pr āmōt', NULL, NULL, 'th', 'google_books_seed'),
  ('9789749906200', 'สี่แผ่นดิน', NULL, NULL, NULL, 'th', 'google_books_seed'),
  ('9786167443362', 'สตีฟ จ็อบส์ ตายแล้วไปไหน', 'ราช รามัญ', 'บริษัท ไพลินบุ๊คเน็ต จำกัด (มหาชน)', 'https://books.google.com/books/content?id=gJ0vEAAAQBAJ&printsec=frontcover&img=1&zoom=1&source=gbs_api', 'th', 'google_books_seed'),
  ('9786162075063', 'ผม--สตีฟ จ็อบส์', 'สตีฟ จ็อบส์', NULL, NULL, 'th', 'google_books_seed'),
  ('9786165156349', 'กว่าจะเป็น สตีฟ จ็อบส์', 'เบรนต์ ชเลนเดอร์', NULL, NULL, 'th', 'google_books_seed'),
  ('9786165167505', 'ผมชื่อสตีฟ จ็อบส์', 'กย็องวัน นัม, ฮีกอน อัน, ธนวดี บุญล้วน', NULL, NULL, 'th', 'google_books_seed'),
  ('9786162053085', 'กล้าคิด กล้าทํา แบบสตีฟ จ็อบส์', 'แดเนียล สมิท, ประไพศรี สงวนวงศ์', NULL, NULL, 'th', 'google_books_seed'),
  ('9786162362026', 'อมตะวาจา สตีฟ จ็อบส์ ไม่มีวันตาย', 'ชนัฐ เกิดประดับ', NULL, NULL, 'th', 'google_books_seed'),
  ('9786160462278', 'เจ้าชายน้อย', 'อองตวน เดอ แซงแต็กซูเปรี', 'Nanmeebooks', 'https://books.google.com/books/content?id=-uwaEQAAQBAJ&printsec=frontcover&img=1&zoom=1&source=gbs_api', 'th', 'google_books_seed'),
  ('9786165729338', 'เจ้าชายน้อย', 'อองตวน เดอ แซงท์-แอคซูเปรี', NULL, NULL, 'th', 'google_books_seed'),
  ('9786165810890', 'เจ้าชายน้อย', 'อองตวน เดอ แซงท์-แอคซูเปรี', NULL, NULL, 'th', 'google_books_seed'),
  ('9786160855049', 'เจ้าชายน้อย', 'ลูอีซ เกร็ก', NULL, NULL, 'th', 'google_books_seed'),
  ('9786163887726', 'เจ้าชายน้อย', 'อองตวน เดอ แซงท์-แอคซูเปรี', NULL, NULL, 'th', 'google_books_seed'),
  ('9789743000904', 'เจ้าชายน้อย', 'Antoine de Saint-Exupéry', NULL, NULL, 'th', 'google_books_seed'),
  ('9786165109604', 'เจ้าชายน้อย', 'อองตวน เดอ แซงท์-แอคซูเปรี', NULL, NULL, 'th', 'google_books_seed'),
  ('9789743896347', 'สามก๊ก', 'สุภฤกษ์ บุญกอง', 'Skybook Co.,Ltd', 'https://books.google.com/books/content?id=NdknCgAAQBAJ&printsec=frontcover&img=1&zoom=1&source=gbs_api', 'th', 'google_books_seed'),
  ('9789740200000', 'สามก๊ก ฉบับคนกันเอง ภาค 2', 'เอื้อ อัญชลี', 'Matichon Public Company Limited', 'https://books.google.com/books/content?id=9yxWDwAAQBAJ&printsec=frontcover&img=1&zoom=1&source=gbs_api', 'th', 'google_books_seed'),
  ('9789743236594', 'สามก๊ก ฉบับคนกันเอง ภาค 1', 'เอื้อ อัญชลี', 'Matichon Public Company Limited', 'https://books.google.com/books/content?id=gi9WDwAAQBAJ&printsec=frontcover&img=1&zoom=1&source=gbs_api', 'th', 'google_books_seed'),
  ('9786167410548', 'แบบฉบับสำหรับผู้บริหาร จากกลยุทธ์สามก๊ก', 'สมชาติ  กิจยรรยง', 'บริษัท ออลเดย์ ช็อปปิ้ง จำกัด', 'https://books.google.com/books/content?id=KT0pEAAAQBAJ&printsec=frontcover&img=1&zoom=1&source=gbs_api', 'th', 'google_books_seed'),
  ('9786161404864', 'เก่งได้อีก ด้วยวิถีสามก๊ก : รวมเทคนิคสร้างความเก่ง เพื่อให้คุณประสบความสำเร็จเร็วกว่าคนอื่น', 'เปี่ยมศักดิ์ คุณากรประทีป', 'Book Time Co., Ltd.', 'https://books.google.com/books/content?id=ZlG7EAAAQBAJ&printsec=frontcover&img=1&zoom=1&source=gbs_api', 'th', 'google_books_seed'),
  ('9786167350141', 'การเมืองเรื่องสามก๊ก', 'อ.ฐาปนีย์ อตีตา', 'สำนักพิมพ์ เพชรประกาย', 'https://books.google.com/books/content?id=QSyKDwAAQBAJ&printsec=frontcover&img=1&zoom=1&source=gbs_api', 'th', 'google_books_seed'),
  ('9789740206460', 'สามก๊ก ฉบับคนกันเอง ภาค 3', 'เอื้อ อัญชลี', 'Matichon Public Company Limited', 'https://books.google.com/books/content?id=fi9WDwAAQBAJ&printsec=frontcover&img=1&zoom=1&source=gbs_api', 'th', 'google_books_seed')
ON CONFLICT (isbn) DO NOTHING;

-- ตรวจผล:
-- SELECT COUNT(*) FROM books WHERE source = 'google_books_seed';
