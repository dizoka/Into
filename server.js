const express = require('express');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const cheerio = require('cheerio');
const iconv = require('iconv-lite');

const app = express();
const PORT = process.env.PORT || 3000;
const OSVITA_BASE = 'https://vstup.osvita.ua';
const LNTU_PAGE = `${OSVITA_BASE}/r4/309/`;
const EDBO_BASE = 'https://vstup2025.edbo.gov.ua';

const ROOT_DIR = __dirname;
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const PUBLIC_INDEX = path.join(PUBLIC_DIR, 'index.html');
const ROOT_INDEX = path.join(ROOT_DIR, 'index.html');

app.use(express.json());

// Працює в обох випадках:
// 1) правильна структура: public/index.html
// 2) якщо GitHub Upload випадково закинув index.html у корінь репозиторію
if (fs.existsSync(PUBLIC_DIR)) app.use(express.static(PUBLIC_DIR));
app.use(express.static(ROOT_DIR));

function sendIndex(req, res) {
  if (fs.existsSync(PUBLIC_INDEX)) return res.sendFile(PUBLIC_INDEX);
  if (fs.existsSync(ROOT_INDEX)) return res.sendFile(ROOT_INDEX);
  return res.status(500).send(`<!doctype html><html lang="uk"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>LNTU</title><body style="font-family:Arial;padding:24px"><h1>Файл index.html не знайдено</h1><p>У репозиторії має бути <b>public/index.html</b> або <b>index.html</b> у корені.</p></body></html>`);
}

app.get('/', sendIndex);

const cache = new Map();
const TTL = 1000 * 60 * 60 * 6;

function getCached(key) {
  const item = cache.get(key);
  if (!item) return null;
  if (Date.now() - item.time > TTL) return null;
  return item.data;
}
function setCached(key, data) {
  cache.set(key, { time: Date.now(), data });
}

async function fetchHtml(url) {
  const cached = getCached(url);
  if (cached) return cached;
  const res = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: 20000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36',
      'Accept-Language': 'uk-UA,uk;q=0.9,en;q=0.8'
    }
  });
  let html;
  const contentType = String(res.headers['content-type'] || '').toLowerCase();
  if (contentType.includes('windows-1251')) html = iconv.decode(Buffer.from(res.data), 'win1251');
  else html = Buffer.from(res.data).toString('utf8');
  setCached(url, html);
  return html;
}

function norm(s) {
  return String(s || '').replace(/\s+/g, ' ').replace(/&nbsp;/g, ' ').trim();
}
function num(s) {
  if (s == null) return null;
  const m = String(s).replace(',', '.').match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
}
function firstRegex(text, patterns) {
  for (const p of patterns) {
    const m = text.match(p);
    if (m) return norm(m[1] || m[0]);
  }
  return '';
}

