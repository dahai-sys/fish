# 鱼多多 Fish Full（MVP）

船长发布船期，钓鱼人按日期/海域查询并在线预约。服务端渲染的 Web 应用。

## 技术栈

- **后端**：Node.js + Express
- **数据库**：SQLite（`better-sqlite3`，同步 API，零运维单文件）
- **前端**：EJS 服务端渲染 + Bootstrap 5（响应式）
- **鉴权**：JWT（httpOnly cookie）+ bcryptjs 密码哈希
- **地图**：高德地图 JS API（可选，不配置则降级显示坐标）

## 快速开始

```bash
cd fish-full
npm install        # 安装依赖
npm run seed       # 灌入演示数据（会清空重建）
npm start          # 启动，访问 http://localhost:3000
```

## 演示账号

| 角色 | 账号 | 密码 | 能做什么 |
|------|------|------|---------|
| 船长 | `captain1` | `123456` | 发布船只/船期、管理预约 |
| 船长 | `captain2` | `123456` | 同上 |
| 钓鱼人 | `angler1` | `123456` | 浏览船期、预约、查看/取消自己的预约 |

## 核心功能

### 1. 船期发布与查询
- 船长：表单录入船期，含结构化海区下拉 + 钓点经纬度（配高德 key 后可在地图点击选点）
- 钓鱼人：按「日期范围 + 海域 + 关键词」筛选船期，详情页查看钓点地图标注

### 2. 在线预约 + 状态流转
```
钓鱼人提交 → pending（待确认，不扣座位）
   ↓ 船长确认（事务内扣座位）
confirmed   /   拒绝 → cancelled
   ↓ 出行后船长标记
completed
```
- **座位一致性**：确认/取消预约在数据库事务内完成，满员自动置 `full`，**不会超卖**

### 3. 用户登录与角色
- 注册时选「船长 / 钓鱼人」，决定可见菜单与权限
- 船长只能操作自己的船/船期；钓鱼人只能看/取消自己的预约

## 配置（可选）

复制 `.env.example` 为 `.env`，可配置：

```
JWT_SECRET=你的随机密钥
PORT=3000
AMAP_KEY=你的高德地图Web端JS Key   # 不填则地图降级显示坐标
```

高德 Key 申请：https://lbs.amap.com/

## 目录结构

```
fish-full/
├── src/
│   ├── app.js               # Express 入口
│   ├── db/
│   │   ├── schema.sql       # 建表（4 张表）
│   │   ├── index.js         # 连接 + 自动建表
│   │   └── seed.js          # 演示数据
│   ├── middleware/
│   │   ├── auth.js          # JWT 校验 + 角色守卫
│   │   ├── flash.js         # 轻量消息闪现（cookie 实现）
│   │   └── errorHandler.js
│   ├── routes/
│   │   ├── auth.js          # 注册/登录/登出
│   │   ├── trips.js         # 船期查询/详情 + 船长发布
│   │   ├── boats.js         # 船只管理
│   │   └── bookings.js      # 预约提交/确认/拒绝/完成/取消
│   └── views/               # EJS 模板
└── data/app.db              # SQLite 文件（gitignore）
```

## 数据模型

- **users**：id, username, password_hash, role(captain/angler), name, phone
- **boats**：id, captain_id, name, boat_type, length_m, seats, description
- **trips**：id, boat_id, depart_date, depart_time, meeting_port, sea_area, fishing_spot_name, longitude, latitude, target_fish, price_per_seat, available_seats, status
- **bookings**：id, trip_id, angler_id, seats_booked, contact_phone, remark, status

## 验证过的流程（端到端）

- [x] 钓鱼人注册/登录（JWT cookie）
- [x] 按日期+海域查询船期
- [x] 提交预约（pending 不扣座位）
- [x] 船长确认预约（事务内扣座位，8→6）
- [x] 钓鱼人取消已确认预约（座位归还，6→8）
- [x] 满员自动置 full + 防超卖（事务回滚）
- [x] 船长发布船期（含经纬度入库）
- [x] 船长添加船只

## 不在 MVP 范围（二期）

支付、评价评分、消息通知、船期图片上传、数据统计看板
