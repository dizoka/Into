const express = require('express');
const path = require('path');
const axios = require('axios');
const cheerio = require('cheerio');

const app = express();
const PORT = process.env.PORT || 3000;
const BASE = 'https://vstup.osvita.ua';
const LIST_URL = `${BASE}/r4/309/`;
const CACHE_TTL = 1000 * 60 * 30;
let cache = { at: 0, data: null, error: null };

const http = axios.create({
  timeout: 18000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'uk-UA,uk;q=0.9,en;q=0.7',
    'Cache-Control': 'no-cache'
  }
});

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(__dirname));

app.get('/', (req, res) => {
  const p1 = path.join(__dirname, 'public', 'index.html');
  const p2 = path.join(__dirname, 'index.html');
  res.sendFile(require('fs').existsSync(p1) ? p1 : p2);
});

app.get('/api/health', (_, res) => res.json({ ok: true, time: new Date().toISOString() }));

app.get('/api/offers', async (req, res) => {
  const refresh = req.query.refresh === '1';
  if (!refresh && cache.data && Date.now() - cache.at < CACHE_TTL) return res.json(cache.data);
  try {
    const data = await loadOffers();
    cache = { at: Date.now(), data, error: null };
    res.json(data);
  } catch (e) {
    const data = fallbackData(`Помилка live-завантаження: ${e.message}`);
    cache = { at: Date.now(), data, error: e.message };
    res.json(data);
  }
});

function absUrl(href) {
  if (!href) return null;
  if (href.startsWith('http')) return href;
  if (href.startsWith('/')) return BASE + href;
  return BASE + '/' + href.replace(/^\/+/, '');
}

async function fetchHtml(url) {
  const r = await http.get(url);
  return String(r.data || '');
}

