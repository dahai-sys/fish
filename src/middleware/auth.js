// 鉴权中间件：解析 JWT、注入当前用户、提供角色守卫
const jwt = require('jsonwebtoken');
const db = require('../db');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-insecure-secret';
const COOKIE_NAME = 'fb_token';

// 所有请求都尝试解析 token，成功则把用户行挂到 res.locals.currentUser 和 req.user
function loadCurrentUser(req, res, next) {
  const token = req.cookies && req.cookies[COOKIE_NAME];
  res.locals.currentUser = null;
  if (!token) return next();

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = db.prepare('SELECT id, username, role, name, phone FROM users WHERE id = ?').get(payload.id);
    if (user) {
      req.user = user;
      res.locals.currentUser = user;
    }
  } catch (e) {
    // token 无效或过期，清除 cookie，按未登录处理
    res.clearCookie(COOKIE_NAME);
  }
  next();
}

// 必须登录
function requireLogin(req, res, next) {
  if (!req.user) {
    req.sessionFlash = { error: '请先登录' };
    return res.redirect('/login');
  }
  next();
}

// 必须是指定角色之一
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      req.sessionFlash = { error: '请先登录' };
      return res.redirect('/login');
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).render('error', { message: '无权访问此页面（需要 ' + roles.join('/') + ' 角色）' });
    }
    next();
  };
}

// 颁发 token 并写入 httpOnly cookie
function issueToken(res, user) {
  const token = jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    maxAge: 7 * 24 * 60 * 60 * 1000,
    sameSite: 'lax',
  });
}

function clearToken(res) {
  res.clearCookie(COOKIE_NAME);
}

module.exports = {
  COOKIE_NAME,
  loadCurrentUser,
  requireLogin,
  requireRole,
  issueToken,
  clearToken,
};
