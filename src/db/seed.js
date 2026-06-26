// 演示数据填充脚本
// 运行：npm run seed
// 注意：会清空并重建数据，仅用于原型演示
const db = require('./index');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');

const UPLOAD_DIR = path.join(__dirname, '..', 'public', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// 清空旧数据（保留表结构）
db.exec(`
  DELETE FROM bookings;
  DELETE FROM catches;
  DELETE FROM boarding_points;
  DELETE FROM boat_areas;
  DELETE FROM boat_images;
  DELETE FROM trips;
  DELETE FROM boats;
  DELETE FROM users;
  DELETE FROM sqlite_sequence;
`);

// ---- 生成 SVG 占位图（浏览器可直接渲染，不依赖外网）----
function makePlaceholder(filename, label, color) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400">
  <rect width="600" height="400" fill="${color}"/>
  <text x="300" y="200" font-size="32" fill="white" text-anchor="middle" dominant-baseline="middle" font-family="sans-serif">${label}</text>
</svg>`;
  fs.writeFileSync(path.join(UPLOAD_DIR, filename), svg, 'utf8');
}

// 溢豐2號占位图
makePlaceholder('yf2-cover.svg', '溢豐2號', '#1864ab');
makePlaceholder('yf2-1.svg', '甲板实拍', '#1971c2');
makePlaceholder('yf2-2.svg', '驾驶舱', '#1c7ed6');
// 其它船
makePlaceholder('boat2-cover.svg', '近海小钓', '#0ca678');
makePlaceholder('boat2-1.svg', '近海小钓·船尾', '#20a58b');
makePlaceholder('boat3-cover.svg', '丰收号', '#d9480f');
makePlaceholder('boat3-1.svg', '丰收号·大厅', '#e8590c');

// 渔获占位图
makePlaceholder('catch-1.svg', '真鲷 4斤', '#fab005');
makePlaceholder('catch-2.svg', '黑棘鲷 3斤', '#fab005');
makePlaceholder('catch-3.svg', '鲈鱼 8斤', '#74c0fc');
makePlaceholder('catch-4.svg', '石斑 12斤', '#f06595');
makePlaceholder('catch-5.svg', '黄鸡鱼', '#69db7c');
makePlaceholder('catch-6.svg', '泥鯭', '#a5d8ff');
makePlaceholder('catch-7.svg', '魷魚', '#a5d8ff');

// 桃太郎占位图
makePlaceholder('tt-cover.svg', '桃太郎', '#5f3dc4');
makePlaceholder('tt-1.svg', '甲板实拍', '#6741d9');
makePlaceholder('tt-2.svg', '驾驶舱', '#7048e8');

// 溢豐1號占位图
makePlaceholder('yf1-cover.svg', '溢豐1號', '#0b7285');
makePlaceholder('yf1-1.svg', '甲板实拍', '#0c8599');
makePlaceholder('yf1-2.svg', '生活舱', '#1098ad');

// ---- 用户：3 船长 + 1 钓鱼人 ----
const pwd = bcrypt.hashSync('123456', 10);
const insUser = db.prepare(
  `INSERT INTO users (username, password_hash, role, name, phone) VALUES (?, ?, ?, ?, ?)`);
insUser.run('captain1', pwd, 'captain', '溢豐船釣', '85246119982');
insUser.run('captain2', pwd, 'captain', '阿海师傅', '13800002222');
insUser.run('captain3', pwd, 'captain', '桃太郎', '85291234567');
insUser.run('angler1',  pwd, 'angler',  '钓友小李', '13900003333');

// ---- 船只档案（新字段：price_per_seat/price_includes/facilities/whatsapp_link/wechat/charter_*）----
const insBoat = db.prepare(`
  INSERT INTO boats (captain_id, name, boat_type, length_m, seats, cover_image, meeting_port, target_fish,
                     captain_experience, contact_phone, whatsapp_link, wechat, price_per_seat, price_includes,
                     charter_min_people, charter_note, facilities, description)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

// 船1：溢豐2號（captain1，香港）—— 信息取自真实公告
const boat1 = insBoat.run(
  1, '溢豐2號', '出海艇', 18.0, 18, 'yf2-cover.svg', '香港嘉亨灣',
  '真鲷/黑棘鲷/石斑/黄鸡鱼/泥鯭', '多年港水船钓经验，日团夜团常年出船', '85246119982',
  'https://wa.me/85246119982', 'Eco96441883',
  550,
  '飲用水1支、杯麵1個、冰、南極蝦共享',
  18,
  '包团人數18人，時間可以更改，歡迎查詢',
  '大型頂流機,洗手間,熱水,微波爐',
  '溢豐2號船，港水日與夜團常年出船。設備齊全，配有大型頂流機、洗手間、熱水及微波爐。由7月1日起採用全新時間：中午12:00出發，晚上9:00回程。'
);
// 船2：近海小钓（保留）
const boat2 = insBoat.run(
  1, '近海小钓', '近海艇', 7.2, 4, 'boat2-cover.svg', '舟山朱家尖樟州湾',
  '黑鲷/黑毛', '8年近海矶钓经验', '13800001111', null, null, 350, '基础钓具、饵料', 4, '4人成行', '基础钓具,饵料箱', '灵活近海钓艇，适合矶钓、路亚。'
);
// 船3：丰收号（保留）
const boat3 = insBoat.run(
  2, '丰收号', '休闲渔船', 15.0, 12, 'boat3-cover.svg', '青岛沙子口渔港',
  '鲈鱼/红甘/马鲛/石斑', '20年渔船船长，曾获青岛海钓赛冠军', '13800002222', null, null, 1200,
  '餐饮、渔获加工', 12, '包船¥12000/天，含餐饮', '厨房,休息舱,活鱼舱,导航雷达', '15米双体休闲渔船，青岛主攻朝连岛/千里岩，深圳线主攻大青针。'
);
// 船4：桃太郎（captain3，香港）—— 信息取自真实公告
const boat4 = insBoat.run(
  3, '桃太郎', '出海艇', 16.0, 16, 'tt-cover.svg', '香港三家村',
  '魷魚/真鲷/黑棘鲷/黄鸡鱼', '多年港水及擔杆远海船钓经验，日团夜团通宵团均出', '85291234567', null, null, 500,
  '飲用水、餌料共享', 16, '其他日子可向我查詢，包团时间可改', '頂流機,洗手間,熱水,活魚艙,導航設備',
  '桃太郎号，常年出港水日团、通宵夜团及擔杆远海团。8:30am 三家村上船，8:40am 嘉亨灣上船。除船期外其他日子可向我查詢。'
);
// 船5：溢豐1號（captain1，香港）—— 石仔團通宵，信息取自真实公告
const boat5 = insBoat.run(
  1, '溢豐1號', '专业钓艇', 24.0, 18, 'yf1-cover.svg', '香港嘉亨灣',
  '石斑/真鲷/黑棘鲷/魷魚/黄鸡鱼', '負責船長：文佬，領隊：偉仔，多年石仔團通宵经验', '85246119982',
  'https://wa.me/85246119982', 'Eco96441883',
  2500,
  '杯麵、飲用水、南極蝦1磚、冰、死魷魚餌',
  18,
  '包船时间可改，歡迎查詢',
  '專業炮架,12V電攪位,大型頂流機,GPS,測深機,衛星WiFi,洗手間,熱水,微波爐,舒適床位',
  '溢豐1號石仔團通宵船，24小時出船（11:00am出發→翌日11:00am回程）。設備齊全：專業炮架、12V電攪位、大型頂流機、GPS、測深機，更配備衛星WiFi高速上網（$50/1GB），支援即時使用WhatsApp及Facebook。生活設施完善，適合長時間通宵作戰。'
);

// ---- 船只图集 ----
const insImg = db.prepare('INSERT INTO boat_images (boat_id, filename) VALUES (?, ?)');
insImg.run(boat1.lastInsertRowid, 'yf2-1.svg');
insImg.run(boat1.lastInsertRowid, 'yf2-2.svg');
insImg.run(boat2.lastInsertRowid, 'boat2-1.svg');
insImg.run(boat3.lastInsertRowid, 'boat3-1.svg');
insImg.run(boat4.lastInsertRowid, 'tt-1.svg');
insImg.run(boat4.lastInsertRowid, 'tt-2.svg');
insImg.run(boat5.lastInsertRowid, 'yf1-1.svg');
insImg.run(boat5.lastInsertRowid, 'yf1-2.svg');

// ---- 上船地点（溢豐2號两个真实上船点，带各自时间和地图链接）----
const insBP = db.prepare(`
  INSERT INTO boarding_points (boat_id, name, depart_time, map_link, sort_order) VALUES (?, ?, ?, ?, ?)`);
insBP.run(boat1.lastInsertRowid, '嘉亨灣', '12:00', 'https://maps.app.goo.gl/VS52jYrAp9YvsNoY7', 0);
insBP.run(boat1.lastInsertRowid, '三家村', '12:10', 'https://maps.app.goo.gl/EjcTjbaWmvGbd1cM6', 1);
// 桃太郎：三家村8:30、嘉亨灣8:40
insBP.run(boat4.lastInsertRowid, '三家村', '08:30', 'https://maps.app.goo.gl/EjcTjbaWmvGbd1cM6', 0);
insBP.run(boat4.lastInsertRowid, '嘉亨灣', '08:40', 'https://maps.app.goo.gl/VS52jYrAp9YvsNoY7', 1);
// 溢豐1號：嘉亨灣11:00、三家村11:10
insBP.run(boat5.lastInsertRowid, '嘉亨灣', '11:00', 'https://maps.app.goo.gl/VS52jYrAp9YvsNoY7', 0);
insBP.run(boat5.lastInsertRowid, '三家村', '11:10', 'https://maps.app.goo.gl/EjcTjbaWmvGbd1cM6', 1);

// ---- 钓区（真实钓点 + 真实经纬度 + 真实鱼种描述）----
const insArea = db.prepare(`
  INSERT INTO boat_areas (boat_id, name, longitude, latitude, sea_area, description)
  VALUES (?, ?, ?, ?, ?, ?)`);
// 溢豐2號：香港水域钓点
insArea.run(boat1.lastInsertRowid, '港水东龙柱', 114.28, 22.20, '南海/香港',
  '香港热门船钓点，水深适中，底钓真鲷、黑棘鲷、黄鸡鱼');
insArea.run(boat1.lastInsertRowid, '果洲群岛', 114.45, 22.18, '南海/香港',
  '远海岛礁区，石斑、泥鯭等大物常见');
// 近海小钓
insArea.run(boat2.lastInsertRowid, '朱家尖外侧礁区', 122.40, 29.90, '东海/舟山', '近岸礁石区，主钓黑鲷、黑毛');
// 丰收号
insArea.run(boat3.lastInsertRowid, '朝连岛', 120.88, 35.89, '黄海/青岛', '鲈鱼春汛明星钓场');
insArea.run(boat3.lastInsertRowid, '千里岩', 121.39, 36.27, '黄海/青岛', '海钓人梦幻钓场');
insArea.run(boat3.lastInsertRowid, '大青针', 114.75, 22.55, '南海/深圳', '珠三角梦幻钓场');
// 桃太郎：港水、7星排、擔杆（公告提及钓点）
insArea.run(boat4.lastInsertRowid, '港水钓区', 114.28, 22.20, '南海/香港', '香港近岸港水钓区，日团主钓真鲷、黑棘鲷、魷魚');
insArea.run(boat4.lastInsertRowid, '7星排', 114.35, 22.15, '南海/香港', '回歸假期热门钓点，礁排区鱼种丰富');
insArea.run(boat4.lastInsertRowid, '擔杆列岛', 114.36, 21.95, '南海/香港', '远海列岛钓场，魷魚及大物聚集，适合远征团');
// 溢豐1號：石仔排（石仔團核心钓点）
insArea.run(boat5.lastInsertRowid, '石仔排', 114.30, 22.08, '南海/香港', '石仔團核心钓点，深水礁排，石斑/真鲷/黑棘鲷大物频出');
insArea.run(boat5.lastInsertRowid, '大澳以南', 113.85, 22.12, '南海/香港', '远海深水区，通宵夜钓魷魚及底鱼');

// ---- 渔获相册 ----
const insCatch = db.prepare(`
  INSERT INTO catches (boat_id, photo, fish_species, shot_date) VALUES (?, ?, ?, ?)`);
function dateOffset(days) {
  const d = new Date(); d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
insCatch.run(boat1.lastInsertRowid, 'catch-1.svg', '真鲷 4斤（港水东龙柱）', dateOffset(-5));
insCatch.run(boat1.lastInsertRowid, 'catch-2.svg', '黑棘鲷 3斤（果洲群岛）', dateOffset(-5));
insCatch.run(boat1.lastInsertRowid, 'catch-4.svg', '石斑 12斤（果洲群岛）', dateOffset(-12));
insCatch.run(boat2.lastInsertRowid, 'catch-5.svg', '黑鲷 2斤', dateOffset(-8));
insCatch.run(boat3.lastInsertRowid, 'catch-3.svg', '鲈鱼 8斤', dateOffset(-5));
// 桃太郎渔获（魷魚是其特色）
insCatch.run(boat4.lastInsertRowid, 'catch-7.svg', '魷魚 一桶（港水通宵）', dateOffset(-6));
insCatch.run(boat4.lastInsertRowid, 'catch-1.svg', '真鲷 5斤（擔杆）', dateOffset(-13));
insCatch.run(boat4.lastInsertRowid, 'catch-4.svg', '石斑 10斤（7星排）', dateOffset(-13));
// 溢豐1號渔获（石仔團大物）
insCatch.run(boat5.lastInsertRowid, 'catch-4.svg', '石斑 18斤（石仔排）', dateOffset(-4));
insCatch.run(boat5.lastInsertRowid, 'catch-1.svg', '真鲷 6斤（石仔排）', dateOffset(-4));
insCatch.run(boat5.lastInsertRowid, 'catch-7.svg', '魷魚（大澳以南）', dateOffset(-11));

// ---- 船期（溢豐2號真实船期 + 成团状态）----
// 取自溢豐公告：6/25-30原时间，7/1起12:00-21:00；含成团/招募中/改1號船等状态
const insTrip = db.prepare(`
  INSERT INTO trips (boat_id, depart_date, depart_time, return_time, available_seats, price_per_seat, status, min_people, note)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);

const T = boat1.lastInsertRowid;
// 6月船期（原时间 05:00-21:00）
insTrip.run(T, '2026-06-25', '05:00', '21:00', 2,  550, 'recruiting', 18, '欠2位成團');
insTrip.run(T, '2026-06-26', '05:00', '21:00', 0,  550, 'confirmed',  18, '成團');
insTrip.run(T, '2026-06-27', '05:00', '21:00', 0,  550, 'confirmed',  18, '成團');
insTrip.run(T, '2026-06-28', '05:00', '21:00', 1,  550, 'confirmed',  18, '成團 餘1個位');
insTrip.run(T, '2026-06-30', '05:00', '21:00', 5,  550, 'confirmed',  18, '成團 餘5位');
// 7月船期（新时间 12:00-21:00）
insTrip.run(T, '2026-07-01', '12:00', '21:00', 0, 550, 'confirmed', 18, '成團 七一');
insTrip.run(T, '2026-07-04', '12:00', '21:00', 18, 550, 'recruiting', 18, '組團中');
insTrip.run(T, '2026-07-05', '12:00', '21:00', 18, 550, 'recruiting', 18, '組團中');
insTrip.run(T, '2026-07-09', '12:00', '21:00', 18, 550, 'recruiting', 18, '改為1號船出發');
insTrip.run(T, '2026-07-12', '12:00', '21:00', 18, 550, 'recruiting', 18, '組團中');

// 近海小钓船期
const insTrip2 = db.prepare(`
  INSERT INTO trips (boat_id, depart_date, depart_time, return_time, available_seats, price_per_seat, status)
  VALUES (?, ?, ?, ?, ?, ?, 'recruiting')`);
insTrip2.run(boat2.lastInsertRowid, dateOffset(5), '06:00', '14:00', 4, 350);

// 丰收号船期
insTrip2.run(boat3.lastInsertRowid, dateOffset(2), '04:30', '20:00', 12, 1200);
insTrip2.run(boat3.lastInsertRowid, dateOffset(7), '05:00', '19:00', 12, 1000);

// 桃太郎船期（取自公告：9个，含港水日团/通宵夜团/擔杆远征/魷魚加釣等类型）
// 上船时间 8:30 三家村；日团约 8:30-16:00，通宵夜团 20:00-次日06:00
const TT = boat4.lastInsertRowid;
insTrip.run(TT, '2026-06-28', '08:30', '16:00', 16, 500, 'recruiting', 16, '☀️ 6/28（日）港水');
insTrip.run(TT, '2026-06-30', '20:00', '06:00', 16, 500, 'recruiting', 16, '🌠 6/30（假期前夕）港水通宵');
insTrip.run(TT, '2026-07-01', '08:30', '16:00', 16, 500, 'confirmed',  16, '☀️ 7/1（回歸假期）7星排');
insTrip.run(TT, '2026-07-03', '20:00', '06:00', 16, 500, 'recruiting', 16, '🌠 7/3（五晚）港水通宵');
insTrip.run(TT, '2026-07-04', '08:30', '18:00', 16, 500, 'recruiting', 16, '☀️ 7/4（六）擔杆');
insTrip.run(TT, '2026-07-04', '20:00', '06:00', 16, 500, 'recruiting', 16, '🌠 7/4（六晚）港水通宵');
insTrip.run(TT, '2026-07-05', '08:30', '18:00', 16, 500, 'recruiting', 16, '☀️ 7/5（日）擔杆');
insTrip.run(TT, '2026-07-05', '20:00', '06:00', 16, 500, 'recruiting', 16, '🦑 7/5（日晚）魷魚加釣');
insTrip.run(TT, '2026-07-08', '08:30', '16:00', 16, 500, 'recruiting', 16, '🎣 7/8（三）港水');

// 溢豐1號船期（石仔團通宵，取自公告：成团/包船/招募中等状态）
// 时间：11:00am 出發 → 翌日 11:00am 回程（24小時通宵）
const YF1 = boat5.lastInsertRowid;
insTrip.run(YF1, '2026-06-27', '11:00', '11:00', 0,  2500, 'confirmed',  18, '✅ 6/27-28（六,日）成團');
insTrip.run(YF1, '2026-06-30', '11:00', '11:00', 0,  2500, 'full',       18, '🈵 6/30-7/1（二,三）七一包船');
insTrip.run(YF1, '2026-07-02', '11:00', '11:00', 18, 2500, 'recruiting', 18, '📝 7/2-3（四,五）組團中');
insTrip.run(YF1, '2026-07-04', '11:00', '11:00', 18, 2500, 'recruiting', 18, '📝 7/4-5（六,日）組團中');
insTrip.run(YF1, '2026-07-11', '11:00', '11:00', 0,  2500, 'confirmed',  18, '✅ 7/11-12（六,日）成團');
insTrip.run(YF1, '2026-07-16', '11:00', '11:00', 18, 2500, 'recruiting', 18, '📝 7/16-17（四,五）組團中');
insTrip.run(YF1, '2026-07-18', '11:00', '11:00', 0,  2500, 'full',       18, '🈵 7/18-19（六,日）2號船包船');
insTrip.run(YF1, '2026-07-25', '11:00', '11:00', 18, 2500, 'recruiting', 18, '7/25-26（六,日）');
insTrip.run(YF1, '2026-07-30', '11:00', '11:00', 18, 2500, 'recruiting', 18, '7/30-31（四,五）');

// ---- 预约（演示流转：angler1 预约丰收号船期）----
const trip3 = db.prepare('SELECT id FROM trips WHERE boat_id=? ORDER BY id LIMIT 1').get(boat3.lastInsertRowid);
db.prepare(`
  INSERT INTO bookings (trip_id, angler_id, seats_booked, contact_phone, remark, status)
  VALUES (?, ?, ?, ?, ?, 'pending')`).run(
  trip3.id, 3, 2, '13900003333', '两个朋友一起，需要拼车到码头');

console.log('✅ 鱼多多演示数据已重建（含溢豐1號/2號 + 桃太郎真实信息）');
console.log('   账号：captain1 / captain2 / captain3 / angler1，密码均为 123456');
console.log('   船只：5 艘（溢豐1號 / 溢豐2號 / 桃太郎 / 近海小钓 / 丰收号）');
console.log('   溢豐1號：¥2500/位 石仔團通宵，含 杯麵/水/南極蝦/冰/死魷魚餌；卫星WiFi+多重设施；微信 Eco96441883');
console.log('   溢豐2號：¥550/位 港水日团，含 飲用水/杯麵/冰/南極蝦；包团18人起；WhatsApp报名');
console.log('   桃太郎：¥500/位，含 飲用水/餌料；其他日子可查询');
console.log('   船期：溢豐1號 9个(石仔團通宵) + 溢豐2號 10个 + 桃太郎 9个');
console.log('   钓区：11 个（香港港水/7星排/擔杆/石仔排 + 舟山/青岛/深圳）');
