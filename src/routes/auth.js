// 认证路由：注册 / 登录 / 登出
const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();
const db = require('../db');
const { issueToken, clearToken } = require('../middleware/auth');

// 注册页（支持 ?role=captain|angler 预选角色）
router.get('/register', (req, res) => {
  const role = ['captain', 'angler'].includes(req.query.role) ? req.query.role : '';
  res.render('auth/register', { values: { role } });
});

// 注册提交
router.post('/register', (req, res) => {
  const { username, password, confirm, role, name, phone } = req.body;
  const values = { username, role: role || 'angler', name, phone };

  // 校验
  if (!username || !password || !name) {
    res.flash('error', '用户名、密码、姓名必填');
    return res.render('auth/register', { values });
  }
  if (password !== confirm) {
    res.flash('error', '两次密码不一致');
    return res.render('auth/register', { values });
  }
  if (!['captain', 'angler'].includes(role)) {
    res.flash('error', '请选择身份（船长或钓鱼人）');
    return res.render('auth/register', { values });
  }
  const exists = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (exists) {
    res.flash('error', '用户名已被占用');
    return res.render('auth/register', { values });
  }

  const hash = bcrypt.hashSync(password, 10);
  const info = db.prepare(
    'INSERT INTO users (username, password_hash, role, name, phone) VALUES (?, ?, ?, ?, ?)'
  ).run(username, hash, role, name, phone || null);

  const user = db.prepare('SELECT id, username, role, name, phone FROM users WHERE id = ?').get(info.lastInsertRowid);
  issueToken(res, user);
  res.flash('success', '注册成功，欢迎加入！');
  res.redirect(role === 'captain' ? '/captain/boats' : '/boats');
});

// 登录页
router.get('/login', (req, res) => {
  res.render('auth/login', { values: {} });
});

// 登录提交
router.post('/login', (req, res) => {
  const { username, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !bcrypt.compareSync(password || '', user.password_hash)) {
    return res.render('auth/login', { values: { username }, error: '用户名或密码错误' });
  }
  issueToken(res, user);
  res.flash('success', '登录成功');
  res.redirect(user.role === 'captain' ? '/captain/boats' : '/boats');
});

// 登出
router.post('/logout', (req, res) => {
  clearToken(res);
  res.flash('success', '已退出登录');
  res.redirect('/login');
});
router.get('/logout', (req, res) => res.redirect('/login'));

module.exports = router;