// Snapshot потрібен тільки якщо джерело тимчасово не відкрилось.
// Дані з сайту при нормальній роботі мають пріоритет над цим fallback.
const FALLBACK_OFFERS = [
  { id:'fallback-f5', code:'F5', speciality:'Кібербезпека та захист інформації', proposal:'Кібербезпека', educationProgram:'Кібербезпека', budgetMin:134.7, edboStats:{applied:399,admitted:368,budgetApps:161,avg:139.4,min:104.8,max:194.6,recommended:61,budgetEnrolled:18,contractEnrolled:42,minRecommended:112.8,budgetMin:134.7,contractMin:106.5}, coefficients:{ukrainian:0.3,math:0.5,history:0.2,fourth:{literature:0.2,foreign:0.3,biology:0.2,geography:0.2,physics:0.4,chemistry:0.3}}, sectorCoef:1 },
  { id:'fallback-h7', code:'H7', speciality:'Агроінженерія', proposal:'Агроінженерія', educationProgram:'Агроінженерія', budgetMin:135, coefficients:{ukrainian:0.4,math:0.3,history:0.3,fourth:{literature:0.2,foreign:0.4,biology:0.5,geography:0.2,physics:0.5,chemistry:0.5}}, sectorCoef:1.02 },
  { id:'fallback-j8', code:'J8', speciality:'Автомобільний транспорт', proposal:'Транспортно-логістичні системи автомобільних перевезень', educationProgram:'Транспортно-логістичні системи автомобільних перевезень', budgetMin:149.74, coefficients:{ukrainian:0.3,math:0.5,history:0.2,fourth:{literature:0.2,foreign:0.5,biology:0.2,geography:0.3,physics:0.4,chemistry:0.3}}, sectorCoef:1.02 },
  { id:'fallback-f3', code:'F3', speciality:'Комп’ютерні науки', proposal:'Комп’ютерні науки', educationProgram:'Комп’ютерні науки', budgetMin:null, coefficients:{ukrainian:0.3,math:0.5,history:0.2,fourth:{literature:0.2,foreign:0.3,biology:0.2,geography:0.2,physics:0.4,chemistry:0.3}}, sectorCoef:1 },
  { id:'fallback-f6', code:'F6', speciality:'Інформаційні системи і технології', proposal:'Інформаційні системи і технології', educationProgram:'Інформаційні системи і технології', budgetMin:null, coefficients:{ukrainian:0.3,math:0.5,history:0.2,fourth:{literature:0.2,foreign:0.3,biology:0.2,geography:0.2,physics:0.4,chemistry:0.3}}, sectorCoef:1 },
  { id:'fallback-d3', code:'D3', speciality:'Менеджмент', proposal:'Менеджмент', educationProgram:'Менеджмент', budgetMin:null, coefficients:{ukrainian:0.3,math:0.35,history:0.35,fourth:{literature:0.3,foreign:0.4,biology:0.2,geography:0.35,physics:0.2,chemistry:0.2}}, sectorCoef:1 },
  { id:'fallback-d5', code:'D5', speciality:'Маркетинг', proposal:'Маркетинг', educationProgram:'Маркетинг', budgetMin:null, coefficients:{ukrainian:0.3,math:0.35,history:0.35,fourth:{literature:0.3,foreign:0.4,biology:0.2,geography:0.35,physics:0.2,chemistry:0.2}}, sectorCoef:1 }
];

function extractCodeAndSpeciality(text) {
  let t = norm(text);
  const m = t.match(/\b([A-ZА-ЯІЇЄҐ]\d(?:\.\d+)?)\b\s*([^\n\r]+)/i);
  if (!m) return { code:'', speciality:t };
  let code = m[1].toUpperCase();
  let speciality = norm(m[2]).replace(/^[-–—:\s]+/, '');
  speciality = speciality.replace(/Назва пропозиції.*$/i, '').trim();
  return { code, speciality };
}

function extractBudgetMin(text) {
  const patterns = [
    /Мін\.\s*бал\s*зарахованих\s*на\s*бюджет\s*([\d.,]+)/i,
    /Мінімальний\s*бал\s*зарахованих\s*на\s*бюджет\s*([\d.,]+)/i,
    /мін\.\s*бюджет[^\d]{0,30}([\d.,]+)/i,
    /бюджет[^\d]{0,40}([\d]{3}(?:[.,]\d+)?)/i
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) return num(m[1]);
  }
  return null;
}

function extractEdboStats(text) {
  const labels = [
    ['applied', /Подано\s*заяв\s*([\d.,]+)/i],
    ['admitted', /Допущено\s*до\s*конкурсу\s*([\d.,]+)/i],
    ['budgetApps', /Заяв\s*на\s*бюджет\s*([\d.,]+)/i],
    ['avg', /Сер\.\s*бал\s*([\d.,]+)/i],
    ['min', /Мін\.\s*бал\s*([\d.,]+)/i],
    ['max', /Макс\.\s*бал\s*([\d.,]+)/i],
    ['recommended', /Рекомендовано\s*на\s*загальних\s*підставах\s*([\d.,]+)/i],
    ['budgetEnrolled', /Зараховано\s*на\s*бюджет\s*([\d.,]+)/i],
    ['contractEnrolled', /Зараховано\s*на\s*контракт\s*([\d.,]+)/i],
    ['minRecommended', /Мін\.\s*бал\s*рекомендованих\s*([\d.,]+)/i],
    ['budgetMin', /Мін\.\s*бал\s*зарахованих\s*на\s*бюджет\s*([\d.,]+)/i],
    ['contractMin', /Мін\.\s*бал\s*зарахованих\s*на\s*контракт\s*([\d.,]+)/i]
  ];
  const out = {};
  for (const [key, re] of labels) {
    const m = text.match(re);
    if (m) out[key] = num(m[1]);
  }
  return out;
}

