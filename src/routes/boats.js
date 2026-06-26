// 船只路由（船只为中心）
// 钓鱼人：浏览船只列表 + 详情页
// 船长：CRUD + 图集上传 + 钓区管理 + 渔获相册管理
const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const db = require('../db');
const upload = require('../middleware/upload');
const { requireRole } = require('../middleware/auth');
const weather = require('../services/weather');

const AMAP_KEY = process.env.AMAP_KEY || '';

// 结构化海区选项
const SEA_AREAS = [
  '渤海/大连', '渤海/烟台', '渤海/秦皇岛',
  '黄海/青岛', '黄海/大连', '黄海/连云港',
  '东海/舟山', '东海/宁波', '东海/温州', '东海/福州', '东海/厦门',
  '南海/深圳', '南海/珠海', '南海/北海', '南海/海口', '南海/三亚',
];

// ===== 钓鱼人端 =====

// 首页：船只卡片列表（精简6项）+ 搜索 + 排序 —— 同时作为根路径 /
router.get('/', listBoats);
router.get('/boats', listBoats);
function listBoats(req, res) {
  const { q, date_from, date_to, sea_area, port, price_min, price_max, sort } = req.query;

  // 动态 WHERE 条件（参数化，防注入）
  const where = [];
  const params = [];
  if (q) {
    where.push('(b.name LIKE ? OR b.target_fish LIKE ? OR b.meeting_port LIKE ? OR u.name LIKE ?)');
    const kw = '%' + q + '%'; params.push(kw, kw, kw, kw);
  }
  if (date_from) { where.push('nt.next_date >= ?'); params.push(date_from); }
  if (date_to)   { where.push('nt.next_date <= ?'); params.push(date_to); }
  if (sea_area)  { where.push('EXISTS(SELECT 1 FROM boat_areas a WHERE a.boat_id=b.id AND a.sea_area=?)'); params.push(sea_area); }
  if (port)      {
    where.push('(b.meeting_port LIKE ? OR EXISTS(SELECT 1 FROM boarding_points bp WHERE bp.boat_id=b.id AND bp.name LIKE ?))');
    const kw = '%' + port + '%'; params.push(kw, kw);
  }
  if (price_min) { where.push('nt.next_price >= ?'); params.push(parseFloat(price_min)); }
  if (price_max) { where.push('nt.next_price <= ?'); params.push(parseFloat(price_max)); }

  // 排序映射（白名单防注入）
  const sortMap = {
    date_asc:   'nt.next_date ASC, nt.next_price ASC',
    price_asc:  'nt.next_price ASC',
    price_desc: 'nt.next_price DESC',
    seats_desc: 'nt.total_seats DESC',
  };
  const orderBy = sortMap[sort] || 'nt.next_date ASC, nt.next_price ASC';

  // CTE 聚合每船「最近可预约船期」，避免 4 个重复子查询
  const sql = `
    WITH next_trip AS (
      SELECT t.boat_id,
             MIN(t.depart_date) AS next_date,
             (SELECT t2.depart_time FROM trips t2 WHERE t2.boat_id=t.boat_id
                AND t2.status IN ('recruiting','confirmed')
                AND t2.depart_date >= date('now') AND t2.available_seats > 0
              ORDER BY t2.depart_date ASC LIMIT 1) AS next_depart_time,
             (SELECT t2.return_time FROM trips t2 WHERE t2.boat_id=t.boat_id
                AND t2.status IN ('recruiting','confirmed')
                AND t2.depart_date >= date('now') AND t2.available_seats > 0
              ORDER BY t2.depart_date ASC LIMIT 1) AS next_return_time,
             (SELECT t2.price_per_seat FROM trips t2 WHERE t2.boat_id=t.boat_id
                AND t2.status IN ('recruiting','confirmed')
                AND t2.depart_date >= date('now') AND t2.available_seats > 0
              ORDER BY t2.depart_date ASC LIMIT 1) AS next_price,
             (SELECT SUM(t3.available_seats) FROM trips t3 WHERE t3.boat_id=t.boat_id
                AND t3.status IN ('recruiting','confirmed')
                AND t3.depart_date >= date('now')) AS total_seats
        FROM trips t
       WHERE t.status IN ('recruiting','confirmed')
         AND t.depart_date >= date('now') AND t.available_seats > 0
       GROUP BY t.boat_id
    )
    SELECT b.id, b.name, b.boat_type, b.cover_image, b.meeting_port,
           b.target_fish, b.seats, b.price_per_seat, b.whatsapp_link,
           u.name AS captain_name,
           nt.next_date, nt.next_depart_time, nt.next_return_time, nt.next_price, nt.total_seats
      FROM boats b
      JOIN users u ON b.captain_id = u.id
      JOIN next_trip nt ON nt.boat_id = b.id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY ${orderBy}
  `;
  const boats = db.prepare(sql).all(...params);
  res.render('boats/index', { boats, SEA_AREAS, filters: req.query });
}

