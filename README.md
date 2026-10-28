# Recto

Version 0.1.0-alpha.

Recto is a reading desk for PDF and DjVu. It keeps the printed contents and the page numbers, and it can read a page that has no text layer. This version is alpha: the desk works, and the contents of a long book can still need another pass.

## What it does

- Opens a PDF or a DjVu and lays the text out as a book.
- Builds a linked contents list from the file's own list, or from the printed contents page, or from the chapter headings.
- Reads picture pages with PP-OCR, and can use a vision model when that is turned on.
- Keeps opened books on a shelf in the browser.

## Run

```bash
npm run dev
```

The desk is served on port 8080. `npm test` runs the folio and installer checks.

## Name

The installed app is named Recto. That name comes from `src/lib/og/site.json` and is what the home-screen installer and the web manifest use. It is not the platform default.

## License

MIT. See [LICENSE](LICENSE).
