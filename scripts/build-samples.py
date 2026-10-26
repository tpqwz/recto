"""Build public-domain sample editions from the texts already fetched into /tmp/samples."""
import json
import re
import zipfile
from pathlib import Path

OUT = Path("/workspace/public/samples")
OUT.mkdir(parents=True, exist_ok=True)
WORDS = 320

def gutenberg(path):
    text = Path(path).read_text(encoding="utf-8", errors="replace")
    start = text.find("*** START OF THE PROJECT GUTENBERG")
    end = text.find("*** END OF THE PROJECT GUTENBERG")
    text = text[text.find("\n", start) + 1 : end]
    paras = []
    buf = []
    for line in text.splitlines():
        if not line.strip():
            if buf:
                paras.append(re.sub(r"\s+", " ", " ".join(buf)).strip())
                buf = []
        else:
            buf.append(line.strip())
    if buf:
        paras.append(re.sub(r"\s+", " ", " ".join(buf)).strip())
    return [p for p in paras if p]

def second_run(paras, pattern=None, pred=None):
    def ok(p):
        return pred(p) if pred else re.fullmatch(pattern, p) is not None

    idxs = [i for i, p in enumerate(paras) if ok(p)]
    if not idxs:
        raise SystemExit("no headings")
    first = paras[idxs[0]]
    repeats = [i for i in idxs if paras[i] == first]
    start = repeats[1] if len(repeats) > 1 else repeats[0]
    heads = [i for i in idxs if i >= start]
    kept = []
    for n, i in enumerate(heads):
        nxt = heads[n + 1] if n + 1 < len(heads) else len(paras)
        body = [paras[j] for j in range(i + 1, nxt) if not ok(paras[j])]
        if sum(len(p.split()) for p in body) < 40:
            continue
        kept.append(i)
    return kept

def chapters_from(paras, heads):
    out = []
    for n, i in enumerate(heads):
        nxt = heads[n + 1] if n + 1 < len(heads) else len(paras)
        body = paras[i + 1 : nxt]
        body = [p for p in body if p != paras[i]]
        if body:
            out.append((paras[i], body))
    return out

def ascent_chapters(path):
    lines = Path(path).read_text(encoding="utf-8", errors="replace").splitlines()
    start = next(i for i, line in enumerate(lines) if line.strip() == "CHAPTER I." and i + 1 < len(lines) and "Two kinds of this night" in lines[i + 1])
    chunks = [("I", [])]
    current = None
    for line in lines[start:]:
        s = line.strip()
        mark = re.match(r"\[CHAP\.?\s*([IVXLC]+)", s)
        if mark:
            num = mark.group(1)
            if not chunks or chunks[-1][0] != num:
                chunks.append((num, []))
            continue
        if chunks and s:
            chunks[-1][1].append(s)
    cleaned = []
    for num, raw in chunks:
        paras = []
        cur = ""
        for line in raw:
            if re.match(r"^\d+\.\s", line) and cur:
                paras.append(re.sub(r"\s+", " ", cur).strip())
                cur = line
            else:
                cur = (cur + " " + line).strip()
        if cur:
            paras.append(re.sub(r"\s+", " ", cur).strip())
        paras = [p for p in paras if len(p.split()) > 8]
        if paras:
            cleaned.append((f"Chapter {num}.", paras))
    return cleaned

def paginate(chapters):
    page = 1
    words = 0
    out = []
    for title, paras in chapters:
        blocks = [{"t": "h1", "s": title, "page": page}]
        for para in paras:
            if words >= WORDS:
                page += 1
                words = 0
            blocks.append({"t": "p", "page": page, "runs": [para]})
            words += len(para.split())
        out.append({"title": title, "page": blocks[0]["page"], "blocks": blocks})
        if words:
            page += 1
            words = 0
    return out

