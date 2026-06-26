// 预约路由：钓鱼人提交 / 查看自己的预约；船长确认/拒绝/完成
// 座位数变更全部在事务内完成，防止超卖
// router 挂在根上，故所有路径为完整路径。
const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireLogin, requireRole } = require('../middleware/auth');

// 钓鱼人：提交预约 —— POST /trips/:tripId/book
router.post('/trips/:tripId/book', requireLogin, (req, res) => {
  const { seats_booked, contact_phone, remark } = req.body;
  const tripId = req.params.tripId;
  const anglerId = req.user.id;

  if (req.user.role !== 'angler') {
    res.flash('error', '船长账号无需预约船期');
    return res.redirect('/boats');
  }

  const seats = parseInt(seats_booked, 10);
  if (!seats || seats < 1) {
    res.flash('error', '请填写有效的座位数');
    return res.redirect('/boats');
  }

  // 防重复预约
  const dup = db.prepare(
    'SELECT id FROM bookings WHERE trip_id = ? AND angler_id = ? AND status IN (?, ?)'
  ).get(tripId, anglerId, 'pending', 'confirmed');
  if (dup) {
    res.flash('error', '你已经预约过这个船期，请勿重复提交');
    return res.redirect('/boats');
  }

  let bookedBoatId = null;
  const tx = db.transaction(() => {
    const trip = db.prepare('SELECT * FROM trips WHERE id = ?').get(tripId);
    if (!trip) throw new Error('船期不存在');
    if (!['recruiting', 'confirmed'].includes(trip.status)) throw new Error('该船期已关闭或已满');
    if (seats > trip.available_seats) {
      throw new Error('剩余座位不足，仅剩 ' + trip.available_seats + ' 座');
    }
    db.prepare(
      `INSERT INTO bookings (trip_id, angler_id, seats_booked, contact_phone, remark, status)
       VALUES (?, ?, ?, ?, ?, 'pending')`
    ).run(tripId, anglerId, seats, contact_phone || null, remark || null);
    bookedBoatId = trip.boat_id;
    // pending 不立即扣座位，等船长确认时再扣，避免被未确认订单占用
  });

  try {
    tx();
    res.flash('success', '预约已提交，等待船长确认');
    res.redirect('/boats/' + bookedBoatId);
  } catch (e) {
    res.flash('error', e.message);
    res.redirect('/boats');
  }
});

// 钓鱼人：我的预约
router.get('/bookings/mine', requireLogin, (req, res) => {
  const bookings = db.prepare(
    `SELECT bk.*, t.depart_date, t.depart_time, t.return_time, t.price_per_seat, t.status AS trip_status,
            b.id AS boat_id, b.name AS boat_name, b.meeting_port, b.target_fish,
            u.name AS captain_name, u.phone AS captain_phone
       FROM bookings bk
       JOIN trips t ON bk.trip_id = t.id
       JOIN boats b ON t.boat_id = b.id
       JOIN users u ON b.captain_id = u.id
      WHERE bk.angler_id = ?
      ORDER BY bk.created_at DESC`
  ).all(req.user.id);
  res.render('bookings/mine', { bookings });
});

// 钓鱼人：取消自己的预约（pending 直接取消；confirmed 取消需归还座位）
router.post('/bookings/:id/cancel', requireLogin, (req, res) => {
  const booking = db.prepare('SELECT * FROM bookings WHERE id = ? AND angler_id = ?').get(req.params.id, req.user.id);
  if (!booking) return res.status(404).render('error', { message: '预约不存在', code: 404 });
  if (booking.status === 'cancelled' || booking.status === 'completed') {
    res.flash('error', '该预约已结束，无需取消');
    return res.redirect('/bookings/mine');
  }

  const tx = db.transaction(() => {
    if (booking.status === 'confirmed') {
      // 归还座位；若船期之前是 full，恢复为 open
      db.prepare(
        `UPDATE trips
            SET available_seats = available_seats + ?,
                status = CASE WHEN status = 'full' THEN 'confirmed' ELSE status END
          WHERE id = ?`
      ).run(booking.seats_booked, booking.trip_id);
    }
    db.prepare('UPDATE bookings SET status = ? WHERE id = ?').run('cancelled', booking.id);
  });
  tx();
  res.flash('success', '已取消预约');
  res.redirect('/bookings/mine');
});

// ---- 船长端 ----