function clean(s) { return String(s || '').replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').trim(); }
function toNum(s) {
  if (s == null) return null;
  const m = String(s).replace(',', '.').match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
}
function linesFromHtml(html) {
  const $ = cheerio.load(html);
  $('script,style,noscript').remove();
  return $('body').text().replace(/\r/g, '\n').split(/\n+/).map(clean).filter(Boolean);
}
function flatFromHtml(html) { return linesFromHtml(html).join('\n'); }
function field(lines, label) {
  const i = lines.findIndex(x => x.toLowerCase().startsWith(label.toLowerCase()));
  if (i < 0) return '';
  const current = lines[i].replace(new RegExp('^' + escapeRegex(label) + '\\s*:?\\s*', 'i'), '').trim();
  if (current) return current;
  return lines[i + 1] || '';
}
function escapeRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function extractCodeAndName(specialityRaw, h1Text='') {
  const src = `${specialityRaw} ${h1Text}`;
  const m = src.match(/\b([A-ZА-ЯІЇЄ]\d(?:\.\d+)?)\s+([^\n.]+(?:[^\n]*?))(?:\.|$)/u);
  if (m) return { code: clean(m[1]), specialty: clean(m[2]) };
  return { code: '', specialty: clean(specialityRaw).replace(/^Спеціальність:\s*/i, '') };
}

async function loadOffers() {
  const listHtml = await fetchHtml(LIST_URL);
  const urls = extractOfferUrls(listHtml);
  if (urls.length < 10) throw new Error(`знайдено лише ${urls.length} посилань на пропозиції`);

  const offers = [];
  const concurrency = 5;
  let idx = 0;
  async function worker() {
    while (idx < urls.length) {
      const url = urls[idx++];
      try {
        const html = await fetchHtml(url);
        const offer = await parseOfferPage(html, url);
        if (offer && isBachelorPzso(offer) && !isContractOnly(offer)) offers.push(offer);
      } catch (_) {}
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));

  const unique = dedupeOffers(offers);
  unique.sort(sortOffers);
  if (unique.length < 10) throw new Error(`після фільтрації лишилось ${unique.length} пропозицій`);
  return { source: 'live-osvita', fetchedAt: new Date().toISOString(), count: unique.length, offers: unique };
}

function extractOfferUrls(html) {
  const found = new Set();
  const $ = cheerio.load(html);
  $('a[href]').each((_, a) => {
    const href = $(a).attr('href') || '';
    const url = absUrl(href);
    if (/\/r4\/309\/\d+\/?/.test(url) || /\/y2026\/r4\/309\/\d+\/?/.test(url)) found.add(url.replace(/#.*$/, '').replace(/\?.*$/, ''));
  });
  const re = /href=["']([^"']*(?:\/r4\/309\/|\/y2026\/r4\/309\/)\d+\/?[^"']*)["']/g;
  let m;
  while ((m = re.exec(html))) found.add(absUrl(m[1]).replace(/#.*$/, '').replace(/\?.*$/, ''));
  return [...found];
}

async function parseOfferPage(html, url) {
  const $ = cheerio.load(html);
  const lines = linesFromHtml(html);
  const flat = lines.join('\n');
  const h1 = clean($('h1').first().text() || '');

  const degree = field(lines, 'Ступінь навчання');
  const base = field(lines, 'На базі');
  const rawSpec = field(lines, 'Спеціальність') || h1;
  const { code, specialty } = extractCodeAndName(rawSpec, h1);
  const program = field(lines, 'Освітня програма') || (h1.match(/Освітня програма:\s*([^\n.]+)/i)?.[1] || '');
  const faculty = field(lines, 'Факультет');
  const form = field(lines, 'Форма навчання');
  const offerType = field(lines, 'Тип пропозиції');
  const enrollment = field(lines, 'Зарахування');
  const term = field(lines, 'Термін навчання');
  const applicationTerm = field(lines, 'Термін подачі заяв');
  const license = toNum(field(lines, 'Ліцензійний обсяг') || field(lines, 'Ліцензований обсяг прийому'));
  const contract = toNum(field(lines, 'Обсяг на контракт'));
  const minState = toNum(field(lines, 'Мінімальний обсяг держ замовлення'));
  const maxState = toNum(field(lines, 'Максимальний обсяг держ замовлення'));
  const regionalCoef = toNum(field(lines, 'Регіональний коефіцієнт')) || 1;
  const id = (url.match(/\/(\d+)\/?$/) || [])[1] || '';
  const y2025Url = findYearUrl($, 2025, url);
  const coeffs = parseCoefficients(flat, code);
  const industryCoef = detectIndustryCoef(flat, code);

  let stats = parseStats(flat);
  let statsSource = url;
  let legacyUrl = y2025Url;
  if ((!stats.minBudget || stats.minBudget === null) && y2025Url) {
    try {
      const oldHtml = await fetchHtml(y2025Url);
      const oldFlat = flatFromHtml(oldHtml);
      const oldStats = parseStats(oldFlat);
      stats = { ...oldStats, currentPageStats: stats };
      statsSource = y2025Url;
      const oldCoeffs = parseCoefficients(oldFlat, code);
      mergeMissingCoefficients(coeffs, oldCoeffs);
    } catch (_) {}
  }

  return {
    id, url, legacyUrl, statsSource,
    degree, base, code, specialty, program: clean(program), faculty, form, offerType, enrollment, term, applicationTerm,
    license, contract, minState, maxState, regionalCoef,
    industryCoef,
    coeffs,
    stats
  };
}

function isBachelorPzso(o) {
  const all = `${o.degree} ${o.base} ${o.url}`.toLowerCase();
  return all.includes('бакалавр') && (all.includes('повна загальна середня освіта') || all.includes('pzso') || all.includes('/r4/'));
}
function isContractOnly(o) { return /небюджетна/i.test(o.offerType || ''); }
function dedupeOffers(arr) {
  const map = new Map();
  for (const o of arr) {
    const key = o.id || `${o.code}|${o.program}|${o.form}|${o.term}`;
    if (!map.has(key)) map.set(key, o);
  }
  return [...map.values()];
}
function sortOffers(a,b) {
  return (a.code || '').localeCompare(b.code || '', 'uk') || (a.specialty || '').localeCompare(b.specialty || '', 'uk') || (a.program || '').localeCompare(b.program || '', 'uk') || (a.form || '').localeCompare(b.form || '', 'uk');
}
function findYearUrl($, year, currentUrl) {
  let out = '';
  $(`a[href*="/y${year}/r4/309/"]`).each((_, a) => { if (!out) out = absUrl($(a).attr('href')); });
  if (out) return out.replace(/#.*$/, '').replace(/\?.*$/, '');
  const id = (currentUrl.match(/\/(\d+)\/?$/) || [])[1];
  return id ? `${BASE}/y${year}/r4/309/${id}/` : '';
}

const SUBJECTS = {
  ua: ['Українська мова'],
  math: ['Математика'],
  history: ['Історія України'],
  literature: ['Українська література'],
  foreign: ['Іноземна мова'],
  biology: ['Біологія'],
  geography: ['Географія'],
  physics: ['Фізика'],
  chemistry: ['Хімія']
};
function parseCoefficients(flat, code) {
  const res = defaultCoefficients(code);
  for (const [key, names] of Object.entries(SUBJECTS)) {
    for (const name of names) {
      const re = new RegExp(escapeRegex(name) + '[\\s\\S]{0,180}?k\\s*=\\s*([0-9]+(?:[.,][0-9]+)?)', 'iu');
      const m = flat.match(re);
      if (m) { res[key] = Number(m[1].replace(',', '.')); break; }
    }
  }
  res.k4max = Math.max(res.literature || 0, res.foreign || 0, res.biology || 0, res.geography || 0, res.physics || 0, res.chemistry || 0);
  return res;
}
function mergeMissingCoefficients(base, old) {
  for (const k of Object.keys(old)) if ((base[k] == null || base[k] === 0) && old[k] != null) base[k] = old[k];
  base.k4max = Math.max(base.literature || 0, base.foreign || 0, base.biology || 0, base.geography || 0, base.physics || 0, base.chemistry || 0);
}
function defaultCoefficients(code='') {
  const c = String(code).toUpperCase();
  if (c.startsWith('H7')) return { ua:.40, math:.30, history:.30, literature:.30, foreign:.40, biology:.50, geography:.40, physics:.50, chemistry:.50, k4max:.50 };
  if (c.startsWith('J8') || c.startsWith('J') || c.startsWith('G')) return { ua:.30, math:.50, history:.20, literature:.20, foreign:.50, biology:.20, geography:.20, physics:.40, chemistry:.30, k4max:.50 };
  if (c.startsWith('F')) return { ua:.30, math:.50, history:.20, literature:.20, foreign:.30, biology:.20, geography:.20, physics:.40, chemistry:.30, k4max:.40 };
  if (c.startsWith('D')) return { ua:.35, math:.30, history:.25, literature:.30, foreign:.35, biology:.25, geography:.30, physics:.25, chemistry:.25, k4max:.35 };
  if (c.startsWith('A')) return { ua:.35, math:.30, history:.25, literature:.30, foreign:.35, biology:.30, geography:.30, physics:.30, chemistry:.30, k4max:.35 };
  return { ua:.30, math:.30, history:.30, literature:.30, foreign:.30, biology:.30, geography:.30, physics:.30, chemistry:.30, k4max:.30 };
}
function detectIndustryCoef(flat, code='') {
  if (/Галузевий коефіцієнт\s*[:\n ]*1[,.]02/i.test(flat)) return 1.02;
  const c = String(code).toUpperCase();
  if (/^(H7|H|J8|J|G|A|E)/.test(c) && !/^F/.test(c)) return 1.02;
  return 1;
}
function parseStats(flat) {
  const get = (label) => {
    const re = new RegExp(escapeRegex(label) + '\\s*[:]?\\s*([0-9]+(?:[.,][0-9]+)?)', 'iu');
    const m = flat.match(re); return m ? Number(m[1].replace(',', '.')) : null;
  };
  let minBudget = get('Мінімальний рейтинговий бал серед зарахованих на бюджет');
  if (minBudget == null) minBudget = get('Мін. бал зарахованих на бюджет');
  if (minBudget == null) minBudget = get('Мінімальний бал зарахованих на бюджет');
  return {
    submitted: get('Всього поданих заяв') ?? get('Подано заяв'),
    admittedCompetition: get('Допущено до конкурсу'),
    budgetApplications: get('Заяв на бюджет'),
    avg: get('Середній рейтинговий бал всіх зарахованих') ?? get('Сер. бал'),
    min: get('Мін. бал'),
    max: get('Макс. бал'),
    recommendedGeneral: get('Рекомендовано на загальних підставах'),
    enrolledBudget: get('Зараховано на бюджет всього') ?? get('Зараховано на бюджет'),
    enrolledContract: get('Зараховано на контракт всього') ?? get('Зараховано на контракт'),
    minRecommended: get('Мін. бал рекомендованих'),
    minBudget,
    minContract: get('Мін. бал зарахованих на контракт') ?? get('Мінімальний рейтинговий бал серед зарахованих на контракт'),
    maxState: get('Максимальний обсяг державного замовлення')
  };
}

function fallbackData(reason) {
  const base = [
    ['F3','Комп’ютерні науки','Комп’ютерні науки','Денна','1503','',145.0,1],
    ['F5','Кібербезпека та захист інформації','Кібербезпека','Денна','1391','',134.7,1],
    ['F6','Інформаційні системи і технології','Інформаційні системи та технології охорони і безпеки','Денна','1335','',null,1],
    ['F7','Комп’ютерна інженерія','Комп’ютерна інженерія','Денна','1447','',null,1],
    ['D5','Маркетинг','Цифровий маркетинг','Денна','1792','',null,1],
    ['D7','Торгівля','Митна справа та торгівля','Денна','2993','',null,1],
    ['G8','Матеріалознавство','Матеріалознавство','Денна','1845','',null,1.02],
    ['G8','Матеріалознавство','Індустріальний інжиніринг','Денна','1903','',null,1.02],
    ['G11','Машинобудування','Галузеве машинобудування','Денна','1961','Технологічні машини та обладнання',null,1.02],
    ['G9','Прикладна механіка','Прикладна механіка','Денна','8040','',null,1.02],
    ['G9','Прикладна механіка','Металообробне обладнання та роботизовані виробничі системи','Денна','8098','',null,1.02],
    ['H4','Лісове господарство','Лісове господарство','Денна','7252','',null,1.02],
    ['H7','Агроінженерія','Агроінженерія','Денна','1449469','',135.0,1.02],
    ['J3','Туризм та рекреація','Туризм','Денна','3101','',null,1.02],
    ['J8','Автомобільний транспорт','Транспортно-логістичні системи автомобільних перевезень','Денна','1564251','',146.81,1.02],
    ['J8','Автомобільний транспорт','Транспортно-логістичні системи автомобільних перевезень','Заочна','1564251z','',null,1.02],
    ['J8','Автомобільний транспорт','Інфраструктура та експлуатація автомобільного транспорту','Денна','j8-infra-d','',null,1.02],
    ['J8','Автомобільний транспорт','Інфраструктура та експлуатація автомобільного транспорту','Заочна','j8-infra-z','',null,1.02],
    ['J8','Автомобільний транспорт','Інжиніринг автомобільного транспорту','Денна','j8-eng-d','',null,1.02]
  ];
  return { source: 'fallback-expanded', warning: reason, fetchedAt: new Date().toISOString(), count: base.length, offers: base.map(([code,specialty,program,form,id,spec,minBudget,gk]) => ({
    id, url: `${BASE}/r4/309/${id}/`, legacyUrl: id && /^\d+$/.test(id) ? `${BASE}/y2025/r4/309/${id}/` : '', statsSource:'fallback', degree:'Бакалавр', base:'Повна загальна середня освіта', code, specialty, specialization:spec, program, faculty:'Луцький національний технічний університет', form, offerType:'Відкрита', enrollment:'на 1 курс', regionalCoef:1, industryCoef:gk, coeffs: defaultCoefficients(code), stats:{ minBudget }
  }))};
}

app.listen(PORT, () => console.log(`LNTU calculator listening on ${PORT}`));