def folio(meta, chapters):
    paged = paginate(chapters)
    body = []
    toc = [
        {"id": "title-page", "label": "Title page", "page": None, "children": []},
        {"id": "contents", "label": "Contents", "page": None, "children": []},
    ]
    full = [
        {
            "id": "title-page",
            "title": "Title page",
            "page": None,
            "blocks": [
                {"t": "p", "kind": "center", "page": None, "runs": [meta["title"]]},
                {"t": "p", "kind": "center", "page": None, "runs": [meta["subtitle"]]},
                {"t": "p", "kind": "center", "page": None, "runs": [meta["author"]]},
                {"t": "p", "kind": "center", "page": None, "runs": ["Public domain."]},
            ],
        }
    ]
    contents_blocks = [{"t": "h1", "id": "contents", "s": "Contents", "page": None}]
    for n, ch in enumerate(paged, 1):
        cid = f"c{n:02d}"
        ch["blocks"][0]["id"] = cid
        full.append({"id": cid, "title": ch["title"], "page": ch["page"], "blocks": ch["blocks"]})
        toc.append({"id": cid, "label": ch["title"], "page": ch["page"], "children": []})
        contents_blocks.append({"t": "toc-entry", "n": n, "s": ch["title"], "page": ch["page"]})
        body.append(ch)
    full.insert(1, {"id": "contents", "title": "Contents", "page": None, "blocks": contents_blocks})
    last = body[-1]["blocks"][-1]["page"] if body else 1
    return {
        "title": meta["title"],
        "subtitle": meta["subtitle"],
        "author": meta["author"],
        "rights": meta["rights"],
        "epubName": meta["file"] + ".epub",
        "stats": {"hyphensRejoined": 0, "headersRemoved": 0, "chapters": len(body), "paragraphs": sum(len(c["blocks"]) - 1 for c in body)},
        "toc": toc,
        "chapters": full,
        "pages": last,
    }

def esc(s):
    return (
        s.replace("&", "&" + "amp;")
        .replace("<", "&" + "lt;")
        .replace(">", "&" + "gt;")
        .replace('"', "&" + "quot;")
    )

def write_epub(book, path):
    files = {}
    def put(name, text):
        files[name] = text
    put("META-INF/container.xml", '<?xml version="1.0" encoding="UTF-8"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>')
    put("OEBPS/style.css", "body{font-family:Georgia,Palatino,serif;line-height:1.5;margin:0;padding:0 6%;color:#1c1915}h1{font-weight:normal;text-align:center}p{margin:0 0 .2em;text-indent:1.15em}p.noindent{text-indent:0}")
    manifest = []
    spine = []
    pages = []
    seen = set()
    for ch in book["chapters"]:
        parts = []
        for block in ch["blocks"]:
            if block["t"] == "h1":
                parts.append(f'<h1>{esc(block.get("s") or ch["title"])}</h1>')
            elif block["t"] == "toc-entry":
                parts.append(f'<p class="noindent">{esc(block["s"])}</p>')
            elif block["t"] == "p":
                text = " ".join(r for r in block.get("runs") or [] if isinstance(r, str))
                page = block.get("page")
                mark = ""
                if page and str(page) not in seen:
                    seen.add(str(page))
                    pages.append((str(page), ch["id"]))
                    mark = f'<span epub:type="pagebreak" id="page-{esc(str(page))}" role="doc-pagebreak" aria-label="{esc(str(page))}"></span>'
                kind = "center" if block.get("kind") == "center" else ""
                cls = ' class="noindent"' if kind else ""
                parts.append(f"<p{cls}>{mark}{esc(text)}</p>")
        put(f'OEBPS/text/{ch["id"]}.xhtml', f'''<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="en" lang="en"><head><meta charset="utf-8"/><title>{esc(ch["title"])}</title><link rel="stylesheet" href="../style.css"/></head><body><section>
{chr(10).join(parts)}
</section></body></html>''')
        manifest.append(f'<item id="{ch["id"]}" href="text/{ch["id"]}.xhtml" media-type="application/xhtml+xml"/>')
        spine.append(f'<itemref idref="{ch["id"]}"/>')
    toc = "".join(f'<li><a href="text/{t["id"]}.xhtml">{esc(t["label"])}</a></li>' for t in book["toc"])
    page_list = "".join(f'<li><a href="text/{cid}.xhtml#page-{esc(label)}">{esc(label)}</a></li>' for label, cid in pages)
    put("OEBPS/nav.xhtml", f'''<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="en" lang="en"><head><title>Contents</title></head><body>
<nav epub:type="toc" id="toc"><h1>Contents</h1><ol>{toc}</ol></nav>
<nav epub:type="page-list" hidden="hidden"><ol>{page_list}</ol></nav>
</body></html>''')
    order = 1
    points = []
    for t in book["toc"]:
        points.append(f'<navPoint id="nav-{t["id"]}" playOrder="{order}"><navLabel><text>{esc(t["label"])}</text></navLabel><content src="text/{t["id"]}.xhtml"/></navPoint>')
        order += 1
    targets = []
    for label, cid in pages:
        targets.append(f'<pageTarget id="pt-{esc(label)}" type="normal" value="{esc(label)}" playOrder="{order}"><navLabel><text>{esc(label)}</text></navLabel><content src="text/{cid}.xhtml#page-{esc(label)}"/></pageTarget>')
        order += 1
    put("OEBPS/toc.ncx", f'''<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><head>
<meta name="dtb:uid" content="urn:uuid:recto-{book["title"][:20]}"/>
<meta name="dtb:depth" content="1"/><meta name="dtb:totalPageCount" content="{len(pages)}"/><meta name="dtb:maxPageNumber" content="{pages[-1][0] if pages else 0}"/></head>
<docTitle><text>{esc(book["title"])}</text></docTitle><navMap>{"".join(points)}</navMap><pageList>{"".join(targets)}</pageList></ncx>''')
    put("OEBPS/content.opf", f'''<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="uid" version="3.0" xml:lang="en">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="uid">urn:uuid:recto-{esc(book["title"])[:24]}</dc:identifier>
<dc:title>{esc(book["title"])}</dc:title>
<dc:creator>{esc(book["author"])}</dc:creator>
<dc:language>en</dc:language>
<dc:rights>{esc(book["rights"])}</dc:rights>
<meta property="dcterms:modified">2026-10-25T16:00:00Z</meta>
</metadata><manifest>
<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
<item id="css" href="style.css" media-type="text/css"/>
{chr(10).join(manifest)}
</manifest><spine toc="ncx"><itemref idref="nav" linear="no"/>{"".join(spine)}</spine></package>''')
    with zipfile.ZipFile(path, "w") as z:
        info = zipfile.ZipInfo("mimetype")
        info.compress_type = zipfile.ZIP_STORED
        z.writestr(info, "application/epub+zip")
        for name, text in files.items():
            z.writestr(name, text)

