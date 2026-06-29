require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
const PORT = Number(process.env.PORT || 5174);
const SERVICE_KEY = process.env.DATA_GO_KR_SERVICE_KEY;
const API_ENDPOINT = process.env.DATA_GO_KR_API_ENDPOINT || '';
const DEFAULT_ENDPOINT = 'https://api.data.go.kr/openapi/tn_pubr_public_nutri_info_api';

app.use(cors());
app.use(express.json());
app.use(express.static('.'));

function toNumber(value) {
  if (value === undefined || value === null) return 0;
  const cleaned = String(value).replace(/,/g, '').trim();
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function pick(row, keys) {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null && row[key] !== '') return row[key];
  }
  return '';
}

function normalizeRows(payload) {
  if (!payload) return [];
  let rows = [];

  if (Array.isArray(payload?.body?.items)) rows = payload.body.items;
  else if (Array.isArray(payload?.body?.items?.item)) rows = payload.body.items.item;
  else if (Array.isArray(payload?.response?.body?.items)) rows = payload.response.body.items;
  else if (Array.isArray(payload?.response?.body?.items?.item)) rows = payload.response.body.items.item;
  else if (Array.isArray(payload?.I2790?.row)) rows = payload.I2790.row;
  else if (Array.isArray(payload?.row)) rows = payload.row;
  else if (Array.isArray(payload)) rows = payload;

  return rows.map((row) => {
    // 가장 구체적인 식품명 우선: 세분류명 등 세부명 → 식품명 → 대표식품명 순.
    const baseName = String(pick(row, [
      'foodLv4Nm', 'foodLv3Nm', 'FOOD_LV4_NM', 'FOOD_LV3_NM', '소분류명', '세분류명', '식품세부명',
      'DESC_KOR', 'foodNm', 'FOOD_NM_KR', 'FOOD_NM', 'name', '식품명',
      'repFoodNm', 'REP_FOOD_NM', '대표식품명',
    ]) || '').trim();

    // 대표식품명만 반복되는 데이터(예: '딸기')를 구분할 보조 정보.
    const foodType = cleanLabel(pick(row, ['typeNm', 'TYPE_NM', '식품유형']));
    const maker = cleanLabel(pick(row, ['mkrNm', 'companyNm', 'rtlBzentyNm', 'MKR_NM', '제조사명', '업체명', '유통업체명']));
    const foodSize = cleanLabel(pick(row, ['foodSize', 'FOOD_SIZE', '식품중량']));
    const origin = cleanLabel(pick(row, ['cooNm', 'COO_NM', '원산지국명', '원산지']));

    // 식품명 옆에 분류/업체명/중량/원산지를 덧붙여 가공품·생것을 구분 가능하게 표시.
    const detailParts = [foodType, maker, foodSize, origin].filter((v) => v && v !== baseName);
    const foodName = detailParts.length ? `${baseName} (${detailParts.join(' · ')})` : baseName;

    const srcName = cleanLabel(pick(row, ['SUB_REF_NAME', 'srcNm', 'source', '출처']));

    return {
      foodName,
      baseName,
      foodType,
      maker,
      foodSize,
      origin,
      servingSize: parseServingSize(pick(row, ['SERVING_SIZE', 'servingSize', 'SERVING_WT', 'nutConSrtrQua', '영양성분함량기준량']) || 100) || 100,
      kcal: toNumber(pick(row, ['NUTR_CONT1', 'enerc', 'ENERC_KCAL', 'energy', '에너지(kcal)', '에너지'])),
      carbohydrate: toNumber(pick(row, ['NUTR_CONT2', 'chocdf', 'CHOCDF', 'carbohydrate', '탄수화물(g)', '탄수화물'])),
      protein: toNumber(pick(row, ['NUTR_CONT3', 'prot', 'PROT', 'protein', '단백질(g)', '단백질'])),
      fat: toNumber(pick(row, ['NUTR_CONT4', 'fatce', 'FATCE', 'fat', '지방(g)', '지방'])),
      sugars: toNumber(pick(row, ['NUTR_CONT5', 'sugar', 'SUGAR', 'sugars', '당류(g)', '당류'])),
      sodium: toNumber(pick(row, ['NUTR_CONT6', 'nat', 'NAT', 'sodium', '나트륨(mg)', '나트륨'])),
      cholesterol: toNumber(pick(row, ['NUTR_CONT7', 'chole', 'CHOLE', 'cholesterol', '콜레스테롤(mg)', '콜레스테롤'])),
      saturatedFat: toNumber(pick(row, ['NUTR_CONT8', 'fasat', 'FASAT', 'saturatedFat', '포화지방산(g)', '포화지방'])),
      transFat: toNumber(pick(row, ['NUTR_CONT9', 'fatrn', 'FATRN', 'transFat', '트랜스지방산(g)', '트랜스지방'])),
      source: [srcName || '공공데이터포털 식품영양정보 Open API', maker].filter(Boolean).join(' / '),
      raw: row,
    };
  }).filter((r) => r.baseName);
}

