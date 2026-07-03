const express = require('express');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const cheerio = require('cheerio');
const iconv = require('iconv-lite');

const app = express();
const PORT = process.env.PORT || 3000;
const OSVITA_BASE = 'https://vstup.osvita.ua';
const LNTU_PAGES = [
  `${OSVITA_BASE}/r4/309/`,
  `${OSVITA_BASE}/y2026/r4/309/`,
  `${OSVITA_BASE}/y2025/r4/309/`
];

const ROOT_DIR = __dirname;
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const PUBLIC_INDEX = path.join(PUBLIC_DIR, 'index.html');
const ROOT_INDEX = path.join(ROOT_DIR, 'index.html');

app.use(express.json());
if (fs.existsSync(PUBLIC_DIR)) app.use(express.static(PUBLIC_DIR));
app.use(express.static(ROOT_DIR));

function sendIndex(req, res) {
  if (fs.existsSync(PUBLIC_INDEX)) return res.sendFile(PUBLIC_INDEX);
  if (fs.existsSync(ROOT_INDEX)) return res.sendFile(ROOT_INDEX);
  return res.status(500).send('index.html not found');
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
function setCached(key, data) { cache.set(key, { time: Date.now(), data }); }

async function fetchHtml(url) {
  const cached = getCached('html:' + url);
  if (cached) return cached;
  const res = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: 25000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36',
      'Accept-Language': 'uk-UA,uk;q=0.9,en;q=0.8'
    }
  });
  const ct = String(res.headers['content-type'] || '').toLowerCase();
  const buf = Buffer.from(res.data);
  const html = ct.includes('windows-1251') || ct.includes('cp1251') ? iconv.decode(buf, 'win1251') : buf.toString('utf8');
  setCached('html:' + url, html);
  return html;
}

