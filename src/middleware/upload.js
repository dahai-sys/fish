// 文件上传中间件（multer）
// 图片存到 src/public/uploads/，数据库只存文件名。
// 限制：仅图片、单文件 5MB。
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');

const UPLOAD_DIR = path.join(__dirname, '..', 'public', 'uploads');

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    // 用 时间戳 + 随机串 + 原扩展名，避免重名覆盖
    const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
    const name = Date.now() + '-' + crypto.randomBytes(4).toString('hex') + ext;
    cb(null, name);
  },
});

const imageFilter = (req, file, cb) => {
  if (/^image\//.test(file.mimetype)) return cb(null, true);
  cb(null, false); // 非图片直接忽略，不报错（让后续逻辑处理空文件）
};

const upload = multer({
  storage,
  fileFilter: imageFilter,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
});

module.exports = upload;