function cleanLabel(value) {
  const text = String(value === undefined || value === null ? '' : value).trim();
  if (!text) return '';
  if (/^(해당\s*없음|없음|미상|미정|n\/?a|null)$/i.test(text)) return '';
  return text;
}

function parseServingSize(value) {
  const text = String(value || '').trim();
  const match = text.match(/([\d.]+)/);
  return match ? toNumber(match[1]) : 100;
}

function buildSearchParams(endpoint, query) {
  if (endpoint.includes('FoodNtrCpntDbInq02') || endpoint.includes('FoodNtrCpnt')) {
    return { FOOD_NM_KR: query };
  }
  return { foodNm: query };
}

function isEncodedServiceKey(key) {
  return /%[0-9A-Fa-f]{2}/.test(key);
}

function buildApiUrl(endpoint, serviceKey, params) {
  const join = endpoint.includes('?') ? '&' : '?';
  // serviceKey 이중 인코딩 방지:
  //  - 이미 퍼센트 인코딩된 Encoding 키(%XX 포함)면 그대로 사용
  //  - RAW(Decoding) 키면 한 번만 인코딩
  // 그리고 URLSearchParams가 serviceKey를 다시 인코딩하지 못하도록 쿼리스트링에 직접 결합한다.
  const keyParam = isEncodedServiceKey(serviceKey) ? serviceKey : encodeURIComponent(serviceKey);
  const qs = new URLSearchParams(params).toString();
  return `${endpoint}${join}serviceKey=${keyParam}&${qs}`;
}

function maskServiceKey(url) {
  return String(url).replace(/serviceKey=[^&]*/i, 'serviceKey=***');
}

function per100(item) {
  const base = item.servingSize || 100;
  const factor = base === 100 ? 1 : 100 / base;
  return {
    ...item,
    servingSize: 100,
    kcal: item.kcal * factor,
    carbohydrate: item.carbohydrate * factor,
    sugars: item.sugars * factor,
    fat: item.fat * factor,
    transFat: item.transFat * factor,
    saturatedFat: item.saturatedFat * factor,
    cholesterol: item.cholesterol * factor,
    protein: item.protein * factor,
    sodium: item.sodium * factor,
  };
}

app.get('/api/health', (_req, res) => {
  const endpoint = API_ENDPOINT || DEFAULT_ENDPOINT;
  res.json({
    ok: true,
    hasServiceKey: Boolean(SERVICE_KEY),
    hasEndpoint: Boolean(API_ENDPOINT),
    endpoint,
  });
});

app.get('/api/search-ingredient', async (req, res) => {
  try {
    if (!SERVICE_KEY) {
      return res.status(500).json({ error: '서버 환경변수 DATA_GO_KR_SERVICE_KEY가 설정되지 않았습니다.' });
    }

    const query = String(req.query.q || '').trim();
    const endpoint = String(req.query.endpoint || API_ENDPOINT || DEFAULT_ENDPOINT).trim();
    const pageNo = String(req.query.pageNo || '1');
    const numOfRows = String(req.query.numOfRows || '20');
    const debug = req.query.debug !== undefined && !['0', 'false', ''].includes(String(req.query.debug));

    if (!query) return res.status(400).json({ error: '검색어 q가 필요합니다.' });

    const searchParams = buildSearchParams(endpoint, query);
    const requestUrl = buildApiUrl(endpoint, SERVICE_KEY, {
      pageNo,
      numOfRows,
      type: 'json',
      ...searchParams,
    });

    const apiRes = await fetch(requestUrl, { headers: { Accept: 'application/json,text/plain,*/*' } });
    const text = await apiRes.text();

    let payload;
    let parseError = false;
    try {
      payload = JSON.parse(text);
    } catch (_err) {
      parseError = true;
    }

    if (debug) {
      // 임시 디버그 패스스루: serviceKey는 마스킹, 정규화 없이 업스트림 원본을 그대로 반환.
      return res.status(200).json({
        debug: true,
        requestUrl: maskServiceKey(requestUrl),
        httpStatus: apiRes.status,
        contentType: apiRes.headers.get('content-type') || '',
        raw: parseError ? undefined : payload,
        rawText: parseError ? text.slice(0, 1000) : undefined,
      });
    }

    if (parseError) {
      return res.status(apiRes.status).json({
        error: 'API 응답을 JSON으로 해석할 수 없습니다.',
        status: apiRes.status,
        preview: text.slice(0, 500),
      });
    }

    const rows = normalizeRows(payload).map(per100);
    res.json({ ok: true, count: rows.length, rows, rawStatus: apiRes.status });
  } catch (error) {
    res.status(500).json({ error: 'API 조회 실패', message: error.message });
  }
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Nutrition Studio running at http://localhost:${PORT}`);
  });
}

module.exports = app;
