// 数据库连接与初始化
// 使用 better-sqlite3（同步 API），单文件数据库
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DB_DIR = path.join(__dirname, '..', '..', 'data');
const DB_PATH = path.join(DB_DIR, 'app.db');

if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');     // 并发读性能更好
db.pragma('foreign_keys = ON');      // 开启外键约束

// 首次加载时执行建表脚本
const schemaPath = path.join(__dirname, 'schema.sql');
const schema = fs.readFileSync(schemaPath, 'utf8');
db.exec(schema);

module.exports = db;