// 船只详情页（完整展开）
router.get('/boats/:id', async (req, res) => {
  const boat = db.prepare(`
    SELECT b.*, u.name AS captain_name
      FROM boats b JOIN users u ON b.captain_id = u.id
     WHERE b.id = ?`).get(req.params.id);
  if (!boat) return res.status(404).render('error', { message: '船只不存在', code: 404 });

  const images = db.prepare('SELECT * FROM boat_images WHERE boat_id = ? ORDER BY id DESC').all(boat.id);
  const areas = db.prepare('SELECT * FROM boat_areas WHERE boat_id = ? ORDER BY id').all(boat.id);
  const catches = db.prepare('SELECT * FROM catches WHERE boat_id = ? ORDER BY shot_date DESC, id DESC').all(boat.id);
  const boardingPoints = db.prepare('SELECT * FROM boarding_points WHERE boat_id = ? ORDER BY sort_order, id').all(boat.id);
  const trips = db.prepare(`
    SELECT * FROM trips
     WHERE boat_id = ? AND status IN ('recruiting','confirmed') AND depart_date >= date('now')
     ORDER BY depart_date ASC`).all(boat.id);

  // 查每个钓区的实时气象（并发，失败降级）
  const weatherMap = await weather.getWeatherForAreas(areas);

  // 钓鱼人是否对该船某船期有预约
  let myBookingTripIds = [];
  if (req.user && req.user.role === 'angler') {
    myBookingTripIds = db.prepare(`
      SELECT trip_id FROM bookings
       WHERE angler_id=? AND status IN ('pending','confirmed')`).all(req.user.id).map(r => r.trip_id);
  }

  res.render('boats/detail', {
    boat, images, areas, catches, trips, boardingPoints, weatherMap,
    myBookingTripIds, amapKey: AMAP_KEY,
  });
});

// ===== 船长端：船只 CRUD =====

// 我的船只列表
router.get('/captain/boats', requireRole('captain'), (req, res) => {
  const boats = db.prepare(`
    SELECT b.*,
           (SELECT COUNT(*) FROM trips t WHERE t.boat_id=b.id) AS trip_count,
           (SELECT COUNT(*) FROM boat_areas a WHERE a.boat_id=b.id) AS area_count,
           (SELECT COUNT(*) FROM catches c WHERE c.boat_id=b.id) AS catch_count
      FROM boats b WHERE b.captain_id=? ORDER BY b.created_at DESC`).all(req.user.id);
  res.render('boats/list', { boats });
});

// 新增船只表单
router.get('/captain/boats/new', requireRole('captain'), (req, res) => {
  res.render('boats/new', { values: {} });
});

// 从请求体解析船只档案字段（新增/更新复用）
function pickBoatFields(b) {
  return {
    name: b.name, boat_type: b.boat_type,
    length_m: parseFloat(b.length_m) || null,
    seats: parseInt(b.seats, 10),
    meeting_port: b.meeting_port || null,
    target_fish: b.target_fish || null,
    captain_experience: b.captain_experience || null,
    contact_phone: b.contact_phone || null,
    whatsapp_link: b.whatsapp_link || null,
    wechat: b.wechat || null,
    price_per_seat: parseFloat(b.price_per_seat) || null,
    price_includes: b.price_includes || null,
    charter_min_people: parseInt(b.charter_min_people, 10) || null,
    charter_note: b.charter_note || null,
    facilities: b.facilities || null,
    description: b.description || null,
  };
}

