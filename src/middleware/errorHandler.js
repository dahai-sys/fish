// 统一错误处理中间件
function notFound(req, res, next) {
  res.status(404).render('error', { message: '页面不存在', code: 404 });
}

function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  console.error('[ERROR]', err);
  res.status(500).render('error', { message: '服务器开小差了：' + (err.message || err), code: 500 });
}

module.exports = { notFound, errorHandler };
