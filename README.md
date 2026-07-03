# ЛНТУ калькулятор вступу — Web Service

Ця версія виправляє помилки `Cannot GET /`, `Not Found` і `ENOENT public/index.html`.

## Як залити

1. Розархівуй ZIP.
2. На GitHub краще видали старі файли репозиторію або створи новий репозиторій.
3. Завантаж **усі файли і папку `public`**.
4. На Render створи **Web Service**, не Static Site.
5. Settings:
   - Build Command: `npm install`
   - Start Command: `npm start`

## Структура

```
server.js
package.json
render.yaml
index.html          # дубль для захисту, якщо GitHub не завантажив public
public/index.html   # головний сайт
```

Сервер спочатку шукає `public/index.html`, а якщо його немає — відкриває `index.html` з кореня.
