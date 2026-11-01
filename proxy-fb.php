<?php
// Firebase Auth yardımcı sayfalarını (/__/auth/*, /__/firebase/*) kendi alan adımızdan sunar.
// Safari/iOS (Bluefy dahil) üçüncü taraf depolamayı bölümlediği için authDomain ile uygulama aynı alan adında olmalı.
$p = $_GET['p'] ?? '';
if (!preg_match('#^(auth|firebase)/[A-Za-z0-9._/\-]*$#', $p) || strpos($p, '..') !== false || $_SERVER['REQUEST_METHOD'] !== 'GET') {
    http_response_code(404);
    exit;
}
$q = $_GET;
unset($q['p']);
$url = 'https://obd2-c65e2.firebaseapp.com/__/' . $p . ($q ? '?' . http_build_query($q) : '');

$ch = curl_init($url);
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_FOLLOWLOCATION => false,
    CURLOPT_ENCODING => '',
    CURLOPT_TIMEOUT => 15,
    CURLOPT_USERAGENT => $_SERVER['HTTP_USER_AGENT'] ?? 'Mozilla/5.0',
]);
$body = curl_exec($ch);
$code = curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
$type = curl_getinfo($ch, CURLINFO_CONTENT_TYPE);
curl_close($ch);

if ($body === false) { http_response_code(502); exit; }
http_response_code($code ?: 502);
if ($type) header('Content-Type: ' . $type);
header('Cache-Control: no-store');
echo $body;
