// Express 应用入口
require('dotenv').config();

const path = require('path');
const express = require('express');
const morgan = require('morgan');

// 引入数据库（首次加载会自动建表）
require('./db');

const { loadCurrentUser } = require('./middleware/auth');
const { notFound, errorHandler } = require('./middleware/errorHandler');
const flash = require('./middleware/flash');

const app = express();
const PORT = process.env.PORT || 3000;

// 视图引擎
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// 基础中间件
app.use(morgan('dev'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(require('cookie-parser')(flash.secret));
app.use(express.static(path.join(__dirname, 'public')));

// 自定义中间件
app.use(flash.attach);       // 给 res 挂 res.flash() 方法
app.use(loadCurrentUser);    // 注入 req.user / res.locals.currentUser
app.use(flash.consume);      // 读取并清空 flash，挂到 res.locals.flash

// 路由（每个 router 内部定义完整路径，挂在根上，避免前缀重写带来的混乱）
// 首页 / 由 boats router 提供（直接展示船只列表）
app.use('/', require('./routes/auth'));
app.use('/', require('./routes/trips'));
app.use('/', require('./routes/boats'));
app.use('/', require('./routes/bookings'));

// 错误处理
app.use(notFound);
app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`🐟 鱼多多 (Fish Full) 已启动：http://localhost:${PORT}`);
  console.log(`   演示账号：captain1 / angler1，密码均为 123456`);
});