function norm(s) { return String(s || '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim(); }
function lines(raw) { return String(raw || '').split(/\r?\n/).map(norm).filter(Boolean); }
function num(s) {
  if (s == null) return null;
  const m = String(s).replace(',', '.').match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
}
function escRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

const FALLBACK_OFFERS = [
  {
    id: '1564251', year: 2025, url: 'https://vstup.osvita.ua/y2025/r4/309/1564251/', previousYearUrl: 'https://vstup.osvita.ua/y2025/r4/309/1564251/',
    code: 'J8', speciality: 'Автомобільний транспорт', proposal: 'Транспортно-логістичні системи автомобільних перевезень', educationProgram: 'Транспортно-логістичні системи автомобільних перевезень', form: 'Денна',
    budgetMin: 146.81, statsYear: 2025, budgetSource: 'Освіта.UA 2025 / ЄДЕБО',
    edboStats: { applied: 271, avg: 134.95, budgetEnrolled: 17, contractEnrolled: 39, budgetMin: 146.81 },
    coefficients: { ukrainian: 0.30, math: 0.50, history: 0.20, fourth: { literature: 0.20, foreign: 0.50, biology: 0.20, geography: 0.20, physics: 0.40, chemistry: 0.30 } }, sectorCoef: 1.02
  },
  {
    id: 'fallback-f3', year: 2025, code: 'F3', speciality: 'Комп’ютерні науки', proposal: 'Комп’ютерні науки', educationProgram: 'Комп’ютерні науки', form: 'Денна',
    budgetMin: 133.60, statsYear: 2025, budgetSource: 'Освіта.UA 2025 / ЄДЕБО',
    edboStats: { applied: 380, admitted: 360, budgetApps: 187, avg: 140.8, min: 105.9, max: 176.9, recommended: 38, budgetEnrolled: 14, contractEnrolled: 33, minRecommended: 117.3, budgetMin: 133.6, contractMin: 107.2 },
    coefficients: { ukrainian: 0.30, math: 0.50, history: 0.20, fourth: { literature: 0.20, foreign: 0.30, biology: 0.20, geography: 0.20, physics: 0.40, chemistry: 0.30 } }, sectorCoef: 1
  },
  {
    id: 'fallback-f5', year: 2025, code: 'F5', speciality: 'Кібербезпека та захист інформації', proposal: 'Кібербезпека', educationProgram: 'Кібербезпека', form: 'Денна',
    budgetMin: 134.7, statsYear: 2025, budgetSource: 'Освіта.UA 2025 / ЄДЕБО',
    edboStats: { applied: 399, admitted: 368, budgetApps: 161, avg: 139.4, min: 104.8, max: 194.6, recommended: 61, budgetEnrolled: 18, contractEnrolled: 42, minRecommended: 112.8, budgetMin: 134.7, contractMin: 106.5 },
    coefficients: { ukrainian: 0.30, math: 0.50, history: 0.20, fourth: { literature: 0.20, foreign: 0.30, biology: 0.20, geography: 0.20, physics: 0.40, chemistry: 0.30 } }, sectorCoef: 1
  },
  {
    id: 'fallback-h7', year: 2025, code: 'H7', speciality: 'Агроінженерія', proposal: 'Агроінженерія', educationProgram: 'Агроінженерія', form: 'Денна', budgetMin: 135.0,
    coefficients: { ukrainian: 0.40, math: 0.30, history: 0.30, fourth: { literature: 0.20, foreign: 0.40, biology: 0.50, geography: 0.20, physics: 0.50, chemistry: 0.50 } }, sectorCoef: 1.02
  }
];

function firstLineAfter(raw, label) {
  const arr = lines(raw);
  const l = label.toLowerCase();
  for (let i = 0; i < arr.length; i++) {
    const row = arr[i].replace(/:$/, '').toLowerCase();
    if (row === l || row.startsWith(l + ':')) {
      const same = arr[i].split(':').slice(1).join(':').trim();
      if (same) return norm(same);
      return norm(arr[i + 1] || '');
    }
  }
  const re = new RegExp(escRe(label) + '\\s*:?\\s*([^\\n\\r]+)', 'i');
  const m = String(raw).match(re);
  return m ? norm(m[1]) : '';
}

function extractCodeAndSpeciality(raw) {
  const text = String(raw || '');
  let m = text.match(/Спеціальність:\s*([A-ZА-ЯІЇЄҐ]\d(?:\.\d+)?)\.\s*([^\n\r]+)/i);
  if (m) return { code: m[1].toUpperCase(), speciality: norm(m[2]) };
  m = text.match(/\b([A-ZА-ЯІЇЄҐ]\d(?:\.\d+)?)\b\s+([^\n\r]+)/i);
  return m ? { code: m[1].toUpperCase(), speciality: norm(m[2]) } : { code: '', speciality: '' };
}

function extractMeta(raw) {
  return {
    proposal: firstLineAfter(raw, 'Назва пропозиції') || firstLineAfter(raw, 'Освітня програма'),
    educationProgram: firstLineAfter(raw, 'Освітня програма') || firstLineAfter(raw, 'Назва пропозиції'),
    faculty: firstLineAfter(raw, 'Факультет'),
    form: firstLineAfter(raw, 'Форма навчання'),
    degree: firstLineAfter(raw, 'Ступінь навчання'),
    educationBase: firstLineAfter(raw, 'На базі'),
    term: firstLineAfter(raw, 'Термін навчання'),
    maxStateOrder: num(firstLineAfter(raw, 'Максимальне держзамовлення')) || num(firstLineAfter(raw, 'Макс. обсяг держзамовлення'))
  };
}

function extractCoefficients(raw) {
  const out = { fourth: {} };
  const subjects = [
    ['ukrainian', 'Українська мова'], ['math', 'Математика'], ['history', 'Історія України'],
    ['literature', 'Українська література'], ['foreign', 'Іноземна мова'], ['biology', 'Біологія'],
    ['geography', 'Географія'], ['physics', 'Фізика'], ['chemistry', 'Хімія']
  ];
  for (const [key, name] of subjects) {
    const re = new RegExp(escRe(name) + '[\\s\\S]{0,180}?k\\s*=\\s*(0[,.]\\d+)', 'i');
    const m = String(raw).match(re);
    if (!m) continue;
    const v = num(m[1]);
    if (['literature', 'foreign', 'biology', 'geography', 'physics', 'chemistry'].includes(key)) out.fourth[key] = v;
    else out[key] = v;
  }
  return out.ukrainian != null && out.math != null && out.history != null && Object.keys(out.fourth).length ? out : null;
}

function extractStats(raw) {
  const text = String(raw || '').replace(/\u00a0/g, ' ');
  const pairs = [
    ['applied', ['Всього поданих заяв', 'Подано заяв']],
    ['admitted', ['Допущено до конкурсу']],
    ['budgetApps', ['Заяв на бюджет']],
    ['avg', ['Загальний середній рейтинговий бал всіх заяв', 'Сер. бал']],
    ['min', ['Мін. бал']],
    ['max', ['Макс. бал']],
    ['recommended', ['Рекомендовано на загальних підставах']],
    ['budgetEnrolled', ['Зараховано на бюджет всього', 'Зараховано на бюджет']],
    ['contractEnrolled', ['Зараховано на контракт всього', 'Зараховано на контракт']],
    ['minRecommended', ['Мін. бал рекомендованих']],
    ['budgetMin', ['Мінімальний рейтинговий бал серед зарахованих на бюджет', 'Мін. бал зарахованих на бюджет']],
    ['contractMin', ['Мін. бал зарахованих на контракт']]
  ];
  const out = {};
  for (const [key, labels] of pairs) {
    for (const label of labels) {
      const a = new RegExp(escRe(label) + '\\s*:?\\s*([0-9]+(?:[,.][0-9]+)?)', 'i').exec(text);
      const b = new RegExp('([0-9]+(?:[,.][0-9]+)?)\\s+' + escRe(label), 'i').exec(text);
      const m = a || b;
      if (m) { out[key] = num(m[1]); break; }
    }
  }
  return out;
}

function extractSectorCoef(raw) {
  const text = String(raw || '');
  if (/Галузевий\s*коефіцієнт[\s\S]{0,80}(1[,.]02|×\s*1[,.]02|x\s*1[,.]02)/i.test(text)) return 1.02;
  // In rating list ГК means the sector coefficient exists, but 2026 pages may not show a separate row.
  if (/\bГК\b/.test(text) && /особливою\s+підтримкою|Галузевий\s*коефіцієнт/i.test(text)) return 1.02;
  return 1;
}

function isBachelorPzso(meta, raw) {
  const t = norm((meta.degree || '') + ' ' + (meta.educationBase || '') + ' ' + raw).toLowerCase();
  return t.includes('бакалавр') && (t.includes('повна загальна середня освіта') || t.includes('пзсо'));
}

function findYearLink($, year) {
  let found = '';
  $(`a[href*="/y${year}/r4/309/"]`).each((_, a) => {
    const href = $(a).attr('href') || '';
    if (!found && /\/y\d{4}\/r4\/309\/\d+\/?/.test(href)) found = href.startsWith('http') ? href : OSVITA_BASE + href;
  });
  return found;
}

async function parseOffer(urlOrId, options = {}) {
  const url = /^https?:/.test(urlOrId) ? urlOrId : `${OSVITA_BASE}/r4/309/${urlOrId}/`;
  const ck = 'offer:' + url + ':' + (options.noPrev ? 'noprev' : 'prev');
  const cached = getCached(ck); if (cached) return cached;
  const html = await fetchHtml(url);
  const $ = cheerio.load(html);
  const raw = $('body').text() || $.text();
  const clean = norm(raw);
  const cs = extractCodeAndSpeciality(raw);
  const meta = extractMeta(raw);
  const coeffs = extractCoefficients(raw);
  let stats = extractStats(raw);
  let statsYear = /\/y(\d{4})\//.test(url) ? Number(url.match(/\/y(\d{4})\//)[1]) : (/Дані отримані з ЄДЕБО\s+\d{2}\.\d{2}\.2026/.test(clean) ? 2026 : null);
  let budgetMin = stats.budgetMin ?? null;
  let previousYearUrl = findYearLink($, 2025);

  if (!options.noPrev && !budgetMin && previousYearUrl && previousYearUrl !== url) {
    try {
      const prev = await parseOffer(previousYearUrl, { noPrev: true });
      if (prev?.edboStats && Object.keys(prev.edboStats).length) {
        stats = { ...prev.edboStats, currentYearApplied: stats.applied };
        statsYear = 2025;
        budgetMin = prev.edboStats.budgetMin ?? prev.budgetMin ?? null;
      }
    } catch (e) {}
  }

  const id = (url.match(/\/(\d+)\/?$/) || [])[1] || firstLineAfter(raw, 'Код конкурсної пропозиції') || url;
  const offer = {
    id, url, previousYearUrl,
    year: /\/y(\d{4})\//.test(url) ? Number(url.match(/\/y(\d{4})\//)[1]) : 2026,
    code: cs.code,
    speciality: cs.speciality,
    proposal: meta.proposal || meta.educationProgram || cs.speciality,
    educationProgram: meta.educationProgram || meta.proposal || cs.speciality,
    faculty: meta.faculty,
    form: meta.form,
    term: meta.term,
    degree: meta.degree,
    educationBase: meta.educationBase,
    maxStateOrder: meta.maxStateOrder,
    budgetMin,
    budgetSource: budgetMin ? `Освіта.UA / ЄДЕБО ${statsYear || ''}`.trim() : '',
    statsYear,
    edboStats: stats,
    coefficients: coeffs,
    sectorCoef: extractSectorCoef(raw),
    source: 'osvita'
  };
  setCached(ck, offer);
  return offer;
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length); let idx = 0;
  async function worker() {
    while (idx < items.length) {
      const i = idx++;
      try { out[i] = await fn(items[i], i); } catch (e) { out[i] = null; }
    }
  }
  await Promise.all(Array.from({ length: limit }, worker));
  return out.filter(Boolean);
}

async function loadOffersFromOsvita() {
  const cached = getCached('offers'); if (cached) return cached;
  const urls = new Map();
  for (const page of LNTU_PAGES) {
    try {
      const html = await fetchHtml(page);
      const $ = cheerio.load(html);
      $('a[href]').each((_, a) => {
        const href = $(a).attr('href') || '';
        const abs = href.startsWith('http') ? href : OSVITA_BASE + href;
        if (/\/y?\d{0,4}\/?r4\/309\/\d+\/?/.test(abs) || /\/r4\/309\/\d+\/?/.test(abs)) {
          const m = abs.match(/\/((?:y\d{4}\/)?r4\/309\/\d+)\/?/);
          if (m) urls.set(abs, abs);
        }
      });
    } catch (e) {}
  }

  let offerUrls = Array.from(urls.values()).filter(u => /\/r4\/309\/\d+\/?/.test(u));
  // Prefer 2026/current pages. Keep 2025 fallback if no current equivalent exists.
  offerUrls.sort((a, b) => (b.includes('/y2026/') || !b.includes('/y2025/') ? 1 : 0) - (a.includes('/y2026/') || !a.includes('/y2025/') ? 1 : 0));
  offerUrls = offerUrls.slice(0, 140);

  let parsed = await mapLimit(offerUrls, 6, (u) => parseOffer(u));
  parsed = parsed.filter(o => o && isBachelorPzso(o, `${o.degree} ${o.educationBase}`) && o.code && o.proposal);

  const byExact = new Map();
  for (const o of [...parsed, ...FALLBACK_OFFERS]) {
    const key = [o.year || '', o.code || '', o.speciality || '', o.proposal || '', o.form || '', o.id || ''].join('|').toLowerCase();
    if (!byExact.has(key)) byExact.set(key, o);
  }
  let offers = Array.from(byExact.values());
  offers.sort((a, b) => `${a.code} ${a.speciality} ${a.proposal}`.localeCompare(`${b.code} ${b.speciality} ${b.proposal}`, 'uk'));
  setCached('offers', offers);
  return offers;
}

app.get('/api/offers', async (req, res) => {
  try { res.json({ ok: true, updatedAt: new Date().toISOString(), offers: await loadOffersFromOsvita() }); }
  catch (e) { res.json({ ok: false, error: e.message, offers: FALLBACK_OFFERS }); }
});
app.get('/api/offer/:id', async (req, res) => {
  try {
    const offers = await loadOffersFromOsvita();
    const item = offers.find(o => String(o.id) === String(req.params.id)) || FALLBACK_OFFERS.find(o => String(o.id) === String(req.params.id));
    if (!item) return res.status(404).json({ ok: false, error: 'Offer not found' });
    if (!item.url || String(item.id).startsWith('fallback')) return res.json({ ok: true, offer: item });
    const full = await parseOffer(item.url);
    res.json({ ok: true, offer: { ...item, ...full } });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});
app.post('/api/refresh', async (req, res) => { cache.clear(); const offers = await loadOffersFromOsvita(); res.json({ ok: true, count: offers.length }); });
app.get('*', (req, res, next) => { if (req.path.startsWith('/api/')) return next(); return sendIndex(req, res); });
app.listen(PORT, () => console.log(`LNTU calculator running on ${PORT}`));