function extractProposalText($, text) {
  const getAfter = (label) => {
    let found = '';
    $('*').each((_, el) => {
      if (found) return;
      const own = norm($(el).text());
      if (own === label || own.toLowerCase() === label.toLowerCase()) {
        const next = norm($(el).next().text());
        if (next && next !== label) found = next;
      }
    });
    return found;
  };
  const proposal = getAfter('Назва пропозиції') || firstRegex(text, [/Назва\s*пропозиції\s+(.+?)(?:Код\s*конкурсної|Освітня\s*програма|Факультет)/i]);
  const educationProgram = getAfter('Освітня програма') || firstRegex(text, [/Освітня\s*програма\s+(.+?)(?:Факультет|Форма\s*навчання)/i]);
  const faculty = getAfter('Факультет') || firstRegex(text, [/Факультет\s+(.+?)(?:Форма\s*навчання|Курс\s*зарахування)/i]);
  return { proposal: norm(proposal), educationProgram: norm(educationProgram), faculty: norm(faculty) };
}

const subjectMap = [
  ['ukrainian', ['Українська мова']],
  ['math', ['Математика']],
  ['history', ['Історія України']],
  ['literature', ['Українська література']],
  ['foreign', ['Іноземна мова']],
  ['biology', ['Біологія']],
  ['geography', ['Географія']],
  ['physics', ['Фізика']],
  ['chemistry', ['Хімія']]
];

function subjectKey(name) {
  const n = norm(name).toLowerCase();
  for (const [key, aliases] of subjectMap) {
    if (aliases.some(a => n.includes(a.toLowerCase()))) return key;
  }
  return null;
}

