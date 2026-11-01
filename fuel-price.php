<?php
// Opet'in herkese açık fiyat servisinden güncel pompa fiyatını getirir (tarayıcı doğrudan çağıramaz: CORS yok).
// ?list=1            -> il listesi
// ?province=34       -> { benzin, motorin, motorinPlus, province, source, at }
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

function opet($path)
{
    $cache = sys_get_temp_dir() . '/opet_' . md5($path) . '.json';
    if (is_file($cache) && time() - filemtime($cache) < 1800) return file_get_contents($cache);
    $ch = curl_init('https://api.opet.com.tr/api/fuelprices/' . $path);
    curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 12, CURLOPT_ENCODING => '', CURLOPT_USERAGENT => 'Mozilla/5.0']);
    $body = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    $GLOBALS['dbg'] = ['http' => $code, 'err' => curl_error($ch), 'curl' => function_exists('curl_version') ? curl_version()['version'] : null, 'head' => is_string($body) ? substr($body, 0, 120) : null];
    curl_close($ch);
    if ($body !== false && $code === 200 && json_decode($body) !== null) { @file_put_contents($cache, $body); return $body; }
    if (is_file($cache)) return file_get_contents($cache); // servis yanıt vermezse eski değer
    return null;
}

if (isset($_GET['list'])) {
    $b = opet('provinces');
    if ($b === null) { http_response_code(502); echo '{"error":"kaynak yanıt vermedi"}'; exit; }
    echo $b; exit;
}

$prov = (int)($_GET['province'] ?? 34);
if ($prov < 1 || $prov > 81 && $prov !== 934) { http_response_code(400); echo '{"error":"geçersiz il"}'; exit; }
$b = opet('prices?ProvinceCode=' . $prov);
$rows = $b ? json_decode($b, true) : null;
if (!$rows) { http_response_code(502); echo json_encode(['error' => 'kaynak yanıt vermedi', 'debug' => $GLOBALS['dbg'] ?? null], JSON_UNESCAPED_UNICODE); exit; }

// ilçelere göre değişebilir: ilin ilçe fiyatlarının ortancası
$by = [];
foreach ($rows as $d) foreach ($d['prices'] as $p) $by[$p['productCode']][] = (float)$p['amount'];
$med = function ($a) { if (!$a) return null; sort($a); return $a[(int)floor((count($a) - 1) / 2)]; };
echo json_encode([
    'source' => 'Opet',
    'province' => $rows[0]['provinceName'] ?? '',
    'benzin' => $med($by['A100'] ?? []),
    'motorin' => $med($by['A128'] ?? []),
    'motorinPlus' => $med($by['A121'] ?? []),
    'at' => date('c'),
], JSON_UNESCAPED_UNICODE);