// 船长：待处理的预约管理
router.get('/captain/bookings', requireRole('captain'), (req, res) => {
  const bookings = db.prepare(
    `SELECT bk.*, t.depart_date, t.depart_time, t.return_time,
            b.id AS boat_id, b.name AS boat_name, b.meeting_port,
            u.name AS angler_name, u.phone AS angler_phone
       FROM bookings bk
       JOIN trips t ON bk.trip_id = t.id
       JOIN boats b ON t.boat_id = b.id
       JOIN users u ON bk.angler_id = u.id
      WHERE b.captain_id = ?
        AND bk.status IN ('pending', 'confirmed')
      ORDER BY CASE bk.status WHEN 'pending' THEN 0 ELSE 1 END, bk.created_at DESC`
  ).all(req.user.id);
  res.render('bookings/captain-manage', { bookings });
});

// 船长：确认预约（扣座位，满员则置 full）
router.post('/captain/bookings/:id/confirm', requireRole('captain'), (req, res) => {
  const booking = db.prepare(
    `SELECT bk.*, b.captain_id AS captain_id
       FROM bookings bk
       JOIN trips t ON bk.trip_id = t.id
       JOIN boats b ON t.boat_id = b.id
      WHERE bk.id = ?`
  ).get(req.params.id);
  if (!booking || booking.captain_id !== req.user.id) {
    return res.status(404).render('error', { message: '预约不存在或无权操作', code: 404 });
  }
  if (booking.status !== 'pending') {
    res.flash('error', '只能确认待处理的预约');
    return res.redirect('/captain/bookings');
  }

  const tx = db.transaction(() => {
    const trip = db.prepare('SELECT * FROM trips WHERE id = ?').get(booking.trip_id);
    if (booking.seats_booked > trip.available_seats) {
      throw new Error('剩余座位不足（仅剩 ' + trip.available_seats + ' 座），请拒绝或调整');
    }
    const newAvail = trip.available_seats - booking.seats_booked;
    db.prepare('UPDATE trips SET available_seats = ?, status = ? WHERE id = ?')
      .run(newAvail, newAvail === 0 ? 'full' : trip.status, trip.id);
    db.prepare('UPDATE bookings SET status = ? WHERE id = ?').run('confirmed', booking.id);
  });

  try {
    tx();
    res.flash('success', '已确认预约');
  } catch (e) {
    res.flash('error', e.message);
  }
  res.redirect('/captain/bookings');
});

// 船长：拒绝 / 撤销确认预约
router.post('/captain/bookings/:id/reject', requireRole('captain'), (req, res) => {
  const booking = db.prepare(
    `SELECT bk.*, b.captain_id AS captain_id
       FROM bookings bk JOIN trips t ON bk.trip_id = t.id JOIN boats b ON t.boat_id = b.id
      WHERE bk.id = ?`
  ).get(req.params.id);
  if (!booking || booking.captain_id !== req.user.id) {
    return res.status(404).render('error', { message: '预约不存在或无权操作', code: 404 });
  }
  if (booking.status === 'pending') {
    db.prepare('UPDATE bookings SET status = ? WHERE id = ?').run('cancelled', booking.id);
    res.flash('success', '已拒绝预约');
  } else if (booking.status === 'confirmed') {
    // 已确认后撤销，归还座位
    const tx = db.transaction(() => {
      db.prepare(
        `UPDATE trips
            SET available_seats = available_seats + ?,
                status = CASE WHEN status = 'full' THEN 'confirmed' ELSE status END
          WHERE id = ?`
      ).run(booking.seats_booked, booking.trip_id);
      db.prepare('UPDATE bookings SET status = ? WHERE id = ?').run('cancelled', booking.id);
    });
    tx();
    res.flash('success', '已撤销确认并归还座位');
  } else {
    res.flash('error', '该预约已结束');
  }
  res.redirect('/captain/bookings');
});

// 船长：标记完成（出行后）
router.post('/captain/bookings/:id/complete', requireRole('captain'), (req, res) => {
  const booking = db.prepare(
    `SELECT bk.*, b.captain_id AS captain_id
       FROM bookings bk JOIN trips t ON bk.trip_id = t.id JOIN boats b ON t.boat_id = b.id
      WHERE bk.id = ?`
  ).get(req.params.id);
  if (!booking || booking.captain_id !== req.user.id) {
    return res.status(404).render('error', { message: '预约不存在或无权操作', code: 404 });
  }
  if (booking.status === 'confirmed') {
    db.prepare('UPDATE bookings SET status = ? WHERE id = ?').run('completed', booking.id);
    res.flash('success', '已标记为已完成');
  } else {
    res.flash('error', '只能完成已确认的预约');
  }
  res.redirect('/captain/bookings');
});

module.exports = router;