function extractCoefficients($, text) {
  const coeffs = { fourth: {} };
  let found = false;

  // Most stable parser: search text rows that contain subject and coefficient nearby.
  const full = text.replace(/\s+/g, ' ');
  for (const [key, aliases] of subjectMap) {
    for (const alias of aliases) {
      const re = new RegExp(alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[^\d]{0,80}(0[,.]\d+)', 'i');
      const m = full.match(re);
      if (m) {
        const v = num(m[1]);
        if (['literature','foreign','biology','geography','physics','chemistry'].includes(key)) coeffs.fourth[key] = v;
        else coeffs[key] = v;
        found = true;
      }
    }
  }

  // Alternate parser: visible colored coefficient chips on EDBO-like blocks.
  $('tr, li, div').each((_, el) => {
    const row = norm($(el).text());
    const k = subjectKey(row);
    if (!k) return;
    const m = row.match(/\b(0[,.]\d+)\b/);
    if (!m) return;
    const v = num(m[1]);
    if (['literature','foreign','biology','geography','physics','chemistry'].includes(k)) coeffs.fourth[k] = v;
    else coeffs[k] = v;
    found = true;
  });

  if (!found) return null;
  return coeffs;
}

function extractSectorCoef(text) {
  if (/Галузевий\s*коефіцієнт[^\d]{0,30}1[,.]02/i.test(text)) return 1.02;
  if (/×\s*1[,.]02/i.test(text) || /x\s*1[,.]02/i.test(text)) return 1.02;
  return 1;
}

async function parseOffer(urlOrId) {
  const url = /^https?:/.test(urlOrId) ? urlOrId : `${OSVITA_BASE}/r4/309/${urlOrId}/`;
  const cached = getCached('offer:' + url);
  if (cached) return cached;

  const html = await fetchHtml(url);
  const $ = cheerio.load(html);
  const text = norm($.text());
  const title = norm($('h1').first().text() || $('title').text());
  const cs = extractCodeAndSpeciality(title + ' ' + text.slice(0, 600));
  const meta = extractProposalText($, text);
  const coefficients = extractCoefficients($, text);
  const budgetMin = extractBudgetMin(text);
  const edboStats = extractEdboStats(text);
  const codeMatch = text.match(/Код\s*конкурсної\s*пропозиції\s*(\d+)/i) || url.match(/\/(\d+)\/?$/);
  const offerCode = codeMatch ? codeMatch[1] : '';

  let offer = {
    id: offerCode || url,
    url,
    code: cs.code,
    speciality: cs.speciality,
    proposal: meta.proposal || meta.educationProgram || cs.speciality,
    educationProgram: meta.educationProgram || meta.proposal || cs.speciality,
    faculty: meta.faculty,
    budgetMin: edboStats.budgetMin || budgetMin || null,
    edboStats,
    coefficients,
    sectorCoef: extractSectorCoef(text),
    source: 'osvita'
  };

  setCached('offer:' + url, offer);
  return offer;
}

async function loadOffersFromOsvita() {
  const cached = getCached('offers');
  if (cached) return cached;
  try {
    const html = await fetchHtml(LNTU_PAGE);
    const $ = cheerio.load(html);
    const links = [];
    $('a[href]').each((_, a) => {
      const href = $(a).attr('href');
      const text = norm($(a).text());
      if (!href) return;
      const abs = href.startsWith('http') ? href : OSVITA_BASE + href;
      if (/\/r4\/309\/\d+\/?/.test(abs) || /\/y2025\/r4\/309\/\d+\/?/.test(abs)) {
        links.push({ url: abs, text });
      }
    });
    const unique = Array.from(new Map(links.map(l => [l.url, l])).values()).slice(0, 120);
    const quick = unique.map((l, idx) => {
      const cs = extractCodeAndSpeciality(l.text);
      return {
        id: l.url.match(/\/(\d+)\/?$/)?.[1] || String(idx),
        url: l.url,
        code: cs.code,
        speciality: cs.speciality || l.text,
        proposal: '',
        educationProgram: '',
        budgetMin: null,
        source: 'osvita-list'
      };
    }).filter(o => o.code || o.speciality);

    // Add fallback and de-duplicate by id/url so site is never empty.
    const byKey = new Map();
    [...quick, ...FALLBACK_OFFERS].forEach(o => byKey.set(o.id || o.url, o));
    const offers = Array.from(byKey.values());
    setCached('offers', offers);
    return offers;
  } catch (e) {
    return FALLBACK_OFFERS;
  }
}

app.get('/api/offers', async (req, res) => {
  try {
    const offers = await loadOffersFromOsvita();
    res.json({ ok: true, updatedAt: new Date().toISOString(), offers });
  } catch (e) {
    res.json({ ok: false, error: e.message, offers: FALLBACK_OFFERS });
  }
});

app.get('/api/offer/:id', async (req, res) => {
  try {
    const offers = await loadOffersFromOsvita();
    const item = offers.find(o => String(o.id) === String(req.params.id)) || FALLBACK_OFFERS.find(o => String(o.id) === String(req.params.id));
    if (!item) return res.status(404).json({ ok:false, error:'Offer not found' });
    if (String(item.id).startsWith('fallback') || !item.url) return res.json({ ok:true, offer:item });
    const full = await parseOffer(item.url);
    res.json({ ok:true, offer:{ ...item, ...full } });
  } catch (e) {
    res.status(500).json({ ok:false, error:e.message });
  }
});

app.post('/api/refresh', async (req, res) => {
  cache.clear();
  const offers = await loadOffersFromOsvita();
  res.json({ ok:true, count:offers.length });
});

// Щоб пряме відкриття будь-якої сторінки не давало Not Found.
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  return sendIndex(req, res);
});

app.listen(PORT, () => {
  console.log(`LNTU Osvita calculator running on port ${PORT}`);
  console.log('Index exists:', { publicIndex: fs.existsSync(PUBLIC_INDEX), rootIndex: fs.existsSync(ROOT_INDEX) });
});
