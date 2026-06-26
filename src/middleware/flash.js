// 轻量 flash 机制：用 res.locals.flash 一次性把消息渲染到下一个页面。
// 用法：在路由里 res.flash('success', '保存成功'); 然后 res.redirect(...)，
// 重定向后的渲染层能读到 res.locals.flash。
//
// 原型期为简化不引入 express-session，用一次性的 cookie 传递。
const cookieParser = require('cookie-parser');

const SECRET = process.env.JWT_SECRET || 'dev-insecure-secret';
const FLASH_COOKIE = 'fb_flash';

// Express 中间件：给每个 res 挂上 flash 方法
function attach(req, res, next) {
  res.flash = function (type, message) {
    const payload = JSON.stringify({ type, message });
    res.cookie(FLASH_COOKIE, payload, {
      httpOnly: true,
      maxAge: 30 * 1000, // 30 秒足够一次重定向跳转
      sameSite: 'lax',
    });
  };
  next();
}

// 读取并清空 flash cookie，挂到 res.locals.flash 供模板渲染
function consume(req, res, next) {
  res.locals.flash = null;
  if (req.cookies && req.cookies[FLASH_COOKIE]) {
    try {
      res.locals.flash = JSON.parse(req.cookies[FLASH_COOKIE]);
    } catch (e) {
      res.locals.flash = null;
    }
    res.clearCookie(FLASH_COOKIE);
  }
  // 同时支持后端直接设置的一次性消息（auth.js 中 sessionFlash）
  if (req.sessionFlash) {
    res.locals.flash = req.sessionFlash;
    req.sessionFlash = null;
  }
  next();
}

module.exports = { attach, consume, secret: SECRET, cookieParser };
