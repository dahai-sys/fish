-- 鱼多多 (Fish Full) 建表脚本
-- 以船只为中心的数据模型：船只档案是主体，船期/钓区/渔获/图集都附属船只。
-- SQLite 单文件，better-sqlite3 同步执行。

-- 用户表：船长(captain) / 钓鱼人(angler)
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('captain', 'angler')),
  name          TEXT NOT NULL,
  phone         TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 船只档案（详情页主体）
CREATE TABLE IF NOT EXISTS boats (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  captain_id          INTEGER NOT NULL REFERENCES users(id),
  name                TEXT NOT NULL,
  boat_type           TEXT NOT NULL,          -- 出海艇/近海艇/休闲渔船...
  length_m            REAL,                    -- 船体长度（米）
  seats               INTEGER NOT NULL,        -- 总座位数
  cover_image         TEXT,                    -- 封面缩略图文件名（首页6项之一）
  meeting_port        TEXT,                    -- 主上船码头地点（兼容旧字段，详情页优先用 boarding_points）
  target_fish         TEXT,                    -- 主打垂钓鱼种
  captain_experience  TEXT,                    -- 船长从业经验
  contact_phone       TEXT,                    -- 船长联系电话
  whatsapp_link       TEXT,                    -- WhatsApp 报名链接（如 https://wa.me/852xxxxxxxx）
  wechat              TEXT,                    -- 微信号
  price_per_seat      REAL,                    -- 散客每座价格
  price_includes      TEXT,                    -- 费用包含明细（如：饮用水1支、杯麵1個、冰、南極蝦共享）
  charter_min_people  INTEGER,                 -- 包团最少人数（如 18）
  charter_note        TEXT,                    -- 包团说明（如：包团时间可改，欢迎查詢）
  facilities          TEXT,                    -- 船上设施清单，逗号分隔（如：頂流機,洗手間,熱水,微波爐）
  description         TEXT,                    -- 船只综合介绍
  created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 船只高清图集（一船多图）
CREATE TABLE IF NOT EXISTS boat_images (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  boat_id     INTEGER NOT NULL REFERENCES boats(id) ON DELETE CASCADE,
  filename    TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_boat_images_boat ON boat_images(boat_id);

-- 上船地点（一船多个上船点，每个带出发时间和地图链接）
CREATE TABLE IF NOT EXISTS boarding_points (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  boat_id     INTEGER NOT NULL REFERENCES boats(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,                   -- 上船地点名（如 嘉亨灣 / 三家村）
  depart_time TEXT,                            -- 该点出发时间 HH:MM（如 12:00 / 12:10）
  map_link    TEXT,                            -- 地图链接（Google Maps / 高德）
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_boarding_points_boat ON boarding_points(boat_id);

-- 船只的多个垂钓区域（一船多钓区）—— 地图标注 + 气象查询的基础
CREATE TABLE IF NOT EXISTS boat_areas (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  boat_id     INTEGER NOT NULL REFERENCES boats(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,                   -- 钓区名称
  longitude   REAL NOT NULL,                   -- 经度（气象 API 按此查）
  latitude    REAL NOT NULL,                   -- 纬度
  sea_area    TEXT,                            -- 结构化海区（东海/舟山 等）
  description TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_boat_areas_boat ON boat_areas(boat_id);

-- 船期（可出船日期 + 座位 + 价格 + 成团状态）—— 附属船只
CREATE TABLE IF NOT EXISTS trips (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  boat_id         INTEGER NOT NULL REFERENCES boats(id) ON DELETE CASCADE,
  depart_date     TEXT NOT NULL,               -- 出发日期 YYYY-MM-DD
  depart_time     TEXT,                        -- 出发时间 HH:MM（按船期独立配置，支持某日起改时间）
  return_time     TEXT,                        -- 回岸时间 HH:MM
  available_seats INTEGER NOT NULL,            -- 当前剩余座位（随预约变动）
  price_per_seat  REAL NOT NULL,               -- 本班次每座价格
  -- 成团状态：招募中(还在凑人)→已成团(确认开船)→已满→已关闭
  -- recruiting: 欠位成团中（钓友可继续预约）
  -- confirmed : 已达最低成团人数，确定开船（钓友仍可预约直到满）
  -- full      : 座位已满，不可再预约
  -- closed    : 船长手动关闭（停开/改期）
  status          TEXT NOT NULL DEFAULT 'recruiting'
                    CHECK (status IN ('recruiting', 'confirmed', 'full', 'closed')),
  min_people      INTEGER,                     -- 成团最少人数（为空则继承船只 charter_min_people）
  note            TEXT,                        -- 本班次备注（如「改為1號船出發」「七一特别班次」）
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_trips_boat ON trips(boat_id);
CREATE INDEX IF NOT EXISTS idx_trips_date ON trips(depart_date);

-- 近期渔获相册（船长自主维护）
CREATE TABLE IF NOT EXISTS catches (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  boat_id       INTEGER NOT NULL REFERENCES boats(id) ON DELETE CASCADE,
  photo         TEXT NOT NULL,                 -- 渔获照片文件名
  fish_species  TEXT,                          -- 当日鱼种记录
  shot_date     TEXT,                          -- 拍摄日期
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_catches_boat ON catches(boat_id);

-- 预约记录（状态机不变，挂在 trip 上）
CREATE TABLE IF NOT EXISTS bookings (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  trip_id       INTEGER NOT NULL REFERENCES trips(id),
  angler_id     INTEGER NOT NULL REFERENCES users(id),
  seats_booked  INTEGER NOT NULL,
  contact_phone TEXT,
  remark        TEXT,
  status        TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'confirmed', 'cancelled', 'completed')),
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_bookings_trip   ON bookings(trip_id);
CREATE INDEX IF NOT EXISTS idx_bookings_angler ON bookings(angler_id);
