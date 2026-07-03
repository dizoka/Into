const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');

const app = express();
const PORT = process.env.PORT || 3000;
const OSVITA_UNIVERSITY_URL = 'https://vstup.osvita.ua/r4/309/';
const EDBO_OFFER_URL = id => `https://vstup2025.edbo.gov.ua/offer/${id}`;
const CACHE_MS = 1000 * 60 * 60 * 6;
let cache = { at: 0, data: null, error: null };

const http = axios.create({
  timeout: 25000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (compatible; LNTUAdmissionsCalculator/3.0; +https://render.com)',
    'Accept-Language': 'uk-UA,uk;q=0.9,en;q=0.5'
  }
});

const SUBJECTS = {
  ua: ['Українська мова'],
  math: ['Математика'],
  hist: ['Історія України'],
  literature: ['Українська література'],
  foreign: ['Іноземна мова'],
  biology: ['Біологія'],
  geography: ['Географія'],
  physics: ['Фізика'],
  chemistry: ['Хімія']
};

function clean(s='') { return String(s).replace(/\s+/g, ' ').trim(); }
function numFrom(text, pattern) {
  const m = text.match(pattern);
  return m ? Number(String(m[1]).replace(',', '.')) : null;
}
function txtMatch(text, pattern) {
  const m = text.match(pattern);
  return m ? clean(m[1]) : '';
}
function codeFromSpecialty(s='') {
  const m = s.match(/^([A-ZА-ЯІЇЄҐ]\d+(?:\.\d+)?)\s+(.+)$/i);
  return m ? { code: m[1].toUpperCase(), name: clean(m[2]) } : { code: '', name: clean(s) };
}
function parseWeight(segment, labels) {
  for (const label of labels) {
    const esc = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`${esc}\\*?[\\s\\S]{0,160}?k\\s*=\\s*([0-9]+(?:[.,][0-9]+)?)`, 'i');
    const m = segment.match(re);
    if (m) return Number(m[1].replace(',', '.'));
  }
  return null;
}
function parseOsvitaPage(url, html) {
  const $ = cheerio.load(html);
  const body = clean($('body').text());
  const composition = body.includes('Складові конкурсного бала')
    ? body.split('Складові конкурсного бала')[1].split(/Статистика спеціальності|Рейтинговий список|Додати в закладки/i)[0]
    : body;

  const educationalProgram = txtMatch(body, /Освітня програма:\s*([^\.]+)\./i) || txtMatch(body, /#\s*Освітня програма:\s*([^\.]+)\./i);
  const specRaw = txtMatch(body, /Спеціальність:\s*([A-ZА-ЯІЇЄҐ0-9\.]+\.\s*[^\.]+)\./i);
  const parsedSpec = codeFromSpecialty(specRaw.replace('.', ''));
  const specialtyCode = parsedSpec.code;
  const specialtyName = parsedSpec.name;

  const base = txtMatch(body, /На базі:\s*([^\.]+)\./i);
  const degree = txtMatch(body, /Ступінь навчання:\s*([^\.]+)\./i);
  const faculty = txtMatch(body, /Факультет:\s*([^\.]+)\./i);
  const mode = txtMatch(body, /Форма навчання:\s*([^\.]+)\./i);
  const offerType = txtMatch(body, /Тип пропозиції:\s*([^\.]+)\./i);
  const startCourse = txtMatch(body, /Зарахування:\s*([^\.]+)\./i);
  const contractCost = numFrom(body, /Вартість навчання за рік \(контракт\):\s*([0-9.,]+)/i);
  const license = numFrom(body, /Ліцензійний обсяг\s*([0-9.,]+)/i);
  const stateOrder = numFrom(body, /Максимальний обсяг державного замовлення\s*([0-9.,]+)/i);

  const weights = {};
  for (const [key, labels] of Object.entries(SUBJECTS)) weights[key] = parseWeight(composition, labels);
  const optionalWeights = ['literature','foreign','biology','geography','physics','chemistry']
    .map(k => weights[k]).filter(v => typeof v === 'number');
  const k4max = optionalWeights.length ? Math.max(...optionalWeights) : null;

  const minRatingBudget = numFrom(body, /Мінімальний рейтинговий бал серед зарахованих на бюджет\s*([0-9.,]+)/i);
  const avgRatingBudget = numFrom(body, /Середній рейтинговий бал зарахованих на бюджет\s*([0-9.,]+)/i);
  const avgNmtBudget = numFrom(body, /Середній бал ЗНО серед зарахованих на бюджет\s*([0-9.,]+)/i);
  const enrolledBudget = numFrom(body, /Зараховано на бюджет всього\s*([0-9.,]+)/i);
  const enrolledContract = numFrom(body, /Зараховано на контракт всього\s*([0-9.,]+)/i);
  const totalApps = numFrom(body, /Всього поданих заяв\s*([0-9.,]+)/i);
  const competition = numFrom(body, /Конкурс на одне бюджетне місце \(всі заяви\)\s*([0-9.,]+)/i);

  const offerId = (url.match(/\/(\d+)\/?$/) || [])[1] || '';
  return {
    id: offerId,
    source: url,
    edbo: offerId ? EDBO_OFFER_URL(offerId) : '',
    code: specialtyCode,
    specialty: specialtyName,
    offerName: educationalProgram || specialtyName,
    base, degree, faculty, mode, offerType, startCourse,
    contractCost, license, stateOrder,
    weights, k4max,
    minRatingBudget, avgRatingBudget, avgNmtBudget, enrolledBudget, enrolledContract, totalApps, competition,
    edboStats: null,
    hasFullCalc: Boolean(weights.ua && weights.math && weights.hist && k4max),
    isPzso: /повна|загальна|середня|пзсо/i.test(base) || !/молодш|фахов/i.test(base),
    isBachelor: /бакалавр/i.test(degree)
  };
}
async function fetchEdboStats(id) {
  if (!id) return null;
  try {
    const { data } = await http.get(EDBO_OFFER_URL(id));
    const $ = cheerio.load(data);
    const text = clean($('body').text());
    const get = (label) => {
      const esc = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return numFrom(text, new RegExp(esc + '\\s*([0-9]+(?:[.,][0-9]+)?)', 'i'));
    };
    return {
      submitted: get('Подано заяв'),
      admitted: get('Допущено до конкурсу'),
      budgetApps: get('Заяв на бюджет'),
      avgScore: get('Сер\\. бал') || get('Сер. бал'),
      minScore: get('Мін\\. бал') || get('Мін. бал'),
      maxScore: get('Макс\\. бал') || get('Макс. бал'),
      recommendedGeneral: get('Рекомендовано на загальних підставах'),
      enrolledBudget: get('Зараховано на бюджет'),
      enrolledContract: get('Зараховано на контракт'),
      minRecommended: get('Мін\\. бал рекомендованих') || get('Мін. бал рекомендованих'),
      minBudgetEnrolled: get('Мін\\. бал зарахованих на бюджет') || get('Мін. бал зарахованих на бюджет'),
      source: EDBO_OFFER_URL(id)
    };
  } catch (e) {
    return null;
  }
}
async function loadPrograms(force=false) {
  if (!force && cache.data && Date.now() - cache.at < CACHE_MS) return cache.data;
  try {
    const { data } = await http.get(OSVITA_UNIVERSITY_URL);
    const $ = cheerio.load(data);
    const links = new Map();
    $('a[href]').each((_, a) => {
      const href = $(a).attr('href') || '';
      const abs = new URL(href, OSVITA_UNIVERSITY_URL).href;
      if (/\/y2025\/r4\/309\/\d+\/?$/.test(abs)) links.set(abs, true);
    });
    // fallback: also parse text links if cheerio did not catch them
    const urls = Array.from(links.keys());
    const results = [];
    for (const url of urls) {
      try {
        const page = await http.get(url);
        const item = parseOsvitaPage(url, page.data);
        if (item.isBachelor && item.isPzso && item.code && item.hasFullCalc) results.push(item);
      } catch (e) {}
    }
    // avoid too many EDBO requests: enrich important stats lazily for all found, with safe sequence
    for (const item of results.slice(0, 80)) item.edboStats = await fetchEdboStats(item.id);
    const uniq = new Map();
    for (const item of results) {
      const key = `${item.code}|${item.offerName}|${item.mode}|${item.id}`;
      uniq.set(key, item);
    }
    const programs = Array.from(uniq.values()).sort((a,b) => (a.code+a.offerName).localeCompare(b.code+b.offerName,'uk'));
    const payload = { fetchedAt: new Date().toISOString(), count: programs.length, source: OSVITA_UNIVERSITY_URL, programs };
    cache = { at: Date.now(), data: payload, error: null };
    return payload;
  } catch (e) {
    cache.error = e.message;
    if (cache.data) return cache.data;
    throw e;
  }
}

app.use(express.static('public'));
app.get('/api/programs', async (req, res) => {
  try {
    const force = req.query.refresh === '1';
    const data = await loadPrograms(force);
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: 'Не вдалося завантажити дані з Освіта.UA', detail: e.message });
  }
});
app.get('/api/health', (req,res)=>res.json({ok:true, cached: !!cache.data, error: cache.error, at: cache.at}));
app.listen(PORT, () => console.log(`LNTU calculator started on ${PORT}`));
