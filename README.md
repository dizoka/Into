# ЛНТУ — калькулятор конкурсного бала як на Освіта.UA

Це Web Service для Render. Він віддає сайт і через сервер підтягує дані з Освіта.UA / ЄДЕБО, щоб браузер не ловив CORS.

## Render

1. Завантаж файли в GitHub.
2. Render → New + → Web Service.
3. Build Command: `npm install`
4. Start Command: `npm start`
5. Deploy.

## Важливо

Це саме Web Service, не Static Site. Якщо зробити Static Site, live-парсинг Освіта.UA/ЄДЕБО напряму з браузера може не працювати через CORS.