// 新增船只提交
router.post('/captain/boats', requireRole('captain'), (req, res) => {
  const values = req.body;
  if (!values.name || !values.boat_type || !values.seats) {
    res.flash('error', '船名、类型、座位数为必填');
    return res.render('boats/new', { values });
  }
  const f = pickBoatFields(values);
  if (!f.seats || f.seats < 1) {
    res.flash('error', '座位数必须是大于 0 的整数');
    return res.render('boats/new', { values });
  }
  const info = db.prepare(`
    INSERT INTO boats (captain_id, name, boat_type, length_m, seats, meeting_port, target_fish,
                       captain_experience, contact_phone, whatsapp_link, wechat, price_per_seat, price_includes,
                       charter_min_people, charter_note, facilities, description)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    req.user.id, f.name, f.boat_type, f.length_m, f.seats, f.meeting_port, f.target_fish,
    f.captain_experience, f.contact_phone, f.whatsapp_link, f.wechat, f.price_per_seat, f.price_includes,
    f.charter_min_people, f.charter_note, f.facilities, f.description);
  res.flash('success', `船只「${f.name}」已添加，ID #${String(info.lastInsertRowid).padStart(3, '0')}`);
  res.redirect('/captain/boats/' + info.lastInsertRowid + '/edit');
});

// 编辑船只表单
router.get('/captain/boats/:id/edit', requireRole('captain'), (req, res) => {
  const boat = db.prepare('SELECT * FROM boats WHERE id=? AND captain_id=?').get(req.params.id, req.user.id);
  if (!boat) return res.status(404).render('error', { message: '船只不存在或无权操作', code: 404 });
  const images = db.prepare('SELECT * FROM boat_images WHERE boat_id=? ORDER BY id DESC').all(boat.id);
  const boardingPoints = db.prepare('SELECT * FROM boarding_points WHERE boat_id=? ORDER BY sort_order, id').all(boat.id);
  res.render('boats/edit', { boat, images, boardingPoints });
});

// 更新船只
router.post('/captain/boats/:id', requireRole('captain'), (req, res) => {
  const boat = db.prepare('SELECT * FROM boats WHERE id=? AND captain_id=?').get(req.params.id, req.user.id);
  if (!boat) return res.status(404).render('error', { message: '船只不存在或无权操作', code: 404 });
  if (!req.body.name || !req.body.boat_type || !req.body.seats) {
    res.flash('error', '船名、类型、座位数为必填');
    return res.redirect('/captain/boats/' + boat.id + '/edit');
  }
  const f = pickBoatFields(req.body);
  db.prepare(`
    UPDATE boats SET name=?, boat_type=?, length_m=?, seats=?, meeting_port=?, target_fish=?,
                     captain_experience=?, contact_phone=?, whatsapp_link=?, wechat=?, price_per_seat=?, price_includes=?,
                     charter_min_people=?, charter_note=?, facilities=?, description=?
     WHERE id=?`).run(
    f.name, f.boat_type, f.length_m, f.seats, f.meeting_port, f.target_fish,
    f.captain_experience, f.contact_phone, f.whatsapp_link, f.wechat, f.price_per_seat, f.price_includes,
    f.charter_min_people, f.charter_note, f.facilities, f.description, boat.id);
  res.flash('success', '船只资料已更新');
  res.redirect('/captain/boats/' + boat.id + '/edit');
});

// ===== 船长端：上船地点管理 =====

// 新增上船地点
router.post('/captain/boats/:id/boarding', requireRole('captain'), (req, res) => {
  const boat = db.prepare('SELECT id FROM boats WHERE id=? AND captain_id=?').get(req.params.id, req.user.id);
  if (!boat) return res.status(404).render('error', { message: '船只不存在', code: 404 });
  const { name, depart_time, map_link, sort_order } = req.body;
  if (!name) { res.flash('error', '上船地点名称必填'); return res.redirect('/captain/boats/' + boat.id + '/edit'); }
  db.prepare(`INSERT INTO boarding_points (boat_id, name, depart_time, map_link, sort_order)
              VALUES (?, ?, ?, ?, ?)`).run(
    boat.id, name, depart_time || null, map_link || null, parseInt(sort_order, 10) || 0);
  res.flash('success', '上船地点已添加');
  res.redirect('/captain/boats/' + boat.id + '/edit');
});

// 删除上船地点
router.post('/captain/boarding/:id/del', requireRole('captain'), (req, res) => {
  const bp = db.prepare(`
    SELECT bp.*, b.captain_id FROM boarding_points bp
      JOIN boats b ON bp.boat_id=b.id WHERE bp.id=?`).get(req.params.id);
  if (!bp || bp.captain_id !== req.user.id) return res.status(404).render('error', { message: '上船地点不存在', code: 404 });
  db.prepare('DELETE FROM boarding_points WHERE id=?').run(bp.id);
  res.flash('success', '上船地点已删除');
  res.redirect('/captain/boats/' + bp.boat_id + '/edit');
});

// ===== 船长端：图集上传 =====

// 上传船只图集
router.post('/captain/boats/:id/images', requireRole('captain'), upload.array('images', 10), (req, res) => {
  const boat = db.prepare('SELECT * FROM boats WHERE id=? AND captain_id=?').get(req.params.id, req.user.id);
  if (!boat) return res.status(404).render('error', { message: '船只不存在', code: 404 });
  if (!req.files || req.files.length === 0) {
    res.flash('error', '请选择图片文件（仅限图片，单张≤5MB）');
    return res.redirect('/captain/boats/' + boat.id + '/edit');
  }
  const ins = db.prepare('INSERT INTO boat_images (boat_id, filename) VALUES (?, ?)');
  req.files.forEach(f => ins.run(boat.id, f.filename));
  // 若无封面，取第一张作封面
  if (!boat.cover_image) {
    db.prepare('UPDATE boats SET cover_image=? WHERE id=?').run(req.files[0].filename, boat.id);
  }
  res.flash('success', `已上传 ${req.files.length} 张图片`);
  res.redirect('/captain/boats/' + boat.id + '/edit');
});

// 设为封面
router.post('/captain/boats/:id/cover', requireRole('captain'), (req, res) => {
  const boat = db.prepare('SELECT * FROM boats WHERE id=? AND captain_id=?').get(req.params.id, req.user.id);
  if (!boat) return res.status(404).render('error', { message: '船只不存在', code: 404 });
  const img = db.prepare('SELECT * FROM boat_images WHERE id=? AND boat_id=?').get(req.body.image_id, boat.id);
  if (!img) { res.flash('error', '图片不存在'); return res.redirect('/captain/boats/' + boat.id + '/edit'); }
  db.prepare('UPDATE boats SET cover_image=? WHERE id=?').run(img.filename, boat.id);
  res.flash('success', '已设为封面');
  res.redirect('/captain/boats/' + boat.id + '/edit');
});

// 删除图片
router.post('/captain/images/:imgId/del', requireRole('captain'), (req, res) => {
  const img = db.prepare(`
    SELECT bi.*, b.captain_id FROM boat_images bi
      JOIN boats b ON bi.boat_id=b.id WHERE bi.id=?`).get(req.params.imgId);
  if (!img || img.captain_id !== req.user.id) return res.status(404).render('error', { message: '图片不存在', code: 404 });
  const boat = db.prepare('SELECT * FROM boats WHERE id=?').get(img.boat_id);
  const fp = path.join(__dirname, '..', 'public', 'uploads', img.filename);
  try { if (fs.existsSync(fp)) fs.unlinkSync(fp); } catch (e) { /* 忽略 */ }
  db.prepare('DELETE FROM boat_images WHERE id=?').run(img.id);
  if (boat.cover_image === img.filename) {
    const next = db.prepare('SELECT filename FROM boat_images WHERE boat_id=? LIMIT 1').get(img.boat_id);
    db.prepare('UPDATE boats SET cover_image=? WHERE id=?').run(next ? next.filename : null, img.boat_id);
  }
  res.flash('success', '图片已删除');
  res.redirect('/captain/boats/' + img.boat_id + '/edit');
});

// ===== 船长端：钓区管理 =====

// 钓区管理页
router.get('/captain/boats/:id/areas', requireRole('captain'), (req, res) => {
  const boat = db.prepare('SELECT * FROM boats WHERE id=? AND captain_id=?').get(req.params.id, req.user.id);
  if (!boat) return res.status(404).render('error', { message: '船只不存在', code: 404 });
  const areas = db.prepare('SELECT * FROM boat_areas WHERE boat_id=? ORDER BY id').all(boat.id);
  res.render('boats/areas', { boat, areas, SEA_AREAS, amapKey: AMAP_KEY });
});

// 新增钓区
router.post('/captain/boats/:id/areas', requireRole('captain'), (req, res) => {
  const boat = db.prepare('SELECT * FROM boats WHERE id=? AND captain_id=?').get(req.params.id, req.user.id);
  if (!boat) return res.status(404).render('error', { message: '船只不存在', code: 404 });
  const { name, longitude, latitude, sea_area, description } = req.body;
  if (!name || !longitude || !latitude) {
    res.flash('error', '钓区名称、经纬度为必填');
    return res.redirect('/captain/boats/' + boat.id + '/areas');
  }
  db.prepare(`INSERT INTO boat_areas (boat_id, name, longitude, latitude, sea_area, description)
              VALUES (?, ?, ?, ?, ?, ?)`).run(
    boat.id, name, parseFloat(longitude), parseFloat(latitude), sea_area || null, description || null);
  res.flash('success', '钓区已添加');
  res.redirect('/captain/boats/' + boat.id + '/areas');
});

// 删除钓区
router.post('/captain/areas/:id/del', requireRole('captain'), (req, res) => {
  const area = db.prepare(`
    SELECT a.*, b.captain_id FROM boat_areas a
      JOIN boats b ON a.boat_id=b.id WHERE a.id=?`).get(req.params.id);
  if (!area || area.captain_id !== req.user.id) return res.status(404).render('error', { message: '钓区不存在', code: 404 });
  db.prepare('DELETE FROM boat_areas WHERE id=?').run(area.id);
  res.flash('success', '钓区已删除');
  res.redirect('/captain/boats/' + area.boat_id + '/areas');
});

// ===== 船长端：渔获相册管理 =====

// 渔获相册管理页
router.get('/captain/boats/:id/catches', requireRole('captain'), (req, res) => {
  const boat = db.prepare('SELECT * FROM boats WHERE id=? AND captain_id=?').get(req.params.id, req.user.id);
  if (!boat) return res.status(404).render('error', { message: '船只不存在', code: 404 });
  const catches = db.prepare('SELECT * FROM catches WHERE boat_id=? ORDER BY shot_date DESC, id DESC').all(boat.id);
  res.render('boats/catches', { boat, catches });
});

// 上传渔获照片
router.post('/captain/boats/:id/catches', requireRole('captain'), upload.array('photos', 10), (req, res) => {
  const boat = db.prepare('SELECT * FROM boats WHERE id=? AND captain_id=?').get(req.params.id, req.user.id);
  if (!boat) return res.status(404).render('error', { message: '船只不存在', code: 404 });
  if (!req.files || req.files.length === 0) {
    res.flash('error', '请选择图片文件');
    return res.redirect('/captain/boats/' + boat.id + '/catches');
  }
  const { fish_species, shot_date } = req.body;
  const ins = db.prepare('INSERT INTO catches (boat_id, photo, fish_species, shot_date) VALUES (?, ?, ?, ?)');
  req.files.forEach(f => ins.run(boat.id, f.filename, fish_species || null, shot_date || null));
  res.flash('success', `已上传 ${req.files.length} 张渔获照片`);
  res.redirect('/captain/boats/' + boat.id + '/catches');
});

// 删除渔获照片
router.post('/captain/catches/:id/del', requireRole('captain'), (req, res) => {
  const c = db.prepare(`
    SELECT c.*, b.captain_id FROM catches c
      JOIN boats b ON c.boat_id=b.id WHERE c.id=?`).get(req.params.id);
  if (!c || c.captain_id !== req.user.id) return res.status(404).render('error', { message: '照片不存在', code: 404 });
  const fp = path.join(__dirname, '..', 'public', 'uploads', c.photo);
  try { if (fs.existsSync(fp)) fs.unlinkSync(fp); } catch (e) { /* 忽略 */ }
  db.prepare('DELETE FROM catches WHERE id=?').run(c.id);
  res.flash('success', '渔获照片已删除');
  res.redirect('/captain/boats/' + c.boat_id + '/catches');
});

// ===== 船长端：批量录入（粘贴公告 → 解析 → 确认入库）=====

// 录入页：粘贴公告文本
router.get('/captain/import', requireRole('captain'), (req, res) => {
  const boats = db.prepare('SELECT id, name FROM boats WHERE captain_id=? ORDER BY id').all(req.user.id);
  res.render('boats/import', { boats });
});

// 解析预览：解析公告文本，返回结构化数据供用户确认
router.post('/captain/import/parse', requireRole('captain'), (req, res) => {
  const { announcement } = req.body;
  if (!announcement || !announcement.trim()) {
    res.flash('error', '请粘贴公告内容');
    return res.redirect('/captain/import');
  }
  const parser = require('../services/announce-parser');
  const parsed = parser.parseAnnouncement(announcement);
  const boats = db.prepare('SELECT id, name FROM boats WHERE captain_id=? ORDER BY id').all(req.user.id);

  // 把解析结果序列化，供确认入库时回传（避免再次解析）
  const token = Buffer.from(announcement, 'utf8').toString('base64');
  res.render('boats/import-preview', { parsed, boats, announcementToken: token });
});

// 确认入库：把用户确认/修改后的数据写入数据库
router.post('/captain/import/save', requireRole('captain'), (req, res) => {
  const {
    target_boat_id,           // null=新建船；数字=追加到已有船
    boat_name, boat_type, length_m, seats,
    meeting_port, target_fish, captain_experience,
    contact_phone, whatsapp_link, wechat,
    price_per_seat, price_includes, charter_min_people, charter_note,
    facilities, description,
    boarding_names, boarding_times,   // 数组
    trip_dates, trip_statuses, trip_notes,  // 数组
  } = req.body;

  // 事务：写船只（如新建）+ 上船点 + 船期
  const tx = db.transaction(() => {
    let boatId;
    if (target_boat_id) {
      // 追加到已有船，校验归属
      const boat = db.prepare('SELECT id FROM boats WHERE id=? AND captain_id=?').get(target_boat_id, req.user.id);
      if (!boat) throw new Error('目标船只不存在或无权操作');
      boatId = boat.id;
      // 可选更新部分字段（如果用户填了的话）
      if (price_per_seat) db.prepare('UPDATE boats SET price_per_seat=? WHERE id=?').run(parseFloat(price_per_seat), boatId);
      if (facilities) db.prepare('UPDATE boats SET facilities=? WHERE id=?').run(facilities, boatId);
    } else {
      // 新建船
      if (!boat_name) throw new Error('新建船只需填写船名');
      const info = db.prepare(`
        INSERT INTO boats (captain_id, name, boat_type, length_m, seats, meeting_port, target_fish,
                           captain_experience, contact_phone, whatsapp_link, wechat, price_per_seat, price_includes,
                           charter_min_people, charter_note, facilities, description)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        req.user.id, boat_name, boat_type || '出海艇',
        parseFloat(length_m) || null, parseInt(seats, 10) || null,
        meeting_port || null, target_fish || null, captain_experience || null,
        contact_phone || null, whatsapp_link || null, wechat || null,
        parseFloat(price_per_seat) || null, price_includes || null,
        parseInt(charter_min_people, 10) || null, charter_note || null,
        facilities || null, description || null);
      boatId = info.lastInsertRowid;
    }

    // 写上船点（数组）
    if (boarding_names) {
      const names = Array.isArray(boarding_names) ? boarding_names : [boarding_names];
      const times = Array.isArray(boarding_times) ? boarding_times : [boarding_times];
      const insBP = db.prepare('INSERT INTO boarding_points (boat_id, name, depart_time, sort_order) VALUES (?, ?, ?, ?)');
      names.forEach((n, i) => {
        if (n && n.trim()) insBP.run(boatId, n.trim(), (times[i] || null), i);
      });
    }

    // 写船期（数组）
    if (trip_dates) {
      const dates = Array.isArray(trip_dates) ? trip_dates : [trip_dates];
      const statuses = Array.isArray(trip_statuses) ? trip_statuses : [trip_statuses];
      const notes = Array.isArray(trip_notes) ? trip_notes : [trip_notes];
      const insTrip = db.prepare(`
        INSERT INTO trips (boat_id, depart_date, available_seats, price_per_seat, status, note)
        VALUES (?, ?, ?, ?, ?, ?)`);
      dates.forEach((d, i) => {
        if (d && d.trim()) {
          // 解析可用座位：从 note 推断，默认用船的 seats 或留空
          insTrip.run(boatId, d.trim(), parseInt(seats, 10) || 10,
            parseFloat(price_per_seat) || null,
            statuses[i] || 'recruiting', (notes[i] || '').trim() || null);
        }
      });
    }

    return boatId;
  });

  try {
    const boatId = tx();
    const tripCount = Array.isArray(trip_dates) ? trip_dates.filter(d => d && d.trim()).length : (trip_dates ? 1 : 0);
    res.flash('success', `录入成功！${target_boat_id ? '已追加船期到' : '新建船只并录入'}，船期 ${tripCount} 个`);
    res.redirect('/boats/' + boatId);
  } catch (e) {
    res.flash('error', '录入失败：' + e.message);
    res.redirect('/captain/import');
  }
});

module.exports = router;
