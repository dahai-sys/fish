// 船期路由（简化为「可出船日期 + 座位 + 价格」管理）
// 钓区/码头/鱼种等已归到 boat 和 boat_areas，船期只管排期。
// 船期列表/详情已转给 boats 路由（船只详情页内嵌展示行程）。
const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireRole } = require('../middleware/auth');

// 船长看自己的船期列表（按船只分组聚合显示）
router.get('/captain/trips', requireRole('captain'), (req, res) => {
  const trips = db.prepare(`
    SELECT t.*, b.name AS boat_name, b.seats AS boat_seats, b.id AS boat_id,
           (SELECT COUNT(*) FROM bookings bk WHERE bk.trip_id = t.id AND bk.status IN ('pending','confirmed')) AS booking_count
      FROM trips t
      JOIN boats b ON t.boat_id = b.id
     WHERE b.captain_id = ?
     ORDER BY t.depart_date DESC`).all(req.user.id);
  res.render('trips/captain-list', { trips });
});

// 发布船期表单（简化：选船 + 日期 + 时间 + 座位 + 价格）
router.get('/captain/trips/new', requireRole('captain'), (req, res) => {
  const boats = db.prepare('SELECT * FROM boats WHERE captain_id = ? ORDER BY created_at DESC').all(req.user.id);
  if (boats.length === 0) {
    res.flash('error', '请先添加至少一艘船只');
    return res.redirect('/captain/boats/new');
  }
  res.render('trips/new', { boats, values: {} });
});

// 发布船期提交
router.post('/captain/trips/new', requireRole('captain'), (req, res) => {
  const { boat_id, depart_date, depart_time, return_time, price_per_seat, available_seats, min_people, note } = req.body;
  const values = req.body;

  const boat = db.prepare('SELECT * FROM boats WHERE id = ? AND captain_id = ?').get(boat_id, req.user.id);
  const boats = db.prepare('SELECT * FROM boats WHERE captain_id = ?').all(req.user.id);
  if (!boat) {
    res.flash('error', '请选择有效的船只');
    return res.render('trips/new', { boats, values });
  }
  if (!depart_date || !price_per_seat || !available_seats) {
    res.flash('error', '出发日期、价格、座位数为必填');
    return res.render('trips/new', { boats, values });
  }
  const seats = parseInt(available_seats, 10);
  if (!seats || seats < 1) {
    res.flash('error', '座位数必须是大于 0 的整数');
    return res.render('trips/new', { boats, values });
  }
  if (seats > boat.seats) {
    res.flash('error', `开放座位不能超过船只载客数（${boat.seats} 座）`);
    return res.render('trips/new', { boats, values });
  }

  // 成团最少人数：表单填了用表单值，否则用船只默认
  const minPpl = (min_people && parseInt(min_people, 10) > 0) ? parseInt(min_people, 10) : (boat.charter_min_people || null);

  db.prepare(`
    INSERT INTO trips (boat_id, depart_date, depart_time, return_time, available_seats, price_per_seat, status, min_people, note)
    VALUES (?, ?, ?, ?, ?, ?, 'recruiting', ?, ?)`).run(
    boat_id, depart_date, depart_time || null, return_time || null, seats, parseFloat(price_per_seat), minPpl, note || null);

  res.flash('success', '船期已发布（状态：招募中）');
  res.redirect('/captain/trips');
});

// 船长关闭船期
router.post('/captain/trips/:id/close', requireRole('captain'), (req, res) => {
  const trip = db.prepare(`
    SELECT t.id FROM trips t JOIN boats b ON t.boat_id = b.id
     WHERE t.id = ? AND b.captain_id = ?`).get(req.params.id, req.user.id);
  if (!trip) return res.status(404).render('error', { message: '船期不存在或无权操作', code: 404 });
  db.prepare('UPDATE trips SET status = ? WHERE id = ?').run('closed', trip.id);
  res.flash('success', '已关闭该船期');
  res.redirect('/captain/trips');
});

// 船长标记成团（招募中 → 已成团，确定开船）
router.post('/captain/trips/:id/confirm', requireRole('captain'), (req, res) => {
  const trip = db.prepare(`
    SELECT t.* FROM trips t JOIN boats b ON t.boat_id = b.id
     WHERE t.id = ? AND b.captain_id = ?`).get(req.params.id, req.user.id);
  if (!trip) return res.status(404).render('error', { message: '船期不存在或无权操作', code: 404 });
  if (trip.status === 'recruiting') {
    db.prepare('UPDATE trips SET status = ? WHERE id = ?').run('confirmed', trip.id);
    res.flash('success', '已标记为成团，确定开船');
  } else {
    res.flash('error', '只有招募中的船期才能标记成团');
  }
  res.redirect('/captain/trips');
});

// 船长重开船期（已关闭 → 招募中）
router.post('/captain/trips/:id/reopen', requireRole('captain'), (req, res) => {
  const trip = db.prepare(`
    SELECT t.* FROM trips t JOIN boats b ON t.boat_id = b.id
     WHERE t.id = ? AND b.captain_id = ?`).get(req.params.id, req.user.id);
  if (!trip) return res.status(404).render('error', { message: '船期不存在或无权操作', code: 404 });
  if (trip.status === 'closed') {
    db.prepare('UPDATE trips SET status = ? WHERE id = ?').run('recruiting', trip.id);
    res.flash('success', '船期已重新开放');
  }
  res.redirect('/captain/trips');
});

module.exports = router;
