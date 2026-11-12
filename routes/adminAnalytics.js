// Tổng hợp thống kê hành vi khách tham quan từ content/.analytics/*.ndjson (do
// routes/analyticsEvents.js ghi). Đọc lại file và gom nhóm mỗi lần gọi — quy mô
// nhỏ nên không cần cơ sở dữ liệu riêng.
const express = require('express');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { CONTENT_DIR } = require('../staticContentBundle');
const authenticateToken = require('../middleware/auth');
const { requireLevel, LEVEL } = authenticateToken;

const router = express.Router();
// Chỉ đọc → mọi vai trò đều xem được, kể cả Chỉ xem.
router.use(authenticateToken, requireLevel(LEVEL.viewer));

const ANALYTICS_LOG_FILE = path.join(CONTENT_DIR, '.analytics', 'events.ndjson');

const RANGE_MS = {
  today: 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
};

// Chỉ chọn các file tháng có thể chứa sự kiện trong khoảng được hỏi, thay vì đọc
// cả lịch sử. Dải tháng tính từ mốc thời gian, không dựa vào tên file.
function monthKeysInRange(cutoffMs, now) {
  if (!cutoffMs) return null; // 'all' → lấy mọi file trên đĩa
  const keys = new Set();
  const d = new Date(now - cutoffMs);
  d.setDate(1);
  const end = new Date(now);
  while (d <= end) {
    keys.add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    d.setMonth(d.getMonth() + 1);
  }
  return keys;
}

function analyticsFilesFor(monthKeys) {
  const dir = path.dirname(ANALYTICS_LOG_FILE);
  const files = [];
  // File từ trước khi chia theo tháng — không biết chứa tháng nào nên luôn đọc.
  if (fs.existsSync(ANALYTICS_LOG_FILE)) files.push(ANALYTICS_LOG_FILE);
  let names = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return files; // Chưa có thư mục .analytics — chưa có số liệu.
  }
  for (const name of names) {
    const m = /^events-(\d{4}-\d{2})\.ndjson$/.exec(name);
    if (!m) continue;
    if (monthKeys && !monthKeys.has(m[1])) continue;
    files.push(path.join(dir, name));
  }
  return files;
}

// Đọc theo luồng thay vì nạp cả file vào chuỗi: file lớn sẽ chặn cả máy chủ và
// có thể vượt giới hạn chuỗi của V8.
async function loadEvents(monthKeys) {
  const out = [];
  for (const file of analyticsFilesFor(monthKeys)) {
    const rl = readline.createInterface({
      input: fs.createReadStream(file, { encoding: 'utf8' }),
      crlfDelay: Infinity,
    });
    for await (const line of rl) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        out.push(JSON.parse(trimmed));
      } catch {
        // Dòng hỏng — bỏ qua.
      }
    }
  }
  return out;
}

// Tên hiển thị của một trường đa ngôn ngữ — ưu tiên ngôn ngữ mặc định.
function localizedName(obj, fallbackLang) {
  if (!obj) return '';
  return obj[fallbackLang] || Object.values(obj)[0] || '';
}

