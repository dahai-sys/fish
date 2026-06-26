// 气象服务：按经纬度查实时风力、浪高、降水（Open-Meteo，免费无 key）
// 详情页钓区 marker 信息窗调用。接口失败时返回降级结构，不抛错。
const http = require('http');

// 把 URL 内容以 JSON 返回；超时或错误则 reject
function getJson(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(e); }
      });
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.on('error', reject);
  });
}

// WMO 天气代码 → 中文（精简版，详情页用完整版可查 weather skill）
const WMO = {
  0: '晴', 1: '晴', 2: '多云', 3: '阴',
  45: '雾', 48: '雾',
  51: '毛毛雨', 53: '毛毛雨', 55: '毛毛雨',
  61: '小雨', 63: '中雨', 65: '大雨',
  71: '小雪', 73: '中雪', 75: '大雪',
  80: '阵雨', 81: '阵雨', 82: '强阵雨',
  95: '雷阵雨', 96: '雷阵雨', 99: '雷阵雨',
};

// 风速 m/s → 蒲福风级（简化）
function windLevel(ms) {
  if (ms == null) return null;
  const levels = [0.3, 1.5, 3.3, 5.4, 7.9, 10.7, 13.8, 17.1, 20.7, 24.4, 28.4, 32.6];
  for (let i = 0; i < levels.length; i++) if (ms < levels[i]) return i;
  return 12;
}

// 查单个钓点的实时气象（合并海洋+天气两个接口）
// 返回：{ ok, windSpeed, windLevel, waveHeight, precipitation, weather, seaTemp }
async function getAreaWeather(lat, lng) {
  const marine = `http://marine-api.open-meteo.com/v1/marine?latitude=${lat}&longitude=${lng}&current=wave_height,sea_surface_temperature&timezone=auto`;
  const wx = `http://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=wind_speed_10m,precipitation,weather_code&timezone=auto`;
  try {
    const [m, w] = await Promise.all([
      getJson(marine, 4000).catch(() => null),
      getJson(wx, 4000).catch(() => null),
    ]);
    const result = { ok: false, windSpeed: null, windLevel: null, waveHeight: null, precipitation: null, weather: null, seaTemp: null };
    if (w && w.current) {
      const ms = w.current.wind_speed_10m;
      result.windSpeed = ms;
      result.windLevel = windLevel(ms);
      result.precipitation = w.current.precipitation;
      result.weather = WMO[w.current.weather_code] || null;
      result.ok = true;
    }
    if (m && m.current) {
      result.waveHeight = m.current.wave_height;
      result.seaTemp = m.current.sea_surface_temperature;
      result.ok = true;
    }
    return result;
  } catch (e) {
    return { ok: false, windSpeed: null, windLevel: null, waveHeight: null, precipitation: null, weather: null, seaTemp: null };
  }
}

// 批量查多个钓区（并发，整体超时保护）
// 入参：[{ id, name, latitude, longitude }, ...]
// 返回：Map<areaId, weather>
async function getWeatherForAreas(areas) {
  const map = {};
  await Promise.all(areas.map(async (a) => {
    map[a.id] = await getAreaWeather(a.latitude, a.longitude);
  }));
  return map;
}

module.exports = { getAreaWeather, getWeatherForAreas };