def save(meta, chapters):
    book = folio(meta, chapters)
    json_path = OUT / f'{meta["file"]}.json'
    json_path.write_text(json.dumps(book, ensure_ascii=False), encoding="utf-8")
    write_epub(book, OUT / f'{meta["file"]}.epub')
    print(meta["file"], "chapters", book["stats"]["chapters"], "pages", book["pages"], "json", json_path.stat().st_size, "epub", (OUT / f'{meta["file"]}.epub').stat().st_size)

james = gutenberg("/tmp/samples/james.txt")
def lecture(p):
    letters = re.sub(r"[^A-Za-z]", "", p)
    return p.startswith("LECTURE") and letters.isupper() and 12 < len(p) < 160

save(
    {"file": "varieties", "title": "The Varieties of Religious Experience", "subtitle": "William James, the Gifford Lectures of 1901–1902", "author": "William James", "rights": "William James, 1902. Public domain."},
    chapters_from(james, second_run(james, pred=lecture)),
)
republic = gutenberg("/tmp/samples/republic.txt")
save(
    {"file": "republic", "title": "The Republic", "subtitle": "Plato, translated by Benjamin Jowett", "author": "Plato", "rights": "Benjamin Jowett’s translation. Public domain."},
    chapters_from(republic, second_run(republic, r"BOOK [IVX]+\.")),
)
cannon = gutenberg("/tmp/samples/cannon.txt")
save(
    {"file": "cannon", "title": "Bodily Changes in Pain, Hunger, Fear and Rage", "subtitle": "Walter B. Cannon, 1915", "author": "Walter B. Cannon", "rights": "Walter B. Cannon, 1915. Public domain."},
    chapters_from(cannon, second_run(cannon, r"CHAPTER [IVX]+")),
)
save(
    {"file": "ascent", "title": "The Ascent of Mount Carmel", "subtitle": "St. John of the Cross, translated by David Lewis, 1906", "author": "St. John of the Cross", "rights": "David Lewis’s translation, 1906. The text is the scan of that edition."},
    ascent_chapters("/tmp/samples/ascent.txt"),
)
