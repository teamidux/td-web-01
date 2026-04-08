<?php
/**
 * Google Books API proxy — สำหรับ shared hosting ในไทย
 *
 * วัตถุประสงค์:
 *   Vercel function ปัจจุบันรันที่ Singapore edge (sin1) ทำให้ Google Books API
 *   geo-localize เป็น Asia general ไม่ใช่ Thailand → คืนหนังสือไม่ตรงเล่ม
 *   proxy นี้รันบน shared host ในไทย (เช่น Hostinglotus) → real Thai IP →
 *   Google คืนผลที่ optimize สำหรับผู้ใช้ไทยจริงๆ
 *
 * วิธี deploy:
 *   1. Upload file นี้ไปที่ root ของ Hostinglotus public_html (หรือ subfolder)
 *      เช่น https://weeehappy.com/books-proxy.php
 *   2. แก้ค่า PROXY_TOKEN ด้านล่างเป็น random string ของคุณเอง
 *      (วิธีสร้าง: openssl rand -hex 24 หรือใช้ password generator)
 *   3. ตั้ง env vars ใน Vercel:
 *        GOOGLE_BOOKS_PROXY_URL=https://weeehappy.com/books-proxy.php
 *        GOOGLE_BOOKS_PROXY_TOKEN=<token เดียวกับข้างล่าง>
 *   4. Redeploy Vercel
 *
 * Security: ใช้ token query param เพื่อกันคนอื่นเรียก proxy ของคุณ
 * (จะถูกใช้ Google API quota ฟรีๆ)
 *
 * Cost: 0 บาท ถ้ามี hosting อยู่แล้ว — ไม่ต้องเปิด domain หรือ space ใหม่
 */

// ==================== CONFIG ====================
// แก้บรรทัดนี้! สร้าง random string ใหม่ เก็บเป็นความลับ
$PROXY_TOKEN = 'CHANGE-ME-PUT-RANDOM-STRING-HERE';

// timeout ใน sec — Google ปกติตอบใน 1-2s, 8s เผื่อไว้
$TIMEOUT = 8;
// ================================================

// 1. Token check — กันคนอื่นใช้ proxy ของเรา
$incoming = $_GET['t'] ?? '';
if (!hash_equals($PROXY_TOKEN, $incoming)) {
    http_response_code(403);
    header('Content-Type: text/plain');
    exit('forbidden');
}

// 2. Build Google Books URL จาก query params (ยกเว้น 't')
$params = $_GET;
unset($params['t']);
$url = 'https://www.googleapis.com/books/v1/volumes?' . http_build_query($params);

// 3. Forward request ด้วย cURL (more reliable than file_get_contents)
$ch = curl_init($url);
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT => $TIMEOUT,
    CURLOPT_CONNECTTIMEOUT => 5,
    CURLOPT_FOLLOWLOCATION => true,
    CURLOPT_HTTPHEADER => ['Accept: application/json'],
]);
$body = curl_exec($ch);
$status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$err = curl_error($ch);
curl_close($ch);

// 4. Handle errors
if ($body === false || $status === 0) {
    http_response_code(502);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['error' => 'upstream_unreachable', 'detail' => $err]);
    exit;
}

// 5. Forward Google's response as-is
http_response_code($status);
header('Content-Type: application/json; charset=utf-8');
// cache 24 ชั่วโมง — ลด API call ซ้ำซ้อน + ประหยัด Google quota
// (Free tier 1,000 calls/day)
header('Cache-Control: public, max-age=86400');
echo $body;
