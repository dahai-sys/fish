// 公告解析器：从粘贴的船钓公告文本提取结构化数据
// 针对香港船钓圈常见公告格式（溢豐/桃太郎等）设计规则
// 输入：原始文本；输出：{ boat, boardingPoints[], trips[], areas[] }
//
// 解析策略：规则匹配为主，提取后由用户在预览页确认/修改，不追求100%准确。

// 去除 emoji 和装饰符号，便于正则匹配
function stripNoise(s) {
  return s
    .replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}\u{FE00}-\u{FE0F}\u{200D}]/gu, '')
    .replace(/[✳️✅🈵📝🚢🛥📍💰⏰👤🍱💬📲➖]/g, '')
    .replace(/\*+/g, '')
    .replace(/[（(]/g, '(').replace(/[）)]/g, ')')
    .trim();
}

// 提取价格：匹配 $500 / HK$2500 / ¥350 / 500/位 等
function parsePrice(text) {
  const m = text.match(/(?:HK\$|HKD|\$|￥|¥)\s*(\d{2,5})/i);
  if (m) return parseFloat(m[1]);
  // "500/位" 没有货币符号的情况
  const m2 = text.match(/(\d{3,5})\s*\/\s*位/);
  if (m2) return parseFloat(m2[1]);
  return null;
}

// 提取船名：常见模式 "溢豐2號船" "桃太郎" "XX號" + 可能有"船"字
function parseBoatName(text) {
  // 模式0：明确"船名 XXX" / "船名：XXX" 前缀
  const m0 = text.match(/船\s*名\s*[:：]?\s*([\u4e00-\u9fa5A-Za-z0-9]{2,8})/);
  if (m0) return m0[1].replace(/船$/, '');
  // 优先匹配 "XX號" / "XX号" 形式（最常见，如 溢豐1號、溢豐2號，允许含数字）
  const m1 = text.match(/([\u4e00-\u9fa5]{1,6}[0-9]*[號号])\s*(?:船)?/);
  if (m1) return m1[1];
  // 匹配方括号或【】内的船名
  const m2 = text.match(/[【\[]([^】\]】{1,10}[號号]?)[】\]]/);
  if (m2) return m2[1];
  return null;
}