// Múi giờ của bảo tàng — dùng để chia ngày và chia tháng trong báo cáo. VPS hay
// đặt giờ UTC, mà khách vào lúc 6 giờ sáng giờ Việt Nam là 23 giờ hôm trước theo
// UTC; không chỉnh thì cột "theo ngày" lệch một ngày.
const MUSEUM_TZ = process.env.MUSEUM_TZ || 'Asia/Ho_Chi_Minh';
let dinhDangNgay;
try {
  dinhDangNgay = new Intl.DateTimeFormat('en-CA', { timeZone: MUSEUM_TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
} catch {
  dinhDangNgay = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' });
}
function ngayCuaBaoTang(ms) {
  return dinhDangNgay.format(new Date(ms)); // YYYY-MM-DD
}

const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

// Khoảng thời gian: `range` (today/7d/30d/all, tính lùi từ bây giờ) hoặc `month`
// (YYYY-MM theo giờ bảo tàng — để báo cáo tháng lên trên).
function khoangThoiGian(query) {
  if (typeof query.month === 'string' && MONTH_RE.test(query.month)) {
    const [y, m] = query.month.split('-').map(Number);
    const keys = new Set();
    // Cộng một tháng đệm mỗi đầu: file chia theo giờ MÁY CHỦ, ranh giới tháng lệch múi giờ.
    for (const d of [new Date(y, m - 2, 1), new Date(y, m - 1, 1), new Date(y, m, 1)]) {
      keys.add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    }
    return {
      range: 'month',
      month: query.month,
      monthKeys: keys,
      giuLai: (t) => ngayCuaBaoTang(t).slice(0, 7) === query.month,
    };
  }
  const range = ['today', '7d', '30d', 'all'].includes(query.range) ? query.range : 'all';
  const cutoffMs = RANGE_MS[range];
  const now = Date.now();
  return {
    range,
    monthKeys: monthKeysInRange(cutoffMs, now),
    giuLai: (t) => !cutoffMs || now - t <= cutoffMs,
  };
}

async function tinhThongKe(query) {
  const khoang = khoangThoiGian(query);
  const manifestPath = path.join(CONTENT_DIR, 'manifest.json');
  let manifest = { zones: [] };
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch {
    // Chưa có manifest → trả thống kê rỗng, không báo lỗi.
  }
  const fallbackLanguage = manifest.fallbackLanguage || 'vi';

  // Bảng tra: major → tên khu vực; "major:minor" → tên hiện vật.
  const zoneByMajor = new Map();
  const exhibitByKey = new Map();
  for (const zone of manifest.zones || []) {
    const zoneName = localizedName(zone.name, fallbackLanguage) || zone.id;
    zoneByMajor.set(zone.major, { zoneId: zone.id, zoneName });
    for (const ex of zone.exhibits || []) {
      const exName = localizedName(ex.name, fallbackLanguage) || ex.id;
      exhibitByKey.set(`${zone.major}:${ex.minor}`, {
        exhibitId: ex.id, exhibitName: exName, zoneId: zone.id, zoneName, major: zone.major, minor: ex.minor,
      });
    }
  }

  const events = (await loadEvents(khoang.monthKeys)).filter((rec) => {
    const t = Date.parse((rec.event || {}).at);
    if (Number.isNaN(t)) return khoang.range === 'all';
    return khoang.giuLai(t);
  });

  // ---- Gom nhóm ----
  const sessionIds = new Set();
  const tourDurations = [];
  let tourStartedCount = 0;
  let headphoneCount = 0;
  const languageCounts = new Map();
  const endReasonCounts = new Map();
  const zoneDwell = new Map(); // major → { totalMs, count }
  const exhibitPlayed = new Map(); // "major:minor" → số lần phát
  const exhibitCompleted = new Map();
  const exhibitListenedSum = new Map();
  const exhibitListenedCount = new Map();

  for (const rec of events) {
    const e = rec.event || {};
    if (e.sessionId) sessionIds.add(e.sessionId);

    if (e.name === 'tour_started') {
      tourStartedCount++;
      if (e.headphones) headphoneCount++;
      const lang = e.language || '?';
      languageCounts.set(lang, (languageCounts.get(lang) || 0) + 1);
    } else if (e.name === 'tour_ended') {
      if (typeof e.durationMs === 'number') tourDurations.push(e.durationMs);
      const reason = e.reason || 'unknown';
      endReasonCounts.set(reason, (endReasonCounts.get(reason) || 0) + 1);
    } else if (e.name === 'zone_dwell') {
      const cur = zoneDwell.get(e.major) || { totalMs: 0, count: 0 };
      cur.totalMs += e.dwellMs || 0;
      cur.count += 1;
      zoneDwell.set(e.major, cur);
    } else if (e.name === 'exhibit_played') {
      const key = `${e.major}:${e.minor}`;
      exhibitPlayed.set(key, (exhibitPlayed.get(key) || 0) + 1);
    } else if (e.name === 'exhibit_finished') {
      const key = `${e.major}:${e.minor}`;
      if (e.completed) exhibitCompleted.set(key, (exhibitCompleted.get(key) || 0) + 1);
      if (typeof e.listenedMs === 'number') {
        exhibitListenedSum.set(key, (exhibitListenedSum.get(key) || 0) + e.listenedMs);
        exhibitListenedCount.set(key, (exhibitListenedCount.get(key) || 0) + 1);
      }
    }
  }

  const languageBreakdown = [...languageCounts.entries()]
    .map(([lang, count]) => ({ lang, count }))
    .sort((a, b) => b.count - a.count);
  const endReasonBreakdown = [...endReasonCounts.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count);

  const zones = [...zoneDwell.entries()].map(([major, { totalMs, count }]) => {
    const info = zoneByMajor.get(major) || { zoneId: null, zoneName: `major=${major}` };
    return {
      zoneId: info.zoneId,
      zoneName: info.zoneName,
      major,
      visitCount: count,
      totalDwellMs: totalMs,
      avgDwellMs: count ? Math.round(totalMs / count) : 0,
    };
  }).sort((a, b) => b.totalDwellMs - a.totalDwellMs);

  // Bắt đầu từ TOÀN BỘ hiện vật trong manifest (kể cả chưa có sự kiện) để thấy
  // được "hiện vật chưa ai nghe".
  const exhibits = [...exhibitByKey.entries()].map(([key, info]) => {
    const playCount = exhibitPlayed.get(key) || 0;
    const completedCount = exhibitCompleted.get(key) || 0;
    const listenedSum = exhibitListenedSum.get(key) || 0;
    const listenedCount = exhibitListenedCount.get(key) || 0;
    return {
      exhibitId: info.exhibitId,
      exhibitName: info.exhibitName,
      zoneId: info.zoneId,
      zoneName: info.zoneName,
      major: info.major,
      minor: info.minor,
      playCount,
      avgListenedMs: listenedCount ? Math.round(listenedSum / listenedCount) : 0,
      completionRate: playCount ? Math.round((completedCount / playCount) * 100) / 100 : 0,
    };
  }).sort((a, b) => b.playCount - a.playCount);

  return {
    range: khoang.range,
    ...(khoang.month ? { month: khoang.month } : {}),
    generatedAt: new Date().toISOString(),
    eventCount: events.length,
    tours: {
      count: sessionIds.size,
      avgDurationMs: tourDurations.length
        ? Math.round(tourDurations.reduce((a, b) => a + b, 0) / tourDurations.length)
        : 0,
      headphoneRate: tourStartedCount ? Math.round((headphoneCount / tourStartedCount) * 100) / 100 : 0,
      languageBreakdown,
      endReasonBreakdown,
    },
    zones,
    exhibits,
  };
}

router.get('/summary', async (req, res) => {
  try {
    const data = await tinhThongKe(req.query);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: `Lỗi tính thống kê: ${err.message}` });
  }
});

module.exports = router;