// 提取船期日期：多种格式
// 6月28日 / 6/28 / 6-28 / 27-28(六,日) / 6月25-30 / 25(四)
function parseTrips(text) {
  const trips = [];
  const lines = text.split(/\n/).map(l => stripNoise(l));

  // 当前解析到的默认年份
  const year = new Date().getFullYear();

  lines.forEach(line => {
    if (!line) return;
    // 匹配 "6月28" "7月1日" 等
    let m = line.match(/(\d{1,2})\s*月\s*(\d{1,2})/);
    // 或匹配 "6/28" "7/1"
    if (!m) m = line.match(/(\d{1,2})\s*\/\s*(\d{1,2})/);
    if (!m) return;

    const month = parseInt(m[1], 10);
    const day = parseInt(m[2], 10);
    if (month < 1 || month > 12 || day < 1 || day > 31) return;

    // 处理日期范围 "27-28" 或 "6月25-30"
    const rangeM = line.match(new RegExp(m[1] + '\\s*月\\s*' + m[2] + '\\s*-\\s*(\\d{1,2})')) ||
                   line.match(new RegExp(m[1] + '\\s*/\\s*' + m[2] + '\\s*-\\s*(\\d{1,2})'));
    const dates = [];
    if (rangeM) {
      const endDay = parseInt(rangeM[1], 10);
      for (let d = day; d <= endDay; d++) {
        dates.push(`${year}-${String(month).padStart(2,'0')}-${String(d).padStart(2,'0')}`);
      }
    } else {
      dates.push(`${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`);
    }

    // 判断状态：成團/組團中/包船/欠位
    let status = 'recruiting';
    let note = line;
    if (/成\s*團|成\s*团/.test(line)) {
      status = 'confirmed';
    }
    if (/包\s*船|包\s*团/.test(line)) {
      status = 'full';
    }
    if (/組\s*團|组\s*团|欠.*位/.test(line)) {
      status = 'recruiting';
    }

    dates.forEach(date => {
      trips.push({ depart_date: date, status, note: line.slice(0, 60) });
    });
  });

  // 去重（同一天可能多次出现）
  const seen = new Set();
  return trips.filter(t => {
    const key = t.depart_date;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// 提取上船点：常见模式 "嘉亨灣 12:00" "三家村 12:10" "8:30am三家村上船"
function parseBoardingPoints(text) {
  const points = [];
  const clean = stripNoise(text);

  // 模式1："12:00 嘉亨灣" 或 "嘉亨灣 12:00"
  const knownPorts = ['嘉亨灣', '嘉亨湾', '三家村', '三家邨', '西灣河', '筲箕灣', '香港仔', '青衣', '长洲', '长洲碼頭'];
  knownPorts.forEach(port => {
    // 找该港口名附近的时间
    const re = new RegExp('(\\d{1,2}[:：]\\d{2}\\s*(?:am|pm)?)\\s*' + port + '|' + port + '\\s*[:： ]*\\s*(\\d{1,2}[:：]\\d{2}\\s*(?:am|pm)?)', 'i');
    const m = clean.match(re);
    let time = null;
    if (m) {
      time = (m[1] || m[2] || '').replace('：', ':').trim();
      // 标准化 am/pm
      time = time.replace(/\s*/g, '');
    }
    if (clean.includes(port)) {
      points.push({ name: port, depart_time: time, map_link: null });
    }
  });

  // 去重
  const seen = new Set();
  return points.filter(p => {
    if (seen.has(p.name)) return false;
    seen.add(p.name);
    return true;
  });
}

// 提取费用包含
function parsePriceIncludes(text) {
  const clean = stripNoise(text);
  const m = clean.match(/(?:包含|包)[：:]\s*([^。\n]+)/);
  if (m) return m[1].trim();
  // 匹配 "杯麵、飲用水..." 这类
  const m2 = clean.match(/(杯麵[^。\n]*|飲用水[^。\n]*|南極蝦[^。\n]*)/);
  if (m2) return m2[1].trim();
  return null;
}

// 提取设施
function parseFacilities(text) {
  const clean = stripNoise(text);
  const facilities = [];
  const known = ['頂流機', '顶流机', '洗手間', '洗手间', '熱水', '热水', '微波爐', '微波炉',
    'GPS', '測深機', '测深机', '衛星', '卫星', 'WiFi', 'wifi', '炮架', '電攪', '电搅',
    '活魚艙', '活鱼舱', '床位', '導航', '导航', '廚房', '厨房', '休息艙', '雷达'];
  known.forEach(f => {
    if (clean.includes(f)) facilities.push(f);
  });
  return facilities.length ? facilities.join(',') : null;
}

// 提取联系方式
function parseContacts(text) {
  const clean = stripNoise(text);
  const result = { whatsapp_link: null, wechat: null, contact_phone: null };

  // WhatsApp: https://wa.me/852xxxxxxxx
  const wa = clean.match(/https?:\/\/wa\.me\/(\d+)/i);
  if (wa) result.whatsapp_link = wa[0];

  // 微信：Eco96441883
  const wx = clean.match(/(?:微信|WeChat|wechat)\s*[:：]?\s*([A-Za-z0-9_\-]{4,30})/i);
  if (wx) result.wechat = wx[1];

  // 电话：852xxxxxxxx 或 13xxxxxxxxx
  const phone = clean.match(/(?:852\d{8}|1[3-9]\d{9})/);
  if (phone) result.contact_phone = phone[0];

  return result;
}

// 提取出发/回岸时间："11:00am 出發 ➔ 翌日 11:00am 回程" "12:00 出發 ... 21:00 回程"
function parseTimes(text) {
  const clean = stripNoise(text);
  const result = { depart_time: null, return_time: null };
  const m = clean.match(/(\d{1,2}[:：]\d{2}\s*(?:am|pm)?)\s*(?:出發|出发)[\s\S]{0,20}?(?:翌日|次日|明日)?\s*(\d{1,2}[:：]\d{2}\s*(?:am|pm)?)\s*(?:回程|回岸|返)/i);
  if (m) {
    result.depart_time = (m[1] || '').replace('：', ':').trim();
    result.return_time = (m[2] || '').replace('：', ':').trim();
  }
  return result;
}

// 主解析函数
function parseAnnouncement(text) {
  const result = {
    boat: { name: parseBoatName(text) },
    price_per_seat: parsePrice(text),
    price_includes: parsePriceIncludes(text),
    facilities: parseFacilities(text),
    times: parseTimes(text),
    boardingPoints: parseBoardingPoints(text),
    contacts: parseContacts(text),
    trips: parseTrips(text),
  };
  return result;
}

module.exports = { parseAnnouncement, stripNoise };
