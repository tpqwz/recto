import { i as __toESM } from "../_runtime.mjs";
import { K as require_react, b as require_jsx_runtime } from "../_libs/@tanstack/react-router+[...].mjs";
import { a as Download, i as Menu, o as BookOpen, r as Search, t as X } from "../_libs/lucide-react.mjs";
import { n as previewPathPrefix, r as __exportAll } from "./router-B5CoSwtJ.mjs";
import { n as zipSync, t as strToU8 } from "../_libs/fflate.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/routes-v4v9HlYs.js
var import_react = /* @__PURE__ */ __toESM(require_react());
var import_jsx_runtime = require_jsx_runtime();
function esc(s) {
	return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function cluster(items) {
	const its = items.filter((it) => it.str && String(it.str).trim()).map((it) => ({
		str: String(it.str).replace(/\u00ad/g, ""),
		x: it.transform[4],
		y: it.transform[5],
		w: it.width || 0,
		h: it.height || Math.abs(it.transform[3]) || 8
	}));
	its.sort((a, b) => b.y - a.y || a.x - b.x);
	const lines = [];
	for (const it of its) {
		let placed = false;
		for (let i = lines.length - 1; i >= 0 && lines.length - i <= 6; i--) {
			const ln = lines[i];
			if (Math.abs(ln.y - it.y) > 3.2) continue;
			if (ln.items.some((o) => Math.min(o.x + o.w, it.x + it.w) - Math.max(o.x, it.x) > 2)) continue;
			ln.items.push(it);
			ln.y = ln.items.reduce((s, x) => s + x.y, 0) / ln.items.length;
			placed = true;
			break;
		}
		if (!placed) lines.push({
			y: it.y,
			items: [it]
		});
	}
	return lines.map((ln) => {
		ln.items.sort((a, b) => a.x - b.x);
		let text = "";
		let prev = null;
		for (const it of ln.items) {
			if (prev) {
				if (it.x - (prev.x + prev.w) > Math.max(1.15, Math.max(prev.h, it.h, 8) * .12)) text += " ";
			}
			text += it.str;
			prev = it;
		}
		const last = ln.items[ln.items.length - 1];
		return {
			text: text.replace(/[ \t]+/g, " ").trim(),
			y: ln.y,
			x0: ln.items[0].x,
			x1: last.x + last.w,
			h: Math.max(...ln.items.map((i) => i.h || 0))
		};
	}).filter((ln) => ln.text.replace(/[^A-Za-z0-9]/g, "").length > 0).sort((a, b) => b.y - a.y || a.x0 - b.x0);
}
function median(nums) {
	if (!nums.length) return 12;
	const s = [...nums].sort((a, b) => a - b);
	return s[Math.floor(s.length / 2)];
}
function joinParagraph(group, hyphens) {
	const runs = [];
	let buf = "";
	let page = group[0].page;
	const flush = () => {
		const t = buf.replace(/[ \t]+/g, " ").trim();
		if (t) runs.push(t);
		buf = "";
	};
	for (const ln of group) {
		const piece = ln.text.trim();
		if (ln.page !== page) {
			flush();
			runs.push(ln.page);
			page = ln.page;
			buf = piece;
			continue;
		}
		if (/[A-Za-z]-$/.test(buf) && /^[a-z(]/.test(piece)) {
			buf = buf.replace(/-$/, "") + piece;
			hyphens.n++;
		} else buf = buf ? `${buf} ${piece}` : piece;
	}
	flush();
	return runs;
}
function normalizeOutline(items) {
	const kept = items.filter((item) => item.label.trim() && (item.page || item.children.some((child) => child.page)));
	if (kept.length === 1 && kept[0].children.filter((child) => child.page).length >= 2) return kept[0].children.filter((child) => child.page);
	return kept.filter((item) => item.page);
}
function slug(s) {
	return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "section";
}
function chapterHtml(blocks) {
	const parts = [];
	const seen = /* @__PURE__ */ new Set();
	const mark = (page) => {
		if (page && !seen.has(page)) {
			seen.add(page);
			parts.push(`<span epub:type="pagebreak" id="page-${page}" role="doc-pagebreak" aria-label="${page}" title="${page}"></span>`);
		}
	};
	for (const b of blocks) if (b.t === "h1" || b.t === "h2") {
		mark(b.page);
		parts.push(`<${b.t} id="${esc(b.id || "")}">${esc(b.s || "")}</${b.t}>`);
	} else if (b.t === "p") {
		mark(b.page);
		const inner = (b.runs || []).map((run) => {
			if (typeof run !== "number") return esc(run);
			if (seen.has(run)) return "";
			seen.add(run);
			return `<span epub:type="pagebreak" id="page-${run}" role="doc-pagebreak" aria-label="${run}" title="${run}"></span>`;
		}).join("");
		parts.push(`<p>${inner}</p>`);
	}
	return {
		html: parts.join("\n"),
		pages: seen
	};
}
function epubBlob(folio, sourceName) {
	const files = { mimetype: [strToU8("application/epub+zip"), { level: 0 }] };
	const put = (name, text) => {
		files[name] = strToU8(text);
	};
	put("META-INF/container.xml", `<?xml version="1.0" encoding="UTF-8"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`);
	put("OEBPS/style.css", `body{font-family:Georgia,Palatino,serif;line-height:1.5;margin:0;padding:0 6%;color:#1c1915}h1,h2{font-weight:normal}h1{text-align:center}p{margin:0 0 .2em;text-indent:1.15em}p.noindent{text-indent:0}`);
	const manifest = [];
	const spine = [];
	const pageLinks = [];
	folio.chapters.forEach((ch) => {
		const built = chapterHtml(ch.blocks);
		put(`OEBPS/text/${ch.id}.xhtml`, `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="en" lang="en"><head><meta charset="utf-8"/><title>${esc(ch.title)}</title><link rel="stylesheet" href="../style.css"/></head><body><section>
${built.html}
</section></body></html>`);
		manifest.push(`<item id="${ch.id}" href="text/${ch.id}.xhtml" media-type="application/xhtml+xml"/>`);
		spine.push(`<itemref idref="${ch.id}"/>`);
		for (const p of [...built.pages].sort((a, b) => a - b)) pageLinks.push({
			page: p,
			href: `text/${ch.id}.xhtml#page-${p}`
		});
	});
	pageLinks.sort((a, b) => a.page - b.page);
	put("OEBPS/nav.xhtml", `<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="en" lang="en"><head><title>Contents</title></head><body>
<nav epub:type="toc" id="toc"><h1>Contents</h1><ol>${folio.toc.map((t) => {
		const kids = t.children.map((c) => `<li><a href="text/${t.id}.xhtml#${esc(c.id)}">${esc(c.label)}</a></li>`).join("");
		return `<li><a href="text/${t.id}.xhtml">${esc(t.label)}</a>${kids ? `<ol>${kids}</ol>` : ""}</li>`;
	}).join("")}</ol></nav>
<nav epub:type="page-list" hidden="hidden"><ol>${pageLinks.map((p) => `<li><a href="${p.href}">${p.page}</a></li>`).join("")}</ol></nav>
</body></html>`);
	let order = 1;
	const navPoints = folio.toc.map((t) => {
		const self = order++;
		const kids = t.children.map((c) => {
			const o = order++;
			return `<navPoint id="nav-${esc(c.id)}" playOrder="${o}"><navLabel><text>${esc(c.label)}</text></navLabel><content src="text/${t.id}.xhtml#${esc(c.id)}"/></navPoint>`;
		}).join("");
		return `<navPoint id="nav-${esc(t.id)}" playOrder="${self}"><navLabel><text>${esc(t.label)}</text></navLabel><content src="text/${t.id}.xhtml"/>${kids}</navPoint>`;
	}).join("");
	const pageTargets = pageLinks.map((p) => {
		const o = order++;
		return `<pageTarget id="pt-${p.page}" type="normal" value="${p.page}" playOrder="${o}"><navLabel><text>${p.page}</text></navLabel><content src="${p.href}"/></pageTarget>`;
	}).join("");
	put("OEBPS/toc.ncx", `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
<head><meta name="dtb:uid" content="urn:uuid:recto-opened"/>
<meta name="dtb:depth" content="2"/><meta name="dtb:totalPageCount" content="${pageLinks.length}"/><meta name="dtb:maxPageNumber" content="${pageLinks.at(-1)?.page || 0}"/></head>
<docTitle><text>${esc(folio.title)}</text></docTitle>
<navMap>${navPoints}</navMap>
<pageList><navLabel><text>Pages</text></navLabel>${pageTargets}</pageList>
</ncx>`);
	put("OEBPS/content.opf", `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="uid" version="3.0" xml:lang="en" prefix="schema: http://schema.org/">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="uid">urn:uuid:recto-${esc(folio.title).slice(0, 24)}</dc:identifier>
<dc:title>${esc(folio.title)}</dc:title>
${folio.author ? `<dc:creator>${esc(folio.author)}</dc:creator>` : ""}
<dc:language>en</dc:language>
<dc:source>${esc(sourceName)}</dc:source>
<dc:rights>Personal reading copy made in Recto from a file supplied by the reader.</dc:rights>
<meta property="dcterms:modified">2026-10-24T16:00:00Z</meta>
<meta property="pageBreakSource">${esc(sourceName)}</meta>
<meta property="schema:accessibilityFeature">pageBreakMarkers</meta>
<meta property="schema:accessibilityFeature">pageNavigation</meta>
</metadata><manifest>
<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
<item id="css" href="style.css" media-type="text/css"/>
${manifest.join("\n")}
</manifest><spine toc="ncx"><itemref idref="nav" linear="no"/>${spine.join("")}</spine></package>`);
	const zipped = zipSync(files, { level: 6 });
	return URL.createObjectURL(new Blob([zipped], { type: "application/epub+zip" }));
}
function pushChapter(chapters, label, page) {
	const id = `c${String(chapters.length + 1).padStart(2, "0")}`;
	const chapter = {
		id,
		title: label,
		page,
		blocks: [{
			t: "h1",
			id,
			s: label,
			page
		}]
	};
	chapters.push(chapter);
	return chapter;
}
function tocOf$1(chapters) {
	return chapters.map((c) => ({
		id: c.id,
		label: c.title,
		page: c.page,
		children: c.blocks.filter((b) => b.t === "h2" && b.id && b.s).map((b) => ({
			id: b.id || "",
			label: b.s || "",
			page: b.page ?? null,
			children: []
		}))
	}));
}
function withOutline(paras, outline, title) {
	const chapters = [];
	const first = outline[0].page || 1;
	const front = paras.filter((p) => p.group[0].page < first);
	if (front.length) {
		const ch = pushChapter(chapters, "Front matter", front[0].group[0].page);
		for (const p of front) ch.blocks.push({
			t: "p",
			runs: p.runs,
			page: p.group[0].page
		});
	}
	outline.forEach((item, index) => {
		const start = item.page || 1;
		const end = outline[index + 1]?.page ?? Infinity;
		const ch = pushChapter(chapters, item.label, start);
		const seen = /* @__PURE__ */ new Set();
		const children = item.children.filter((c) => c.page && c.page >= start && c.page < end && c.page !== start);
		for (const p of paras) {
			const page = p.group[0].page;
			if (page < start || page >= end) continue;
			for (const child of children) {
				if (child.page !== page || seen.has(child.label)) continue;
				seen.add(child.label);
				const id = `${ch.id}-${slug(child.label)}`;
				ch.blocks.push({
					t: "h2",
					id,
					s: child.label,
					page,
					section: true
				});
			}
			ch.blocks.push({
				t: "p",
				runs: p.runs,
				page
			});
		}
	});
	if (!chapters.length) pushChapter(chapters, title, paras[0]?.group[0].page ?? 1);
	return chapters;
}
function withHeadings(paras, title, bodyH) {
	const headingAt = /* @__PURE__ */ new Set();
	paras.forEach((p, i) => {
		const text = p.runs.filter((r) => typeof r === "string").join(" ");
		if (p.group.length === 1 && p.h > bodyH * 1.28 && text.length > 2 && text.length < 80 && !/[,:;]$/.test(text)) headingAt.add(i);
	});
	if (headingAt.size > 60) headingAt.clear();
	const chapters = [];
	let current = headingAt.has(0) ? null : pushChapter(chapters, title, paras[0]?.group[0].page ?? 1);
	paras.forEach((p, i) => {
		const text = p.runs.filter((r) => typeof r === "string").join(" ");
		if (headingAt.has(i)) {
			current = pushChapter(chapters, text, p.group[0].page);
			return;
		}
		if (!current) current = pushChapter(chapters, title, p.group[0].page);
		current.blocks.push({
			t: "p",
			runs: p.runs,
			page: p.group[0].page
		});
	});
	if (!chapters.length) pushChapter(chapters, title, 1);
	return chapters;
}
function assembleFolio(rawLines, options) {
	let headers = 0;
	const kept = [];
	for (const ln of rawLines) {
		const short = ln.text.length < 72;
		const header = ln.y > ln.pageH - 54 && short && (/\d/.test(ln.text) || ln.text.length < 40);
		const footer = ln.y < 36 && short;
		if (header || footer) {
			headers++;
			continue;
		}
		kept.push(ln);
	}
	if (!kept.length) throw new Error(options.emptyMessage);
	const bodyH = median(kept.map((ln) => ln.h));
	const margin = median(kept.filter((ln) => ln.x1 - ln.x0 > 80).map((ln) => Math.round(ln.x0 / 2) * 2));
	const groups = [];
	let buf = [];
	const flush = () => {
		if (buf.length) groups.push(buf);
		buf = [];
	};
	for (const ln of kept) {
		const prev = buf[buf.length - 1];
		const pageBreak = !!prev && prev.page !== ln.page;
		const gap = prev && !pageBreak ? prev.y - ln.y : 0;
		const prevEnded = !!prev && /[.?!]["']?$/.test(prev.text.trim()) && prev.x1 < prev.pageW * .78;
		const indented = ln.x0 > margin + 14;
		if (prev && !/[A-Za-z]-$/.test(prev.text) && (gap > Math.max(bodyH * .9, 14) || indented && prevEnded || pageBreak && prevEnded)) flush();
		buf.push(ln);
	}
	flush();
	const hyphens = { n: 0 };
	const paras = groups.map((group) => ({
		group,
		runs: joinParagraph(group, hyphens),
		h: group[0].h
	})).filter((p) => p.runs.some((r) => typeof r === "string" && r.replace(/[^A-Za-z]/g, "").length > 1));
	if (!paras.length) throw new Error(options.emptyMessage);
	const tops = normalizeOutline(options.outline || []);
	const chapters = tops.length >= 2 ? withOutline(paras, tops, options.title) : withHeadings(paras, options.title, bodyH);
	const folio = {
		title: options.title,
		subtitle: options.subtitle,
		author: options.author || "",
		stats: {
			hyphensRejoined: hyphens.n,
			headersRemoved: headers,
			chapters: chapters.length
		},
		toc: tocOf$1(chapters),
		chapters
	};
	options.onStatus?.("Making the EPUB");
	folio.epubHref = epubBlob(folio, options.sourceName);
	folio.epubName = `${options.title.replace(/[^\w.-]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "folio"}.epub`;
	return folio;
}
var book_default = {
	title: "A Compilation on Sex",
	subtitle: "From the writings of Alice A. Bailey and the Tibetan Master, Djwhal Khul",
	author: "Alice A. Bailey",
	contributor: "Djwhal Khul",
	publisher: "Lucis Publishing Company",
	year: "1980",
	stats: {
		"hyphensRejoined": 906,
		"hyphensKept": 20,
		"headersRemoved": 159,
		"fragmentsRejoined": 5,
		"wordsSplit": 162,
		"paragraphs": 617,
		"chapters": 14
	},
	toc: [
		{
			"id": "title-page",
			"label": "Title page",
			"page": null,
			"children": []
		},
		{
			"id": "copyright",
			"label": "Copyright",
			"page": null,
			"children": []
		},
		{
			"id": "epigraph",
			"label": "Epigraph",
			"page": null,
			"children": []
		},
		{
			"id": "reference-index",
			"label": "Reference Index",
			"page": null,
			"children": []
		},
		{
			"id": "invocation",
			"label": "The Great Invocation",
			"page": null,
			"children": []
		},
		{
			"id": "statement",
			"label": "A Statement by the Tibetan",
			"page": null,
			"children": []
		},
		{
			"id": "contents",
			"label": "Contents",
			"page": null,
			"children": []
		},
		{
			"id": "c01",
			"label": "The Sex Energy",
			"page": 1,
			"children": []
		},
		{
			"id": "c02",
			"label": "The Problem of Sex",
			"page": 4,
			"children": [
				{
					"id": "c2-1-definition-of-sex-of-virtue-and-of-vice",
					"label": "Definition of Sex, of Virtue and of Vice",
					"page": 15,
					"children": []
				},
				{
					"id": "c2-2-sex-in-the-new-age",
					"label": "Sex in the New Age",
					"page": 31,
					"children": []
				},
				{
					"id": "c2-3-some-suggestions-for-the-present-cycle",
					"label": "Some Suggestions for the Present Cycle",
					"page": 36,
					"children": []
				}
			]
		},
		{
			"id": "c03",
			"label": "Sex and Discipleship",
			"page": 45,
			"children": []
		},
		{
			"id": "c04",
			"label": "Marriage and Parenthood",
			"page": 49,
			"children": []
		},
		{
			"id": "c05",
			"label": "Chakras and Sex Energy",
			"page": 62,
			"children": []
		},
		{
			"id": "c06",
			"label": "Transmutation and Transference",
			"page": 74,
			"children": []
		},
		{
			"id": "c07",
			"label": "Kundalini and Sex Energy",
			"page": 93,
			"children": []
		},
		{
			"id": "c08",
			"label": "Disease and Sex Energy",
			"page": 95,
			"children": []
		},
		{
			"id": "c09",
			"label": "Homosexuality",
			"page": 110,
			"children": []
		},
		{
			"id": "c10",
			"label": "The Rays and Sex Energy",
			"page": 114,
			"children": []
		},
		{
			"id": "c11",
			"label": "Astrology and Sex Energy",
			"page": 119,
			"children": []
		},
		{
			"id": "c12",
			"label": "Devas and Sex Energy",
			"page": 126,
			"children": []
		},
		{
			"id": "c13",
			"label": "Cosmic Correspondences to the Sex Impulse",
			"page": 130,
			"children": []
		},
		{
			"id": "c14",
			"label": "The Mystery of Sex",
			"page": 143,
			"children": []
		}
	],
	chapters: [
		{
			"id": "title-page",
			"title": "Title page",
			"page": null,
			"blocks": [
				{
					"t": "h1",
					"id": "title-page",
					"s": "A Compilation on Sex"
				},
				{
					"t": "p",
					"kind": "center",
					"runs": ["Compiled by a student who has imposed his own punctuation on some of the original text"]
				},
				{
					"t": "p",
					"kind": "center",
					"runs": ["From the Writings of Alice A. Bailey and the Tibetan Master, Djwhal Khul"]
				},
				{
					"t": "p",
					"kind": "center",
					"runs": ["Lucis Publishing Company, New York"]
				},
				{
					"t": "p",
					"kind": "center",
					"runs": ["Lucis Press, Ltd., London"]
				}
			]
		},
		{
			"id": "copyright",
			"title": "Copyright",
			"page": null,
			"blocks": [
				{
					"t": "h1",
					"id": "copyright",
					"s": "Copyright"
				},
				{
					"t": "p",
					"kind": "center",
					"runs": ["This compilation is extracted from books by Alice A. Bailey for which the Lucis Trust holds copyrights."]
				},
				{
					"t": "p",
					"kind": "center",
					"runs": ["First printing, 1980."]
				},
				{
					"t": "p",
					"kind": "center",
					"runs": ["The Lucis Publishing Company is a non-profit organisation owned by the Lucis Trust. No royalties are paid on this book."]
				},
				{
					"t": "p",
					"kind": "center",
					"runs": ["Manufactured in the United States of America by Fort Orange Press, Inc., Albany, N.Y."]
				}
			]
		},
		{
			"id": "epigraph",
			"title": "Epigraph",
			"page": null,
			"blocks": [
				{
					"t": "h1",
					"id": "epigraph",
					"s": "Epigraph"
				},
				{
					"t": "p",
					"runs": ["“In dealing with this subject of sex I shall have to generalise, and the exceptions to the rules laid down and to the suggested classifications will, of course, be many. I am dealing with the subject asa whole, and my topic therefore is the menace of the present attitude, the need for fuller understanding, and the importance of a re-arrangement of men’s ideas on this vital matter."]
				},
				{
					"t": "p",
					"runs": ["The Tibetan, Esoteric Psychology, Vol. 1, p. 270"]
				},
				{
					"t": "p",
					"runs": ["“I can, however, bring to your attention what I have already written and suggest that someone with the interest and time should collect all I have said in all of my books anent the subject of sex so that a pamphlet on the subject may be compiled.” The Tibetan, Esoteric Healing, p. 176"]
				}
			]
		},
		{
			"id": "reference-index",
			"title": "Reference Index",
			"page": null,
			"blocks": [
				{
					"t": "h1",
					"id": "reference-index",
					"s": "Reference Index"
				},
				{
					"t": "p",
					"kind": "center",
					"runs": ["Books by the Tibetan (Djwhal Khul) through Alice A. Bailey"]
				},
				{
					"t": "p",
					"runs": ["A reference such as (6 — 135/6) at the end of a quotation is taken from Education in the New Age, book 6, starting on page 135 and continued on page 136."]
				},
				{
					"t": "table",
					"headers": [
						"No.",
						"Title",
						"First edition",
						"Reference edition",
						"Pages"
					],
					"rows": [
						[
							"1",
							"Initiation, Human and Solar",
							"1922",
							"9th, 1970",
							"225"
						],
						[
							"2",
							"Letters on Occult Meditation",
							"1922",
							"11th, 1973",
							"360"
						],
						[
							"3",
							"A Treatise on Cosmic Fire",
							"1925",
							"10th, 1973",
							"1,283"
						],
						[
							"4",
							"A Treatise on White Magic",
							"1934",
							"11th, 1971",
							"640"
						],
						[
							"5",
							"The Destiny of the Nations",
							"1949",
							"3rd, 1968",
							"152"
						],
						[
							"6",
							"Education in the New Age",
							"1954",
							"6th, 1971",
							"153"
						],
						[
							"7",
							"A Treatise on the Seven Rays, Vol. I — Esoteric Psychology",
							"1936",
							"6th, 1970",
							"430"
						],
						[
							"8",
							"Vol. II — Esoteric Psychology",
							"1942",
							"5th, 1970",
							"751"
						],
						[
							"9",
							"Vol. III — Esoteric Astrology",
							"1951",
							"7th, 1970",
							"695"
						],
						[
							"10",
							"Vol. IV — Esoteric Healing",
							"1953",
							"5th, 1970",
							"715"
						],
						[
							"11",
							"Vol. V — The Rays and the Initiations",
							"1960",
							"3rd, 1970",
							"769"
						],
						[
							"12",
							"The Externalisation of the Hierarchy",
							"1957",
							"3rd, 1968",
							"701"
						],
						[
							"13",
							"Discipleship in the New Age, Vol. I",
							"1944",
							"7th, 1971",
							"790"
						]
					]
				}
			]
		},
		{
			"id": "invocation",
			"title": "The Great Invocation",
			"page": null,
			"blocks": [
				{
					"t": "h1",
					"id": "invocation",
					"s": "The Great Invocation"
				},
				{
					"t": "p",
					"kind": "verse",
					"runs": ["From the point of Light within the Mind of God"]
				},
				{
					"t": "p",
					"kind": "verse",
					"runs": ["Let light stream forth into the minds of men."]
				},
				{
					"t": "p",
					"kind": "verse",
					"runs": ["Let Light descend on Earth."]
				},
				{
					"t": "p",
					"kind": "verse",
					"runs": ["From the point of Love within the Heart of God"]
				},
				{
					"t": "p",
					"kind": "verse",
					"runs": ["Let love stream forth into the hearts of men."]
				},
				{
					"t": "p",
					"kind": "verse",
					"runs": ["May Christ return to Earth."]
				},
				{
					"t": "p",
					"kind": "verse",
					"runs": ["From the centre where the Will of God is known"]
				},
				{
					"t": "p",
					"kind": "verse",
					"runs": ["Let purpose guide the little wills of men—"]
				},
				{
					"t": "p",
					"kind": "verse",
					"runs": ["The purpose which the Masters know and serve."]
				},
				{
					"t": "p",
					"kind": "verse",
					"runs": ["From the centre which we call the race of men"]
				},
				{
					"t": "p",
					"kind": "verse",
					"runs": ["Let the Plan of Love and Light work out"]
				},
				{
					"t": "p",
					"kind": "verse",
					"runs": ["And may it seal the door where evil dwells."]
				},
				{
					"t": "p",
					"kind": "verse",
					"runs": ["Let Light and Love and Power restore the Plan on Earth."]
				},
				{
					"t": "p",
					"runs": ["The above Invocation or Prayer does not belong to any person or group but to all Humanity. The beauty and the strength of this Invocation lies in its simplicity, and in its expression of certain central truths which all men, innately and normally, accept—the truth of the existence of a basic Intelligence to Whom we vaguely give the name of God; the truth that behind all outer seeming, the motivating power of the universe is Love; the truth that a great Individuality came to earth, called by Christians, the Christ, and embodied that love so that we could understand; the truth that both love and intelligence are effects of what is called the Will of God; and finally the self-evident truth that only through humanity itself can the Divine Plan work out."]
				},
				{
					"t": "p",
					"kind": "center",
					"runs": ["Alice A. Bailey"]
				}
			]
		},
		{
			"id": "statement",
			"title": "A Statement by the Tibetan",
			"page": null,
			"blocks": [
				{
					"t": "h1",
					"id": "statement",
					"s": "A Statement by the Tibetan"
				},
				{
					"t": "p",
					"runs": ["Suffice it to say, that I am a Tibetan disciple of a certain degree, and this tells you but little, for all are disciples from the humblest aspirant up to, and beyond, the Christ Himself. I live in a physical body like other men, on the borders of Tibet, and at times (from the exoteric standpoint) preside over a large group of Tibetan lamas, when my other duties permit. It is this fact that has caused it to be reported that I am an abbot of this particular lamasery. Those associated with me in the work of the Hierarchy (and all true disciples are associated in this work) know me by still another name and office. A. A. B. knows who I am and recognises me by two of my names."]
				},
				{
					"t": "p",
					"runs": ["I am a brother of yours, who has travelled a little longer upon the Path than has the average student, and has therefore incurred greater responsibilities. I am one who has wrestled and fought his way into a greater measure of light than has the aspirant who will read this article, and I must therefore act as a transmitter of the light, no matter what the cost. I am not an old man, as age counts among the teachers, yet I am not young or inexperienced. My work is to teach and spread the knowledge of the Ageless Wisdom wherever I can find a response, and I have been doing this for many years. I seek also to help the Master M. and the Master K. H. whenever opportunity offers, for I have been long connected with Them and with Their work. In all the above, I have told you much; yet at the same time I have told you nothing which would lead you to offer me that blind obedience and the foolish devotion which the emotional aspirant offers to the Guru and Master whom he is as yet unable to contact. Nor will he make that desired contact until he has transmuted emotional devotion into unselfish service to humanity,—not to the Master."]
				},
				{
					"t": "p",
					"runs": ["The books that I have written are sent out with no claim for their acceptance. They may, or may not, be correct, true and useful. It is for you to ascertain their truth by right practice and by the exercise of the intuition. Neither I nor A. A. B. is the least interested in having them acclaimed as inspired writings, or in having anyone speak of them (with bated breath) as being the work of one of the Masters. If they present truth in such a way that it follows sequentially upon that already offered in the world teachings, if the information given raises the aspiration and the will-to-serve from the plane of the emotions to that of the mind (the plane whereon the Masters can be found) then they will have served their purpose. If the teaching conveyed calls forth a response from the illumined mind of the worker in the world, and brings a flashing forth of his intuition, then let that teaching be accepted. But not otherwise. If the statements meet with eventual corroboration, or are deemed true under the test of the Law of Correspondences, then that is well and good. But should this not be so, let not the student accept what is said."]
				}
			]
		},
		{
			"id": "contents",
			"title": "Contents",
			"page": null,
			"blocks": [
				{
					"t": "h1",
					"id": "contents",
					"s": "Contents"
				},
				{
					"t": "toc-entry",
					"id": "c01",
					"n": 1,
					"s": "The Sex Energy",
					"page": 1
				},
				{
					"t": "toc-entry",
					"id": "c02",
					"n": 2,
					"s": "The Problem of Sex",
					"page": 4
				},
				{
					"t": "toc-entry",
					"id": "c03",
					"n": 3,
					"s": "Sex and Discipleship",
					"page": 45
				},
				{
					"t": "toc-entry",
					"id": "c04",
					"n": 4,
					"s": "Marriage and Parenthood",
					"page": 49
				},
				{
					"t": "toc-entry",
					"id": "c05",
					"n": 5,
					"s": "Chakras and Sex Energy",
					"page": 62
				},
				{
					"t": "toc-entry",
					"id": "c06",
					"n": 6,
					"s": "Transmutation and Transference",
					"page": 74
				},
				{
					"t": "toc-entry",
					"id": "c07",
					"n": 7,
					"s": "Kundalini and Sex Energy",
					"page": 93
				},
				{
					"t": "toc-entry",
					"id": "c08",
					"n": 8,
					"s": "Disease and Sex Energy",
					"page": 95
				},
				{
					"t": "toc-entry",
					"id": "c09",
					"n": 9,
					"s": "Homosexuality",
					"page": 110
				},
				{
					"t": "toc-entry",
					"id": "c10",
					"n": 10,
					"s": "The Rays and Sex Energy",
					"page": 114
				},
				{
					"t": "toc-entry",
					"id": "c11",
					"n": 11,
					"s": "Astrology and Sex Energy",
					"page": 119
				},
				{
					"t": "toc-entry",
					"id": "c12",
					"n": 12,
					"s": "Devas and Sex Energy",
					"page": 126
				},
				{
					"t": "toc-entry",
					"id": "c13",
					"n": 13,
					"s": "Cosmic Correspondences to the Sex Impulse",
					"page": 130
				},
				{
					"t": "toc-entry",
					"id": "c14",
					"n": 14,
					"s": "The Mystery of Sex",
					"page": 143
				}
			]
		},
		{
			"id": "c01",
			"title": "The Sex Energy",
			"page": 1,
			"blocks": [
				{
					"t": "h1",
					"id": "c01",
					"s": "The Sex Energy",
					"page": 1,
					"chapter": 1
				},
				{
					"t": "p",
					"runs": ["(1) Sex is then seen to be in truth only the relation of the lower nature to the higher Self; it is then lifted up into the light of day in order that man may reach complete union with divinity. Man discovers that sex (which has hitherto been a purely physical function, carried on sometimes under the impulse of love) is elevated into its rightful plane as the divine marriage, carried out and consummated upon the levels of soul awareness. It is this great truth which lies beyond the sordid story of sex expression, of sex magic and the distortions of modern Tantric magic. Humanity has stepped down the symbolism and in its thoughts debased sex to an animal function and failed to lift it up into the realm of symbolic mystery. Men have sought through physical expression to produce the inner fusion and harmony which they crave and this cannot be done. Sex is but the symbol of an inner duality which must be itself transcended and wrought into a unity. It is not transcended by physical means or rituals. It is a transcendence in consciousness. (9 — 385)."],
					"page": 1,
					"chapter": 1,
					"kind": "extract"
				},
				{
					"t": "p",
					"runs": [
						"(2)... the force of sex attraction... is a pull from the physical plane and the swinging back ofatype of involutionary energy on the path of return. Cosmically speaking, it manifests as the attractive force between spirit and matter; spiritually speaking, it is demonstrated as the activity of the soul, as it seeks to draw the lower self into full realisation. Physically speaking, it is the urge which tends to unite male and female for the purpose of procreation. When man was purely animal, no sin was involved. When to this urge was added emotional desire, then sin crept in, and the purpose for which the urge manifested was perverted into the satisfaction of desire. Now that the race is more mental, and the force of mind is making itself",
						2,
						"felt in the human body, an even more serious situation is apparent, which can only be safely worked out when the soul assumes control of its triple instrument. (4 — 241/2)."
					],
					"page": 1,
					"chapter": 1
				},
				{
					"t": "p",
					"runs": ["(3) We live in a world of forms. These forms are made up of lives and these lives have their own emanatory and contributory influence. They fall in their turn into three main groups:"],
					"page": 2,
					"chapter": 1,
					"kind": "extract"
				},
				{
					"t": "p",
					"runs": ["a. Those emanations, which issuing from the cells themselves and dependent upon their quality, produce a good or a bad effect, are coarsening or refining in their influence, and raise or lower the physical vibration of the united cell body. Thus, as we well know, the physical effect of a coarse brutal animal natured man will be different to that of the refined beautifying results of contact with an older soul, functioning in a body, cultured, clean, disciplined and purified."],
					"page": 2,
					"chapter": 1
				},
				{
					"t": "p",
					"runs": ["b. Those emanations, of a purely physical kind which are responsible for that chemical affinity between one animal body and another which produces the coming together of the sexes. It is an aspect of animal magnetism and is the response of the cells to the call of other cells, acting under the Law of Attraction and Repulsion. It is shared by man with the animals, and is instinctive and free from all mental reactions."],
					"page": 2,
					"chapter": 1
				},
				{
					"t": "p",
					"runs": ["c. Those forces or emanations, which are the response of the cells to harmonious rhythms and therefore dependent upon the cell having in itself something of that to which it responds. These emanations are little understood as yet, but will increasingly come to the fore as the race progresses. This type of force is that mysterious something which enables the physical body to recognise as"],
					"page": 2,
					"chapter": 1
				},
				{
					"t": "p",
					"runs": ["harmonious or congenial a physical surrounding or environment, for instance. It is"],
					"page": 3,
					"chapter": 1
				},
				{
					"t": "p",
					"runs": ["that undefinable reaction which results in"],
					"page": 3,
					"chapter": 1
				},
				{
					"t": "p",
					"runs": ["two human beings (apart from all sex attraction, for people of the same sex experience it with each other) having a harmonious effect physically upon each other. This"],
					"page": 3,
					"chapter": 1
				},
				{
					"t": "p",
					"runs": ["is, on the outer plane, the esoteric basis for"],
					"page": 3,
					"chapter": 1
				},
				{
					"t": "p",
					"runs": ["all group relation, and it is the understanding of these emanations that enables the"],
					"page": 3,
					"chapter": 1
				},
				{
					"t": "p",
					"runs": ["isolation and segregation of races to be carried forward under the great evolutionary"],
					"page": 3,
					"chapter": 1
				},
				{
					"t": "p",
					"runs": ["plan. (4 — 282/3)."],
					"page": 3,
					"chapter": 1
				},
				{
					"t": "p",
					"runs": ["(4)... The relation between male and female physical bodies [is] called by man the sex relation, and [is] deemed of such paramount importance at this time. In the vale of illusion, the symbol oft engrosses attention and that which it represents is forgotten. In the solving of this relationship will come racial initiation, and it is with this that the race is now engrossed. (4 — 86)."],
					"page": 3,
					"chapter": 1
				},
				{
					"t": "p",
					"runs": ["(5) The instinct of sex has its main root in the fear of separateness and of isolation, and in a revolt against separative unity on the physical plane, against aloneness; and it has resulted in the carrying forward of the race and the persistence and propagation of the forms through which the race can come into manifestation. (4 — 626/7)."],
					"page": 3,
					"chapter": 1,
					"kind": "extract"
				},
				{
					"t": "p",
					"runs": ["(6) The sex instinct has worked out and finds its logical consummation in the relationship—consciously realised—of the soul and the body. This is the keynote of mysticism and religion, which is today, as ever, the expression of the Law of Attraction, not as it expresses itself through physical plane marriage, but as it finds its consummation (for man) in the sublime marriage carried forward with conscious intent between the positive soul and the negative and receptive form. (4 — 628)."],
					"page": 3,
					"chapter": 1,
					"kind": "extract"
				}
			]
		},
		{
			"id": "c02",
			"title": "The Problem of Sex",
			"page": 4,
			"blocks": [
				{
					"t": "h1",
					"id": "c02",
					"s": "The Problem of Sex",
					"page": 4,
					"chapter": 2
				},
				{
					"t": "p",
					"runs": ["(1) It is not my intention here to indicate the solution of the problem of sex. Humanity will inevitably work it out as the aeons slip away and as the herd instinct gives place to the premeditated and self-conscious attitudes of the aspirant and the intelligentsia. I would remind you, however, that the herd instinct in relation to sex has its basis either in normal and natural animal instinctual desire or in emotional attitudes, and of these the last category are by far the worst and carry with them by far the more deep-seated seeds of trouble. They range all the way from the stage of free love and a general promiscuity to the orthodox narrow and bigoted Christian angle, as that is normally understood though not in the sense in which Christ viewed life. This narrow viewpoint and the normal Anglo-Saxon attitude (an outcome of the teaching of the Middle Ages) regard sex as unusually sinful, ever undesirable, and as something to be lived down and overcome, and kept secretly in the background of the Christian consciousness, where it is hidden as a prurient mystery. This again is due to the influence of St. Paul but not to the teaching of Christ."],
					"page": 4,
					"chapter": 2,
					"kind": "extract"
				},
				{
					"t": "p",
					"runs": [
						"From these attitudes, there has been a violent reaction which is today at its height and this, in its turn, is both undesirable and dangerous, as are all violent reactions, for the one is as untrue as the other; it is at the centre of the Scales or at the hub of the wheel that the true perspective and indicated action can be seen correctly. When the basic “sex” relation is finally established and soul and body (positive and negative) are permanently related in the lives of the world aspirants, then we shall see the right handling of the world teaching on the subject of physical sex. This teaching will come from the merging and synthesis of the best views",
						5,
						"of all the spiritually minded teachers in both hemispheres, embodying the experience of the East and of the West, and of the mystical and the scientific approaches to a mystery which is both physical (requiring scientific understanding) and mystical (requiring spiritual interpretation). It will involve the aid and conclusions of the medical profession in order to give the needed wise, physical instruction and the aid also of the cultural knowledge of the yogis of India in connection with the energy flowing through the centres—in this case the sacral centre. Finally, through the intelligent activity of the judicial and legal-minded men of the world, the search for a balanced and desirable point of view will come to an end. Out of the many sexual experiments now going on, the coming generation will arrive at a point of balance and then, as a consequence, they will tip the scales in the desired and desirable direction. Of this there is no question of doubt; there is only the point in time and this will be astrologically determined. Through the legal minds and through right legislation, sex will be seen eventually to be a proper and divine function and will then be safeguarded by right education of the young and the ignorant, and the right action of the young and highly intelligent emerging generation—the children and babies of today."
					],
					"page": 4,
					"chapter": 2
				},
				{
					"t": "p",
					"runs": [
						"The teaching of wrong sexual habits, the example of widespread prostitution (I use this word in connection with men as well as women), the growth of homosexuality not in its rare physiological forms and predispositions but from the angle of a perverted mentality and an unwholesome imagination, which today lie behind so much of its expression), the narrow-minded Christian inheritance of a “guilt complex” where sex is concerned, and the heritage of diseased and over-or undersexed physical bodies, have brought the race to its",
						6,
						"present chaotic and unintelligent handling of the important problem. The solution will not be found through religious pronouncements, based upon an outworn theory, or through physiological inhibition or legalised license; neither will it come through legislation, inspired by various schools of thought in any community or nation. It will be the result of the united activity of the spiritually minded consciousness, the judicial attitude, the intellectual perception and the steady urge of the evolutionary process. Nothing can prevent the inevitability of the solution and the appearance of desirable attitudes and conditions wherein sex can find right expression. (9 — 234/6)."
					],
					"page": 5,
					"chapter": 2
				},
				{
					"t": "p",
					"runs": ["(2) I have stated that the incoming seventh ray plays through the planetary sacral centre, and then through the sacral centre of every human being. Because of this, we can look for the anticipated developments in that human function which we designate the sex function. We shall see consequent changes in the attitude of man towards this most difficult problem. In speaking on the subject of sex, and in outlining what it is possible to say at this time, I seek to be as simple as I can, and to express my thoughts in such a way that something constructive may eventuate, and a note may be struck which will sound forth clearly in the present welter of discordant sounds, of conflicting views, and of varying ideas."],
					"page": 6,
					"chapter": 2,
					"kind": "extract"
				},
				{
					"t": "p",
					"runs": [
						"It is obvious that the matter is a difficult one to approach. But why is it so difficult? In the last analysis, we shall find that the difficulty is based on the prejudices in men’s minds, and upon their inner assurance that their particular point of view is necessarily the right one because they themselves live and act in accordance with it, and it suffices for them; it is based on the fact that sex is one of the fundamental primeval urges, one of the",
						7,
						"substantial instincts, and is consequently the dominating factor in the animal side of man’s nature; it is based upon the excessive intimacy of the subject,—an intimacy which was transmuted into an indecent secret during the periods wherein the race succumbed to an excessive puritanism and prostituted a natural function into a prurient mystery. This intimacy relating to the subject of sex caused it to be regarded as an unmentionable episode, and asa topic to be shunned by decent people, instead of being regarded as an instinctual and natural process,—as instinctual and as necessary as the functions of eating and drinking. It is a function, however, which has not been reduced to rhythm in the daily life and regarded as one to be followed and satisfied only when need arises and right demands. Herein lies a great distinction and a clue is offered to the problem."
					],
					"page": 6,
					"chapter": 2
				},
				{
					"t": "p",
					"runs": [
						"Again, the difficulty of the problem can be found in the widely diverse attitudes of men’s minds to the subject. These attitudes range all the way from an ill-regulated promiscuity to a monogamy which has worked out into a cruel imposition and restraint upon women, and an unbridled license on the part of men. Attendant upon these difficulties, and growing out of these wrong attitudes, the legalities and the illegalities, the license and the restraints, have produced points of infection (if I may so call them) in our civilisation. Because of them, we find a lax morality which is based on bewilderment, “red light” districts which are but an unhappy compromise with vicious tendencies and unsatisfied desires, divorce courts which devastate the life of the family and in time undermine the national life (of which each family unit should be a wholesome part), and the steady growth of disease as the result of the prevalent promiscuity and the many illicit relations. There is also a psychological factor to be found, of real importance.",
						8,
						"This fact is the militancy expressed by the many groups of people who are seeking to impose their own ideas and their peculiar solution of the problem upon their fellow-men."
					],
					"page": 7,
					"chapter": 2
				},
				{
					"t": "p",
					"runs": ["Behind all these results of an age-long wrong attitude to the sex function lie two major evils, or rather two major effects of man’s actions, mental and physical. These are of dire significance. There is, first of all, the development within man’s consciousness of those complexes, those psychoses and psychological disruptions and inhibitions, which have so seriously undermined the health and the serenity of hundreds and thousands of men. There is, secondly, the threatening of the very life of humanity itself, as it is embodied in the family unit and family life. On the one hand, you have promiscuity and over-indulgence in sex relations, which are resulting (and have always resulted) in over-population and an over-production of human beings. On the other hand, you have an enforced sterility which—though in many ways the lesser of the two evils—is eventually dangerous. This sterility is rapidly on the increase. It leads finally to physical conditions which are undesirable. Nevertheless, at this time, it is the lesser of the two evils. Two points might incidentally be noted here. Out of the first of these evils, and asa result of over-production, we have brought about an economic situation of such a drastic and serious nature that the very peace and stability of the world are threatened; out of the second, we should have a gradual disappearance of humanity itself, if enforced sterility should become a universal practice. This would lead to the consequent dominance of the animal world and an immense increase of animal life, and we should have a period of retrogression and not of progress."],
					"page": 8,
					"chapter": 2
				},
				{
					"t": "p",
					"runs": [
						"In dealing with this subject of sex I shall have to generalise, and the exceptions to the rules laid",
						9,
						"down and to the suggested classifications will, of course, be many. I am dealing with the subject asa whole, and my topic therefore is the menace of the present attitude, the need for a fuller understanding, and the importance of a re-arrangement of men’s ideas on this vital matter. The attitude of the unthinking savage to the sex life, and the attitude of the mentally polarised and spiritually oriented initiate to the same subject, may seem so widely dissimilar that on the surface there may appear no point of resemblance; yet basically both of these attitudes are nearer to each other and to the reality than is that of the average man today. The one is controlled by the rhythm of his animal nature, and knows no more of the evil side and of the vile promiscuity of the civilised man than does the animal in its wild state; the other lives his life in a controlled fashion, governing through the power of the mind, and animated by desire for the good of humanity. In between these two approaching extremes, we have the many points of view, the many dissimilar ideas, the many customs, the many types of relation (legitimate and illegitimate), the many animal and psychological reactions, the many forms of marriage, and the many perversions of a natural process which distinguish modern man in all parts of the world. These again vary in the different civilisations and under the influence of the differing climatic conditions."
					],
					"page": 8,
					"chapter": 2
				},
				{
					"t": "p",
					"runs": [
						"It is therefore obvious,—is it not?—that it is no part of my service to the readers of this book to enter into a detailed analysis of the marriage customs of the ages, past and present. It is not my work to enlarge in detail upon the mistakes, the evil consequences, the many types of perversion, and the sadistic cruelties which have grown out of man’s misuse of the natural processes and of his mate, nor to elucidate his foolish misunderstanding of the Law of Attraction and Repulsion. It",
						10,
						"would serve no useful purpose if I put forth, in this brief discussion of an immense subject, any of the theories which men have formulated in their search for o solution. Their name is legion. All have in them a measure of the truth. Most of them express the depths of man’s ignorance, and they can be studied at any time by any student who has the time to read, the intelligence to see clearly and without prejudice, and the money to purchase the needed literature."
					],
					"page": 9,
					"chapter": 2
				},
				{
					"t": "p",
					"runs": ["I cannot and I will not touch upon the medical and physiological aspect of vice, whether it be the vice of promiscuity or the vice of an unhappy marriage. I can best serve you at this time by pointing out the laws which should govern the life of man, particularly where sex is concerned, and by indicating—as far as I can and dare—why and how the present peculiar and unique conditions have been brought about. I may also be able to make certain suggestions which, when duly considered, may help to clear from the mind those false and illusory views which prevent man from seeing truly, and I may thus help him to find the golden thread of light which will lead him to his solution in due time."],
					"page": 10,
					"chapter": 2
				},
				{
					"t": "p",
					"runs": [
						"One thing I will say, sad though it may seem to you to be. There is no immediate solution of the problem of sex with which we are at this time confronted. For ages men have misused and wrongly employed a God-given function; they have prostituted their birthright, and through their laxity and license, and through their lack of control, they have inaugurated an era of disease, both mental and physical, of wrong attitudes and illusory relations which it will take several centuries to eradicate; they have also brought too rapidly into incarnation myriads of human beings who were not yet ready for the experience of this incarnation, and who needed longer interludes between",
						11,
						"births wherein to assimilate experience. Those souls who are unevolved come into incarnation with rapidity; but older souls need longer periods wherein to garner the fruits of experience. They are however open to the magnetic attractive power of those who are alive on the physical plane, and it is these souls who can be brought prematurely into incarnation. The process is under law, but the unevolved progress under group law as do the animals, whilst the more evolved are susceptible to the pull of human units, and the evolved come into incarnation under the Law of Service, and through the deliberate choice of their conscious souls."
					],
					"page": 10,
					"chapter": 2
				},
				{
					"t": "p",
					"runs": ["I shall divide what I have to say into four parts, for the sake of clarity and rapid reference:"],
					"page": 11,
					"chapter": 2
				},
				{
					"t": "li",
					"runs": ["1. Definitions of sex, of virtue and of vice."],
					"page": 11,
					"chapter": 2
				},
				{
					"t": "li",
					"runs": ["2. Sex in the New Age."],
					"page": 11,
					"chapter": 2
				},
				{
					"t": "li",
					"runs": ["3. Some suggestions for the present moment."],
					"page": 11,
					"chapter": 2
				},
				{
					"t": "li",
					"runs": ["4. Sex and the life of discipleship."],
					"page": 11,
					"chapter": 2
				},
				{
					"t": "p",
					"runs": [
						"I deal not with history nor with the details of racial evolution. These are necessarily all connected with the problem of sex, but are too vast in their implications for my present purposes. As I said before, I deal not with the physiological aspects of sex, nor with the diseases incident upon the misuse of the function, nor shall I deal with the subject of sterility, except as it enters into our consideration of modern man. I cannot touch upon the quarrels of the various schools of thought, for I am not writing from any specific angle, such as that of religion or of morality or of partisanship. The whole question is wider and bigger than any religious view or the moral affirmations of the little minds. What is morality in one country or in one specific relation can be quite the reverse in another. What is deemed legal in one part of the world is found illegal in another. What constitutes",
						12,
						"a difficult problem under one climatic condition presents totally different possibilities under another. Polygamy, promiscuity and monogamy have been and are cyclically dominant in different parts of the world, down through the ages, and are to be found functioning simultaneously on the earth today. Each has been, or is, in turn right, legal and suitable, or wrong, illegal and unsuitable. Each of these forms of interpreting the sex relation has been the subject of attack or defense, of virtuous horror or of specious argument; each has been the common custom and the rightful method, according to the location, the tradition, training and attitude of the men who practiced it. In one part of the world, one woman may have many husbands; in another, one husband is legally entitled to four wives, if so he choose, and in the harem and the kraal such conditions are always to be found. In the West, a man has legally one wife, but through his promiscuity and his so-called “romantic” adventures, he really has as many as an African chieftain; and today, women are little better."
					],
					"page": 11,
					"chapter": 2
				},
				{
					"t": "p",
					"runs": ["I have enumerated the above conditions with no thought of criticism in my mind, but simply as a statement of fact, and in order to awaken in the average reader a realisation of a world-wide condition which is probably quite different to their ordinary surmise. I write not for the specialists, but for the average intelligent student who needs a worldwide picture of existing conditions."],
					"page": 12,
					"chapter": 2
				},
				{
					"t": "p",
					"runs": [
						"It is divinely true that the trend of men’s thoughts and desires is towards an established monogamy, but as yet this has never been universally achieved. If one faces this issue with courage and with truth, one will be forced to the conclusion that down the ages men have never been monogamists. Women have been more so in the past than men, but are perhaps less so now, as modern",
						13,
						"knowledge is inculeating modern methods of protection from the risk and pain of childbirth. Up till now, the act of bearing children has been regarded as deterrent and as a penalty for legal or illegal sex relations. Think of the horror unfolded in those words! Women, practicing the ancient trade of promiscuity, have of course always existed, but I am referring here to women in the home."
					],
					"page": 12,
					"chapter": 2
				},
				{
					"t": "p",
					"runs": ["Will you believe me if I tell you that the world situation today, where sex is concerned, is so critical and so serious that there is not a thinker to be found who can yet see the solution, or who can find—no matter how clear his brain or erudite his mind—the way out of the present impasse? The traditions of customs and of practices, with their inevitable consequences and long established tenure, serve to bewilder the clearest minds. The physical results alone of sexual intercourse, carried on within or without the legalised marriage relation, have produced not only the world of every-day human life, but much of the disease, the insanity, the evil tendencies, and the perverted impulses which today fill our hospitals, our homes for neurotics, our sanatoriums, our prisons and our lunatic asylums."],
					"page": 13,
					"chapter": 2
				},
				{
					"t": "p",
					"runs": [
						"Our young people, expecially the idealistic types and the clear-thinking boys and girls, find themselves faced with a situation which defies their best efforts. They do not know what to think or what to believe. They look into, or form part of, homes which are sanctified by legal marriage, and find (on a large scale) nothing but unhappiness, legalised prostitution, ill-health, the seeking of illicit relations outside the home, neglected and unwanted children, the friction produced by wrong mating, divorce, and no answer to their many intelligent questions. They look then elsewhere, into the lives of those who have avoided the responsibility of marriage, and find naught but discontent,",
						14,
						"frequently a secret and hidden sex life, ill-health as a result of the frustration of the natural instincts, psychological conditions of the worst kind, sometimes illegitimate children, sexual perversions, and a growing tendency towards what is called homosexuality. They are overwhelmed by complete bewilderment and the failure to find an answer to their questions. They ask the worldly-minded for a solution and for help, and get no clear reply, no sound philosophy and no fundamental instruction. They may be offered sound common sense, and the injunction to avoid excesses and those conditions which would impair their health or lay on them the burden of straitened economic conditions. The moralities of the past may be pointed out to them, and they may be warned of the results which inevitably follow when the laws of nature are broken and the physical body is prostituted to ill-regulated desire. They may have the virtues of “straight living” eulogised to them, and even the fact that they are sons of God may be emphasized to them. All this is good and right and useful. But no true solution is offered, and no light is thrown upon their problem, and their confusion remains unrelieved. They may perhaps turn to the religiously minded people and seek out the orthodox churchman. They may be told to be good; the example of the saints may be cited to them; they may find themselves deluged in a flood of puritanical injunctions, in righteous platitudes, and with unsatisfying explanations, based often on personal prejudice and predilection. But seldom is a clear note sounded, and seldom is it possible to do more than enunciate the great Mosaic law, “Thou shaltnot....”To the bulk of the young and seeking enquirers of the present generation the fact that God says thus and so, or the Bible ordains this, that or the other, does not satisfy their longing to know the reason why. The hope of an ultimate",
						15,
						"heaven, where self-discipline, self-control and sexual abstinence will receive a just reward, seems too far away to offset the temptations of the outer environing world and the insistent urges arising within the man himself."
					],
					"page": 13,
					"chapter": 2
				},
				{
					"t": "p",
					"runs": ["That many do withstand the “temptations of the flesh” is indeed wonderfully true. That there are men and women everywhere who pass through life clean and uncontaminated is equally and wonderfully a fact. That there are advanced souls whose life is divorced from the animal nature and whose minds control their daily acts is the glory of humanity. But many of them, living in another world of thought and interest, are not tempted as are the more animally inclined of the sons of men. There are, again, of course, those who refrain from wrong doing because they fear the results, either today in the physical body or hereafter in the other world of penalty. But which of all these people, even the most good and saintly, can speak with real wisdom and understanding of this universal problem? Which of them can see the way out for humanity at present? Which of them understands the reason for all the distress, sin and wickedness which have grown up around the sex relation? Which of them really comprehends the true significance of the sex life, its place"],
					"page": 15,
					"chapter": 2
				},
				{
					"t": "p",
					"runs": ["in the great scheme of things, and the reason for the relation between the sexes? Which of them can say with true vision what the next evolutionary step will be, whither we are going, and what will be the next development?"],
					"page": 15,
					"chapter": 2
				},
				{
					"t": "h2",
					"id": "c2-1-definition-of-sex-of-virtue-and-of-vice",
					"s": "1. Definition of Sex, of Virtue and of Vice",
					"page": 15,
					"chapter": 2,
					"section": true
				},
				{
					"t": "p",
					"runs": [
						"Cosmically speaking, sex is a short word used to express the relation existing (during manifestation) between spirit and matter, and between life and form. It is, in the last analysis, an expression of the Law of Attraction,—that basic law which underlies the entire manifestation of life in form,",
						16,
						"and which is the cause of all phenomenal appearance. Humanly or physically speaking, sex is the word used to denote the relation between men and women which results in the reproduction of the species. Speaking in terms of modern usage as it is found among the unthinking and the average, sex is a word which denotes the alluring satisfaction of the animal impulses at any cost and with no rhythmic regulation. Sex is essentially an expression of duality, and of the separation of a unity into two aspects or halves. These we can call spirit and matter, male and female, positive and negative; and they are in the nature of a stage upon the evolutionary ladder towards a final unity or homosexuality which has no relation to that perversion which is, today and inaccurately, called “homosexuality.” This latter manifestation is rampant at this time in a mental and modern conception of the phenomenon, but it is rare indeed to find a person who truly combines within himself the two sexes, and is,—physiologically and mentally— entirely “self-satisfying, self-sustaining and self-propagating.” Down the ages, here and there, we find the true homo-sexual emerging as a guarantee of a distant racial and evolutionary achievement, when the world cycle will have been run and the two separated halves will again be merged in their essential unity. In the above phraseology I do not refer to any doctrine of"
					],
					"page": 15,
					"chapter": 2
				},
				{
					"t": "p",
					"runs": ["sion twin souls, or to any perverreferof reality, as ordinarily understood today. I"],
					"page": 16,
					"chapter": 2
				},
				{
					"t": "p",
					"runs": [
						"to the divine Hermaphrodite, to the true androgynous man, and to the perfected human being. But thé word has been distorted from its true significance and applies in nine cases out of ten (nay, in ninety-nine cases out of one hundred) to a type of mental perversion, to a distorted attitude of mind which results often in physical practices and reactions which are—in their manifestation—so old that their very antiquity gives the lie to the idea",
						17,
						"that this attitude marks a step forward on the path of progress. It marks indeed a point of retrogression, the swinging back into an ancient rhythm, and the resumption of ancient practices."
					],
					"page": 16,
					"chapter": 2
				},
				{
					"t": "p",
					"runs": ["These perversions are ever found when"],
					"page": 17,
					"chapter": 2
				},
				{
					"t": "p",
					"runs": ["sation a civiliis crumbling and the old order is changing into a new. Why should this be? It is due to the fact that the newer impulses pouring into the old, and the impact of the new forces upon humanity, awaken in mana desire for that which is, for him, a new and untried field of expression, and for that which is unusual and oft abnormal. Weak minds then succumb to the impulse, or strong experimenting souls fall victim to their own lower natures, and investigate in unlawful directions. You have, then, under these new energies, a definite progress forward into new and untried spiritual realms, but at the same time, you find an experimenting in the realm of physical desire which is not for humanity the line of progress."],
					"page": 17,
					"chapter": 2
				},
				{
					"t": "p",
					"runs": [
						"As the world of forms responds cyclically to the inflow of the higher energies, their effect is to stimulate all parts and aspects of the form life, and this stimulation will produce results that are bad as well as good. Evil will temporarily emerge as well as lasting righteousness. If the effect of the impact of these energies is to produce material reactions, and if man then lays the emphasis of his interest upon that which is material, then the form nature becomes dominant, and not the divine. If energy is prostituted to material ends, such as the expression of physical plane sexual relations for purely commercial objectives, then evil is the result. But it must be remembered that the same divine energy, when working in the realm of brotherly love, for instance, would produce naught but good. Let me illustrate my point in two ways, both of which account for the present orgy of sexual",
						18,
						"expression and for the widespread interest in the subject."
					],
					"page": 17,
					"chapter": 2
				},
				{
					"t": "p",
					"runs": ["We live today in a period of the world’s history wherein three events of major importance are taking place, mostly unrealised and unobserved by the majority of people."],
					"page": 18,
					"chapter": 2
				},
				{
					"t": "p",
					"runs": ["The seventh Ray of Law and Order is coming into manifestation; we are transitting into a new sign of the zodiac, and the “coming of Christ” is imminent. These three great happenings are the cause of much of the present upheaval and chaos; at the same time they are responsible for the universal turning to spiritual realities which all true workers at this time recognise, and for the growth of understanding, of welfare movements and of the tendency to cooperation, of religious unity and of internationalism. Types of energy which have hitherto been latent are now becoming potent. The consequent world reaction is, in the initial stages, material in its manifestation; in its final stages, divine qualities will manifest and change history and civilisation. The interest being shown today in the so-called cosmic rays indicates a scientific recognition of the new incoming seventh ray energies. These rays, pouring through the sacral centre of the planetary etheric body, have necessarily an effect upon the sacral centres of humanity, and hence the sex life of mankind is temporarily overstimulated, and hence also the present overemphasis upon sex. But hence also (and this must be remembered) the keen impetus now being mentally expressed which will eventually result in man’s thinking through to a solution of this problem of sex."],
					"page": 18,
					"chapter": 2
				},
				{
					"t": "p",
					"runs": [
						"The coming in of the Aquarian age also stimulates in mana spirit of universality and a tendency towards fusion. This can be seen working out in the present trend towards synthesis in business, in",
						19,
						"religion and in politics. It produces an urge towards union, and among other unions, towards religious understanding and tolerance. But these influences, playing upon the sensitive bodies of the undeveloped and the over-psychic, lead to a morbid tendency towards unions, legitimate and illegitimate; they produce an extreme aptitude to sexual intercourse in many directions, and to relations and fusions which are not along the intended or the evolutionary line, and which outrage oft the very laws of nature itself. Energy is an impersonal thing, and is dual in its effect,—the effect varying according to the type of substance upon which it plays."
					],
					"page": 18,
					"chapter": 2
				},
				{
					"t": "p",
					"runs": ["The incoming seventh ray expresses the power to organise, the ability to integrate and to bring into synthetic relation the great pairs of opposites, and thus produce the new forms of spiritual manifestation. But it will also produce the new forms of what, from the standpoint of spirit, may be regarded as material evil. It is the great impulse which will bring into the light of day all that is to be found clothed with matter, and will thus eventually lead to the revelation of spirit and of the hidden glory, when that which has been revealed of the material form has been purified and sanctified. This it was to which Christ referred when He prophesied that, at the end of the age, the hidden things would be made plain, and secrets be shouted from the housetops."],
					"page": 19,
					"chapter": 2
				},
				{
					"t": "p",
					"runs": [
						"By means of this process of revelation, within the human family as well as elsewhere in nature, we shall have the development of the power of thought. This will come about through the development of the faculty of ‘discrimination, which will offer choices to man, and thus develop a truer sense of values. False and true standards will emerge in man’s consciousness, and those choices will be made which will lay the foundation of the",
						20,
						"new order, which will inaugurate the new race, with its new laws and novel approaches, and so usher in the new religion of love and brotherhood, and that period wherein the group and the group-good will be the dominant note. Then separateness and hatreds will fade out and men will be merged in a true unity."
					],
					"page": 19,
					"chapter": 2
				},
				{
					"t": "p",
					"runs": ["The third factor under consideration, the coming of the Christ as it is called, must also be noted. Everywhere we find the spirit of expectancy, and the demand for a manifestation and a symbolic happening which we call by various names but which is usually referred to as the advent of Christ. This, as you know, may be an actual physical coming, as before in Palestine, or it may connote a definite over-shadowing of His disciples and lovers by the Great Lord of Life. This over-shadowing will call forth a response from all those who are in any way spiritually awakened. Or again, the coming may take the form of a tremendous inflow of the Christ principle, the Christ life and love, working out through the human family. Perhaps all three possibilities may be found simultaneously on our planet very shortly. It is not for us to say. It is for us to be ready, and for us to work at preparing the world for that significant series of events. The immediate future will show. The point I seek to make, however, is that this inflow of the Christ spirit of love (whether it comes through a Person in bodily form or through His felt and realised Presence) will again be two-fold in its effect."],
					"page": 20,
					"chapter": 2
				},
				{
					"t": "p",
					"runs": [
						"This is a hard saying for the unthinking and the illogical. Both the good and the evil man will be stimulated; both material desire and spiritual aspiration will be awakened and fostered. Facts prove the truth of the saying that a heavily fertilised garden and a carefully tended and watered plot of ground will produce its crop of weeds as well as flowers. Yet in this fact you have two reactions",
						21,
						"to the same sun, the same water, the same fertilising agency and the same care. The difference exists in the seeds found in the ground upon which these factors play. The inflow of love therefore will stimulate earthly love and earthly desire and animal lust; it will foster the urge to possess in the material sense, with all the evil consequent upon this attitude, and the resulting growth of sexual reactions, and the many expressions of an ill-regulated mechanism, responding to an impersonal force. But it will also produce the growth of brotherly love and foster the development and the expression of group consciousness, of universal understanding; it will produce a new and powerful tendency to fusion, to at-one-ment and to synthesis. All this will be brought about through the medium of humanity and the Christ spirit. Steadily the love of Christ will be shed abroad in the earth, and its influence will grow stronger during the coming centuries, until at the end of the Aquarian age, and through the work of the seventh ray (bringing the pairs of opposites into closer cooperation), we can look for the “raising of Lazarus from the dead,” and the emergence of humanity out of the tomb of matter. The hidden divinity will be revealed. Steadily all forms will be brought under the influence of the Christ spirit, and the consummation of love will be brought about."
					],
					"page": 20,
					"chapter": 2
				},
				{
					"t": "p",
					"runs": ["Owing to these three causes we have at this time a world-wide interest in sex, leading as a natural consequence to two things:"],
					"page": 21,
					"chapter": 2
				},
				{
					"t": "p",
					"runs": [
						"First, to an outburst throughout the entire world, and primarily in our large centres of population, of an increase in sexual relations, but distinguished at this time by no corresponding increase in population. This is due to the modern understanding of birth control methods and secondly to the increased mental focussing or polarisation of the",
						22,
						"race, which leads to sterility or"
					],
					"page": 21,
					"chapter": 2
				},
				{
					"t": "p",
					"runs": ["size of the families raised. to a reduction in the"],
					"page": 22,
					"chapter": 2
				},
				{
					"t": "p",
					"runs": ["Second, to a reorganisation of the racial ideas on marriage and on sexual relations. This is due to the breakdown of our present economic situation, to the widespread interest in medical hygiene (an interest hitherto confined to the specialists), to the general recognition of the varied marriage customs of the nations in the East and in the West, which has led to a general questioning, and also to the failure of the legal machine to safeguard the family unit and to interpret human relations in a satisfactory manner."],
					"page": 22,
					"chapter": 2
				},
				{
					"t": "p",
					"runs": ["Out of this universal interest and discussion we shall work towards a solution and an objective which exist as yet on purely abstract mental levels and in the world of ideas. Even the foremost thinkers of the race sense only vaguely and nebulously what these hidden ideals may be."],
					"page": 22,
					"chapter": 2
				},
				{
					"t": "p",
					"runs": [
						"The question at issue is not primarily a religious one, except in so far as social relations are basically divine relations. It is fundamental in its connotation, and when it is solved we shall see the establishment of equality between the sexes, the removal of those barriers which at present exist between men and women, and the safe-guarding of the family unit. This will involve therefore the protection of the child, so that he may be given those essentials to right physical growth and that true education which will lead to emotional unfoldment along sound lines, and a mental development which will enable him to serve his race, his time and his group to the best possible advantage. This has always been an ideal, but it has never yet been satisfactorily accomplished. The solving of the sexual problem will release the minds of men from an inhibition and an undue concern, and so produce a mental freedom which will admit of the",
						23,
						"inflow of new ideas and concepts. We shall discover that vice and virtue have no real reference to ability and inability to conform to man-made laws, but to man’s attitude to himself and to his social relation with God and his fellowmen. Virtue is the manifestation in man of the spirit of cooperation with his brothers, necessitating unselfishness, understanding and complete self-forgetfulness. Vice is the negation of this attitude. These two words signify in reality simply perfection and imperfection, conformity to a divine standard of brotherhood or a failure to achieve that standard. Standards are shifting things and change with man’s growth towards divinity. They vary also according to man’s destiny as it is affected by his time and age, his nature and surroundings. They alter also according to the point of evolutionary development. The standard for attainment is not today what it was one thousand years ago, nor a thousand years hence will it be what it is today."
					],
					"page": 22,
					"chapter": 2
				},
				{
					"t": "p",
					"runs": ["Yet all periods of the world’s history have not been as critical as today, for—apart from the great cyclic opportunity to which I have earlier referred—we have in humanity itself a unique attainment. For the first time in racial history, we have the expression of a true human being, of man as he essentially is. We have the personality, integrated and functioning as a unit, and we have the mind and the emotional nature fused and blended, on the one hand with the physical body, and on the other with the soul. Also, the shift of emphasis is today away from the physical life to the mental life, and in an increasing number of cases to the spiritual life. There is therefore little real cause for depression, if what I have here noted is true. There is today, on a wide scale, a true “lifting up of the heart unto the Lord,” and a steady turning of the eyes towards the world of spiritual values. Hence the present upheaval."],
					"page": 23,
					"chapter": 2
				},
				{
					"t": "p",
					"runs": ["Apart from the coming in of the new age, apart therefore from the inflow of the Christ spirit, with its transforming power and regenerating force, and apart from the cyclic return of the seventh ray energies, we have mankind in a condition where the response to the deeper spiritual energies and to the new opportunities is, for the first time, adequate and synthetic. Hence the increasing problem. Hence the great day of opportunity. Hence the wonder of the dawn which can be seen brightening in the east."],
					"page": 24,
					"chapter": 2
				},
				{
					"t": "p",
					"runs": ["Ishould like here to approach the problem of sex from another angle and point out that it is a basic symbol. A symbol, as we well know, is an outward and visible sign of an inward and spiritual reality. What is this inward reality? First of all, the reality of relationship. It is a relationship existing between the basic pairs of opposites,—Father-Mother, spirit-matter; between positive and negative; between life and form, and between the great dualities which—when brought together in the cosmic sense—produce the manifested son of God, the cosmic Christ, the conscious sentient universe. Of this relation the Gospel story is a dramatic symbol, and the historical Christ is the guarantee of its truth and reality. Christ guarantees for us the reality of the inner significance and the true spiritual basis of all that is and ever shall be. Out of the relation of light and dark that which is invisible emerges into visibility, and we can see and know. Christ, as the light of the world, revealed that reality. Out of the darkness of time God spoke, and the Fatherhood of Deity was revealed."],
					"page": 24,
					"chapter": 2
				},
				{
					"t": "p",
					"runs": [
						"The drama of creation and the story of revelation are depicted for us, if we could but see truly and interpret our facts with spiritual exactitude, in the relation of the two sexes and in the fact of their intercourse with each other. When this relation is no longer purely physical but is a union of the two",
						25,
						"separated halves on all three planes,—physical, emotional and mental—then we shall see the solution of the sex problem and the restitution of the marriage relation to its intended position in the Mind of God. Today it is the marriage of two physical bodies. Sometimes it is the marriage also of the emotional natures of the two people concerned. Rarely indeed is it a marriage of minds as well. Sometimes it is the union of the physical body of one party, with the physical body of the other party left cold and uninterested and uninvolved, but with the emotional body attracted and participating. Sometimes the mental body is involved with the physical body, and the emotional nature left out. Seldom, very seldom, do we find the coordinated, cooperating fusion of all the three parts of the personality concerned in both parties to the union. When this is indeed found, then you have a true union, a real marriage, and a blending of the two in one."
					],
					"page": 24,
					"chapter": 2
				},
				{
					"t": "p",
					"runs": ["It is here that some of the schools of esoteric teaching have gone sadly astray. The false idea has crept into their presentation of truth that marriage of this kind is essential for spiritual liberation and that without it the soul remains in prison. They teach that through the marriage act, at-onement with the soul is brought about, and that there is no spiritual deliverance without this marriage. At-one-ment with the soul is an individual interior experience, resulting in an expansion of consciousness, so that the individual and specific becomes at-one with the general and universal. Behind the erroneous interpretation, however, lies truth."],
					"page": 25,
					"chapter": 2
				},
				{
					"t": "p",
					"runs": [
						"Where this true marriage and these ideal sexual relations on all three planes are found, the right conditions exist in which souls can be provided with the needed forms in which to incarnate. Sons of God can find forms in which to manifest on",
						26,
						"earth. According to the scope of the marriage contact (if so unusual a form of words can be used in this connection), so will be the type of human being attracted into incarnation. Where the parents are purely physical and emotional, so will be the nature of the child. Thus is the general average determined. Today we have a world of men which is rapidly reaching a high stage of development. We have therefore a dissatisfaction with the present views on marriage, preparatory to the enunciation of certain hidden principles which will eventually govern the relations between the sexes, and provide, as a consequence, the opportunity to men and women to furnish, through the creative act, the needed bodies for disciples and initiates."
					],
					"page": 25,
					"chapter": 2
				},
				{
					"t": "p",
					"runs": [
						"Under the symbol of sex, you have also the reality of love itself expressing itself. Love in reality connotes a relation, but the word “love” (like the word “sex”) is used with little thought and with no attention to its true meaning. Basically, love and sex are one and the same thing, for both express the meaning of the Law of Attraction. Love is sex, and sex is love, for in those two words the relation, the interplay and the union between God and His universe, between man and God, between a man and his own soul, and between men and women are equally depicted. The motive and the relation are emphasized. But the impelling result of that relation is creation and the manifestation of form through which divinity can express itself and come to be. Spirit and matter met together, and the manifested universe came into being. Love is ever productive, and the Law of Attraction is fruitful in results. Man and God came together under the same great Law, and the Christ was born,—the guarantee of the divinity of humanity and the demonstration of the fact. Individual man and his soul are also attempting to come together, and when that event is consummated the Christ is born",
						27,
						"in the cave of the heart, and Christ is seen in the daily life with increasing power. Man therefore dies daily in order that Christ may be seen in all His glory. Of all these wonders, sex is the symbol."
					],
					"page": 26,
					"chapter": 2
				},
				{
					"t": "p",
					"runs": ["Again, in man himself the great drama of sex is enacted, and twice over in his body, within his personality, the process of union and fusion takes place. Let me briefly refer here to these two symbolic happenings, for the use of esoteric students, so that the great story of sex may be comprehended in its spiritual sense."],
					"page": 27,
					"chapter": 2
				},
				{
					"t": "p",
					"runs": ["Man, as you know, is the expression of energies. These energies galvanise the physical man into activity through the medium of certain force centres in the etheric body. These, for our immediate purposes, can be divided into three centres below the diaphragm and four above."],
					"page": 27,
					"chapter": 2
				},
				{
					"t": "p",
					"runs": ["These are:"],
					"page": 27,
					"chapter": 2
				},
				{
					"t": "p",
					"runs": ["I. Below the diaphragm:"],
					"page": 27,
					"chapter": 2
				},
				{
					"t": "li",
					"runs": ["1. The base of the spine."],
					"page": 27,
					"chapter": 2
				},
				{
					"t": "li",
					"runs": ["2. The sacral centre."],
					"page": 27,
					"chapter": 2
				},
				{
					"t": "li",
					"runs": ["8. The solar plexus."],
					"page": 27,
					"chapter": 2
				},
				{
					"t": "p",
					"runs": ["II. Above the diaphragm:"],
					"page": 27,
					"chapter": 2
				},
				{
					"t": "li",
					"runs": ["1. The heart centre."],
					"page": 27,
					"chapter": 2
				},
				{
					"t": "li",
					"runs": ["2. The throat centre."],
					"page": 27,
					"chapter": 2
				},
				{
					"t": "li",
					"runs": ["3. The centre between the eyebrows."],
					"page": 27,
					"chapter": 2
				},
				{
					"t": "li",
					"runs": ["4. The head centre. We know that two fusions have to take place"],
					"page": 27,
					"chapter": 2
				},
				{
					"t": "p",
					"runs": ["and, in these two we have two enactments of the symbolic sex process, and two symbolic events that externalise a spiritual happening and picture forth to man his spiritual goal and God’s great objective in the evolutionary process."],
					"page": 27,
					"chapter": 2
				},
				{
					"t": "p",
					"runs": [
						"First, the energies below the diaphragm have to be lifted up and blended with those above the diaphragm. With the process and rules for so doing",
						28,
						"we cannot here deal, except in one case,—the raising of the sacral energy to the throat centre, or the transmutation of the process of physical reproduction and of physical creation into that of the creativeness of the artist in some field of creative expression. Through the union of the energies of these two centres we shall come to that stage in our development wherein we shall produce the children of our skill and minds. Where, in other words, there is a true union of the higher and the lower energies, you will have the emergence of beauty in form, the enshrining of some aspect of truth in appropriate expression, and thus the enriching of the world. Where there is this synthesis, the true creative artist begins to function. The throat, the organ of the Word, expresses the life and manifests the glory and the reality behind. Such is the symbolism lying behind the teaching of the fusion of the lower energies with the higher, and of this, physical plane sex is a symbol. Mankind today is rapidly becoming more creative, for the transfusion of the energies is going on under the new impulses. As we develop the sense of purity in man, as the growth of the sense of responsibility is fostered, and as his love of beauty, of colour and of ideas proceeds, we shall have a rapid increase in the raising of the lower into union with the higher, and thereby the beautifying of the Temple of the Lord will be tremendously accelerated."
					],
					"page": 27,
					"chapter": 2
				},
				{
					"t": "p",
					"runs": [
						"In the coming Aquarian age this will go rapidly forward. The majority of people today live below the diaphragm, and their energies are turned outward into the material world and prostituted to material ends. In the coming centuries this will be corrected; their energies will be transmuted and purified, and men will begin to live above the diaphragm. They will then express the potencies of the loving heart, of the creative throat, and of the divinely ordered will of the head. Of this relation",
						29,
						"between the lower and the higher, physical plane sex is the symbol."
					],
					"page": 28,
					"chapter": 2
				},
				{
					"t": "p",
					"runs": [
						"But in the head of man himself is also to be found a marvellous symbolic happening. In that living organism is enacted that drama whereby the purely human being merges himself in divinity. The great final drama of the mystical union between God and man, and between the soul and the personality is there enacted. According to the Eastern philosophy, there are in the head of man two great energy centres. One of them, the centre between the eyebrows, blends and fuses the five types of energy which are transmitted to it and blended with it,—the energy of the three centres below the diaphragm and of the throat and heart centres. The other, the head centre, is awakened through meditation, service and aspiration, and it is through this centre that the soul makes its contact with the personality. This head centre is the symbol of the spirit or positive masculine aspect, just as the centre between the eyebrows is the symbol of matter, of the negative feminine aspect. Connected with these force vortices are two physical plane organs, the pituitary body and the pineal gland. The first is negative and the second is positive. These two organs are the higher correspondences of the male and female organs of the physical reproduction. As the soul becomes increasingly potent in the mental and emotional life of the aspirant, it pours in with greater power into the head centre. As the man works with his personality, purifying it and bending it to the service of the spiritual will, he automatically raises the energies of the centres in the body up to the centre between the eyebrows. Eventually the influence of each of the two centres increases and becomes wider and wider, until they make a contact with each other’s vibratory or magnetic field, and instantly the light flashes out. Father-spirit and mother-matter unite",
						30,
						"and are at-one and the Christ is born. “Except a man be born again, he cannot see the kingdom of God,” said the Christ. This is the second birth, and from that moment vision comes with increasing power."
					],
					"page": 29,
					"chapter": 2
				},
				{
					"t": "p",
					"runs": ["This is again the great drama of sex, re-enacted in man. Thus in his personal life he three times knows the meaning of union, of sex:"],
					"page": 30,
					"chapter": 2
				},
				{
					"t": "li",
					"runs": ["1. In the physical plane sex, or his relation to his opposite, the woman, resulting in the reproduction of the species."],
					"page": 30,
					"chapter": 2
				},
				{
					"t": "li",
					"runs": ["2. In the union of the lower energies with the higher, resulting in the creative work."],
					"page": 30,
					"chapter": 2
				},
				{
					"t": "li",
					"runs": ["8. In the union within the head of the energies of the personality with those of the soul, resulting in the birth of the Christ."],
					"page": 30,
					"chapter": 2
				},
				{
					"t": "p",
					"runs": ["Great is the glory of man and wonderful are the divine functions which he embodies. Through the passage of time, the race has been brought to the point where man is beginning to raise the lower energies into the higher centres, and it is this transition which is causing much of the trouble in the world today. Many men everywhere are becoming politically, religiously, scientifically, or artistically creative, and the impact of their mental energy and of their plans and ideas is making itself felt competitively. Until the idea of brotherhood dominates the race, we shall see these powers prostituted to personal ends and ambitions, and to consequent disaster, just as we have seen the power of: sex prostituted to personal satisfaction and selfishness and consequent disaster. Some few, however, are raising their energies higher still and translating them into terms of the heavenly world. The Christ is being born today in many a human being, and increasingly will the sons of God appear in their true nature to take over the guidance of humanity in the New Age."],
					"page": 30,
					"chapter": 2
				},
				{
					"t": "h2",
					"id": "c2-2-sex-in-the-new-age",
					"s": "2. Sex in the New Age",
					"page": 31,
					"chapter": 2,
					"section": true
				},
				{
					"t": "p",
					"runs": ["Prophecy is ever a dangerous thing, but a forecast, a drawing out of present general tendencies, is often possible."],
					"page": 31,
					"chapter": 2
				},
				{
					"t": "p",
					"runs": ["During the next two hundred years the old influences under which we have been living will gradually die out, and the new potencies will make their presence felt. Three things we are told will characterise the coming Aquarian age, and they will be made possible through the influence of the three planets governing the three decanates of this sign. First, we shall have the activity of Saturn, producing a dividing of the ways and a proffering of opportunity to those who can avail themselves of it. We shall have, therefore, a period of discipline and a cycle wherein choices will be made, and through these discriminating decisions humanity will enter into its birthright. This influence is now being strongly felt."],
					"page": 31,
					"chapter": 2
				},
				{
					"t": "p",
					"runs": ["Then, later, we shall have, through the influence of Mercury in the second decanate, the pouring in of light, of mental and spiritual illumination, and a truer interpretation of the teaching of the Lodge of Messengers. The work of the first decanate will enable many to make those choices and efforts which will enable them to raise the lower energies into the higher centres, and to transfer the focus of their attention from below to above the diaphragm. The work of the second decanate will enable those who are thus ready to fuse the personality and the soul, and thus, as I earlier pointed out, the light will shine forth and Christ will be born within them."],
					"page": 31,
					"chapter": 2
				},
				{
					"t": "p",
					"runs": [
						"During the third decanate we shall see the rule of Brotherhood inaugurated, and Venus controlling by intelligent love; the group and not the individual will be the important unit, and unselfishness",
						32,
						"and cooperation will steadily take the place of separativeness and competition."
					],
					"page": 31,
					"chapter": 2
				},
				{
					"t": "p",
					"runs": [
						"In no department of life will these coming great changes show more potently than in the attitude of man towards sex, and in the readjustment of the marriage relationship. This new attitude will gradually come about as the slowly developing science of psychology comes into its own. As man comes to understand his own threefold nature, and as the nature of consciousness and the depth of his own subconscious life are more truly grasped, there will take place, gradually and automatically, a change in the attitude of men towards women and of women towards their destiny. This needed change will not be the result of legal measures, or of decisions by the people’s representatives to meet the disasters of the hour; these changes will come slowly, as the result of the intelligent interest of the next three generations. The young people now coming into incarnation, and those who will come during the next century, will prove themselves well equipped to handle this problem of sex, because they can see more clearly than the older generation, and will think in wider and larger terms than is common today. They will be more group-conscious and less individualistic and selfish; they will be more interested in new ideas than in the ancient theologies, and will be freer from prejudice and less intolerant than are the bulk of the well-meaning people of today. Psychology is only just come into its own, and only now is its function beginning to be understood; in one hundred years’ time, however, it will be the dominating science; and the newer educational systems, based on scientific psychology, will have completely superseded our modern methods. The emphasis in the future will be laid upon the determining of aman’s life purpose. This will be brought about through an understanding of his ray, through an analysis of",
						33,
						"his equipment (and of this, vocational psychology is the faint first beginning), through a study of his horoscope, and through giving him a sound grounding in mind control, as well as training his memory to the impartation of information. The processes by which he can integrate his personality and raise and purify his living qualities will receive careful attention, and all to the end of making him group-conscious and useful to his group. This is the factor of importance. Synthesis, physical purity, decentralisation and group good will be the keynotes of the teaching imparted. Emotional control and right-thinking will be inculcated, and where these are present a knowledge of spiritual realities will be automatically acquired and the life subordinated to the group purpose. Man’s relations to others will then be intelligently directed, and his relation to the other sex will be guided not only by love and desire, but by an ordered intellectual appreciation of the true significance of marriage. The above applies to the intelligent, well-intentioned majority whose standards will have developed as the decades pass, so that they will embody the dreams and ideals of the most advanced visionaries of today. The unthinking, the idle and the stupid will still be found, but evolution proceeds apace and order is on its way."
					],
					"page": 32,
					"chapter": 2
				},
				{
					"t": "p",
					"runs": ["What laws will be enacted for the control of the people on this difficult subject of sex I cannot say; what the marriage laws will be it is no part of my purpose to foretell; how the legislatures of the nations will deal with the problem remains to be seen. I am not interested in speculation."],
					"page": 33,
					"chapter": 2
				},
				{
					"t": "p",
					"runs": [
						"But I can and I shall put down for you here the basic premises which will underlie the best thought of the future on the subject of sex and marriage. These premises are three in number; when they are understood and grasped, and when they are integrated into the thought of the period,",
						34,
						"forming the basis of all recognised standards and consistent living, then the details as to how and where and when will take care of themselves."
					],
					"page": 33,
					"chapter": 2
				},
				{
					"t": "li",
					"runs": ["1. The relation of the sexes and their approach to"],
					"page": 34,
					"chapter": 2
				},
				{
					"t": "p",
					"runs": ["the marriage relation will be regarded as a part of the group life and as serving the group good; this will not be the result of laws regulating marriage, but a result of education in group relations, service and the law of love, as understood practically and not just sentimentally. Men and women will know themselves as, cells in a vital organism, and their activities and outlook will be coloured by this realisation. It will be regarded as a fact in nature and as a product of past evolutionary cycles, and not be looked upon as a theory and a hope, as is the case today. What is best for the group, and what is needed to promote the efficiency of a unit in the group, will be the points considered. Men will increasingly live in the world of thought and understanding, and not so much in the world of ill-regulated desire and of animal instinct; the love of men for women and of women for men will be more truly present than is now the case, for it will not be so purely emotional, and it will be based also on intelligence."],
					"page": 34,
					"chapter": 2
				},
				{
					"t": "p",
					"runs": [
						"As the creative urge is turned upwards from the sacral centre to the throat, man will live less potently in his physical sexual urges, and more consistently in his creative expression. His physical plane life will proceed along normal lines, but it is necessary for men to realise that the manner in which man today satisfies his sexual nature is abnormal and unregulated, and that we are on our way to a wise normality. The craving for selfish pleasure and for the satisfaction of an animal urge, which is instinctually right when regulated and devastatingly wrong when prostituted purely to enjoyment, will give place to a mutual decision by both of the parties concerned. The decision will",
						35,
						"meet a natural need in a right and suitable and regulated manner. Today one party or other is usually sacrificed, either to an undue abstinence or to an unseemly profligacy."
					],
					"page": 34,
					"chapter": 2
				},
				{
					"t": "li",
					"runs": ["2. The second rule is based upon the point of"],
					"page": 35,
					"chapter": 2
				},
				{
					"t": "p",
					"runs": ["evolution, and for its right fulfillment necessitates the true integration of the personality. This rule might be expressed as follows: True marriage and right sexual relation should involve the marriage of all three aspects ofman’s nature; there should be a meeting on all three levels of consciousness at once—the physical, the emotional and the mental. Aman and a woman, to be truly and happily married, must be complements to each other in all the three departments of their nature, and there should be a simultaneous union of all three. How seldom is this the case, and how rare it is to find! There is no need for me to elaborate in this direction, for this truth is obvious and has oft been voiced. Later, but not for a long while yet, we shall see marriages which will be based upon the point of development of the integrated personality, and only those will meet each other in the sacred marriage ritual who have reached the same point in the work of transmuting the lower into the higher centres; a marriage will be regarded as undesirable and the parties ill-mated where oneis living the life of the purified personality above the diaphragm, and the other the life of the intelligent animal below the diaphragm. Finally some few will choose their mates from amongst those in whom the Christ has been born again, and who are giving expression to the Christ life. But the time is not yet, except for the rare and the few."],
					"page": 35,
					"chapter": 2
				},
				{
					"t": "li",
					"runs": ["3. The third governing principle will be the desire to provide good and fair and healthy bodies for"],
					"page": 35,
					"chapter": 2
				},
				{
					"t": "p",
					"runs": [
						"incoming egos. This is not possible today, under our ill-regulated system of co-habitation. The majority of the children who are born now have come",
						36,
						"accidentally into being or are not wanted. Some few, of course, are desired, but even in these cases, that desire is usually based on reasons of heredity, property to be passed on, an old name to be perpetuated, an unfulfilled ambition to be satisfied; yet the day of ordained and desired births is drawing nearer, and when it comes it will make possible the more rapid incarnation of disciples and initiates. Right preparation will take place prior to any fulfillment of the sex urge, and souls will be attracted to their parents by the urgency of those parents’ desire, the purity of their motives and the power of their preparatory work."
					],
					"page": 35,
					"chapter": 2
				},
				{
					"t": "p",
					"runs": ["When these three motives are carefully studied, and when men and women mould their physical plane relationship to each other upon their group responsibilities, upon their union with each other on all three planes simultaneously, and upon the offering of opportunity for incoming souls, then we shall indeed see a restoration of the spiritual aspect of marriage. We shall see the coming in of that era when good will will be the outstanding characteristic, and wherein selfish purpose and animal instinct will fade into the background."],
					"page": 36,
					"chapter": 2
				},
				{
					"t": "h2",
					"id": "c2-3-some-suggestions-for-the-present-cycle",
					"s": "3. Some Suggestions for the Present Cycle",
					"page": 36,
					"chapter": 2,
					"section": true
				},
				{
					"t": "p",
					"runs": [
						"I have been occupied with indicating a situation which at present exists, and in pointing out an ideal one which lies ahead, but which is not as yet possible. This is valuable, but it leaves a gap in our thought which requires filling. The question now arises which is capable of formulation in the following terms: Given the accuracy of my presentation of the present appalling conditions, given the possibility of an ultimate approximation to the presented ideal in a distant future, is it possible at this time to take steps which will eventually lead to the necessary adjustments in the department of",
						37,
						"sex? It most certainly is, and my answer takes the following form."
					],
					"page": 36,
					"chapter": 2
				},
				{
					"t": "p",
					"runs": ["When certain basic postulates, four in number, have been presented and kept before the mind of the public, they will finally lead to such an education of public opinion that the needed activities will follow. But the first step is the education of the public, and their grasp of the four essential laws. Any correction of present conditions will come as a growth from within humanity itself, and not as the imposition of a ruling from without. The training of the public consciousness must therefore go steadily forward, and thus we shall lay the foundation for the later changes."],
					"page": 37,
					"chapter": 2
				},
				{
					"t": "p",
					"runs": [
						"I should like here to remind you that the coming three generations (in which I include the present one of boys and girls) will bring into incarnation a group of people who will be well equipped to lead humanity out of the present impasse. This fact warrants remembrance, and is often forgotten. There are always those at every epoch in human history who are able to solve the problems which arise, and who are sent in for that very purpose. This sex problem, in the last analysis, is a temporary one, little as you may think it today, and it grows out of a basic mistake,—out of the prostitution of man’s God-given faculities to selfish physical ends, instead of the consecration to divine purposes. Man has been swept and carried off his feet by his instinctual animal nature, and only a clear and clean mental understanding of the real nature of his problem will be strong enough to carry him forward into the New Age and into the world of right motive and right action. Man has to learn and deeply grasp the fact that the main purpose of sex is not the satisfaction of the appetites, but the providing of physical bodies through which life may express itself. He has to understand the nature of the symbolism underlying the sexual relation,",
						38,
						"and by its means grasp the scope of the spiritual realities. The Law of Sex is the law of those relations whereby life and form are brought together in order that divine purpose may be seen. This is a fundamental law of creation, and it is true, whether one is dealing with the informing Life of a solar system, with the birth of an animal, or with the appearance of a plant from a seed. “Sex” is the word we use to cover the relation which exists between that energy we call “life” and the aggregate of force units through which that energy expresses itself and builds a form. It covers the activity which takes place when the pairs of opposites are brought together, and by means of which they become at-one and produce a third reality. That third reality or result bears witness to their relation, and another life in form is seen. You have always, therefore, relation, at-onement and birth. These three words deal with the true significance of sex."
					],
					"page": 37,
					"chapter": 2
				},
				{
					"t": "p",
					"runs": [
						"But man has prostituted the truth, and the real significance has been lost. Sex now means the satisfaction of the male desire for sensuous pleasure, and the assuaging of a physical appetite through the prostitution of the feminine aspect to that desire and appetite. This relation leads to no result as intended, but to a momentary second of satisfaction, and all of it is confined to the animal nature and the physical plane. I am largely generalising and would remind you that there are exceptions to all generalisations. I should also like to add that no one must here think that I hold the masculine aspect as responsible for our present problem when I say that man uses woman for his pleasure. How can I mean this, when I know that every human being is cyclically either a man or a woman; that the men of today have been women and the women have been men in previous lives? There is no sex, as we understand it, where souls are concerned; it",
						39,
						"is only in the form life that sex exists. Only in the process of differentiation for the purposes of experimentation does the incarnating spiritual man occupy first a male body and then a feminine, thus rounding out the negative and positive aspects of the form life. All the race is equally guilty, and all must be equally active in the process of creating the correct conditions, and in bringing order out of the present chaos."
					],
					"page": 38,
					"chapter": 2
				},
				{
					"t": "p",
					"runs": ["Therefore, the first postulate which must be laid down, and to which the general public must be educated, is that all souls incarnate and reincarnate under the Law of Rebirth. Hence each life is not only a recapitulation of life experience, but an assuming of ancient obligations, arecovery of old relations, an opportunity for the paying of old indebtedness, a chance to make restitution and progress, an awakening of deep-seated qualities, the recognition of old friends and enemies, the solution of revolting injustices, and the explanation of that which conditions the man and makes him what he is. Such is the law which is crying now for universal recognition, and which, when understood by thinking people, will do much to solve the problems of sex and marriage."],
					"page": 39,
					"chapter": 2
				},
				{
					"t": "p",
					"runs": [
						"Why will this be so? Because when this law is admitted as a governing intellectual principle, all men will tread more carefully the path of life, and will proceed with greater caution to fulfill their family and group obligations. They will know full well that “whatsoever a man soweth, that will he also reap,” and that he will reap it here and now, and not in some mystical and mythical heaven or hell; he will have to make his adjustments in the life of every day upon earth, which provides an adequate heaven and a more than adequate hell. The spreading of this doctrine of rebirth, its scientific recognition and proving, is fast going forward,",
						40,
						"and during the next ten years it will be the subject of much attention."
					],
					"page": 39,
					"chapter": 2
				},
				{
					"t": "p",
					"runs": ["The second basic postulate was enunciated for us by Christ when he told us to “love our neighbor as ourselves.” To this we have paid, as yet, but little attention. We have loved ourselves and have sought to love those we like. But to love universally and because our neighbor is a soul as we are, with a nature essentially perfect and an infinite destiny, this has always been regarded as a beautiful dream to be consummated in a future so distant, and in a heaven so far away, that we may well forget it. Two thousand years have gone since the greatest expression of God’s love walked on earth and bade us love each other. Yet still we fight and hate and use our powers for selfish ends, our bodies and our appetites for material pleasures, and our efforts at living are, in the mass, primarily directed towards personal selfishness. Have you ever considered what the world would today be if man had listened to the Christ and had sought to obey His command? We should have eliminated much disease (for the diseases originating in the misuse of the sex function underlie a large percentage of our physical ills, and devastate our modern civilisation), we should have made war impossible, we should have reduced crime to a minimum, and our modern life would be an exemplification of a manifesting divinity. But this has not been the case, and hence our modern world conditions."],
					"page": 40,
					"chapter": 2
				},
				{
					"t": "p",
					"runs": [
						"But the new law must, and will, be enunciated. This law can be summed up in the words: Let a man so live that his life is harmless. Then no evil to the group can grow out of his thoughts, his actions or his words. This is not negative harmlessness, but of a difficult and positive activity. If the above practical paraphrase of the words of Christ were universally promulgated and practically applied, we should have order growing out of chaos, group",
						41,
						"love superseding personal selfishness, religious unity taking the place of fanatical intolerance, and regulated appetites instead of license."
					],
					"page": 40,
					"chapter": 2
				},
				{
					"t": "p",
					"runs": ["The two laws I have proclaimed, and the two postulates I have above enunciated, sound like platitudes. But platitudes are the universal and recognised truths, and a truth is a scientific pronouncement. The moulding of the life by these two recognitions (the Law of Rebirth and the Law of Love) would save humanity and rebuild our civilisation. They are probably too simple to evoke an interested recognition. But the power lying behind them is the power of divinity itself, and their recognition is simply a question of time, for evolution will force the recognition at some distant date. The forming of an earlier recognition lies in the hands of the disciples and thinkers of the present age."],
					"page": 41,
					"chapter": 2
				},
				{
					"t": "p",
					"runs": ["The third basic law underlying the solution of our modern problems, including that of sex, grows normally out of the other two laws. It is the Law of Group Life. Our group relations must be seen and acknowledged. Not only must a man fulfill in love his family and national obligations, but he must think in the wider terms of humanity itself, and so bring the Law of Brotherhood into expression. Brotherhood is a group quality. The young people who are now coming in will come into life equipped with a much deeper sense of the group, and with their group awareness much more fully developed than is now the case. They will solve their problems, including the problem of sex, by asking themselves when situations arise of a difficult nature: Will this action of mine tend to the group good? Will the group be hurt or suffer if"],
					"page": 41,
					"chapter": 2
				},
				{
					"t": "p",
					"runs": ["and so? Will this benefit the group and produce"],
					"page": 41,
					"chapter": 2
				},
				{
					"t": "p",
					"runs": [
						"I do thus group progress, group integration, and group unity? Action which fails to measure up to the group requirements will then automatically be",
						42,
						"discarded. In the deciding of problems, the individual and the unit will slowly learn to subordinate the personal good and the personal pleasure to group conditions and group requirements. You can see, therefore, how the problem of sex will also yield to solution. An understanding of the Law of Rebirth, a good-will towards all men, working out as harmlessness, and a desire for group good-will will gradually become determining factors in the racial consciousness, and our civilisation will adjust itself in time to these new conditions."
					],
					"page": 41,
					"chapter": 2
				},
				{
					"t": "p",
					"runs": ["The final postulate which I seek to emphasize is that the keeping of these three laws will lead necessarily to an urgent desire to keep the law of the land in which a particular soul has incarnated. That these man-made laws are inadequate I well know, and it is needless to point this out. They may be, and are, temporary and insufficient to the need. They may fail in their scope and prove inadequate, but they do, in a measure, safeguard the little feeble ones, and will be regarded therefore as binding upon those who are seeking to help the race. These laws are subject to change as the effect of the three great laws makes itself felt, but until they are wisely altered (and this takes time) they act as a brake on license and on selfishness. They may also work hardship. This none can deny. But the hardships they bring are not so evil in their nature nor so lasting in their effects as would be the result of their removal and the consequent inauguration of a cycle of law-less-ness. Therefore, the server of the race co-operates with the laws of the land in his daily life, working at the same time for the removal of the injustices they may produce and for the bettering of the legal impositions upon mankind in his country."],
					"page": 42,
					"chapter": 2
				},
				{
					"t": "p",
					"runs": ["In the recognition of these four laws;,—of Rebirth, of Love, of the Group, and of the Land,—we shall see the salvation of the race. (7 — 268/303)."],
					"page": 42,
					"chapter": 2
				},
				{
					"t": "p",
					"runs": [
						"(8) At this time, the whole world is embroiled in the chaos and the turmoil incident upon the clashing of the forces of the sixth and the seventh rays. As one ray passes out and another comes into manifestation and their impact upon the earth and upon all the forms in all the kingdoms of nature has reached the point where the two influences are equalised, then a definite point of crisis is reached. This is what has occurred today, and humanity, subjected to two types or forms of energy, is thrown “off centre” and hence the intense difficulty and tension of the present world period. The cause of this is not only the impact of the two types of energy, beating upon the forms of life with equal force, but also that the energy of humanity itself (which is a combination of the fourth and fifth rays) is swept into the conflict. To this must also be added the energy of the animal kingdom (again a combination of the energies of the third, fifth and sixth rays) for this governs the animal or physical form of every human being. You have, therefore, a meeting of many conflicting forces and the world Arjuna is faced with a stupendous battle—one that is recurrent and cyclic but which will, in this particular era, prove a decisive and determining factor in the age old conflict between material domination and spiritual control. The forces playing upon the planet at this time are of supreme importance. If you will bear in mind that the sixth ray works through and controls the solar plexus (being closely related to the astral plane, the sixth level of awareness) and that the seventh ray controls the sacral centre, you will see why there is so much emotion, so much idealism and so much desire mixed up in connection with the world conflict and why also—apart from the storms in the political arena and the religious field—that sex and its various problems has reached a point of interest in the human consciousness where a solution of these",
						44,
						"difficulties, a fresh understanding of the underlying implications and a frank dealing with the situation is inevitable and immediate."
					],
					"page": 43,
					"chapter": 2,
					"kind": "extract"
				},
				{
					"t": "p",
					"runs": ["Four problems will be solved in the next two centuries...[one being] the problem of sex which will involve a truer understanding of the law of attraction. (5 — 32/4)."],
					"page": 44,
					"chapter": 2
				}
			]
		},
		{
			"id": "c03",
			"title": "Sex and Discipleship",
			"page": 45,
			"blocks": [
				{
					"t": "h1",
					"id": "c03",
					"s": "Sex and Discipleship",
					"page": 45,
					"chapter": 3
				},
				{
					"t": "p",
					"runs": ["(1) I want to write a word on the subject of sex in the life of the disciple. There is much confusion in the minds of aspirants on this matter, and the injunction as to celibacy is assuming the position of a religious doctrine. We are often told by the well-meaning but illogical that if a man is a disciple he cannot marry, and that there is no real spiritual attainment unless a man is celibate. This theory has its roots in two things:"],
					"page": 45,
					"chapter": 3,
					"kind": "extract"
				},
				{
					"t": "p",
					"runs": ["First, there has ever been a mistaken attitude in the East towards women. Secondly, in the West, from the time of Christ, there has been a tendency towards the monastic and conventual conception of spiritual life. These two attitudes embody two mistaken ideas, and lie at the root of much misunderstanding and at the heart of much evil. Man is no better than the woman, nor woman than the man. Yet many thousands regard women as embodying that which is evil and that which is the basis of temptation. But God has from the beginning ordained that men and women should meet each other’s needs and act as complements to each other. God has not ordained that men should live herded together, away from women, or women away from men; and both of these great systems have led to much sexual abuse and to much suffering."],
					"page": 45,
					"chapter": 3
				},
				{
					"t": "p",
					"runs": [
						"The belief that to be a disciple necessitates a celibate life and complete abstinence from all natural functions is neither correct nor desirable. This can be proved by the recognition of two things: The first is that if divinity is indeed a reality and an expression of omnipotence’ and omnipresence as well as omniscience, and if man is essentially divine, then there can be no condition possible wherein divinity cannot be supreme. There can be",
						46,
						"no sphere of human activity where man cannot act divinely and wherein all functions cannot be illumined by the light of pure reason and divine intelligence. I deal not here with the specious and devious argument that that which normally and by all right-minded people is regarded as wrong must be right because of man’s inherent divinity. That can be but a loose excuse for wrong-doing. I speak of sexual relations of the right kind, within the permit of the spiritual law as well as the law of the land."
					],
					"page": 45,
					"chapter": 3
				},
				{
					"t": "p",
					"runs": [
						"Secondly, a life that is not normally rounded out till all the functions of its nature—animal, human and divine—(and man is all of these three in one body) are exercised, is frustrated, inhibited, and abnormal. That all cannot marry in these days is true, but that fact does not negate the greater fact that man has been created by God to marry. That all are not in a position where they can today live normal and full lives is equally a consequence of our present abnormal economic conditions; but this in no way negates the fact that the condition is abnormal. But that an enforced celibacy is an indication of a deep spirituality, and a necessary part of all esoteric and spiritual training, is equally false, abnormal and undesirable. There is no better training school for a disciple and an initiate than family life, with its enforced relations, its scope for adjustments and adaptability, its demanded sacrifices and service, and its opportunities for the full expression of every part of man’s nature. There is no greater service to be rendered to the race than the proffering of bodies to incoming souls, and the giving of attention and educational facilities to those souls within the home limits. But the whole condition and problem of the family life and of child-bearing have been distorted and misunderstood; and it will be long before marriage and children assume their rightful place as sacraments,",
						47,
						"and longer still before the pain and suffering consequent upon our mistakes and on the misuse of the sexual relation have disappeared, and the beauty and consecration of marriage and of the manifestation of souls in form supersede the present wrong grouping of ideas."
					],
					"page": 46,
					"chapter": 3
				},
				{
					"t": "p",
					"runs": ["The disciple and aspirant upon the Path, and the Initiate upon his “Lighted Way,” have no better training ground therefore than the marriage relation, rightly used and rightly understood. The bringing of the animal nature under rhythmic discipline, the elevation of the emotional and the instinctual natures upon the altar of sacrifice, and the self-abnegation required in the life of the family are tremendous purificatory and developing potencies. The celibacy required is that of the higher nature to the demands of the lower, and the refusal of the spiritual man to be dominated by the personality and the demands of the flesh. The attitude of an imposed celibacy upon the equipment of many a disciple has led to much prostitution and to many perversions of God-given functions and faculties; and even where there has not been this distressing condition, and where the life has been sane, consecrated and sound, there have frequently been undue suffering and much mental distress and disciplining, before unruly thoughts and tendencies could be controlled."],
					"page": 47,
					"chapter": 3
				},
				{
					"t": "p",
					"runs": [
						"It is of course true that sometimes a man may be called to some particular life wherein he is faced with the problem of celibacy, and is forced to abstain from all physical relations and to live a strictly celibate life, in order to demonstrate to himself that he can control the animal and instinctual side of his nature. But this condition is frequently the result of excess and license in a previous life, which necessitates stringent measures and abnormal conditions in order to offset and rectify past errors and give the lower nature time to",
						48,
						"readjust itself. But again it is no indication of spiritual development, rather the reverse. Forget not that here I am dealing with the special case of self-applied celibacy, and not with the present world-wide condition wherein, through economic and other reasons, men and women are forced to live without a natural and full life expression."
					],
					"page": 47,
					"chapter": 3
				},
				{
					"t": "p",
					"runs": ["The sex problem must, in the last analysis, be solved in the home and under normal conditions, and it is the advanced people of the world and the disciples of all degrees who must thus solve it. (7 —304/7)."],
					"page": 48,
					"chapter": 3
				}
			]
		},
		{
			"id": "c04",
			"title": "Marriage and Parenthood",
			"page": 49,
			"blocks": [
				{
					"t": "h1",
					"id": "c04",
					"s": "Marriage and Parenthood",
					"page": 49,
					"chapter": 4
				},
				{
					"t": "p",
					"runs": ["(1) Many who are reading this section of my instructions will be disappointed (so futile and silly is the human mind in so many cases) because I do not choose to consider now the means whereby the Members of the Hierarchy will adjust Themselves to modern living conditions, as to what food They will eat and whether They will marry or not marry. One thing only will I say: They will take modern life and what it means and will proceed to demonstrate how that life (the normal product of the evolutionary process) can be lived divinely; They will express the highest ideal of marriage (I would here remind you that many of the Masters are married and have raised families) and demonstrate the principle which underlies the perpetuation of the race of men; They will also show how all life is one life, that the form nature is ever a sacrificial unity in the vast scheme of divine manifestation; They will show us also that whatever we do, whether we eat or drink, all must be done under correct, temperate and natural law and in a spirit of loving understanding, and ever to the glory of God. They will express ordered, temperate living in all things, and will demonstrate also the possibility of the existence of people on earth who have no wrong inclinations and no bad qualities in their natures. They will stand forth as living examples of goodwill, of true love, of intelligent applied wisdom, of high good nature and humour, and of normalcy. They may indeed be so normal that recognition of what They are may escape notice. (12 —699)."],
					"page": 49,
					"chapter": 4,
					"kind": "extract"
				},
				{
					"t": "p",
					"runs": [
						"(2) Forget not that when a manis living asa soul and his entire personality is therefore subordinated to that soul, unselfish purpose, purity of life, conformity to law and the setting of a true example",
						50,
						"of spiritual living will normally and automatically follow. Food, for instance, is frequently a matter of climatic expediency and of taste, and that food is desirable which keeps the physical body in condition to serve the race. Again, a divine son of God can surely function as freely and as effectively when in the married state as in the celibate; he will however brook no prostitution of the powers of the body to the grosser satisfactions, nor will he offend against established custom, nor lower the standard which the world has set for its highest and best. The issues have been confused and the emphasis has been too often laid upon the physical acts and not upon the life of the actor. When the attention is fixed upon the soul, the physical plane life will be rightly handled. (4 — 420)."
					],
					"page": 49,
					"chapter": 4,
					"kind": "extract"
				},
				{
					"t": "p",
					"runs": ["(3) In the words “peace” and “goodwill” you have two keywords which express the bridging of two cleavages: One in the psychic nature of man, particularly that between the mind and the emotional vehicle which means the attainment of peace, and the other between the personality and the soul. This latter is the resolution of a basic “split”, and it is definitely brought about by the will-to-good. This bridges not only the major cleavage in individual man, but it is that which will bring about the great and imminent fusion between intelligent humanity and the great spiritual centre which we call the spiritual Hierarchy of the planet."],
					"page": 50,
					"chapter": 4,
					"kind": "extract"
				},
				{
					"t": "p",
					"runs": ["of It has been the almost unconscious recognition"],
					"page": 50,
					"chapter": 4
				},
				{
					"t": "p",
					"runs": ["these cleavages and of the need for their fusion which has made marriage, and the consummating act of marriage, the great mystical symbol of the greater inner fusions."],
					"page": 50,
					"chapter": 4
				},
				{
					"t": "p",
					"runs": [
						"May I remind you also that these cleavages are cleavages in consciousness or awareness and not",
						51,
						"in fact? Is that too difficult a matter for us to grasp? Let us ponder upon it. (8 — 448)."
					],
					"page": 50,
					"chapter": 4
				},
				{
					"t": "p",
					"runs": ["(4) Parenthood will not be regarded primarily as an animal function or as a purely social or economic function, which are the usual lines of approach at this present time. The establishing of a deliberately prepared or constructed thread of light (as a definite part of the worldantahkarana) between parent and child, even in the prenatal stages, will be carefully taught. Thus aclose rapport will be brought about “in the light” yet without establishing undue mental control and authority. This latter sentence will show you how impossible it has been to date to hasten the teaching of this new science of the antahkarana. Today it is beginning to be possible to lay the foundation for this new teaching, because the young people in every land are forcing upon their parents and their teachers the idea of their essential and determined independence. The revolt of youth, in spite of all the immediate and individual disasters, has been a desirable thing and has prepared the way for the establishing of right and better relations, based upon the premises which I have laid down."],
					"page": 51,
					"chapter": 4,
					"kind": "extract"
				},
				{
					"t": "p",
					"runs": [
						"It is of course impossible for me to do more than indicate here the basis of the new education which will prepare the youth of the world for the responsibilities and duties of parenthood. The entire problem is tied up with that of sex, and also with the problem of the state and its control, far more than is generally conceded. Those are two problems which are only emerging today into their full significance, and with them I cannot here deal. Parenthood is the result, and the ordained result, of the relation of two animal bodies, and I would have you ponder—even if ineffectually—upon the wider group implications of this statement. Parenthood is what makes a state, a nation, and a",
						52,
						"group possible as far as manifestation is concerned, and here again the vastness of the problem is staggering. Parenthood has also a close symbolic relationship to the Hierarchy, for the family unit is the symbol upon earth of the Hierarchy, and it is through the two facts of sexual relationship and physical birth that the vast Hierarchy of Souls can achieve physical manifestation and attain spiritual perfection in the three worlds of human evolution. One could (and this fact should be carefully borne in mind) divide the Hierarchy into two basic groups:"
					],
					"page": 51,
					"chapter": 4
				},
				{
					"t": "li",
					"runs": ["1. Those souls who have reached perfection and achieved the status of divine servers."],
					"page": 52,
					"chapter": 4
				},
				{
					"t": "li",
					"runs": ["2. Those souls who are in the processes of evolution and passing through the periods of continual incarnation."],
					"page": 52,
					"chapter": 4
				},
				{
					"t": "p",
					"runs": ["The idea of generation, birth and subsequent manifestation runs like a guiding thread through all esoteric thought. The ancient teachers of the race, sent out by the Hierarchy from time to time, ever employed the symbolism of natural process in order to illustrate and make clear the needed instruction, and lay that spiritual foundation of truth which will in the coming age lead the race into new ways and a new manner of thought. For the esotericist, there is the process of birth into the darkness of physical incarnation which—in its turn—is the foreordained preparatory process which leads to birth into light, carried forward in the light and producing the externalisation of the body of light. This continuing process (for in all ages this birth into light has been going forward) will produce that future world of light which it is the purpose of the natural processes of evolution to reveal. This is the “second birth” spoken of in the New Testament, in which a man is “born again” into the world of light and love,"],
					"page": 52,
					"chapter": 4
				},
				{
					"t": "p",
					"runs": ["From the angle of the new education, these new concepts will govern the mental attitude of parents in the coming civilisation, and for this the adolescent must be prepared. It is the misinterpretation of the newer concepts which is prevalent at this time and is thus producing the emphasis laid—in certain countries and among nationalists of all countries—upon the necessity to increase the birth rate. Attention is now being paid to birth rate, its rise and fall, to correct care of mothers and children, even in the prenatal period, and to the education of parents everywhere. Out of all this, new ideas and attitudes must eventually arise which will be in line with the coming world culture and concepts. But today, the motive for this solicitude is wrong. The interior impulse to deal with the whole problem of parenthood in a newer and better way is right. The objectives, however, which are held before the race are not the highest or the most desirable. The necessity of the times will eventually produce radical changes in the approach to family life, parenthood and the training of children, and for this a nucleus is preparing the way—or can do so if faithful, attentive and intelligent work is done."],
					"page": 53,
					"chapter": 4
				},
				{
					"t": "p",
					"runs": ["_.. As I said before, this subject of parenthood and child training is too great for ample or satisfactory discussion in these brief instructions, but certain statements can be made which will be indicative of future developments and point the way to where the changed attitude may be anticipated. Let me list them as follows:"],
					"page": 53,
					"chapter": 4
				},
				{
					"t": "li",
					"runs": ["1. Theemphasisin the future will shift from the urge to produce large families to that of producing quality and intelligence in the offspring. This will include that science of which eugenics is the distorted and exoteric indication. When the fact of the etheric body with its"],
					"page": 53,
					"chapter": 4
				},
				{
					"t": "p",
					"runs": ["force centres is scientifically established, the above prophecy will assume significance and meaning:"],
					"page": 54,
					"chapter": 4
				},
				{
					"t": "p",
					"runs": ["2. The need of an increasing birthrate will be eventually regarded as erroneous, and this for three reasons which it would profit you to study:"],
					"page": 54,
					"chapter": 4
				},
				{
					"t": "p",
					"runs": ["a. Many souls are rapidly achieving perfection and passing away altogether from our planetary life. This process will be intensified during the coming Aquarian Age. It should be remembered that the door will be shut for some time as yet upon the animal kingdom, and for a long period no individualisation will culminate in materialisation into physical bodies. Technically, any individualisation which may take place will be that which is technically called “individualisation into pralaya, there to await the inevitable call.” There will be, therefore, no necessity for a massed and hurried creation of human forms."],
					"page": 54,
					"chapter": 4
				},
				{
					"t": "p",
					"runs": [
						"b. The economic situation will make it necessary that certain physical restrictions should be imposed, because it is now evident that beyond a certain point the planet cannot support humanity. This is more fundamental in its implications than you can imagine. Again, we have evidence of a growing realisation of the race along this particular line; that realisation is as yet distorted and much misunderstood and is today producing the promiscuous use of contraceptive methods. As the intelligence of the race is developed (and that is going on apace), as the Laws of Rhythm. and Approach are grasped, it will then be found that there are certain innate reactions",
						55,
						"which will negate conception, and that then the mechanical means will no longer be required. This sounds as yet extremely vague and almost impossible, but the race is rapidly achieving personality control (e’en though our idea of rapidity may not be yours) and this, in its turn, must produce certain automatic and inherent changes. This is a point which must be grasped by esotericists."
					],
					"page": 54,
					"chapter": 4
				},
				{
					"t": "p",
					"runs": ["c. The widespread promiscuity of the sexes, and the rule in many countries which entitles a man to possess many wives (which is an insult to the woman), will eventually and inevitably cease. It is, in the last analysis, a form of legalised prostitution, and the fact that it has the endorsement of tradition and centuries of practice does not mitigate this position which"],
					"page": 55,
					"chapter": 4
				},
				{
					"t": "p",
					"runs": ["this lack I take. Through"],
					"page": 55,
					"chapter": 4
				},
				{
					"t": "p",
					"runs": [
						"of regulation and of essential rhythm, the natural consequences have occurred, and millions of souls have been brought into incarnation who were never intended at this time to incarnate and achieve exoteric manifestation. This fact is largely responsible for much of the present economic distress and for the modern planetary dilemma. The economic situation and the necessity to provide for the unduly large population of the planet lies behind much of the aggression and greed of the nations down the ages, and for the effort being made today as never before to provide better and more adequate living conditions. War has consequently been the inevitable result of this undue and unlimited propagation of the human species. This lack of sexual control has brought into the world thousands of unwanted",
						56,
						"children whose appearance is solely the result of accidental and uncontrolled sexual relations, and in no way indicates the planned intention of parents—planned because intended to offer experience to incarnating souls, with the conscious intent of offering the opportunity to hasten the “birth into the light” of those particular souls, thus rendering service to the divine plan."
					],
					"page": 55,
					"chapter": 4
				},
				{
					"t": "p",
					"runs": ["3. The science of eugenics and of sex hygiene and the development of mentally controlled relationships will steadily grow. Much that is now taught along these lines is erroneous and wrongly motivated, being based upon fear, expediency and the desire for improved racial attributes and physical perfection. The right form of scientific sex control, leading to those right conditions in which souls may incarnate, cannot be imposed by law. The desired ends may be aided by educational methods and already this is being done in a tentative and embryonic manner; but the real change in human consciousness which is needed will appear only as the race itself is brought under a rhythmic law—under which, for instance, the animal lives function, or the seasonal law under which forms in the vegetable kingdom operate—thus transferring the whole concept on to a higher turn of the evolutionary spiral. This, when it is brought about, will produce certain fundamental changes—regulated sex life, and organised parental life, and mental differences in the racial attitude towards the sex rth."],
					"page": 56,
					"chapter": 4
				},
				{
					"t": "p",
					"runs": [
						"raleeon and its ordained consequence,",
						57,
						"4. As yet, it is only the religious person who thinks in terms of the two necessitated and inevitable births, the physical and the spiritual, and he thinks of the relation between the two as purely symbolic and not in any way to be interpreted literally. Yet there is a close relation and an analogy between the two which, as time elapses, will become more clear. There can be no new birth, no creation of the “body of light,” and no “manifestation of the sons of God” apart from the process of physical incarnation. There can be no fusion of the opposites of soul and personality apart from the physiological processes of sex, and I say this deliberately, for it is in the relation of the sexes that the element of time enters into the experience of the soul, and the understanding of this will come when the doctrine of reincarnation is properly comprehended and taught universally. It is here that sex magic and the inner tantric teachings have gone so woefully astray, and been centralised upon individual development and the attainment of some experience which is presumed to promote spiritual attainment. The underlying idea, governing all that has been given out on the sex relation heretofore, is twofold in its implications:"
					],
					"page": 56,
					"chapter": 4
				},
				{
					"t": "p",
					"runs": ["a. To provide bodies for incarnating souls"],
					"page": 57,
					"chapter": 4
				},
				{
					"t": "p",
					"runs": ["so that certain destined evolutionary"],
					"page": 57,
					"chapter": 4
				},
				{
					"t": "p",
					"runs": ["unfoldments may be carried forward,"],
					"page": 57,
					"chapter": 4
				},
				{
					"t": "p",
					"runs": ["and the attainment of an equally destined and inevitable spiritual unfoldment becomes possible."],
					"page": 57,
					"chapter": 4
				},
				{
					"t": "p",
					"runs": ["b. To impart the scientific procedure"],
					"page": 57,
					"chapter": 4
				},
				{
					"t": "p",
					"runs": ["whereby bodies “built in the dark” may"],
					"page": 57,
					"chapter": 4
				},
				{
					"t": "p",
					"runs": ["gradually be superseded by bodies “built"],
					"page": 58,
					"chapter": 4
				},
				{
					"t": "p",
					"runs": ["in the light.” Thus will be brought about"],
					"page": 58,
					"chapter": 4
				},
				{
					"t": "p",
					"runs": ["the manifestation of the foundational"],
					"page": 58,
					"chapter": 4
				},
				{
					"t": "p",
					"runs": ["light aspect of the world and its underlying structure."],
					"page": 58,
					"chapter": 4
				},
				{
					"t": "p",
					"runs": ["5. The sex relation has, therefore, only one major objective, which is to produce physical bodies for incarnating souls. The relation between the soul and the personality is consequently a higher aspect of the basic sex expression of the universe, and this relation is intended to bring about the appearance of = son of God as light in the world, enabling him to say, as did the Christ, that he is “the light of the world,” and to fulfill the injunction, “let your light shine.” Again, the relation between humanity and the Hierarchy is intended to produce the radiance of group light and cause to emerge, out of these two planetary groups or bodies, through their close fusion and scientific interrelation, that form of divine manifestation to which the name “the Kingdom of God” has been given in the West."],
					"page": 58,
					"chapter": 4
				},
				{
					"t": "p",
					"runs": [
						"I would ask you to ponder on these five points or statements which are only intended to be suggestive, to evoke brooding thought and to indicate those elementary ideas which will bring in the newer attitudes to parental responsibility. In the world today there are many thinking men and women who are conscious of and earnestly desiring the above, and who are working towards these ends. But the mass of people in their untold millions are totally unaware of the situation, either in its economic or esoteric aspects. One of the tasks of the educator of the future will be to teach the meaning of the Law of Rebirth, and thus bring about such a profound change in the racial attitude to life",
						59,
						"and sex, to birth and parenthood, that sex rhythm, cyclic experience, psychological preparation and directed, controlled body-building may go forward and supersede the present methods, which are based upon an uncontrolled response to the sex urge and desire, and the unthinking procreation of children. The vast population of the world today is the result of an animal response to those urges and of the general promiscuity, which is perhaps the outstanding factor, esoterically speaking and from the standpoint of the Hierarchy, of the present world distress, economic difficulties and national aggressions. Think this out, for it holds a clue."
					],
					"page": 58,
					"chapter": 4
				},
				{
					"t": "p",
					"runs": ["Summing up very briefly, I would say that the objective before the race as it enters into the new age is to “create in the light through the ordained activity of the light-body.” This involves the understanding of the different light expressions—the light of understanding, the light of a pre-arranged and comprehended process and the light of experience. With these more subtle aspects of light leading, controlling and directing the human consciousness in relation to racial generation and the perpetuation of the species, and with the science of light (a science dealing with that which concerns substance and form, for it must not be forgotten that light and substance are synonymous terms) forming an integral part of the education of parents and adolescents, we can then look forward to adjustments and changes, which are bound to come, with confidence and assurance that all will be well."],
					"page": 59,
					"chapter": 4
				},
				{
					"t": "p",
					"runs": [
						"The motives leading to marriage will undergo profound changes during the next one thousand years, though the basic motive—that of love between two people—will remain unchanged or more properly emphasised and selflessly expressed. The attitude of parents towards their children will alter",
						60,
						"drastically and the responsibility angle will be continuously emphasised, though that responsibility will be concerned primarily with the time, opportunity and correctness of producing the forms which incarnating souls will assume. The idea of the need for rapid procreation and the production of large families through which the state can achieve its end will be changed. The preparation of adults for the duties of parenthood and their training in the basic necessities of the coming child will shift increasingly to the mental and spiritual levels of consciousness and be less given to physical preparations. The light which is in the parents, which in the days to come will be seen clairvoyantly by an increasing number of people, will be scientifically related to the embryonic light in the child, and the thread of light connecting parent and child (of which the umbilical cord is the exoteric symbol) will be skillfully and patiently constructed. The child will come into incarnation with its light body already embedded and functioning in the physical body and this will be due to the intelligent mental work of the parents. This is not so today, except in the case of very advanced egos, for the light body is inchoate and diffused and simply hovers over the physical form of the child, waiting for an opportunity to enter and irradiate the consciousness. Thus will be brought about an integration in the light substance of the planet which is lacking at this time; and the production of this integration will be definitely initiated:"
					],
					"page": 59,
					"chapter": 4
				},
				{
					"t": "p",
					"runs": ["by the trained parents of the new age and facilitated, as the child matures, by the teaching and influence of the illumined educator. (6 — 131/140)."],
					"page": 60,
					"chapter": 4
				},
				{
					"t": "p",
					"runs": [
						"(5)... there is being formed in the world that “bridge of souls and servers” which will make possible the merging of the inner subjective Hierarchy of souls and the outer world of humanity. This will",
						61,
						"constitute an actual fusion or blending and will mark the initiation of the human family through the achievement of its foremost pioneering members. This is the true “marriage in the Heavens” of which mystical Christianity speaks and the result of this fusion will be the manifestation of the fifth kingdom in nature, the kingdom of God. (13 — 32)."
					],
					"page": 60,
					"chapter": 4
				}
			]
		},
		{
			"id": "c05",
			"title": "Chakras and Sex Energy",
			"page": 62,
			"blocks": [
				{
					"t": "h1",
					"id": "c05",
					"s": "Chakras and Sex Energy",
					"page": 62,
					"chapter": 5
				},
				{
					"t": "p",
					"runs": ["(1) The Sacral Centre.... is located in the lower part of the lumbar area and is a very powerful centre, controlling as it does the sex life. One of the interesting things about this centre is that it must always remain a powerful centre until two-thirds of mankind have taken initiation, for the generative processes must go on and remain active in order to provide bodies for incoming souls. But as the race progresses, this centre will be controlled and its activities will be carried forward intelligently and as the result of knowledge, of insight and of higher and subtler contacts, and not as the result of unlimited and uncontrolled desire, as is now the case. I cannot enlarge further upon this matter as the theme is too big. I can, however, bring to your attention what"],
					"page": 62,
					"chapter": 5,
					"kind": "extract"
				},
				{
					"t": "p",
					"runs": ["that I have already written, and suggest"],
					"page": 62,
					"chapter": 5
				},
				{
					"t": "p",
					"runs": ["someone with the interest and the time should collect all I have said in all my books anent the subject of sex so that a pamphlet on the subject may be compiled."],
					"page": 62,
					"chapter": 5
				},
				{
					"t": "li",
					"runs": ["a. The sacral centre corresponds to the physical sun, the source of vitality, and the life-giving agent on our planet."],
					"page": 62,
					"chapter": 5
				},
				{
					"t": "li",
					"runs": ["b. The symbolism of the sacral centre is concerned primarily with the gestation period prior to birth, and in its right understanding can be traced and expanded the whole story of conception, of form-building, and this whether it is the physical form of a human being, the form of an idea, an organisation built around a central truth, the form of a planet or of a solar system. It is perhaps above everything else the centre through which the forces of IMPERSONALITY must eventually express themselves, and the whole problem of dualism must be solved. This solution and interpretation of the symbol must"],
					"page": 62,
					"chapter": 5
				},
				{
					"t": "p",
					"runs": ["come from the realm of the mind, thereby controlling the physical reaction and occupying itself with purposes and not with desire. Ponder on this. When it is thus understood, then we shall be reaching the point where a great transference can take place into the higher centre of creation, the throat centre. c. The sacral centre is therefore closely related to matter, and there is a flow of energy between three points in the lower part of the human body:"],
					"page": 63,
					"chapter": 5
				},
				{
					"t": "p",
					"runs": ["1. The spleen, the organ of prana or of physical vitality coming from the sun."],
					"page": 63,
					"chapter": 5
				},
				{
					"t": "p",
					"runs": ["2. The sacral centre, the predisposing agent"],
					"page": 63,
					"chapter": 5
				},
				{
					"t": "p",
					"runs": ["towards physical generation."],
					"page": 63,
					"chapter": 5
				},
				{
					"t": "p",
					"runs": ["3. The centre at the base of the spine which"],
					"page": 63,
					"chapter": 5
				},
				{
					"t": "p",
					"runs": ["(until the will aspect is aroused in man)"],
					"page": 63,
					"chapter": 5
				},
				{
					"t": "p",
					"runs": ["feeds the life-giving principle, the will-tolive, to all parts of the human frame. These create a great triangle of force, concerned with matter, with substance, form-building, creation, vitality and persistence in form. This triangle is a reflection of a much higher one, composed of:"],
					"page": 63,
					"chapter": 5
				},
				{
					"t": "p",
					"runs": ["1. The throat centre, corresponding to the"],
					"page": 63,
					"chapter": 5
				},
				{
					"t": "p",
					"runs": ["sacral centre."],
					"page": 63,
					"chapter": 5
				},
				{
					"t": "p",
					"runs": ["2. The pituitary body, corresponding to the"],
					"page": 63,
					"chapter": 5
				},
				{
					"t": "p",
					"runs": ["splenic centre."],
					"page": 63,
					"chapter": 5
				},
				{
					"t": "p",
					"runs": ["3. The pineal gland, corresponding to the"],
					"page": 63,
					"chapter": 5
				},
				{
					"t": "p",
					"runs": ["basic centre."],
					"page": 63,
					"chapter": 5
				},
				{
					"t": "p",
					"runs": [
						"In the relation of these two triangles lies the clue to the instinct of self-preservation, the survival of the subtle bodies after death, and the principle of immortality which is seated in the soul and functions when self-preservation and survival no longer hold sway. This constitutes a triplicity of ideas",
						64,
						"which requires most careful study and which— if"
					],
					"page": 63,
					"chapter": 5
				},
				{
					"t": "p",
					"runs": ["Imight so express it—gives the key to the spiritualistic movement."],
					"page": 64,
					"chapter": 5
				},
				{
					"t": "p",
					"runs": ["d. The sacral centre is also connected with the ajna centre in the last analysis; the two together create a functioning quality which is productive of that subtle quality which we call personality. There is a wide field for investigation in the theme of personality as an integrated whole and in the quality of personality, which is the aroma, the influence, the effect and the radiation of a personality. I throw out these ideas to students, hoping that some research may follow which will relate this subject of the centres to the recognised facts of coordination, integration and their effects in producing greatness."],
					"page": 64,
					"chapter": 5
				},
				{
					"t": "p",
					"runs": ["For those of you who are students of The Secret Doctrine, there is much to be unfolded anent the relation of the “lunar Lords,” the Barhishad Pitris, to the solar Lord or Angel. The field of work of the former is the sacral centre, par excellence; that of the solar Angel is the throat centre."],
					"page": 64,
					"chapter": 5
				},
				{
					"t": "p",
					"runs": ["e. The sacral centre registers the energy of the third aspect of divinity, just as the solar plexus centre registers that of the second aspect and the basic centre expresses the energy of the first aspect. Here again you have the lower centres reflecting the throat, heart and head centres and thus completing the higher and the lower manifestation of the divine Trinity in man. This centre was brought into full functioning activity in old Lemuria, the first human race; its energy is that of the Holy Spirit, overshadowing virgin substance. Here again we find also another divine reflection in the following:"],
					"page": 64,
					"chapter": 5
				},
				{
					"t": "p",
					"runs": ["Sacral Centre"],
					"page": 65,
					"chapter": 5
				},
				{
					"t": "p",
					"runs": ["wi Adrenal Glands"],
					"page": 65,
					"chapter": 5
				},
				{
					"t": "p",
					"runs": ["Eventually, in the Divine Hermaphrodite (later to appear) you will have another combination:"],
					"page": 65,
					"chapter": 5
				},
				{
					"t": "p",
					"runs": ["id Sacral Centre"],
					"page": 65,
					"chapter": 5
				},
				{
					"t": "p",
					"runs": ["/| Adrenal Gland"],
					"page": 65,
					"chapter": 5
				},
				{
					"t": "p",
					"runs": [
						"Again you will note, my brother, how the Science of Triangles governs the human frame in all its aspects, as well as the frame of a solar system. This is to be expected. f. The dense physical externalisation of this centre is to be found in the gonads, the human organs of generation—viewing them as a basic unity, though temporarily separated in the present dualistic expression of the human being. It must be remembered that this separation fosters a powerful impulse towards fusion, and this urge to blend we call sex. Sexis, in reality, the instinct towards unity: first of all, a physical unity. It is the innate (though much misunderstood) principle of mysticism, which is the name we give to the urge to union with the divine. Like all else that undeveloped man has touched, we have perverted and distorted",
						66,
						"a divine idea and prostituted an immaterial urge to material desire. We have reversed the direction of the sacral energy,"
					],
					"page": 65,
					"chapter": 5
				},
				{
					"t": "p",
					"runs": ["hence the overdeveloped animal nature and"],
					"page": 66,
					"chapter": 5
				},
				{
					"t": "p",
					"runs": ["functions of average humanity. (10 —176/180). (2)... The awakening of the sacral centre is of such ancient origin that it is not possible at this time to trace the true history of the development of the difficulties connected with sexual expression, nor is it desirable. I have dealt with the subject of sex in my other treatises, particularly in A Treatise on White Magic. I call attention to it only because in the course of the mystical life there is often a period of sexual difficulty if the mystic has not previously learnt sexual control and unless it has assumed balanced proportions to his other life activities and natural instincts in his consciousness. Else, as he touches the heights of spiritual contact and brings in the energy of his soul to the personality, that energy will pass straight down to the sacral centre and not be arrested at the throat centre, as it rightly should be. When this occurs, then perversions of the sex life may take place, or an undue importance may be attached to the sex activity, or the sexual imagination can be dangerously stimulated, leading to lack of control and to many of the difficulties known to physicians and psychologists. The result is ever an over-activity of the sex life in some form or another. (8 — 538)."],
					"page": 66,
					"chapter": 5
				},
				{
					"t": "p",
					"runs": ["of (3) In the undeveloped human being or in groups in men who are low down in the racial scale, as also"],
					"page": 66,
					"chapter": 5
				},
				{
					"t": "p",
					"runs": [
						"animals, there is much psychic perception because the sacral centre motivates the physical plane life and the solar plexus centre governs the psychic nature. In these cases, all the higher centres are quiescent and undeveloped. The solar plexus is to the worlds of lower psychic perception what the brain is intended to be in the worlds of higher psychic understanding. In the one case, you",
						67,
						"have a centre of energy which is so potent that it swings the man into a state of consciousness which is fundamentally astral, thus governing the sex life from the angle of the sentient consciousness; in the other case, you have so close an identification between the head centre in etheric matter and the brain in physical substance that an organ which is definitely physical functions sympathetically, accurately and synchronouslv with its subjective counterpart, registering impressions from the head centre and the worlds with which that centre puts a man in touch. The two are then as one. (8 — 574)."
					],
					"page": 66,
					"chapter": 5
				},
				{
					"t": "p",
					"runs": ["(4) In the bulk of humanity the sacral centre and the solar plexus govern the life, and that is why desire for material living and for the sex life are so closely blended. The solar plexus in the animal is the brain and governs all the instinctual reactions, but is not so closely allied with the purely sex expression as it is in the human being. When the brain is becoming sensitive to the awakening mind and is not so entirely occupied with the mechanism which registers sensory impression, we shall have the orientation which will eventually raise the consciousness into those centres which lie above the diaphragm. (4 —310)."],
					"page": 67,
					"chapter": 5,
					"kind": "extract"
				},
				{
					"t": "p",
					"runs": ["(5) When the energies of the sacral centre, focussed hitherto on the work of physical creation and generation and therefore the source of physical sex life and interest, are sublimated, re-oriented and carried up to the throat centre, then the aspirant becomes a conscious creative force in the higher worlds; he enters within the veil, and begins to create the pattern of things which will bring about eventually the new heavens and the new earth. (4 — 192)."],
					"page": 67,
					"chapter": 5,
					"kind": "extract"
				},
				{
					"t": "p",
					"runs": ["(6) It should be remembered that the sacral centre and the spleen are primarily connected with the planetary emanation of the Earth itself. (9 — 80)."],
					"page": 67,
					"chapter": 5,
					"kind": "extract"
				},
				{
					"t": "p",
					"runs": ["(7) The table gives man as he is intended to be and not as he now is in the course of his evolutionary progress."],
					"page": 68,
					"chapter": 5,
					"kind": "extract"
				},
				{
					"t": "p",
					"runs": ["1 Self-aseertion the coordinated Centre at base Adrenals"],
					"page": 68,
					"chapter": 5
				},
				{
					"t": "p",
					"runs": ["(full development) quaternary —_—_of spine"],
					"page": 68,
					"chapter": 5
				},
				{
					"t": "p",
					"runs": ["2. Selfexpression Lowerbrain _‘Throat centre Thyroid"],
					"page": 68,
					"chapter": 5
				},
				{
					"t": "p",
					"runs": ["(creative work)"],
					"page": 68,
					"chapter": 5
				},
				{
					"t": "p",
					"runs": ["3. Self-conscious life Upper brain Head centre Pineal gland."],
					"page": 68,
					"chapter": 5
				},
				{
					"t": "p",
					"runs": ["(personality)"],
					"page": 68,
					"chapter": 5
				},
				{
					"t": "p",
					"runs": ["4. Self-perpetuation Sex organs Sacral centre Sex glands 5. Mental life Cerebro-spinal = Ajna centre Pituitary"],
					"page": 68,
					"chapter": 5
				},
				{
					"t": "p",
					"runs": ["system"],
					"page": 68,
					"chapter": 5
				},
				{
					"t": "p",
					"runs": ["6. Sensory life Sympathetic Solar plexus Pancreas"],
					"page": 68,
					"chapter": 5
				},
				{
					"t": "p",
					"runs": ["‘nervous eystem"],
					"page": 68,
					"chapter": 5
				},
				{
					"t": "p",
					"runs": ["7 Cell life Blood stream Heart centre Heart"],
					"page": 68,
					"chapter": 5
				},
				{
					"t": "p",
					"runs": ["(8)... 1 was anxious to have clearly established the difference which will be found existing between the rays governing the elementals of the three lower bodies and that of the personality. The life of these three elementals is founded primarily in the three lowest centres in the etheric body:"],
					"page": 68,
					"chapter": 5
				},
				{
					"t": "li",
					"runs": ["1. The sacral centre... the mental elemental life. Transferred later to the throat centre."],
					"page": 68,
					"chapter": 5
				},
				{
					"t": "li",
					"runs": ["2. The solar plexus centre... the astral elemental life. Transferred later to the heart centre."],
					"page": 68,
					"chapter": 5
				},
				{
					"t": "li",
					"runs": ["3. The centre at the base of the spine... the physical elemental life. Transferred later to the head centre."],
					"page": 68,
					"chapter": 5
				},
				{
					"t": "p",
					"runs": ["(9)... The relation between the centres below the diaphragm and those above, or between:"],
					"page": 68,
					"chapter": 5
				},
				{
					"t": "li",
					"runs": ["a. The centre at the base of the spine and the thousand petalled lotus, the head centre. In this the four petals of the basic centre become the many, or the quaternary is lost in the universal."],
					"page": 68,
					"chapter": 5
				},
				{
					"t": "li",
					"runs": [
						"b. The sacral centre and the throat. In this there comes a union between the twelve Creative",
						69,
						"Hierarchies and the quaternary, and the secret of the sixteen petals of the throat lotus is seen."
					],
					"page": 68,
					"chapter": 5
				},
				{
					"t": "li",
					"runs": ["c. The solar plexus centre and the heart, in which the ten of the perfect man in this solar system is lost in the consummated twelve. As the twelve Creative Hierarchies (in their outer and creative aspect) are contacted by the man, who is the perfected quaternary from the standpoint of the form, so in the relation between the solar plexus and heart is the second aspect perfected; the love of the soul can express itself perfectly through the emotional nature. (4 — 87)."],
					"page": 69,
					"chapter": 5
				},
				{
					"t": "p",
					"runs": ["(10) Many schools are simply forcing schools, prematurely developing the higher faculties and leading the aspirant (if I might express it in mystical language) directly out of the realm of feeling and of desire into that of the intuition, but leaving the intellectual faculties and the mental apparatus totally undeveloped and latent. When this is the case then—again speaking mystically—an hiatus or agap occurs, in part of the equipment which the soul must perforce use in the three worlds of its endeavour. The interpreting, organising, understanding mind is unable to play its part. Where there is lack of understanding and of mental ability, there is danger of misapprehension, of credulity and of wrong interpretation of the phenomena of other states of being. A sense of values will be lacking, and the aspirant will over-estimate the non-essentials and fail to grasp the value of the spiritual realities."],
					"page": 69,
					"chapter": 5,
					"kind": "extract"
				},
				{
					"t": "p",
					"runs": [
						"Energy may pour into the force centres... but because there is no directing intelligence it willrun riot and we then have those sad cases which strew the path of occult endeavour and have brought the work of the Lodge into disrepute—cases of overemphasized",
						70,
						"personalities, of superstitious devotees, of credulous followers of leaders, of fanatical unbalanced idealists, and of those warped minds which arrogate to themselves powers which are not theirs. Men and women become swayed by astralism and wander in the vale of illusion regarding themselves as different from other men, placing themselves upon a pedestal far above average humanity. They fall consciously into the sin of separateness. Add to the above category, the cases of sex perversion, brought about by overstimulation of the sacral centre, the cases of neuroticism and over-sensitivity and emotionalism, brought about by the premature vitalisation of the solar plexus centre, and lastly the cases of insanity, brought about by over-stimulation of the brain cells through unwise meditation work, and it will become increasingly clear why it is deemed necessary to proceed slowly and to develop the mental processes as well as the spiritual nature. (4 —193/4)."
					],
					"page": 69,
					"chapter": 5
				},
				{
					"t": "p",
					"runs": ["(11) “Watch and pray,” the Great Lord said when last on earth, and He spoke in occult terms, that have not as yet received due attention or interpretation."],
					"page": 70,
					"chapter": 5,
					"kind": "extract"
				},
				{
					"t": "p",
					"runs": ["What must therefore be watched?"],
					"page": 70,
					"chapter": 5
				},
				{
					"t": "p",
					"runs": ["1—The attitude of the emotional ovoid and its positive-negative control."],
					"page": 70,
					"chapter": 5
				},
				{
					"t": "p",
					"runs": ["2—The stability of the emotional matter and its conscious receptivity."],
					"page": 70,
					"chapter": 5
				},
				{
					"t": "p",
					"runs": [
						"3—Its alignment with the mental and with the causal bodies. If this alignment is imperfect (as it so frequently is) it causes inaccuracy in reception from the higher planes, distortion of the truths sent down via the Ego, and a very dangerous transference of force to undesirable centres. This lack of alignment is the cause of the frequent straying from sexual purity of many apparently spiritually",
						71,
						"inclined persons. They can touch the intuitional levels somewhat, the Ego can partially transmit power from on high, but as the alignment is imperfect the force from those higher levels is deflected, the wrong centres are over-stimulated, and disaster results. (2 — 99)."
					],
					"page": 70,
					"chapter": 5
				},
				{
					"t": "p",
					"runs": ["(12) It will be seen then that for the disciple the following centres are of paramount importance: 1. The ajna centre, through which the purified personality expresses itself."],
					"page": 71,
					"chapter": 5,
					"kind": "extract"
				},
				{
					"t": "p",
					"runs": ["2. The centre at the base of the spine, which is the centre through which complete and utter control and coordination is achieved, through the arousing of the purifying agency of fire."],
					"page": 71,
					"chapter": 5
				},
				{
					"t": "p",
					"runs": ["3. The sacral centre, wherein the basic force of our particular solar system, the force of attraction of form to form is transmuted, and the attractive force of the soul takes the place of the reproductive creative material activity. 4. The solar plexus centre which, situated in the centre of the body and being the organ of the astral body and of the lower psychism, gathers together all lower forces and redirects them under the impulse of the soul to their higher repositories. (4 — 287/8)."],
					"page": 71,
					"chapter": 5
				},
				{
					"t": "p",
					"runs": ["(13)... The activity of the ajna centre will increase a great deal during the coming century, bringing with it its own attendant problems. Its close relation to the pituitary body and the growing interplay between"],
					"page": 71,
					"chapter": 5
				},
				{
					"t": "p",
					"runs": [
						"a. The ajna centre and the pituitary body b. The centre at the top of the head (involving the pineal gland) and the ajna centre will produce serious problems connected with the brain and the eyes. The ajna centre focusses the",
						72,
						"abstracted energy of the five centres up the spine and is the seat of personality power. According to the use made of that power and according to the direction of the force sent forth throughout the body by the directed, integrated personality, so will the organs of the body be affected. The solar plexus can be stimulated from that centre with disastrous effects; the heart centre can be swept into undue activity by the imposition of personality force, and its energy deflected downwards in a focussed selfish manner; the solar plexus can be so over-vitalised that all the forces of the personality can be turned downwards and subverted to purely selfish and separative ends, thus producing a powerful personality, but—at the same time—the temporary suspension of the spiritual life of the man. When this suspension takes place, all the forces of the body which have been “elevated” are driven downwards again, putting the man en rapport with the rank and file of humanity who are working through the lower centres; this tends to produce an immense personality success. It is interesting to note that when this takes place, the energies—concentrated in the ajna centre—sweep down into the solar plexus or into the sacral centre, and seldom to the heart centre. The heart centre has a power all its own to produce what is called “occult isolation,” because it is the seat of the life principle. The throat centre receives stimulation in this case but seldom to the point of difficulty. The man is a powerful creative thinker, selfishly polarised and with an emotional solar plexus contact with the masses. He frequently also has a strong sexual complex in some form or another. (8 —553/4),"
					],
					"page": 71,
					"chapter": 5
				},
				{
					"t": "p",
					"runs": ["at(14)... Again, much trouble among people is due"],
					"page": 72,
					"chapter": 5
				},
				{
					"t": "p",
					"runs": [
						"this time to the awakening of the throat centre. This centre governs and conditions the thyroid gland and the parathyroids. It can produce, when",
						73,
						"unduly developed or prematurely awakened, hyperthyroidism with its attendant difficulties at in often dangerous effects upon the heart and upon the metabolism of the body. The psychological effects are well-known and recognised. These difficulties are increased and this higher creative centre unduly stimulated and rendered a danger instead of an aid to expression by the enforced celibacy of many people, owing to the present unfortunate economic conditions. These conditions are such that people refrain from marriage and there is consequently the lack of opportunity to use (or to misuse) the energy flowing through the sacral centre. Mystics are likewise prone to this difficulty. The throat centre is not used creatively noris the sacral centre turned to its proper uses. The sacral energy is carried prematurely to the throat where it produces an intense stimulation. The equipment of the man concerned has not yet reached the point where it can be turned to creative work in any field. There is no creative expression of any kind as the development of the man does not permit him to be creative in the higher sense. The Swiss people, though highly intelligent, are not creative in this sense. The energy flowing through the thyroid gland is not used in creative art, music or writing in any outstanding manner, and hence the prevalence of goitre and thyroid difficulty. There is much energy flowing through and to the thyroid gland and, as yet, but little use made of it. (8 — 536/7)."
					],
					"page": 72,
					"chapter": 5
				}
			]
		},
		{
			"id": "c06",
			"title": "Transmutation and Transference",
			"page": 74,
			"blocks": [
				{
					"t": "h1",
					"id": "c06",
					"s": "Transmutation and Transference",
					"page": 74,
					"chapter": 6
				},
				{
					"t": "p",
					"runs": ["(1) Let me bring another point to your attention. In the phenomenal world of the average human being who has not yet passed through the initiatory experience of the rebirth, the emphasis has ever been and is today upon the dual relationship of the sexes and to this our novels, plays, movies and affairs of all men bear testimony. Creativity expresses itself mainly through the propagation of the race, brought about through the relation of male and female, or of the positive and negative poles in the human family. This is right and good and part of the divine Plan. Even though men have prostituted their capacities and debased their relationships, the basic plan is divine and ideal. After the first initiation, the entire sex relationship shifts gradually and steadily into its proper place as simply a natural phase of existence in the three worlds and as one of the normal and correct appetites, but the emphasis changes. The higher experience and correspondence, that of which physical sex is only the symbol, becomes apparent. Instead of male and female, there emerges the magnetic relationship between the now negative personality and the positive soul, with consequent creativity upon the higher planes. Of this relationship the head centre and the centre between the eyebrows (the ajna centre) are the agents and eventually— through the medium of the pituitary body and the pineal gland—they condition the personality, rendering it soul-infused. (11 — 668/9)."],
					"page": 74,
					"chapter": 6,
					"kind": "extract"
				},
				{
					"t": "p",
					"runs": [
						"_ (2) You have been taught that the activity or the inactivity of the centres conditions the personality, working through the endocrine system; the energies which the centres channel and the forces which they generate can be controlled and directed",
						75,
						"by the soul, by the spiritual man. You have likewise been told that the energy of the sacral centre (the centre most implicated and active at the time of the first initiation) has to be transmuted and raised to the throat centre, thereby transforming the physical creative act into the creative process of producing the good, the beautiful and the true. This is the A B C of your fundamental knowledge: the transmutation of sex. In that transmutative process men have greatly erred and have approached the subject from two angles:"
					],
					"page": 74,
					"chapter": 6
				},
				{
					"t": "li",
					"runs": ["1. They have sought to stamp out natural desire"],
					"page": 75,
					"chapter": 6
				},
				{
					"t": "p",
					"runs": ["and have endeavoured to emphasise an enforced celibacy; they have thus frequently warped the nature and subjected the “natural man” to rules and regulations which were not of divine intent."],
					"page": 75,
					"chapter": 6
				},
				{
					"t": "li",
					"runs": ["2. They have tried—at the other extreme—to exhaust normal sexual desire by promiscuity, license"],
					"page": 75,
					"chapter": 6
				},
				{
					"t": "p",
					"runs": ["and perversion, damaging themselves and laying up the basis for trouble for many incarnations ahead."],
					"page": 75,
					"chapter": 6
				},
				{
					"t": "p",
					"runs": [
						"True transmutation is in reality the achieving of a correct sense of proportion in relation to any phase of human life, and for the race of men today has particular reference to the sacral centre and the energies which bring it into activity. When a proper recognition of the place the sex life should play in the daily life is paralleled by the concentration of thought anent the throat centre, that centre becomes automatically magnetic and attracts the forces of the sacral centre upward through the spine into “the place of creative building;” the normal sex life is then regulated and not atrophied, and is relegated to its rightful place as one of the usual faculties or appetites with which man is endowed; it is brought under control through the lack of directed interest and is subordinated to the law of the land as regards its relation to its opposite",
						76,
						"pole—either negative and feminine or masculine and positive. To the aspirant it becomes mainly the agent for the creation of the vehicles needed for reincarnating souls. Thus by force of example, by the avoiding of all extremes, by the dedication of the bodily energies to the higher uses, and by the acceptance of the law of the land in any given country and at any given time, the present disorder and the current misuse of the sex principle will give way to orderly living and to the right use of this major bodily function."
					],
					"page": 75,
					"chapter": 6
				},
				{
					"t": "p",
					"runs": ["This regulated physical life comes about when the personality is sufficiently integrated and coordinated and the ajna centre (the centre between the eyebrows) is active and is coming under the control of the soul. This has an immediate effect— automatically induced—upon the gland associated with this centre; it becomes a balanced part of the general endocrine system and past imbalance is avoided. Simultaneously, the head centre becomes active as a result of the aspirant’s mental perception, meditation and service; this brings the allied gland, the pineal gland, into action. All this is again only the A BC of occultism."],
					"page": 76,
					"chapter": 6
				},
				{
					"t": "p",
					"runs": [
						"What is oft omitted from normal consideration is the fact that the increasing activity of these two “points of light within the head” is basically related to what is occurring in the sacral and throat centres, as the transmutative process proceeds and the energies of the sacral centre are gathered up into the throat centre—without, however, withdrawing all the energy from the lower centre; thus its normal activity is properly preserved. The two centres in the head then become correspondingly active; the negative and the positive elements affect each other, and the light in the head shines forth; a line of light, permitting free interplay, is established between the ajna centre and the head centre, and therefore between the pituitary body",
						77,
						"and the pineal gland. When this line of light is present and there is an unobstructed relation between the two centres and the two glands, then the first initiation becomes possible. When this takes place, it must not be inferred that the task of transmutation going on between the lower and the higher centres and the relationship between the two head centres is fully and finally completed and established. The line of light is still tenuous and unstable, but it is in existence. It is the energy let loose at the first initiation and distributed into the sacral and the throat centres (via the slowly awakening head centre) which brings the transmutation process to a successful conclusion and stabilises the relationship within the head. This process may take several lives of steadily intensifying effort on the part of the initiate-disciple. (11 —669/671)."
					],
					"page": 76,
					"chapter": 6
				},
				{
					"t": "p",
					"runs": [
						"(3) Knowledge concerning the endocrine or ductless glands is as yet in an embryonic state. Much is known anent the glands connected with the sacral centre and about the thyroid gland, but to date, naturally, the medical profession does not admit that they are effects of the activity or the nonactivity of the centres, or that a line of least resistance exists between the sacral centre and the throat centre. Something is known (not much) about the pituitary body, but its extreme importance as it affects the psychological response of the person is not adequately grasped. Nothing is known, factually speaking, about the pineal or the thymus glands, and this because neither the head centre nor the heart centre is awakened in undeveloped man, or even in the average citizen. That there is a considerable wealth of knowledge anent the sacral centre (as the source of physical creation) and the conditioning effects of the thyroid gland is due to the fact that both these centres are awakened in the average man, and when the functioning is",
						78,
						"adequate and the necessary interplay is established, you then have a highly sexed individual who is also a creative artist along some artistic line. This is very frequently seen, as you well know. When the ajna centre and its externalisation, the pituitary body, are also active, and the relation between the three centres—sacral, throat and ajna centre—is awakened and beginning to function, and definite conscious relationship is being set up between it and the other centres (dependent upon ray, upon conscious objective and training), then you will have the practical mystic, the humanitarian and the occultist."
					],
					"page": 77,
					"chapter": 6,
					"kind": "extract"
				},
				{
					"t": "p",
					"runs": ["Students should remember that there is both an upward and a downward trend of energy within the entire structure of centres, where the aspirant and the disciple are concerned:"],
					"page": 78,
					"chapter": 6
				},
				{
					"t": "li",
					"runs": ["1. The upward trend... producing Transmutation."],
					"page": 78,
					"chapter": 6
				},
				{
					"t": "p",
					"runs": ["From the sacral centre to the throat centre."],
					"page": 78,
					"chapter": 6
				},
				{
					"t": "p",
					"runs": ["Physical creation is transmuted into artistic creativity."],
					"page": 78,
					"chapter": 6
				},
				{
					"t": "p",
					"runs": ["From the solar centre to the heart centre."],
					"page": 78,
					"chapter": 6
				},
				{
					"t": "p",
					"runs": ["Individual, emotional consciousness is"],
					"page": 78,
					"chapter": 6
				},
				{
					"t": "p",
					"runs": ["transmuted into group consciousness."],
					"page": 78,
					"chapter": 6
				},
				{
					"t": "p",
					"runs": ["From the base of the spine to the head centre. Material force is transmuted into"],
					"page": 78,
					"chapter": 6
				},
				{
					"t": "p",
					"runs": ["spiritual energy."],
					"page": 78,
					"chapter": 6
				},
				{
					"t": "p",
					"runs": ["From any or all of the five spinal centres to"],
					"page": 78,
					"chapter": 6
				},
				{
					"t": "p",
					"runs": ["the ajna centre. Uncoordinated living is"],
					"page": 78,
					"chapter": 6
				},
				{
					"t": "p",
					"runs": ["transmuted into personality integration."],
					"page": 78,
					"chapter": 6
				},
				{
					"t": "p",
					"runs": ["From the six centres in relationship into the"],
					"page": 78,
					"chapter": 6
				},
				{
					"t": "p",
					"runs": ["highest head centre. Personality activity"],
					"page": 78,
					"chapter": 6
				},
				{
					"t": "p",
					"runs": ["is transmuted into spiritual living."],
					"page": 78,
					"chapter": 6
				},
				{
					"t": "p",
					"runs": [
						"This is a wide generalisation, and the process is not carried forward in any sequential fashion or",
						79,
						"smoothly and in order as the tabulation above might suggest. The process involved is spread over many lives of unconscious transmutation in the earlier stages, and as a result of bitter experience and of conscious effort in the later stages, and becomes increasingly dynamic and effective as the various stages upon the Path are trodden by the aspirant. The five rays with which a disciple has to work (two major conditioning rays and three subsidiary rays) have a definite active effect; karmic adjustments provide opportunity or hindrance, and the intricacies of the entire process (within the relatively limited experience of the disciple) are so confusing whilst in process that all that he can do is to grasp the general outline as here given and not pay too much attention to the immediate factual detail."
					],
					"page": 78,
					"chapter": 6
				},
				{
					"t": "p",
					"runs": ["2. The downward trend... producing Transformation."],
					"page": 79,
					"chapter": 6
				},
				{
					"t": "p",
					"runs": ["Once the head centre is awakening and the disciple is consciously active in the work of directing the energies to the centres and thereby governing his personality life, there is a scientific undertaking of energising the centres in a certain ordered rhythm which is again determined by the rays, by circumstance and by karma; thus all the bodily energies are swung into correct spiritual activity. With the process involved we cannot here deal, beyond pointing out that this downward trend can be roughly regarded as falling into three stages:"],
					"page": 79,
					"chapter": 6
				},
				{
					"t": "p",
					"runs": ["1. The stage of energising the creative life, via"],
					"page": 79,
					"chapter": 6
				},
				{
					"t": "p",
					"runs": ["the throat centre, thus bringing:"],
					"page": 79,
					"chapter": 6
				},
				{
					"t": "li",
					"runs": ["a. The head centre and the throat centre,"],
					"page": 79,
					"chapter": 6
				},
				{
					"t": "li",
					"runs": ["b. These two and the sacral centre,"],
					"page": 79,
					"chapter": 6
				},
				{
					"t": "li",
					"runs": ["c. Allthree, consciously and simultaneously, into conscious relation."],
					"page": 79,
					"chapter": 6
				},
				{
					"t": "p",
					"runs": ["This relation, when properly established, will solve the individual problem of sex, and without recourse to either inhibition or suppression, but by bringing about right control and making the disciple, at the same time, creative in a worldly sense, and therefore of use to his fellowmen."],
					"page": 80,
					"chapter": 6
				},
				{
					"t": "p",
					"runs": ["2. The stage of energising the conscious life of relationship via the heart centre, thus bringing:"],
					"page": 80,
					"chapter": 6
				},
				{
					"t": "p",
					"runs": ["a. The head centre and the heart centre, b. These two and the solar plexus centre, c. Allthree, simultaneously and consciously,"],
					"page": 80,
					"chapter": 6
				},
				{
					"t": "p",
					"runs": ["into close cooperation."],
					"page": 80,
					"chapter": 6
				},
				{
					"t": "p",
					"runs": ["This serves to establish right human relations, right group relations, and right spiritual relations throughout a man’s entire life expression. Just as the stage of regulating the creative life has a paramount effect upon the physical body, so this stage affects the astral vehicle with great potency; emotional reactions are transformed into aspiration and service; selfish individual love is transformed into group love, and then divinity rules the life."],
					"page": 80,
					"chapter": 6
				},
				{
					"t": "p",
					"runs": ["3. The stage of energising the entire man, via the basic centre thus bringing:"],
					"page": 80,
					"chapter": 6
				},
				{
					"t": "p",
					"runs": ["a. The head centre and the basic centre, b. These two and the ajna centre,"],
					"page": 80,
					"chapter": 6
				},
				{
					"t": "p",
					"runs": ["c. All the three, simultaneously and consciously, into rhythmic, coordinated expression. This is a final stage of great importance, and only takes place in its"],
					"page": 80,
					"chapter": 6
				},
				{
					"t": "p",
					"runs": ["completeness at the time of the third initiation, that of the Transfiguration."],
					"page": 80,
					"chapter": 6
				},
				{
					"t": "p",
					"runs": [
						"You can see, therefore, how three important words convey the purpose of the scientific unfoldment",
						81,
						"and the right direction of the centres: Transmutation. Transformation. Transfiguration. (10 — 213/6)."
					],
					"page": 80,
					"chapter": 6
				},
				{
					"t": "p",
					"runs": [
						"(4) For instance, these ideas [transference, psychological difficulty and pathological results|may clarify themselves in your mind if I point out certain facts, relating to the sacral centre which for so long a period of time governs the animal and physical creative life of the human being. During the process of evolution, the sacral centre passes through the stages of automatic unconscious use, such as you find in purely animal man; then use under the urge of desire for pleasure and physical satisfaction, wherein the imagination is beginning to exert its influence; next comes the period wherein there is the conscious subordination of the life to the sex impulse. This is of a different nature to the first mentioned. Sex becomes a dominating thought in the consciousness, and many people today are passing through this stage and everybody at some time or in some life passes through it. This is followed by a period of transference wherein the physical pull of sex and the urge to physical creation is not so dominant and the forces begin to be gathered up into the solar plexus. There they will be controlled largely by the astral imaginative life far more than by the unconscious animal or the conscious desire life. They blend there with the forces of the solar plexus itself and gradually are carried up to the throat centre, but always via the heart centre. Here we find a major point of difficulty for the mystic who is rapidly coming into being and functioning activity. He becomes painfully conscious of duality, of the pull of the world and of the mystical vision, of divine possibilities and personality potencies, of love in place of desire and attraction, of divine relationship instead of human relations. But this whole subject is still interpreted in terms of duality. Sexis",
						82,
						"still imaginatively in his consciousness and is not relegated to a balanced place among the other instincts of the human nature; the result is an almost pathological interest in the symbolism of sex and what might be called a spiritualised sex life. This tendency is amply exemplified in the writings and experiences of many of the mystics of the middle ages. We find such expressions as the “bride of Christ,” the “marriage in the Heavens,” the picture of Christ as the “heavenly bridegroom” and many such symbols and phrases. In the Song of Solomon, you find a masculine rendition of the same basically sexual approach to the soul and its all embracing life."
					],
					"page": 81,
					"chapter": 6,
					"kind": "extract"
				},
				{
					"t": "p",
					"runs": [
						"These and many more unpleasant examples of a sex psychology are to be found, blended with a true and pronounced mystical aspiration and yearning, and a genuine longing for union with the divine. The cause of all this lies in the stage of transference. The lower energies are subject, as you can see, to two stages of transference: first, into the solar plexus and from thence to the throat centre. The throat centre is not, at this period, active enough or sufficiently awakened to absorb and utilise the sacral energies. They are arrested in some cases in their upward passage and retained temporarily in the heart centre, producing the phenomena of sex urges (accompanied at times with definitely physical sexual reactions), of religious eroticism and a generally unwholesome attitude, ranging all the way from real sexuality to fanatical celibacy. This latter is as much an undesirable extreme as the other and produces most undesirable results. Frequently in the case of a male mystic there will be over developed sexual expression on the physical plane, perversions of different kinds or a pronounced homosexuality. In the case of women, there may be much disturbance of the solar plexus (instead of sacral disturbances)",
						83,
						"and consequent gastric trouble and an unwholesome imaginative life, ranging all the way from a feeble pruriency to definite forms of sexual insanity with (frequently) a strong religious bias at the same time. I would remind you here also of the fact that I am definitely dealing with abnormalities, and hence must touch upon that which is unpleasant. In the early stages of mystical development, if there were right guidance of the mental life and of thought, plus courageous explanation of process, a great deal of difficulty would later be avoided. These early stages resemble closely the interest shown by the adolescent both in sex and religion. The two are closely allied in this particular period of development. If right help can be given at this time by educators, parents and those concerned with the training of the young, certain undesirable tendencies—now so prevalent—would never grow into habits and thought states as they now do. (8 — 530/2)."
					],
					"page": 82,
					"chapter": 6
				},
				{
					"t": "p",
					"runs": ["(5)... The channel of approach or of downflow is as follows:"],
					"page": 83,
					"chapter": 6
				},
				{
					"t": "li",
					"runs": ["a. From the will aspect of the monadic life to that level of consciousness and of energy which we call that of the higher mind."],
					"page": 83,
					"chapter": 6
				},
				{
					"t": "li",
					"runs": ["b. From the higher mind to the knowledge petals of the egoic lotus."],
					"page": 83,
					"chapter": 6
				},
				{
					"t": "li",
					"runs": [
						"c. From these vortexes of force to the lower or concrete mind—that in which the average intelligent man familiarly works—to the throat centre and from thence immediately to the sacral centre (the centre of physical plane creation or reproduction). From there it is raised again to the throat centre where the creative physical urge is transmuted into artistic or literary creation in some form or another, and later still into the power to create groups or organisations which will express",
						84,
						"some idea or some thought which emanates from the Mind of God, and which demands immediate precipitation upon earth. (8 — 390)."
					],
					"page": 83,
					"chapter": 6
				},
				{
					"t": "p",
					"runs": ["(6) Let the disciple transfer the fire from the lower triangle to the higher, and preserve that which is created through the fire of the midway point."],
					"page": 84,
					"chapter": 6,
					"kind": "extract"
				},
				{
					"t": "p",
					"runs": ["This means, literally, the control by the initiate of the sex impulse, as usually understood, and the transference of the fire which now normally vitalises the generative organs to the throat centre, thus leading to creation upon the mental plane through the agency of mind. That which is to be created must then be nourished and sustained by the love energy of nature issuing from the heart centre."],
					"page": 84,
					"chapter": 6
				},
				{
					"t": "p",
					"runs": ["The lower triangle referred to is:—"],
					"page": 84,
					"chapter": 6
				},
				{
					"t": "li",
					"runs": ["1. The solar plexus."],
					"page": 84,
					"chapter": 6
				},
				{
					"t": "li",
					"runs": ["2. The base of the spine."],
					"page": 84,
					"chapter": 6
				},
				{
					"t": "li",
					"runs": ["3. The generative organs."],
					"page": 84,
					"chapter": 6
				},
				{
					"t": "p",
					"runs": ["Whilst the higher one is, as pointed out:—"],
					"page": 84,
					"chapter": 6
				},
				{
					"t": "li",
					"runs": ["1. The head."],
					"page": 84,
					"chapter": 6
				},
				{
					"t": "li",
					"runs": ["2. The throat."],
					"page": 84,
					"chapter": 6
				},
				{
					"t": "li",
					"runs": ["3. The heart."],
					"page": 84,
					"chapter": 6
				},
				{
					"t": "p",
					"runs": [
						"This might be interpreted by the superficial reader as an injunction to the celibate life, and the pledging of the applicant to abstain from all physical manifestation of the sex impulse. This is not so. Many initiates have attained their objective when duly and wisely participating in the marriage relation. An initiate cultivates a peculiar attitude of mind, wherein there is a recognition that all forms of manifestation are divine, and that the physical plane is as much a form of divine expression as",
						85,
						"any of the higher planes. He realises that the lowest manifestation of divinity must be under the conscious control of that indwelling divinity, and that all acts of every kind should be regulated by the endeavour to fulfil every duty and obligation, to control every action and deed, and to utilise the physical vehicle so that the group may be thereby benefited and aided in its spiritual progress, and the law perfectly fulfilled."
					],
					"page": 84,
					"chapter": 6
				},
				{
					"t": "p",
					"runs": ["That it may be advisable, at certain stages, fora man to perfect control along any particular line through a temporary abstention is not to be denied, but that is a means to an end, and will be succeeded by stages when—the control having been gained—the man demonstrates perfectly through the medium of the physical body, the attributes of divinity, and every centre will be normally and wisely used, and thus race purposes furthered."],
					"page": 85,
					"chapter": 6
				},
				{
					"t": "p",
					"runs": ["Initiates and Masters, in many cases marry, and normally perform their duties as husbands, wives, and householders, but all is controlled and regulated by purpose and intention, and none is carried away by passion or desire. In the perfect man upon the physical plane, all the centres are under complete control, and their energy is legitimately used; the spiritual will of the divine inner God is the main factor, and there will be a unity of effort shown on all the planes through all the centres for the greatest good of the greatest number."],
					"page": 85,
					"chapter": 6
				},
				{
					"t": "p",
					"runs": [
						"This point has been touched upon because so many students go astray upon these matters, and cultivate either an attitude of mind which results in the complete atrophying of the entire normal physical nature, or indulge in an orgy of license under the specious plea of “stimulating the centres,” and thus furthering astral development. The true initiate should be known by his wise and sanctified",
						86,
						"normality, by his steady conformity to that which is best for the group as emphasised by the group laws of the land, by his control and his refraining from excess of any kind, and by the example he sets to his environing associates of spiritual living and moral rectitude, coupled with the discipline of his life. (1 — 204/6)."
					],
					"page": 85,
					"chapter": 6
				},
				{
					"t": "p",
					"runs": ["(7) I would here remind students that the following three points, related to the transference of energy, must be borne in mind:"],
					"page": 86,
					"chapter": 6,
					"kind": "extract"
				},
				{
					"t": "p",
					"runs": ["1. That there is a transference to be made from all the lower centres to higher ones and that this is usually done in two stages. This transference, carried on within the personality, is paralleled by the transference of spiritual energy from that reservoir of force we call the soul to the man on the physical plane. This becomes possible as the man makes the needed transference within himself. These transferences can take place in the course of the evolutionary process, or they can be hastened through the forced training given to disciples of all degrees."],
					"page": 86,
					"chapter": 6
				},
				{
					"t": "p",
					"runs": ["2. That, within this major field of activity, the following transferences will have to be made: a. The energy of the centre at the base of the"],
					"page": 86,
					"chapter": 6
				},
				{
					"t": "p",
					"runs": ["spine (the organ of the personal will) must"],
					"page": 86,
					"chapter": 6
				},
				{
					"t": "p",
					"runs": ["be raised and carried up the spinal column"],
					"page": 86,
					"chapter": 6
				},
				{
					"t": "p",
					"runs": ["to the head centre, via the ajna centre. b. The energy of the sacral centre (governing"],
					"page": 86,
					"chapter": 6
				},
				{
					"t": "p",
					"runs": ["the sexual life and the organs of physical"],
					"page": 86,
					"chapter": 6
				},
				{
					"t": "p",
					"runs": ["creation) must be raised to the throat centre, which becomes the organ of creative"],
					"page": 86,
					"chapter": 6
				},
				{
					"t": "p",
					"runs": ["activity of a non-physical nature."],
					"page": 86,
					"chapter": 6
				},
				{
					"t": "p",
					"runs": ["c. The energy of the solar plexus (the organ of"],
					"page": 86,
					"chapter": 6
				},
				{
					"t": "p",
					"runs": ["self-conscious personal desire) must be"],
					"page": 86,
					"chapter": 6
				},
				{
					"t": "p",
					"runs": ["raised to the heart and there transmuted"],
					"page": 86,
					"chapter": 6
				},
				{
					"t": "p",
					"runs": ["into group service."],
					"page": 86,
					"chapter": 6
				},
				{
					"t": "p",
					"runs": ["3. That all these centres are developed and brought into activity in three stages, and thus progressively condition the outer aspects of a man’s life:"],
					"page": 87,
					"chapter": 6
				},
				{
					"t": "p",
					"runs": ["a. There is a period wherein the centres are active only in a sluggish and semi-dormant manner: the forces of which they are formed, and which they express, move slowly and with a heavy inert rhythm; the light which can be seen wherever thereisa centre is dim; the point of electric potency at the centre (the “heart of the lotus or chakra,” the hub of the wheel, as it is esoterically termed in the Oriental teaching) is relatively quiescent. There is just enough energy pouring into the centre to produce the preservation of life, the smooth functioning of the instinctual nature, plus a tendency to react, in a fluctuating and unintelligent manner to stimuli coming from the astral plane, via the individual astral body."],
					"page": 87,
					"chapter": 6
				},
				{
					"t": "p",
					"runs": [
						"pb. A period wherein there takes place a definite heightening and intensifying of force. The light of the centres is brighter and the solar plexus centre, in particular, becomes very active. As yet, all the real life of the man is focussed below the diaphragm. The centres above the diaphragm are dim and dull and relatively inactive; the point at the centre is, however, more electrical and dynamic. At this stage, the man is the average intelligent citizen, predominantly controlled by his lower nature and his emotional reactions, with what mind he has actively employed in bringing satisfaction to his needs. His centres are the receivers primarily of physical and astral forces, but occasionally respond to mental impacts.",
						88,
						"c. A period wherein the first transference is being made. This can last a long time and cover several lives. The centres below the diaphragm are fully awakened; their activity is great; their light is vivid; their interrelation is real, so much so that a complete magnetic field has been set up involving the whole area below the diaphragm and becoming potent enough to extend its influence above the diaphragm. The solar plexus becomes the dominant organ in the place of the sacral centre which has so long determined the life of the animal nature. It becomes the recipient of energy streams from below which it absorbs and starts on its task of deflecting them and transferring them to the higher centres. The man is now the highly intelligent citizen and aspirant. He is conscious of the dualism of his nature, of that which is below and of that which is above, as it has been called, and is ready to tread the Probationary Path."
					],
					"page": 87,
					"chapter": 6
				},
				{
					"t": "p",
					"runs": ["d. A period wherein the transference is continued. The sacral forces are carried to the throat and the solar plexus forces are carried to the heart. The latter transference is as yet of so small a measure that the effect of the transference is almost negligible. This period is along and very difficult one. Today, most people are going through periods c and d, which are preparatory to the expression of the mystical life."],
					"page": 88,
					"chapter": 6
				},
				{
					"t": "p",
					"runs": [
						"e. A period wherein the heart and throat centres are brought into activity. The man is creatively intelligent along some line or other and is slowly becoming group conscious. As yet, however, his reactions are",
						89,
						"still selfishly motivated though—at the same time—he is subject to cycles of vision and periods of spiritual effort. The mystical life is definitely attracting him. He is becoming the mystic."
					],
					"page": 88,
					"chapter": 6
				},
				{
					"t": "p",
					"runs": ["f. Asecond period of transference ensues and the ajna centre, which governs the integrated personality, becomes active and dominant. The life of feeling and of mystical effort is, at this time, liable to diedown temporarily in its expressed fervour and ardent disciplines, and personality integration, personality ambitions, personality aims and personality expression take its place. This is a right and good change and tends correctly to a rounded out development. It is only temporary, for still the mystic sleeps beneath the outer activity and the intelligent worldly effort, and will emerge again to living endeavour when the mind nature has been fully aroused and is controlling, when desire for mental satisfaction has been satiated and the “son of God is ready to arise and enter the Father's house.” During this period, we find the intelligently creative or the powerful man will come to the zenith of his personality life. The centres below the head will all be active and functioning, but the centres below the diaphragm will be subordinated to and controlled by those found above. They are subject then to the conditioning will of the man whois governed at this time by ambition, intellectual expediency and that form of group work which tends to the expression of his personality potency. The ajna centre is vivid and potent; the throat centre is intensely active and the heart centre is rapidly awakening."],
					"page": 89,
					"chapter": 6
				},
				{
					"t": "p",
					"runs": ["g. Aperiod wherein the highest head centre is brought into radiant activity. This occurs as the result of the uprising (in a fresh and more potent manner) of the mystical instinct, plus, this time, an intelligent approach to reality. The result is twofold: 1. The soul begins to pour its energy into"],
					"page": 90,
					"chapter": 6
				},
				{
					"t": "p",
					"runs": ["all the etheric or vital centres, via the"],
					"page": 90,
					"chapter": 6
				},
				{
					"t": "p",
					"runs": ["head centre."],
					"page": 90,
					"chapter": 6
				},
				{
					"t": "p",
					"runs": ["2. The point at the heart of each centre"],
					"page": 90,
					"chapter": 6
				},
				{
					"t": "p",
					"runs": ["comes into its first real activity; it becomes radiant, brilliant, magnetic and"],
					"page": 90,
					"chapter": 6
				},
				{
					"t": "p",
					"runs": ["forceful, so that it “dims the light of all"],
					"page": 90,
					"chapter": 6
				},
				{
					"t": "p",
					"runs": ["that lies around.”"],
					"page": 90,
					"chapter": 6
				},
				{
					"t": "p",
					"runs": ["All the centres in the body are then swept into ordered activity by the forces of love and will. Then takes place the final transference of all the bodily and psychic energies into the head centre through the awakening of the centre at the base of the spine. Then the great Polar opposites, as symbolised and expressed by the head centre (the organ of spiritual energy) and the centre at the base of the spine (the organ of the material forces) are fused and blended and from this time on the man is controlled only from above, by the soul. (8 — 522/7)."],
					"page": 90,
					"chapter": 6
				},
				{
					"t": "p",
					"runs": [
						"(8)... In the period of transference wherein the forces of the body are in a state of abnormal flux and mutation, it will be obvious what danger there is for the mystic and the disciple, and how serious can be the results of any transference which is forced into effect instead of following the natural course of evolution. This accounts, partially, for the present world upheaval and chaos. The forces flowing through the masses of average intelligent men today (and by that I mean those men who are educated and able to recognise the world news and",
						91,
						"to discuss world events and trends) are constituting the experimental ground for transference of the energy of the sacral centre to the solar plexus. This leads inevitably to turmoil, over-stimulation, revolt and many other difficulties. (8 — 542)."
					],
					"page": 90,
					"chapter": 6
				},
				{
					"t": "p",
					"runs": ["(9) As regards human evolution, this fourth law [the Law of Magnetic Control] is of prime importance at this time. The aim of human endeavour is both to be controlled by this law, and likewise to wield it in service. It is the law whereby sex expression, as we know it, is transmuted and elevated; sex is only the physical plane demonstration of the Law of Attraction; it is the working out of that law in the human kingdom, and in all the lower kingdoms, too. The love of all that breathes, and the attraction that works out in service, is the same thing as demonstrated in the Triad. Sex expression, the coming together of two, becomes transmuted into the coming together of many for acts of service, which will give birth to new ideals, and to a new race—the spiritual. (3 —584/5)."],
					"page": 91,
					"chapter": 6,
					"kind": "extract"
				},
				{
					"t": "p",
					"runs": ["(10) The danger of the over-stimulation of these organs is well recognised theoretically, and I do not purpose to enlarge on it greatly today. I but seek to point out that this danger is very real. The reason is that in the over-stimulation of these centres the inner fire is but following the line of least resistance, owing to the polarisation of the race as a whole. The work, therefore, that the student has to do is twofold:—"],
					"page": 91,
					"chapter": 6,
					"kind": "extract"
				},
				{
					"t": "p",
					"runs": ["a—He has to withdraw his consciousness from those centres; this is no easy task for it means working against the results of age-long development."],
					"page": 91,
					"chapter": 6
				},
				{
					"t": "p",
					"runs": [
						"b—He has to direct the attention of the creative impulse to the mental plane. In so doing, if successful, he will turn the activity of the divine fire to the throat centre and its corresponding head centre,",
						92,
						"instead of to the lower organs of generation. Therefore, it will be apparent to you why—unless a man is very advanced—it is not wise to spend much time in meditation during the earlier years. There was wisdom in the old Brahmanical rule that a man must give his early years to household endeavour, and only when he had fulfilled his function as a man could he go on to the life of the devotee. This was the rule for the average. With advanced egos, pupils and disciples, it is not so, and each must then work out his own individual problem. (2 — 106)."
					],
					"page": 91,
					"chapter": 6
				}
			]
		},
		{
			"id": "c07",
			"title": "Kundalini and Sex Energy",
			"page": 93,
			"blocks": [
				{
					"t": "h1",
					"id": "c07",
					"s": "Kundalini and Sex Energy",
					"page": 93,
					"chapter": 7
				},
				{
					"t": "p",
					"runs": ["(1) Latent or interior fire produces the internal heat which makes the solar system productive of all forms of life. It is the inherent warmth that causes all fertilisation, whether human, animal, or vegetable."],
					"page": 93,
					"chapter": 7,
					"kind": "extract"
				},
				{
					"t": "p",
					"runs": ["Human latent fire, the heat interior of the human frame causes production of other forms of life, such as—"],
					"page": 93,
					"chapter": 7
				},
				{
					"t": "li",
					"runs": ["1. The physical body cells."],
					"page": 93,
					"chapter": 7
				},
				{
					"t": "li",
					"runs": ["2. Organisms nourished by the latent heat."],
					"page": 93,
					"chapter": 7
				},
				{
					"t": "li",
					"runs": ["3. The reproduction of itself in other human forms, the basis of the sex function. (3 —53)."],
					"page": 93,
					"chapter": 7
				},
				{
					"t": "p",
					"runs": ["(2) Should a man, by the power of will or through an over-development of the mental side of his character, acquire the power to blend these fires of matter and to drive them forward, he stands in danger of obsession, insanity, physical death, or of dire disease in some part of his body, and he also runs the risk of an over-development of the sex impulse through the driving of the force in an uneven manner upwards, or in forcing its radiation to undesirable centres. The reason of this is that the matter of his body is not pure enough to stand the uniting of the flames, that the channel up the spine is still clogged and blocked, and therefore acts asa barrier, turning the flame backwards and downwards, and that the flame (being united by the power of mind and not being accompanied by a simultaneous downflow from the plane of spirit), permits the entrance, through the burning etheric, of undesirable and extraneous forces, currents, and even entities. These wreck and tear and ruin what is left of the etheric vehicle, of the brain tissue and even of the dense physical body itself. (8 — 126)."],
					"page": 93,
					"chapter": 7,
					"kind": "extract"
				},
				{
					"t": "p",
					"runs": ["(3) [have dealt with this in detail as the practice of breathing exercises definitely moves the forces flowing through the “nadis” and re-organises them—usually prematurely. It hastens the process of breaking down the walls separating four forces from the fifth energy, and hastens the burning of the protecting etheric webs up the spinal column. If this is done whilst the emphasis of the life is below the diaphragm and the man is not even an aspirant or intelligent, then it will cause the overstimulation of the sex life, and also the opening up of the astral plane and hence much physical difficulty and disease. It occultly “releases the lower fires and the man will be destroyed by fire;” he will not be then (as is intended) the “burning bush"],
					"page": 94,
					"chapter": 7,
					"kind": "extract"
				},
				{
					"t": "p",
					"runs": ["ee forever and cannot be destroyed.” (8"],
					"page": 94,
					"chapter": 7
				}
			]
		},
		{
			"id": "c08",
			"title": "Disease and Sex Energy",
			"page": 95,
			"blocks": [
				{
					"t": "h1",
					"id": "c08",
					"s": "Disease and Sex Energy",
					"page": 95,
					"chapter": 8
				},
				{
					"t": "p",
					"runs": ["(1) I would like to deal, first of all, with the basic premise that disease and physical liabilities are not the result of wrong thought. They are far more likely to be the result of no thought at all, or are caused by the failure to follow those fundamental laws which govern the Mind of God. One interesting instance of this failure is the fact that man does not follow the basic Law of Rhythm, which governs all the processes of nature, and man is a part of nature. It is to this failure to work with the Law of Periodicity that we can trace much of the difficulty inherent in the use and the misuse of the sex urge. Instead of man being governed by the cyclic manifestation of the sex impulse, and his life, therefore, being ruled by a definite rhythm, there exists at this time no such thing, except in the cycles through which the female passes, and little attention is paid to these. The male, however, is not governed by any such cycles, and has broken in also on the rhythm to which the female body should be subordinated, and which—rightly understood—would determine the use of the sex relationship, including naturally the male impulse also. This failure to live by the Law of Periodicity and to subordinate the appetites to cyclic control is one of the major causes of disease; and as these laws are given form on the mental plane, one might legitimately say that their infringement has a mental basis. This might be the case if the race were working mentally, but it is not. It is in the modern world of today that there is beginning a widespread infringement of these mental laws, particularly of the Law of Cycles, which determines the tides, controls world events and should also condition the individual and so establish rhythmic life habits—one of the major predisposing incentives to good health. (10 — 89)."],
					"page": 95,
					"chapter": 8,
					"kind": "extract"
				},
				{
					"t": "p",
					"runs": ["(2) Of the three major diseases which have been inherited from the past, it might be said that the syphilitic or so-called social diseases are remainders of the excesses indulged in in Lemurian times; they are of such ancient origin that the very soil is permeated with the germs of these diseases—a fact quite unknown to modern science. Down the ages, men have suffered from these groupsofinfections; they have died and been buried and in their millions have contributed their quota of infection to the earth. In Lemurian times, the emphasis of the life force was upon the physical body, upon its development, its use and control, and also upon its perpetuation or reproduction. It was in Lemurian times that troubles connected with the misuse of the sex life began; this was, in a peculiar sense, the essential primeval evil, and concerning this fact, ancient legends and hints are found throughout the earliest records and writings. There is much misinterpreted testimony to this effect, and when men can read the records more correctly and with right interpretation, they will understand the way out, because they will see more clearly the underlying causes."],
					"page": 96,
					"chapter": 8,
					"kind": "extract"
				},
				{
					"t": "p",
					"runs": [
						"Cancer is a gift to modern man from the Atlantean humanity, and the scourge of this disease was the major factor which devastated the inhabitants of old Atlantis. The roots of this dire evil are deep-seated in the emotional or desire nature, and are grounded in the astral body. Cancer is partially the result of a reaction to the diseases connected with the sex life which became so rampant in later Lemurian times and early Atlantean days. The people of those times, seeing the fearful evils and the extent of the disease which grew up out of the fertile Lemurian life, resulting from the promiscuous sex life on every hand, for the sake of self-preservation dammed back the natural flow of desire (the flow of life as it expresses itself through",
						97,
						"the centres of reproduction and procreation), and this in due time produced other evils. Cancer is primarily a disease of inhibition, just as the syphilitic diseases are those of over-expression and overuse of one aspect of the mechanism of man. (10 — 58/9)."
					],
					"page": 96,
					"chapter": 8
				},
				{
					"t": "p",
					"runs": ["(3)... The great original sin in Lemurian times was sexual in nature, and due largely not only to inherent tendencies, but to the extraordinarily dense population of its civilisation and to the close relation of the animal kingdom. The origin of the syphilitic diseases traces back to these times. There is a beautiful idea in the minds of the ignorant that primitive races are free from that type of contamination and that the many sexual diseases and their results are predominantly the diseases of civilisation. This is not so from the occult angle of vision. True knowledge disproves it. In the infancy of the race, a great mismating, promiscuity and series of perversions took place, and in the language of some of the most ancient books in the Masters’ Archives we read: “earth took its toll and earth to earth, polluted and impure, returned to earth; thus evil life entered the pristine cleanliness of the ancient mother. Deep in the soil the evil lies, emerging into form from time to time, and only fire and suffering can cleanse the mother of the evil which her children have given unto her.”"],
					"page": 97,
					"chapter": 8
				},
				{
					"t": "p",
					"runs": [
						"The Lemurian race practically destroyed itself, owing to its misuse of the sacral centre, which was at that time the most active and the dominant centre. In Atlantean days it was the solar plexus centre which was the prime objective of the “entering fire.” The work of the Hierarchy in Lemurian days was, as I have told you elsewhere, to teach infant humanity the nature, meaning and significance of the physical vehicle, just as in the next race, the emotional was fostered and the major",
						98,
						"object of attention, and in our race, it is the mind which is subjected to stimulation...."
					],
					"page": 97,
					"chapter": 8
				},
				{
					"t": "p",
					"runs": ["Paralleling all the activity of the Great White Lodge (as was always the case and is the case today) was the activity of the dark forces. Their effects had to be brought about through the medium of the sacral centre, and thus a most vicious situation came about which weakened the stamina of the human body, which greatly increased the demands of the sex nature through the stimulation of the sacral centre, artifically brought about by the Black Lodge, and which produced many unholy alliances and widespread evil relations."],
					"page": 98,
					"chapter": 8
				},
				{
					"t": "p",
					"runs": ["A great new law of nature was then imposed by the planetary Logos which has been expressed (very inadequately) by the words, “The soul that sinneth, it shall die.” This law could be better expressed by saying, “He that misuses that which he hath built will see it fall from forces within itself.”"],
					"page": 98,
					"chapter": 8
				},
				{
					"t": "p",
					"runs": ["As the centuries slipped away and the Lemurian race submitted to the evil impulses of the animal nature, gradually the earliest type of venereal disease made its appearance; eventually the entire race was riddled with it and died out, nature taking its toll and exacting its inexorable price. You might here ask how these early inhabitants of our planet could be held responsible for there is no sin where there is no sense of responsibility and no consciousness of wrong doing. The Hierarchy in those days had its own methods of teaching these infant peoples, just as the smallest child can be taught today to refrain from certain physical habits. Humanity then knew well what was evil, because the evidences of that evil were physically apparent and quite easily perceived. The penalty was obvious and the results immediate; the Teachers of the race saw to it that cause and effect were quickly to be noted."],
					"page": 98,
					"chapter": 8
				},
				{
					"t": "p",
					"runs": ["At this time there also arose the first tendencies to marriage, as differentiated from promiscuity; the formation of family units became the subject of attention and a goal for the most highly evolved. This was one of the first tasks undertaken by the Hierarchy and the first effort toward any form of group activity, conveying the first lesson in responsibility. The family unit was not stable as it can be now, but even its relatively brief tenure was a tremendous step forward; the segregation of the family unit and the growth of the sense of responsibility has gone steadily forward until it has culminated in our present system of marriage and our stress in the Occident upon monogamy; it has led to the western pride in family strains and pedigrees, our interest in genealogies and relationships, and the complete horror of the occidental thinker over the syphilitic diseases as they affect families and their offspring."],
					"page": 99,
					"chapter": 8
				},
				{
					"t": "p",
					"runs": ["Two most interesting things are, however, happening today. The family unit, on a worldwide scale, is being broken up, owing to the fortunes of war and—on a smaller scale—owing to the more modern views concerning marriage and divorce. Secondly, definite and rapid cures for the sexual diseases are being discovered, and these may tend to make people more reckless. When, however, they are perfected, they will in the long run safeguard the race and will return bodies to the soil after death freed from the plague which has contaminated the earth for endless ages. There will thus be brought about a gradual purifying of the soil. The growth of the practice of cremation will also aid this process of purification. Destruction by fire and the intensity of the heat engendered by applied military methods are also helping, and during the next one million years we shall see syphilis (inherited from Lemuria) stamped out, both in the human family and in the soil of the planet."],
					"page": 99,
					"chapter": 8
				},
				{
					"t": "p",
					"runs": ["As the ages passed away, humanity entered into the Atlantean stage of development. The conscious control of the physical body dropped below the threshold of consciousness; the etheric body became consequently more potent (a fact not oft considered), and the physical body reacted increasingly like an automaton to the impression and the direction of a steadily developing desire nature. Desire became something more than simply response to animal physical urges and to the primitive instincts, but was directed to objects and objectives extraneous to the body, towards material possessions and towards that which (when seen and coveted) could be appropriated. Just as the major sins of Lemurian times (if they could be called sins in any true sense, because of the low intelligence of the race) were through the misuse of sex, so the major sin of the Atlantean people was theft—widespread and general. (10 —227/231)."],
					"page": 100,
					"chapter": 8
				},
				{
					"t": "p",
					"runs": [
						"(4) In all the above, even in connection with what I have said concerning homosexuality, I have considered either rampant or inhibited desire, but I have only considered it in general terms and in a broad outline. Will you misunderstand if I point out to you that where desire is inhibited (which is the case with many aspirants today) all kinds of diseases—cancer, congestion of the lungs and certain liver complaints—become possible, as well as the dread malady of tuberculosis? The diseases of inhibition are numerous and serious, as you will note from the above enumeration. It should be noted that where desire is rampant and uncontrolled and no inhibition is present, such diseases as the syphilitic disorders, homosexuality and inflammations and fevers appear. According to the temperament so will be the types of disease, and the temperament is dependent upon the ray quality.",
						101,
						"People on the different rays are predisposed to certain disorders. (10 — 66)."
					],
					"page": 100,
					"chapter": 8,
					"kind": "extract"
				},
				{
					"t": "p",
					"runs": ["(5) Cancer is a disease most definitely related to the centres, and it will be found that the centre in the area wherein the cancer exists is overactive, with a consequent increase of energy pouring through the related bodily substance. This energy and the overstimulation of a centre can be due not only to the activity of the centre and its consequent radiation, but also the suppression imposed by the mind upon any activity of a particular centre. This brings about a damming up of energy, and again we have the creation of too much concentrated energy in any particular area. One of the main sources of cancer as related to the sacral centre, and therefore to the sex organs, has been the well-intentioned suppression of the sex life, and of all thought connected with the sex life, by misguided aspirants; they are those who find the teaching— monastic and celibate—of the Middle Ages the line of least resistance. In that period of time, good people taught that sex was evil and wicked, something not to be mentioned, and a potent source of trouble. Normal reactions, instead of being controlled and transmuted into creative activity, were violently suppressed and all thoughts anent the sex life were refused expression. Nevertheless, energy follows the direction of thought, with the result that that particularly magnetic type of energy attracted an increasing number of cells and atoms to itself; therein is found the source of the tumours, growths and cancers so prevalenttoday. (10 — 239)."],
					"page": 101,
					"chapter": 8,
					"kind": "extract"
				},
				{
					"t": "p",
					"runs": ["(6)... A frustrated sex life or a state wherein an unmarried person has had no normal expression of a natural and universal process, and to whom therefore sex remains a mystery (and at the same time a constant inner unrecorded subject of thought) will lead:"],
					"page": 101,
					"chapter": 8
				},
				{
					"t": "li",
					"runs": ["a. To a condition of great devitalisation with a consequent and unavoidable ill health which attends that type of person—the so-called obvious old maid or bachelor. Needless to remark, there are many such unmarried people who face life wholesomely and do not come under this category."],
					"page": 102,
					"chapter": 8
				},
				{
					"t": "li",
					"runs": ["b. Toaconstant effort to attract the attention of the opposite sex until it reaches a point where it becomes a nervous and most unwholesome tendency."],
					"page": 102,
					"chapter": 8
				},
				{
					"t": "li",
					"runs": ["c. To the development of homosexual habits or to those perversions which warp the life of many intelligent people."],
					"page": 102,
					"chapter": 8
				},
				{
					"t": "li",
					"runs": ["d. To the tumours—malignant or otherwise— which attack the organs of generation and which frequently make the subject an operative case."],
					"page": 102,
					"chapter": 8
				},
				{
					"t": "p",
					"runs": ["There are other possible developments but upon them I do not propose to dwell. I have here indicated enough to show the danger of a sense of frustration and a morbid (even if at the time an unrecognised) interest in sex. This can evidence itself also in a dream life which links the brain, the mind and the organs of generation closely together and proves the fact of astral desire evoking the physical appetite; this demonstrates my contention that the physical body automatically responds—even when unconscious in the hours of sleep—to astral control. The cure, as you of course know, is a full creative outer life, particularly one which is of benefit to one’s fellowmen and is not simply a transmutation of the sex urge into some form of creative thinking which simply remains thinking, but takes no shape or form on the outer plane of human life. (10 — 562/3)."],
					"page": 102,
					"chapter": 8
				},
				{
					"t": "p",
					"runs": [
						"(7)... Certain astral energies, emanating from some planetary forms which as yet exist not in the",
						103,
						"form of physical planets, nor yet in the etheric realm, but which are enclosed within the ring-pass-not of our solar system. They represent, in the planetary sense, two groups of lives:—First, those astral shells of decaying and disintegrating planets which are to be seen by the initiate, still revolving around our sun, but which are nevertheless fast disappearing. Our moon will join their number when the complete disintegration of the outer form has taken place. Second, the astral forms of those lesser solar lives on the evolutionary arc who are taking form slowly but have not yet taken an etheric body, and will never in this world period take a physical body. These two groups are the planetary correspondences to the re-incarnating types of men, and to those who have passed over and are slowly shedding their bodies, prior to eventual rebirth, or who have completely vacated their shells."
					],
					"page": 102,
					"chapter": 8
				},
				{
					"t": "p",
					"runs": [
						"There are two of these astral forms in close proximity to our Earth, which are rapidly “decomposing,” if may so term it, and yet have a very potent influence. On account of this close relation, they produce two types of desire or of astral tendency among men. One produces much of that instinctual tendency to cruelty which one sees in children and in certain types of men, and the other has an effect upon the sex life and produces some of those tendencies to perversions which cause so much difficulty now. Sadistic tendencies and sex perversions find much strengthening influence from these dying astral emanations. In ancient days they were still more potent, being closer to our earth than now; hence the ritualistic cruelties and the horrors, for instance, of Sodom and Gomorrah. Their power is rapidly declining and it should be remembered that they would have no power at all were there not in humanity itself certain instincts upon which these energies can work. It should also",
						104,
						"be remembered that in Lemurian times their influence was constructive, for in those days, the lesson of sex and the intelligent registering of pain hada place in the scheme of those who were endeavouring"
					],
					"page": 103,
					"chapter": 8
				},
				{
					"t": "p",
					"runs": ["to lead animal man into human consciousness— not into soul consciousness or even into self-consciousness in those very early times. (4 — 312/3). (8) The major cause of a distressing dream life is, in every case, a frustration or an inability of the soul to impose its wishes and designs upon its instrument, the man. These frustrations fall into three categories:"],
					"page": 104,
					"chapter": 8
				},
				{
					"t": "p",
					"runs": ["1. Sex frustration. This type of frustration leads in many cases, especially in the average person, to an over-emphasis of the fact of sex, to an uncontrolled sex thought-life, to sexual jealousies (oft unrecognised) and to physical underdevelopment."],
					"page": 104,
					"chapter": 8
				},
				{
					"t": "p",
					"runs": ["2. Frustrated ambition. This dams back the resources of the life, produces constant inner fret, leads to envy, hatred, bitterness, intense dislike of the successful, and causes abnormalities of many kinds."],
					"page": 104,
					"chapter": 8
				},
				{
					"t": "p",
					"runs": ["3. Frustrated love. This would perhaps be included under sex frustration by the average psychologist, but it is not so viewed by the esotericist. There can be full sexual satisfaction or else complete freedom from its grip and yet the out-going magnetic love nature of the subject may meet only with frustration and lack of response."],
					"page": 104,
					"chapter": 8
				},
				{
					"t": "p",
					"runs": ["Where these three types of frustration exist, you will frequently have a vivid, unwholesome dream life, physical liabilities of many kinds and a steadily deepening unhappiness. (8 — 496)."],
					"page": 104,
					"chapter": 8
				},
				{
					"t": "p",
					"runs": [
						"(9) When, for instance, the sacral energy is raised to the solar plexus, there will be found many",
						105,
						"ailments involving, as noted before, the intestinal tract. When the energy of the lesser centres which are found below the diaphragm (but not up the spine) are raised to the solar plexus centre, trouble involving the gall bladder and the kidneys will often be found. Occultly speaking, any process of elevation or of “raising up” automatically involves death. This death affects the atoms in the organs involved and causes the preliminary stages of ill-health, disease and disruption, because death is nothing but a disruption and a removal of energy. When the science of the transference of energy from a lower centre to a higher is understood, then light will be thrown upon the entire problem of dying and the true Science of Death will come into being, liberating the race from fear."
					],
					"page": 104,
					"chapter": 8,
					"kind": "extract"
				},
				{
					"t": "p",
					"runs": ["Students would do well at this stage to pause and consider the following points with care:"],
					"page": 105,
					"chapter": 8
				},
				{
					"t": "li",
					"runs": ["1. Which are the areas controlled by the five centres up the spine and the two centres in the head."],
					"page": 105,
					"chapter": 8
				},
				{
					"t": "li",
					"runs": ["2. The three major points of transference:—the solar plexus, the throat centre and the ajna centre in the head. The heart centre and the highest head centre, as points of transference, only concern the initiate."],
					"page": 105,
					"chapter": 8
				},
				{
					"t": "li",
					"runs": ["3. The fluidic and changeable condition produced by the processes of awakening, transference and the focussing of the energy in the higher centre. These three major activities are conditioned by the intermediate stages of:"],
					"page": 105,
					"chapter": 8
				},
				{
					"t": "li",
					"runs": ["a. The active radiation of the lower centre."],
					"page": 105,
					"chapter": 8
				},
				{
					"t": "li",
					"runs": ["b. The responsiveness of the lower centre to the magnetic pull of the higher."],
					"page": 105,
					"chapter": 8
				},
				{
					"t": "li",
					"runs": [
						"c. The succeeding interplay between the higher and the lower centres, conditioned",
						106,
						"at first by arhythmic repulsion and attraction. This is a reflection of the play of the dualities in the career of the human being."
					],
					"page": 105,
					"chapter": 8
				},
				{
					"t": "li",
					"runs": ["d. This is followed by a concentration of the lower energy in the higher centre."],
					"page": 106,
					"chapter": 8
				},
				{
					"t": "li",
					"runs": ["e. Then comes the control of the lower centre or centres by the higher focal points of energy and their rhythmic interplay."],
					"page": 106,
					"chapter": 8
				},
				{
					"t": "p",
					"runs": ["Between all these different stages come “points of crisis” of greater or lesser moment. This intense interior activity which is going on all the time in the subjective life of humanity produces both good and bad effects, and psychological as well as physiological reactions. Today, the mass transference of the forces of the sacral centre into that of the solar plexus is responsible for many of the modern and physical disabilities of the race. Because also of the slow removal ona racial scale of the sacral force to the solar plexus there is eventuating a condition which is called sometimes “race suicide,” necessitating the efforts of many of the different governments to offset the rapidly falling birth rate in their countries."],
					"page": 106,
					"chapter": 8
				},
				{
					"t": "p",
					"runs": ["The above summation of the threefold activity which is going on in the human body all the time will give some idea of the strain under which the individual man labours, and will account, therefore, for much of the discomfort and disease found in those areas in the human body which are governed and controlled by a particular centre. I would like to add the following points to the information given above:"],
					"page": 106,
					"chapter": 8
				},
				{
					"t": "li",
					"runs": ["1. The intense activity of the sacral centre will often produce diseases and physiological abnormalities, connected with the organs of reproduction (both male and female). These difficulties are of two kinds:"],
					"page": 106,
					"chapter": 8
				},
				{
					"t": "li",
					"runs": ["a. Those to which normal humanity is prone and which are well known to the physician, surgeon and psychologist."],
					"page": 107,
					"chapter": 8
				},
				{
					"t": "li",
					"runs": ["b. Those which are the result of overstimulation, through the successful effort of the mystic to bring in energy from the higher centres and from sources outside the human frame altogether."],
					"page": 107,
					"chapter": 8
				},
				{
					"t": "li",
					"runs": ["2. In all cases of transference, the intense activity produced will cause all kinds of tensions and reactions, resulting in congestions, inflammations and diseases of the organs vitalised. This is particularly the case today in relation to the sacral and solar plexus centres. The glands—major and minor, endocrine and lymphatic—in the abdominal area are powerfully affected and through their hyper-sensitivity or their “deficiency through abstraction” (as it is esoterically called) they constitute a fruitful source of difficulty. (8 —548/551)."],
					"page": 107,
					"chapter": 8
				},
				{
					"t": "p",
					"runs": [
						"(10)... as the race develops right emotional control we shall see the gradual disappearance of the phenomena of cancer. I said right emotional control; inhibition and the suppression of the desire impulses by the force of the will is not right control. It is interesting also to note that though both men and women suffer from the disease of cancer, the general cause is not identical, though the basic cause (reaction from an over-expression of the sex life through the cultivation of the desire nature) remains the same. Women, owing to the risks they run in childbearing, through the turning of the life emphasis to the sex aspect of life, have revolted on a large scale (as did the Atlanteans) against this form of life expression, and it is along this line—the sex line—that their major inhibitions are found. They do not suffer so much from",
						108,
						"the general inhibition of the emotional-desire-feeling expression. Men do suffer from this latter inhibition and have a tradition or a marked tendency to greater emotional control in the handling of life than have women. Men do not require or acquire so marked a sex control. The general field of their inhibited life tendency is therefore of greater extent, and consequently (if statistics can be trusted) more men suffer from cancer than do women, though it is a dread disease, feared by all."
					],
					"page": 107,
					"chapter": 8
				},
				{
					"t": "p",
					"runs": ["of cancer, and this will eventually be realised. I am"],
					"page": 108,
					"chapter": 8
				},
				{
					"t": "p",
					"runs": ["In the secret of right transmutation lies the cure using this phrase not only symbolically but also technically and scientifically. This again will later be seen. In the secret of right rhythmic living and in a right proportional accent upon all phases of life will come (and it is rapidly coming) complete immunity from tuberculosis. In the secret of right understanding of times and cycles, and of periodic reproductive creation, will come the emergence of the race from the evils of the social diseases."],
					"page": 108,
					"chapter": 8
				},
				{
					"t": "p",
					"runs": ["It will be apparent to you, therefore, that the syphilitic diseases will be the last to disappear, just as they were the first to devastate the race. Tuberculosis is disappearing. The attention of the experts is now being given to the cure of cancer. (10 — 60/1)."],
					"page": 108,
					"chapter": 8
				},
				{
					"t": "p",
					"runs": [
						"(11) Immediately after death, and particularly if cremation has taken place, the man, in his kama-manasic body, is as much aware and alert to his environment as he was upon the physical plane when alive.... May I again remind you that there is now no physical brain to respond to impacts generated by the inner man, and also that sex, as it is physically understood, is nonexistent. Spiritualists would do well to remember this and so grasp the foolishness as well as the impossibility of those spiritual marriages which certain schools of",
						109,
						"thought in the movement teach and practice. The man, in his astral body, is now free from the strictly animal impulses which, upon the physical plane, are both normal and right, but which now have no meaning to him in his kamic body. (10 —490/1)."
					],
					"page": 108,
					"chapter": 8,
					"kind": "extract"
				}
			]
		},
		{
			"id": "c09",
			"title": "Homosexuality",
			"page": 110,
			"blocks": [
				{
					"t": "h1",
					"id": "c09",
					"s": "Homosexuality",
					"page": 110,
					"chapter": 9
				},
				{
					"t": "p",
					"runs": ["(1) One of the major problems today to the psychologist, and in a lesser degree to the medical man, is the growth of homosexuality, both female and male. Specious arguments are brought forth in order to prove that this abnormal development (and the consequent interest in this morbid tendency) is due to the fact that the race is slowly becoming androgynous in its development, and that the future hermaphroditic man or woman is gradually making its appearance. This, again, is not true. Homosexuality is what you call a “leftover” from the sexual excesses of Lemurian times, an inherited taint, if you like. Egos who individualised and incarnated in that vast period of time are the ones who today demonstrate homosexual tendencies. In those days, so urgent was the sexual appetite, the normal processes of human intercourse did not satisfy the insatiable desire of the advanced man of the period. Soul force, flowing in through the processes of individualisation, served to stimulate the lowest centres. Hence, forbidden methods were practised. Those who thus practised them are today, in great numbers, in incarnation, and the ancient habits are too strong for them. They are now far enough advanced upon the evolutionary path so that the cure lies ready at this time—if they choose to employ it. They can, with relative ease, transfer the sex impulse to the throat centre, and thus become creative in the higher sense, employing the energy sensed and circulating in right and constructive ways. Many of them are beginning automatically to do this. However, it is well known that, among the so-called artistic types, homosexuality is very prevalent. I say “so called” for the truly creative artist is not the victim of these ancient evil predisposing habits. It might"],
					"page": 110,
					"chapter": 9,
					"kind": "extract"
				},
				{
					"t": "p",
					"runs": ["‘inds:"],
					"page": 110,
					"chapter": 9
				},
				{
					"t": "p",
					"runs": [
						"Be Bointad out here that homosexuality is of three",
						111,
						"1. That which is the result of ancient evil habits. This is the major cause today and indicates: a. Individualisation upon this planet; for"
					],
					"page": 110,
					"chapter": 9
				},
				{
					"t": "p",
					"runs": ["those who individualised upon the moon"],
					"page": 111,
					"chapter": 9
				},
				{
					"t": "p",
					"runs": ["chain are not susceptible to these dangerous characteristics."],
					"page": 111,
					"chapter": 9
				},
				{
					"t": "p",
					"runs": ["b. A relatively advanced stage upon the evolutionary path which was achieved by the"],
					"page": 111,
					"chapter": 9
				},
				{
					"t": "p",
					"runs": ["Lemurian egos who succumbed to this"],
					"page": 111,
					"chapter": 9
				},
				{
					"t": "p",
					"runs": ["desire-satisfaction."],
					"page": 111,
					"chapter": 9
				},
				{
					"t": "p",
					"runs": ["c. A consequent study of sex magic, plus a"],
					"page": 111,
					"chapter": 9
				},
				{
					"t": "p",
					"runs": ["constant insatiable physical and sexual"],
					"page": 111,
					"chapter": 9
				},
				{
					"t": "p",
					"runs": ["urge."],
					"page": 111,
					"chapter": 9
				},
				{
					"t": "p",
					"runs": ["2. Imitative homosexuality. A number of persons of all classes imitated their betters (if I might use so paradoxical a term) and so developed evil habits in sexual intercourse from which they might otherwise have remained free. This is one of the prevalent reasons today, among many men and women, and is based upon a too active imagination, plus a powerful physical or sex nature, and a prurjent curiosity. This I say with advisement. This category accounts for many of our Sodomites and Lesbians."],
					"page": 111,
					"chapter": 9
				},
				{
					"t": "p",
					"runs": ["3. A few rare, very rare, cases of hermaphroditism. These people, combining in themselves both aspects of the sex life, are faced with a very real problem. It is a problem which is greatly increased by human ignorance, human refusal to face facts, wrong early training and teaching, and a widespread misunderstanding. These cases are to be found in small numbers everywhere, even though their numbers, in relation to the world population, is still negligible. But that they exist is of real interest to the medical profession and a subject of deep pity and commiseration to"],
					"page": 111,
					"chapter": 9
				},
				{
					"t": "p",
					"runs": ["the humanitarian and the understanding"],
					"page": 112,
					"chapter": 9
				},
				{
					"t": "p",
					"runs": ["psychologist. They face a difficult situation."],
					"page": 112,
					"chapter": 9
				},
				{
					"t": "p",
					"runs": ["... Psychologists, social workers, physicians, and all those occupied with group training constantly meet with this problem, and it is just as well that some distinction is made between the types which must be considered, thus clarifying the issue."],
					"page": 112,
					"chapter": 9
				},
				{
					"t": "p",
					"runs": [
						"... You will note also from the above how this taint, as might well be expected, has its roots in the astral or sentient body, the body of sensation. It is for this reason that I have included it. It would be an interesting experiment in analysis if these various well-known difficulties, diseases and complaints could be classified under their originating impulses. So few of them have a mental origin, in spite of all that Christian Science or Mental Science may say to the contrary. Perhaps I should say rather, that they are not based on wrong human thought, though all evil can be aggravated and intensified by wrong thought. Many or perhaps most of the complaints from which average man suffers are based upon astral causes or upon some clearly defined desire. A formulated desire is one that finds expression in some form of activity. Of these homosexuality is one of the clearest to define. The other diseases to which humanity is heir are sometimes not so easy to clarify and define. The man or woman is a victim but the cause producing the illness or difficulty—physical or psychological—lies hid in a long past which the victim (with his limited knowledge) is unable to investigate, nor can he arrive at the cause producing the effect. All that he can affirm is that, in all probability, desire was the initiating impulse. What human beings are today and what they suffer is the result of their long past, and the past presupposes long and well-established habits.",
						113,
						"Such habits are inevitably the result of one of two factors:"
					],
					"page": 112,
					"chapter": 9
				},
				{
					"t": "li",
					"runs": ["1. Desire, dominating and controlling action, or"],
					"page": 113,
					"chapter": 9
				},
				{
					"t": "li",
					"runs": ["2. Mental control which substitutes for desire a planned campaign which will run counter in many cases to the normally sensed, defined desire."],
					"page": 113,
					"chapter": 9
				},
				{
					"t": "p",
					"runs": ["You will note from the above that it is my wish that you grasp the importance of the emotional sentient body and its power to initiate those secondary causes which, in this life, demonstrate as disease. (10 — 62/5)."],
					"page": 113,
					"chapter": 9
				}
			]
		},
		{
			"id": "c10",
			"title": "The Rays and Sex Energy",
			"page": 114,
			"blocks": [
				{
					"t": "h1",
					"id": "c10",
					"s": "The Rays and Sex Energy",
					"page": 114,
					"chapter": 10
				},
				{
					"t": "p",
					"runs": ["(1) The relation of the rays to the centres in the average aspirant might be classified as follows:"],
					"page": 114,
					"chapter": 10,
					"kind": "extract"
				},
				{
					"t": "p",
					"runs": ["1, Head centre.... -Ray of Will or Power. First Ray. 2. The Ajna centre........ Ray of Concrete Knowledge. Fifth Ray. 3. The Throat centre..... Ray of Active Intelligence. Third Ray. 4. Heart centre.......... Ray of Love-Wisdom. Second Ray. 5. The Solar plexus...... Ray of Devotion. Sixth Ray."],
					"page": 114,
					"chapter": 10
				},
				{
					"t": "p",
					"runs": ["6. The Sacral centre..... Ray of Ceremonial Magic. Seventh Ray. 7. Base of Spine......... Ray of Harmony. Fourth Ray."],
					"page": 114,
					"chapter": 10
				},
				{
					"t": "p",
					"runs": ["These rays and their corresponding centres warrant most careful study. They are comprehensive and revealing. Note, for instance, that at this time the seventh ray governs and expresses itself through the sacral centre, that which controls the sex life and the building of forms of expression. Therefore it swings now into activity and pours through this particular centre in order to organise and produce the appearance of those new forms through which all life in the new cycle (astrologically understood and periodically and cyclically understood) may express itself. Thus it was necessary for the sex life to be controlled by this type of energy in order to bring about the needed changes, and hence also one of the great results of the influence of the incoming seventh ray has been the increase in the mental interest in sex. (7 — 261/2)."],
					"page": 114,
					"chapter": 10
				},
				{
					"t": "p",
					"runs": [
						"(2) Curiously enough, it is the potency of this sixth ray force (as it feeds desire) which is responsible for much of the ills and diseases of humanity which are based upon the misuse of the mission and function of sex. Desire, bewilderment, weakness, perversions and the one-pointed development of sexual and other satisfactions grow out of the misuse of this energy. The bewilderment growing out of desire leads to a violently demanded satisfaction and the taking of those steps—some right and some wrong—which lead to satisfaction.",
						115,
						"The results cover a wide field, all the way from sadistic cruelty and lust to those marriages which are based on physical desire and to those conditions which lead to the many forms of sexual disease. A clue to this whole worldwide problem lies in the words of an ancient writing which says that “the imperfection of the Lord of the Sixth Ray opened the door to an erroneous marriage between the poles.” (10 — 303)."
					],
					"page": 114,
					"chapter": 10,
					"kind": "extract"
				},
				{
					"t": "p",
					"runs": ["(3) The major function of this seventh ray is to bring together the negative and positive aspects of the natural processes. It consequently governs the sex relationship of all forms; it is the potency underlying the marriage relation, and hence as this ray comes into manifestation in this world cycle, we have the appearance of fundamental sex problems—license, disturbance in the marriage relation, divorce and the setting in motion of those forces which will eventually produce a new attitude to sex and the establishing of those practices, attitudes and moral perceptions which will govern the relation between the sexes during the coming New Age."],
					"page": 115,
					"chapter": 10,
					"kind": "extract"
				},
				{
					"t": "p",
					"runs": ["The first initiation is therefore closely related to this problem. The seventh ray governs the sacral centre and the sublimation of its energy into the throat or into the higher creative centre; this ray is therefore setting in motion a period of tremendous creative activity, both on the material plane through the stimulation ofthesex life of all peoples and in the three worlds through the stimulation brought about when soul and form are consciously related. The first major proof that humanity (through the medium of the majority of its advanced people) has undergone the first initiation will be the appearance of a cycle of entirely new creative art. This creative urge will take forms which will express the new incoming energies. (11 — 571/2)."],
					"page": 115,
					"chapter": 10
				},
				{
					"t": "p",
					"runs": ["(4)... The energy of the seventh ray is the potent agent of initiation when taken on the physical plane, that is, during the process of the first initiation."],
					"page": 116,
					"chapter": 10
				},
				{
					"t": "p",
					"runs": ["... Its effect upon humanity will be:"],
					"page": 116,
					"chapter": 10
				},
				{
					"t": "p",
					"runs": ["a. To bring about the birth of the Christ-consciousness among the masses of intelligently aspiring human beings."],
					"page": 116,
					"chapter": 10
				},
				{
					"t": "p",
					"runs": ["b. To set in motion certain relatively new evolutionary processes which will transform humanity (the world disciple) into humanity (the world initiate)."],
					"page": 116,
					"chapter": 10
				},
				{
					"t": "p",
					"runs": ["c. To establish in a new and intelligible manner the ever-existent sense of relationship and thus bring about upon the physical plane right human relations. The agent of this is goodwill, a reflection of the will-to-good of the first divine aspect. Of this first Ray of Will or Purpose, goodwill is the reflection."],
					"page": 116,
					"chapter": 10
				},
				{
					"t": "p",
					"runs": ["d. To readjust negative and positive relationships, and—today—this will be carried forward primarily in connection with the sex relation and marriage."],
					"page": 116,
					"chapter": 10
				},
				{
					"t": "p",
					"runs": ["e. To intensify human creativity and thus bring in the new art as a basis for the new culture and as a conditioning factor in the new civilisation."],
					"page": 116,
					"chapter": 10
				},
				{
					"t": "p",
					"runs": ["f. To reorganise world affairs and so initiate the new world order. This is definitely in the realm of ceremonial magic. (11 — 573/4). (5) Ray Seven"],
					"page": 116,
					"chapter": 10
				},
				{
					"t": "p",
					"runs": ["“The Angel of the Presence lifts one hand into the blue of heaven. He plunges deep the other into the sea of forms. Thus he connects the world of form and formless life. Heaven to earth he brings; earth into heaven. This the man, who stands before the Angel, knows."],
					"page": 116,
					"chapter": 10
				},
				{
					"t": "p",
					"runs": ["He grasps the meaning of the painted sign"],
					"page": 117,
					"chapter": 10
				},
				{
					"t": "p",
					"runs": ["which the Angel holds aloft. [Then follows a"],
					"page": 117,
					"chapter": 10
				},
				{
					"t": "p",
					"runs": ["phrase which is incapable of translation into"],
					"page": 117,
					"chapter": 10
				},
				{
					"t": "p",
					"runs": ["modern language. It signifies that complete"],
					"page": 117,
					"chapter": 10
				},
				{
					"t": "p",
					"runs": ["merging which the mystic endeavours to express in terms of the “marriage in the heavens,”"],
					"page": 117,
					"chapter": 10
				},
				{
					"t": "p",
					"runs": ["and which has been wrongly twisted into the"],
					"page": 117,
					"chapter": 10
				},
				{
					"t": "p",
					"runs": ["false teaching anent sex magic. This phrase,"],
					"page": 117,
					"chapter": 10
				},
				{
					"t": "p",
					"runs": ["expressed by a painted symbol, symbolises"],
					"page": 117,
					"chapter": 10
				},
				{
					"t": "p",
					"runs": ["complete unity between the outer and the inner,"],
					"page": 117,
					"chapter": 10
				},
				{
					"t": "p",
					"runs": ["the objective and the subjective, between spirit"],
					"page": 117,
					"chapter": 10
				},
				{
					"t": "p",
					"runs": ["and matter, and between the physical and the"],
					"page": 117,
					"chapter": 10
				},
				{
					"t": "p",
					"runs": ["essential.]"],
					"page": 117,
					"chapter": 10
				},
				{
					"t": "p",
					"runs": ["The two are one. Naught more remains to"],
					"page": 117,
					"chapter": 10
				},
				{
					"t": "p",
					"runs": ["grasp. The Word is manifest. The work is seen"],
					"page": 117,
					"chapter": 10
				},
				{
					"t": "p",
					"runs": ["complete. The Whole is visioned. The magic"],
					"page": 117,
					"chapter": 10
				},
				{
					"t": "p",
					"runs": ["work is wrought. Again the two are one. The"],
					"page": 117,
					"chapter": 10
				},
				{
					"t": "p",
					"runs": ["Plan is served. No word need then be said.” (8"],
					"page": 117,
					"chapter": 10
				},
				{
					"t": "p",
					"runs": [
						"(6) As he realises the task to be carried out and the nature of the work to be done by the seventh ray worker, and appreciates the fact that it is the magical work of producing those forms on earth which will embody the spirit of God (and in our particular time, this necessitates the building of new forms), each seventh ray disciple will see himself as a relating agent, as the one who stands in the midst of the building processes, attending to his portion of the task. This, if really grasped and deeply considered will have the effect of producing alignment. The moment that this alignment is achieved, then let the disciple remember that it will mean a tremendous inflow of power, of energy from both the aligned points, from both directions, converging upon him, as he stands in the midway place. Ponder deeply upon this truth, for it is this fact which always evokes a seventh ray crisis. It will be obvious what this crisis is. If the man concerned is materially minded, selfishly ambitious",
						118,
						"and unloving, the inpouring energy will stimulate the personality nature and he will immediately be warring furiously with all that we mean by the instinctual, psychic, intellectual nature. When all these three are stimulated, the disciple is often for a time swung off the centre into a maelstrom of magical work of the lower kind—sex magic and many forms of black magic. He is glamoured by the beauty of his motive, and deceived by the acquired potency of his personality. (8 — 3876/7)."
					],
					"page": 117,
					"chapter": 10,
					"kind": "extract"
				}
			]
		},
		{
			"id": "c11",
			"title": "Astrology and Sex Energy",
			"page": 119,
			"blocks": [
				{
					"t": "h1",
					"id": "c11",
					"s": "Astrology and Sex Energy",
					"page": 119,
					"chapter": 11
				},
				{
					"t": "p",
					"runs": ["(1) Scorpio is the sign of sex and of regeneration, and birth is ever the intended result of the sex relation. Father-spirit and Mother-matter when brought together produce the Son. The tests and difficulties and pains of this era are symptoms or indications of the “entering into manifestation” of the new civilisation and culture. They portend the birth of the new era for which the entire world waits. This will happen if—speaking esoterically— the sixth ray energy of Mars is transmuted into the sixth ray energy of Neptune, for the one is “objective and full of blood” and the other is “subjective and full of life.” (9 — 217)."],
					"page": 119,
					"chapter": 11,
					"kind": "extract"
				},
				{
					"t": "p",
					"runs": ["(2)... Mars is closely related to sex, which is an aspect of the pairs of opposites, and its effect is also definitely to vitalise the blood stream; it vitalises, purifies and stimulates all aspects and organisms in the body, via the blood stream. It will be obvious to you, therefore, how the tests in Scorpio and the activity of Mars are potent to arouse the entire lower nature and bring about its final rebellion and the last stand, so to speak, of the personality against the soul. It is Mars who brings the world Arjuna into the active fight. The whole man is then engaged and the “quarrel of the sexes” is resolved in its highest aspect through the battle between the highly developed personality or form nature and the soul which seeks to be the ultimate controlling factor."],
					"page": 119,
					"chapter": 11
				},
				{
					"t": "p",
					"runs": [
						"The colour assigned to Mars is, as you know, red and this is a correspondence to the colour of the blood stream and hence also the association of Mars with passion, with anger and a sense of general opposition. The sense of duality is exceedingly powerful. Hence also the necessity for the entire life of man (for the blood is the life in this sense) to",
						120,
						"be swung into the conflict, leaving no side of human nature uninvolved; hence again the need for the disciple to carry his physical nature, his emotional or desire nature and his mental processes up into heaven. This takes place as a consequence of overcoming the “serpent of evil” (the form nature with its promptings and demands) by the means of the “serpent of wisdom,” which is the esoteric name oft given to the soul."
					],
					"page": 119,
					"chapter": 11
				},
				{
					"t": "p",
					"runs": [
						"In connection with the symbolic connection between Mars and the blood, producing the resultant conflict between life and death (for Scorpio is one of the signs of death), it is interesting to note that Christianity is governed by Mars. One is apt to recognise with ease that the sixth ray, working through Mars, rules Christianity. It is a religion of devotion, fanaticism, of high courage, of idealism, of the spiritual emphasis upon the individual and his worth and problem, of conflict and of death. All those characteristics are familiar to us in the presentation of Christian theology. It is however preeminently a religion which has waged a cruel and oft illogical war upon sex and its implications; it has emphasised a militant celibacy (militant where women and their rights and natures are concerned); it has regarded the sex relation as one of the primary evils in the world and has laid the emphasis upon the inviolable nature of the marriage bond when endorsed by the Church. This has all been the result of the beneficent or the malefic effect of the impact of sixth ray force upon the form nature. Little emphasis has been laid nevertheless upon the influence of Mars upon Christianity, making it a definitely militant religion, oft cruel and sadistic (as witness the murders and tortures carried out in the name of Christ, who was the outstanding Representative of God’s love). Throughout the teaching of Christian theology, the theme of blood runs ceaselessly and the source of salvation",
						121,
						"is laid upon the blood relationship and not upon the life aspect which the blood veils and symbolises. It is the creed of a crucified and dead Christ which rules Christianity and not that of the risen Master. One of the reasons for this travesty of the truth has been that St. Paul, that great initiate, prior to taking the third initiation which he did at the time he was functioning as related in The Acts of the Apostles, was potently under Martian influence and was born in Scorpio; a study of his horoscope would demonstrate this were you in a position to study as can we who are connected with the Hierarchy. It was he who gave the Scorpio-Mars slant to the interpretation and exposition of the Christian teaching and deflected its energy into channels of teaching which its Founder had never intended. Such is often the undesirable effect of the activities of well-meaning disciples upon the work which they undertake to carry on after the originator of some work for the Hierarchy passes over to the other side through death or relinquishes his task in order to take up other duties. (9 —211/3)."
					],
					"page": 120,
					"chapter": 11
				},
				{
					"t": "p",
					"runs": [
						"(3) The three tests in Scorpio also concern the three aspects of the human being as they fuse and blend upon the physical plane. They are, first of all, the test of appetite. This appetite is the natural predilections and tendencies which are inherent in the animal nature and these are mainly three: Sex, physical comfort, and money, as concretised energy. They are, secondly, the tests connected with desire and the astral plane. These are subtler in nature, producing automatic effects upon the physical plane; they are not inherent in the animal nature but are imposed by the desire nature and are again three in number: Fear, hatred and ambition or desire for power. Then there are, thirdly, the tests of the lower critical mind which are: Pride, separativeness and cruelty. Remember that the",
						122,
						"worst kind of cruelty is not of physical nature but is more mental in character. (9 — 205)."
					],
					"page": 121,
					"chapter": 11,
					"kind": "extract"
				},
				{
					"t": "p",
					"runs": ["(4)... Two of the other non-sacred planets— Mars and Pluto—function in connection with the sacral centre (Mars) and the solar plexus (Pluto). This latter planet becomes active in the life of the man who is “becoming alive in the higher sense, his lower nature passes into the smoke and darkness of Pluto, who governs the lesser burning ground, in order that the man may live in truth in the higher land of light.” (9 — 78)."],
					"page": 122,
					"chapter": 11
				},
				{
					"t": "p",
					"runs": ["(5) It is because of this balancing quality in Libra that this constellation can be associated more specifically with the problem of sex than can any of the others. Sex is usually connected in the mind of the average astrological student with the signs Taurus and Scorpio. This is probably due to the fact that the Bull is so frequently regarded as the symbol of the mad urges of the uncontrolled sex principle and because in Scorpio fundamental tests are applied. For most aspirants in the early stages, sex does constitute a fundamental problem. Esoterically, however, it is in Libra that the whole question comes up and will increasingly come up for answering, and it is in Libra that the balancing of the pairs of opposites must take place and reach solution through the activity of the judicial mind and the establishing of a point of equilibrium between the male and the female principles. (9 — 233)."],
					"page": 122,
					"chapter": 11,
					"kind": "extract"
				},
				{
					"t": "p",
					"runs": [
						"(6) When, however, the consciousness of man is opened up in such a manner that it can register that which is proceeding and taking place in the three lower kingdoms in nature, then further light and information will be given. This will take place in a period of human history when Libra is dominant and the three divine aspects of the third Person of the Trinity, the Holy Spirit, the Creator—",
						123,
						"law, sex and money—will give the clue to the three lower kingdoms. Law, natural law (the externalisation of the subjective spiritual law) will give the clue to the animal kingdom; sex or the consciousness of affinity will reveal the mystery of the vegetable kingdom; money will unveil the secret of the mineral kingdom... Suffice it to say here that each of these three signs is related to one of these three aspects of divine life:"
					],
					"page": 122,
					"chapter": 11,
					"kind": "extract"
				},
				{
					"t": "li",
					"runs": ["1. Taurus—animal kingdom—law—natural law."],
					"page": 123,
					"chapter": 11
				},
				{
					"t": "li",
					"runs": ["2. Libra—vegetable kingdom—sex—natural affinity."],
					"page": 123,
					"chapter": 11
				},
				{
					"t": "li",
					"runs": ["3. Capricorn—mineral kingdom—money—concrete expression of the Law of Supply,... (9 —245)."],
					"page": 123,
					"chapter": 11
				},
				{
					"t": "p",
					"runs": ["(7) Venus connotes in our minds, even if we have only a glimmer of occult truth, that which is mental, that which concerns final sublimation, that which deals with sex and that which must work out into symbolic expression upon the physical plane. These are the major concepts which enter our minds when Venus and Taurus are considered in unison. These factors of expression have ever been related to these two since the night of time, because they are essentially basic and eternally cosmic in their implications. Taurus is one of the signs which veils a certain divine mystery. For the sake of disciples in training, these four concepts have been briefly summed up in an archaic writing of great significance. This writing states:"],
					"page": 123,
					"chapter": 11,
					"kind": "extract"
				},
				{
					"t": "p",
					"runs": ["“The holy Sons of Mind embraced the two."],
					"page": 123,
					"chapter": 11
				},
				{
					"t": "p",
					"runs": ["They saw and understood. Thus was sex born"],
					"page": 123,
					"chapter": 11
				},
				{
					"t": "p",
					"runs": ["and thus the great mistake was made. The"],
					"page": 123,
					"chapter": 11
				},
				{
					"t": "p",
					"runs": ["mind was outward turned. The form appears"],
					"page": 123,
					"chapter": 11
				},
				{
					"t": "p",
					"runs": ["to view and not the life."],
					"page": 123,
					"chapter": 11
				},
				{
					"t": "p",
					"runs": ["“Out of the dark, they cried aloud, the holy"],
					"page": 124,
					"chapter": 11
				},
				{
					"t": "p",
					"runs": ["Sons of Mind. In pain, they cried aloud. They"],
					"page": 124,
					"chapter": 11
				},
				{
					"t": "p",
					"runs": ["inward looked and knew the error they had"],
					"page": 124,
					"chapter": 11
				},
				{
					"t": "p",
					"runs": ["made but knew not what to do.... The Lord"],
					"page": 124,
					"chapter": 11
				},
				{
					"t": "p",
					"runs": ["replied and gave to them the sign of resurrection.”"],
					"page": 124,
					"chapter": 11
				},
				{
					"t": "p",
					"runs": ["Do you grasp the significance of this statement, and its fundamental simplicity? Let me give you a hint. The earthly triplicity has been designated by astrologers as embodying the idea of plains (Taurus), of caves (Virgo) and of rock (Capricorn). It might be stated that these caves exist in the rocks, deep under the plains. I am speaking figuratively and symbolically. Out of the rocky cave, the Christ emerged and walked again upon the plains of Earth and from that time “the woman knew Him not.” Form had no further hold upon him for He had overcome it in the depths. Into the cave of Initiation, the light of resurrection streams when the stone at the entrance is rolled away. From life in the form to the death of the form—deep in the rocky place, down in the crypts of the Temple—the human being goes. But into that same place, the new life streams, bringing fresh life and liberation; old things pass away and the darkness becomes light. (9 — 384/5)."],
					"page": 124,
					"chapter": 11
				},
				{
					"t": "p",
					"runs": [
						"(8) We are told that Sagittarius governs the thighs, which are the main centre of physical power and protective strength, and also the sacral centre which provides the energy for the use of the creative powers of the physical life. This is also symbolically true. In Sagittarius, the disciple has two things to discover within himself; these are the power to make progress upon the path and to walk the Way, and also the ability to create in the higher and spiritual sense. This concerns the relationship between the sacral and the throat centres. These powers (the higher powers) are as yet embryonic in",
						125,
						"the earlier Sagittarian experience of the disciple, but they become more developed and potent as he cyclically returns to life experience in this sign. (9 — 191)."
					],
					"page": 124,
					"chapter": 11,
					"kind": "extract"
				}
			]
		},
		{
			"id": "c12",
			"title": "Devas and Sex Energy",
			"page": 126,
			"blocks": [
				{
					"t": "h1",
					"id": "c12",
					"s": "Devas and Sex Energy",
					"page": 126,
					"chapter": 12
				},
				{
					"t": "p",
					"runs": ["(1)... A further clue to the sad condition to beseen in the world (especially along sex lines) lies in the fact that those units of the human family who contribute to the constitution of this particular centre [of the Planetary Logos] out of the seven, are frequently at this stage over-vitalised, the physical vehicle vitality indicating to them the line of least resistance. To word it otherwise: The deva forces who form the centre, and are likewise the activity of the centre, are as yet overdominant, and the power they acquired in the earlier solar system has not yet been transmuted into spiritual power. (3 —649)."],
					"page": 126,
					"chapter": 12
				},
				{
					"t": "p",
					"runs": [
						"(2) [There] are a peculiar group of Agnichaitans who have reached a stage of evolution which permits of their being separated off from their group into a group connected with a certain fire in man’s bodies. This fire owing to its present activity, and the direction of that activity, is responsible for the reaction against physical marriage, and for the desire evinced by highly evolved men everywhere to evade the marriage relation, and confine themselves to creation upon the mental or astral planes. This is due to the present inclination of the manipulatory devas of the lower generative organs to seek the throat centre, and to function there, utilising the strength of the kundalini fire to bring this about. All this is under the law of evolution, but in the interim between cause and justified effect much harm, evasion of the law, and consequent suffering can be seen. Owing, therefore, to the violent reaction at this time against the safeguarding laws of civilisation, it has been decided that the nature and functions of the devas must be somewhat revealed to man, and that their place in the scheme of things, and man’s close connection and dependence upon them, must be given out.... At",
						127,
						"the same time, the means whereby they can be contacted, and the words whereby they can be controlled, will be withheld."
					],
					"page": 126,
					"chapter": 12,
					"kind": "extract"
				},
				{
					"t": "p",
					"runs": ["Laxness in the marriage relation, due to this particular cause, is only seen amongst the highly evolved and amongst the independent thinkers of the race. Similar laxness amongst the masses, and the low types of humanity, is based upon a different reason, and their promiscuity is due to certain developments of the animal nature in its lowest manifestation. These two causes will bear consideration by those who have the present needs of civilisation at heart. They can then co-operate with the Mahachohan in the work of effecting the very necessary transfer of force from a lower to a higher centre, and prevent (through knowledge), the incidental license. This will bring about a refusal to besmirch the great love or sex impulse of nature."],
					"page": 127,
					"chapter": 12
				},
				{
					"t": "p",
					"runs": ["The ceremonial ray has been often called “the marriage ritual of the Son,” because upon this ray Spirit and matter can meet and have union. This fact also should be borne in mind during the next one hundred years, for they will see great changes in the marriage laws. The present laxity will inevitably bring a reaction, and the laws will become more stringent, in order to safeguard the race during a transition period. These laws will not be along the line of making escape from the marriage relation more difficult, but will take effect at the other end, so to speak; the rising generation will be properly taught and guarded, and indiscriminate, hasty marriage will not be permitted, nor will juveniles be allowed rashly to enter into the marriage obligation. There is no need to enlarge further upon this, for in working out their own problems men learn, and all that those upon the inner side are permitted to do is to give a hint or an indication. (3 — 908/9)."],
					"page": 127,
					"chapter": 12
				},
				{
					"t": "p",
					"runs": ["(3)... Amysterious group of devas [are] intimately connected at this time with the sex expression in the human family on the physical plane. They are agroup who are, at this juncture, swept into being, and they embody the fire of sex expression as we understand it. They are the impulse, or instinct, back of physical sex desire. They were peculiarly dominant in the fourth root-race, at which time sex conditions reached a stage of unbelievable horror from our point of view. They are gradually being controlled, and when the last of the Lemurian Egos has passed into the fifth root-race they will be slowly passed out of the solar system altogether. They are connected with the passional “fire” of the solar Logos and with one of His centres in particular; this centre is being gradually obscured and its fire transferred into a higher centre. (3 — 677)."],
					"page": 128,
					"chapter": 12
				},
				{
					"t": "p",
					"runs": ["(4) The entire problem of magnetism is closely connected with the problem of sex. In the occult study of the dissemination of the seed life and the germs of the vegetable kingdom, and in the understanding of the part played therein by those miraculously developed organisms,—the ants and bees—and later in the investigation of the work of the etheric builders, the elves and fairies, by those with awakened vision, will come a new light upon sex and upon the function it serves in the interrelation of lives and the creation of forms. With this aspect of this deeply esoteric truth I cannot here deal, for it is the effect of activity in the solar lives of the solar system, and with these we cannot concern ourselves. (7 — 244/5)."],
					"page": 128,
					"chapter": 12,
					"kind": "extract"
				},
				{
					"t": "p",
					"runs": [
						"(5) A mysterious change in the attitude of men and women to the sex question, marriage and the work of procreation will result from the development of etheric vision, and the consequent recognition of the devas. This change will be based on the realisation of the true nature of matter, or of the",
						129,
						"mother aspect, and of the effect of the Sun upon substance. The unity of life will be known and scientific fact, and life in matter will no longer bea theory but a fundamental of science. This cannot be enlarged upon here. (3 — 475)."
					],
					"page": 128,
					"chapter": 12,
					"kind": "extract"
				}
			]
		},
		{
			"id": "c13",
			"title": "Cosmic Correspondences to the Sex Impulse",
			"page": 130,
			"blocks": [
				{
					"t": "h1",
					"id": "c13",
					"s": "Cosmic Correspondences to the Sex Impulse",
					"page": 130,
					"chapter": 13
				},
				{
					"t": "p",
					"runs": ["(1)... When the Heavenly Man, Who is at present demonstrating through the Earth scheme, has succeeded in vitalising His middle centre, or in directing the force of planetary kundalini away from the lower centres to the solar plexus centre, a new cycle will be reached, and much of the present distress will be ended. His work is as yet in an embryonic condition, and two and a half more cycles must transpire before He has accomplished the necessary work. When that is done, the result in connection with the human units in incarnation will be threefold:"],
					"page": 130,
					"chapter": 13
				},
				{
					"t": "p",
					"runs": ["Sex stimulation, as now understood, will be showing a tendency to manifest in creation, not so"],
					"page": 130,
					"chapter": 13
				},
				{
					"t": "p",
					"runs": ["much on the physical plane, as on the astral"],
					"page": 130,
					"chapter": 13
				},
				{
					"t": "p",
					"runs": ["and mental, demonstrating in the creations"],
					"page": 130,
					"chapter": 13
				},
				{
					"t": "p",
					"runs": ["of art and beauty, and the objective work of"],
					"page": 130,
					"chapter": 13
				},
				{
					"t": "p",
					"runs": ["the scientists."],
					"page": 130,
					"chapter": 13
				},
				{
					"t": "p",
					"runs": ["Crime, as now seen, based largely on the sex"],
					"page": 130,
					"chapter": 13
				},
				{
					"t": "p",
					"runs": ["emotion, will be a thing of the past, and physical plane license, orgy and horror will be"],
					"page": 130,
					"chapter": 13
				},
				{
					"t": "p",
					"runs": ["reduced seventy-five per cent."],
					"page": 130,
					"chapter": 13
				},
				{
					"t": "p",
					"runs": ["The interplay between the three dense physical"],
					"page": 130,
					"chapter": 13
				},
				{
					"t": "p",
					"runs": ["planets will be perfected and man will pass at"],
					"page": 130,
					"chapter": 13
				},
				{
					"t": "p",
					"runs": ["will from one to another. (3 — 297/8)."],
					"page": 130,
					"chapter": 13
				},
				{
					"t": "p",
					"runs": ["(2) As will be seen in the three worlds of man’s emprise, man will work as a Creator and will follow a similar procedure. His thought forms will be constructed of mental matter, chosen specifically because it vibrates to the same type of vibration as the Idea seeking embodiment, and these forms will persist—as does the logoic thought form, the solar system—for just as long as the factor of Will, or dynamic vitality, continues to hold it together."],
					"page": 130,
					"chapter": 13,
					"kind": "extract"
				},
				{
					"t": "p",
					"runs": ["This brings us to our next point:"],
					"page": 131,
					"chapter": 13
				},
				{
					"t": "p",
					"runs": ["... To Provide a Body for an Idea. In this statement we have latent the basic principle of incarnation, and of activity, even of existence itself. It involves the expansion of our idea to include the cosmic mental plane as we consider the Logos, and as the creative faculty of man is studied we are taken to the mental plane of the solar system. One fundamental thought must here be given and pondered upon: This creative impulse, this tendency towards the concretion of the abstract, this inherent ability to “take form” has its fullest expression as yet in physical matter. The “raison detre” is that—for man—all substances with which he creates, all forms which he builds,and all processes of concretion which he carries on, are created, built and carried on within the physical body of the Logos. Herein can be found the reason for the emphasis laid in nature on the sex aspect, and on that of physical reproduction; it can be seen in all the kingdoms of nature, with the exception of the first and fifth. This is a most significant point and the exceptions should be studied in their widest connotation, for they contain the basic mystery of sex on the involutionary path, and on the evolutionary. In them we have the two extremes. It will have been noted that as the idea that the solar system is the physical vehicle of the Logos and His body of manifestation is grasped, many problems become elucidated, and two points especially will gradually be apprehended by the student, if he meditates and studies:"],
					"page": 131,
					"chapter": 13
				},
				{
					"t": "p",
					"runs": [
						"First. That in due course of time, as the Logos achieves liberation from the trammels of physical matter, the whole objective system will come to be regarded as an idea or concept, clothed in a veil or sheath of subtler matter than the physical, and the logoic body will be viewed as the product of will and desire, and physical matter in any of its",
						132,
						"grades will not enter into its composition; it will simply be a desire body. This will bring about a condition of affairs inconceivable to us and only to be somewhat apprehended by the man who can function upon the systemic buddhic plane, the fourth cosmic ether. Bear in mind here that our astral plane is but the sixth subplane of the cosmic physical plane and that this provides us with no real grounds from which to reason concerning the cosmic astral plane. Only when the astral plane is a calm receiver of buddhic impulse, or a liquid reflector of that plane (which will not be till the close of the mahamanvantara) shall we be able to formulate any ideas anent the cosmic astral plane."
					],
					"page": 131,
					"chapter": 13
				},
				{
					"t": "p",
					"runs": ["Second. That the entire sex aspect of manifestation, as we understand it in the different kingdoms of nature, is an expression of the energy of the Logos, as it flows through and stimulates that centre in His body which corresponds to the generative organs. All the creative functions of the vegetable, animal, and human family, viewing them as a whole, are as yet purely physical, and based on lower desire. The desire of the Logos for physical incarnation is as yet the dominant note. Later His desire for that will be less and will become transmuted into desire for creation on mental levels only. This is what brings the Destroyer aspect into activity, leading to eventual obscuration, and the physical “death” of the solar system. Indication that this aspect is coming into power will be seen when two great events transpire:"],
					"page": 132,
					"chapter": 13
				},
				{
					"t": "li",
					"runs": ["a. The-ability of man consciously to create on mental levels, and the consequent transmutation of his lower sex impulses into higher."],
					"page": 132,
					"chapter": 13
				},
				{
					"t": "li",
					"runs": ["b. The mental vitalisation of another large section of the animal kingdom."],
					"page": 132,
					"chapter": 13
				},
				{
					"t": "p",
					"runs": [
						"When these two things can be seen working out in any round, it will be indicative of a decided mental",
						133,
						"polarisation of the Logos; we can only become cognisant of this by studying His body of manifestation in its component parts."
					],
					"page": 132,
					"chapter": 13
				},
				{
					"t": "p",
					"runs": ["What is here predicated anent the logoic thought-form can be equally well stated about that of a Heavenly Man, and a planetary scheme. As His cosmic polarisation becomes more mental, and as His cosmic desire nature becomes transmuted, the force that plays through His centres will correspondingly be seen to vary in direction; He will withdraw force from certain of His lower centres and globes; He will cease to be interested in physical incarnation, and He will eventually withdraw within Himself. His thought-form will show a gradual diminution of vitality; the dense physical globe will die and pass out of objectivity, and other globes will temporarily hold His life, though not for long. In due course of time the entire scheme will be obscured, and He will function only in His cosmic astral body."],
					"page": 133,
					"chapter": 13
				},
				{
					"t": "p",
					"runs": ["Such is the case too with a chain and its informing Life, viewing a chain as simply a centre in the body of the planetary Logos, yet having its own central factor. This can be seen in the Moon in a most interesting way. The desire of its Occupant was no longer for physical manifestation; He therefore withdrew His life. All that is left is the devitalised shell; the two other aspects have gone and only the third aspect, the inherent life of matter itself, remains gradually to dissipate also as the centuries elapse. In connection with man, a similar condition is seen in the gradual disintegration of the physical body after death; the two other aspects are removed, and the form decays."],
					"page": 133,
					"chapter": 13
				},
				{
					"t": "p",
					"runs": [
						"As these fundamental facts are grasped, and man begins to appreciate his position as Creator, the entire aspect of the sex question will also change; and emphasis will be laid upon the laws of",
						134,
						"mental creation, on the formulation of thought-forms in a scientific manner, and the dense physical aspect of creation will be in abeyance. When this is so, then will man be coming into his divine right, and the human kingdom be fulfilling its legitimate function. The sex aspect—as at present expressing itself—and the whole process of reproduction is one which man shares with the animal kingdom, and is based upon his animal instincts, and his dense physical nature, which is not a principle. When he is totally emancipated from the animal kingdom, and the third and fourth kingdoms stand distinct from each other, then the sex nature, and the organs of reproduction will be viewed by the average man in a very different manner than at present. Creation will eventually be the result of thought impulses and not desire impulses; the process will be then (once the initial impulse on the mental plane has been given), as normal, as safe, and as unconscious as the act of breathing is now. When this is so (and the time is a long way ahead), physical reproduction will still continue, but the physical form will be spoken of in terms of concretion and of energy, and the emphasis will be laid upon that which is to be embodied. This stage will be entered upon when the functions of the etheric body are scientifically grasped and understood and the laws of creative thought are a matter of public knowledge and discussion; it will coincide with a period wherein the animal kingdom will again be under manasic impression, and individualisation will again be permitted."
					],
					"page": 133,
					"chapter": 13
				},
				{
					"t": "p",
					"runs": [
						"It will be generally recognised at that time that Spirit-matter are two aspects of the one Unity, and the present terminology of Spirit, and material substance, will have given place to the broader concept of negative and positive energy as the two aspects of the One Energy. All phenomena will then be expressed in force terms, and the sex",
						135,
						"question—or the union of the male and female, the negative and the positive, on the physical plane— will be redeemed and purified."
					],
					"page": 134,
					"chapter": 13
				},
				{
					"t": "p",
					"runs": ["An embodied idea, therefore, is literally a positive impulse, emanating from mental levels, and clothing itself in a veil of negative substance. These iwo factors in turn will be regarded as emanations from a still greater force center, which is expressing purpose through them both. (3— 555/560)."],
					"page": 135,
					"chapter": 13
				},
				{
					"t": "p",
					"runs": ["(3) The quality of these energies is primarily astral-buddhic, and the bias of the life forces and the general trend of the impulses influencing humanity in this great cycle are the attractive energy of the intuitional nature of the planetary Logos, and the potent force of the astral (desire) body. In other words, the astral elemental, which embodies the desire nature of the planetary Logos is exceedingly potent, particularly in this present cycle, but the strength of the spiritual and intuitional nature of the Onein Whom we live and move and have our being is steadily increasing. On the one hand, you have the devastating expression of the wild hunt for pleasure, of sex and of the crime incident to the satisfying of desire. This characterises our present civilisation and is now at its height; it may be said that it is even on the decline, little as you may sense it. At the same time, there is found the open door of initiation. Both these opportunities (if I might so term them) are found simultaneously present, but the strength of the one is weakening, and the trend towards the other is growing. Thus the way out can be seen. (4 — 432/3)."],
					"page": 135,
					"chapter": 13,
					"kind": "extract"
				},
				{
					"t": "p",
					"runs": [
						"(4) There is one fact to be grasped in connection with the place of the permanent atom within the causal periphery and its evolution, that needs to be emphasised with care, and that is that the astral permanent atom in this solar system is the recipient",
						136,
						"of a great flow of force or energy, and receives more stimulation and energising than any of the others, and this for the following reasons:"
					],
					"page": 135,
					"chapter": 13,
					"kind": "extract"
				},
				{
					"t": "p",
					"runs": ["First. The centre of polarisation for the fourth, or human kingdon, is in the astral consciousness viewing this kingdom as a unity in expression. From the astral, and through the desire nature, the majority of men inevitably direct and control the physical vehicle. The astral body is in the direct line of force via the buddhic from monadic levels, 2-4-6."],
					"page": 136,
					"chapter": 13
				},
				{
					"t": "p",
					"runs": ["Second. The goal set before humanity is that of becoming Masters of the Wisdom, or conscious units in the Body of the Dragon of Wisdom or of Love. This a man achieves when he can function consciously in the buddhic vehicle, or when the astral permanent atom is superseded by the buddhic permanent atom."],
					"page": 136,
					"chapter": 13
				},
				{
					"t": "p",
					"runs": ["Third. The next reason is that the second aspect of the Logos (that of love or the manifestation of the love nature of the Logos through the medium of the Son) is the one demonstrated in this system. This system is:"],
					"page": 136,
					"chapter": 13
				},
				{
					"t": "li",
					"runs": ["a. A Son of Necessity, or of desire"],
					"page": 136,
					"chapter": 13
				},
				{
					"t": "li",
					"runs": ["b. Vibrant to the key of the cosmic Ray of Love"],
					"page": 136,
					"chapter": 13
				},
				{
					"t": "li",
					"runs": ["c. The form through which this ray of cosmic Love (shown in the inter-relation between the Self and the Not-Self, or through duality) is expressing itself"],
					"page": 136,
					"chapter": 13
				},
				{
					"t": "li",
					"runs": ["d. Governed by the cosmic Law of Attraction. The monads of love are the dominating quality. (I choose this word ‘quality’ specifically.)"],
					"page": 136,
					"chapter": 13
				},
				{
					"t": "p",
					"runs": ["Fourth. The centre in the cosmic body of the"],
					"page": 136,
					"chapter": 13
				},
				{
					"t": "h2",
					"id": "c13-one-about-whom-nought-may-be-said",
					"s": "ONE ABOUT WHOM NOUGHT MAY BE SAID",
					"page": 136,
					"chapter": 13
				},
				{
					"t": "p",
					"runs": [
						"of which our solar Logos is the embodied force is the heart centre. Here we have one of the clues to",
						137,
						"the mystery of electricity. The sacred planets, with certain allied etheric spheres within the ring-passnot, are parts of that heart centre, and are ‘petals in the Lotus,’ or in the heart centre of that great unknown Existence Who stands to the solar Logos as Hein His turn stands to the Heavenly Men Who are His centres, and specially as He stands to the particular Heavenly Man Who is the embodied force of the logoic Heart centre. Therefore, it will be apparent to the careful student that the entire force and energy of the system and its life quality will be that which we call (having perforce to use handicapping, misleading words) LOVE. This will account for the fact that the force that plays through that cosmic heart centre will be the paramount force found in the manifestation of a solar Logos, and of a Heavenly Man; it will likewise produce its microcosmic analogy, and reflective reactions; hence the relative importance of the astral permanent atom within the causal periphery. It is in the direct line of active force emanating from the cosmic existence, and passing to it in ever lessening degree, via the solar Logos in His system of love, and the planetary Logos within a scheme, the Dragon of Wisdom-Love."
					],
					"page": 136,
					"chapter": 13
				},
				{
					"t": "p",
					"runs": ["This force when rightly directed and properly controlled is the great transmuting agency, which eventually will make of the human unit a Master of the Wisdom, a Lord of Love, a Dragon of Wisdom in lesser degree."],
					"page": 137,
					"chapter": 13
				},
				{
					"t": "p",
					"runs": ["Finally: this solar system, the objective physical manifestation of the Logos, is interpenetrated by His astral body, as is the case with the human manifestation. As the Logos is polarised in His cosmic astral sheath and has not yet attained cosmic mental polarisation His force or desire nature is the main incentive for the subjective Life and lives that underlie the form."],
					"page": 137,
					"chapter": 13
				},
				{
					"t": "p",
					"runs": ["If the student will ponder with care these five facts, he will get a clue to the problems of existence as realised around us, to the causes of the heat of the solar system, to the method of the cosmic Law of Attraction and Repulsion, which governs all atomic forms, and to the question of SEX which is apparent in every kingdom of nature. They give the clue also to the constitution of the Divine Hermaphrodite."],
					"page": 138,
					"chapter": 13
				},
				{
					"t": "p",
					"runs": ["Therefore, it is necessary to bear in mind the relative importance of the permanent atom of the second aspect of the personality within the causal periphery, and to remember that the force, which flows through that atom and which is the animating force of the astral body is following the lines of least resistance and really might be considered as bearing upon his physical manifestation in a manner twice as strong as that reaching him through the other two. The Logos expresses Himself now through the Divine Ray, His second aspect, and this Ray is the sumtotal of the radiation of the Lords of Wisdom, the Heavenly Men, the Dragons Who are Unity and Who are Love. Through Them this force flows, and They in turn clothe Themselves with form, or as H. P. B. expresses it ‘The primordial Ray becomes the vahan for the Divine Ray.’.. Their life animates every atom of substance when built into form, and Their life is the sumtotal of Logoic magnetism, or the great desire nature of the Logos going out after the Not-Self, producing the cosmic Marriage; it is the logoic demonstration of the sex appeal, His search for His polar opposite, and their mystic union."],
					"page": 138,
					"chapter": 13
				},
				{
					"t": "p",
					"runs": ["This process is repeated by the microcosm following the line of his being, and this brings him likewise into incarnation, or into mystic union with form. (3 — 510/3)."],
					"page": 138,
					"chapter": 13
				},
				{
					"t": "p",
					"runs": ["(5) As says the old Commentary again:"],
					"page": 139,
					"chapter": 13,
					"kind": "extract"
				},
				{
					"t": "p",
					"runs": ["“When Father approaches Mother, that which will be taketh form. The union of the two concealeth the true mystery of Being."],
					"page": 139,
					"chapter": 13
				},
				{
					"t": "p",
					"runs": ["When the two great devas seek each other, when they meet and merge, the promise of life is fulfilled."],
					"page": 139,
					"chapter": 13
				},
				{
					"t": "p",
					"runs": ["When the one who sees and knows stands midway between his parents, then can be seen the fruition of knowledge, and all is known upon the planes of consciousness."],
					"page": 139,
					"chapter": 13
				},
				{
					"t": "p",
					"runs": ["When Anu, the infinitesimal, is seen to contain Ishvara in His potency, when the lesser spheres and cycles expand into the circle of the Heavens, then shall the essential Unity. be cognised and manifested fully."],
					"page": 139,
					"chapter": 13
				},
				{
					"t": "p",
					"runs": [
						"When the One that holds the life becomes the three behind which that life is hidden; when the three by revolution become the seven and the ten; when the thirty million crores of deva lives repeat the revolution; when the central point is reached and reveals the three, the nine, and the inner blazing JEWEL, then is the circle of manifestation consummated, and the One again becomes the ten, the seven, the three and the point.” Herein lies the key to the mystic marriage, and to the student of occultism much may be revealed through the study of these pairs of opposites; it will cause the revelation of the process (in time and space) whereby this union and its fruit is consummated, and the resultant creation of the divine Hermaphrodite is seen upon His Own high plane. We must ever keep clearly in mind that we are dealing in this section with the evolutionary devas who are the positive Life animating involutionary matter or deva substance. Consequently, the correspondence",
						140,
						"of the mystic marriage of Spirit and matter can be seen working out also in deva substance itself, through the interaction of negative and positive deva lives. Substance itself represents essential duality; forms repeat the same duality, and when we arrive at man himself again, we have duality plus a third factor. (3 — 671/2)."
					],
					"page": 139,
					"chapter": 13
				},
				{
					"t": "p",
					"runs": ["(6)... The Law of Sex. This is the term applied to the force which brings about the physical merging of the two poles in connection with the animal kingdom, and of man, viewing him as responsive to the call of his animal nature. It concerns itself with the due guarding of the form in this particular cycle and its perpetuation. It is only powerful during the period of the duality of the sexes and their separation and, in the case of man, will be offset by a higher expression of the law when man is again androgynous. It is the law of marriage, and finds some aspects of its manifestation not only in marriage of men and animals in the physical sense, but in the “occult marriage” of"],
					"page": 140,
					"chapter": 13
				},
				{
					"t": "li",
					"runs": ["a. The Soul and the Spirit."],
					"page": 140,
					"chapter": 13
				},
				{
					"t": "li",
					"runs": ["b. The Son with his Mother (or the Soul with the physical substance)."],
					"page": 140,
					"chapter": 13
				},
				{
					"t": "li",
					"runs": ["c. The negative planetary lives with the positive ones earlier pointed out."],
					"page": 140,
					"chapter": 13
				},
				{
					"t": "li",
					"runs": ["d. The systemic marriage, or the merging of the two final planetary schemes after their absorption of the other forces."],
					"page": 140,
					"chapter": 13
				},
				{
					"t": "li",
					"runs": [
						"e. The cosmic marriage, or the merging of our solar system with its opposite cosmic pole, another constellation. The cosmic marriage of stars and Systems is the cause of the occasional irregular flaring-up or intensification of suns and their increased luminosity which is sometimes seen, and which has frequently been the subject of discussion. (3 — 1168/9).",
						141,
						"(7) In the mystery of the sea and the secret of its"
					],
					"page": 140,
					"chapter": 13
				},
				{
					"t": "p",
					"runs": ["occult “drying up” or absorption, will be revealed eventually the significance underlying:"],
					"page": 141,
					"chapter": 13
				},
				{
					"t": "li",
					"runs": ["a. The sex impulse, macrocosmically and microcosmically interpreted."],
					"page": 141,
					"chapter": 13
				},
				{
					"t": "li",
					"runs": ["b. The cessation of desire."],
					"page": 141,
					"chapter": 13
				},
				{
					"t": "li",
					"runs": ["c. The direction of fire to the throat centre instead of to the generative organs."],
					"page": 141,
					"chapter": 13
				},
				{
					"t": "li",
					"runs": ["d. Pralaya and obscuration."],
					"page": 141,
					"chapter": 13
				},
				{
					"t": "li",
					"runs": ["e. The meaning of the words “There shall be no more sea” found in the Christian Bible. (3 —899/900). (8) By a close scrutiny of these conditions in the"],
					"page": 141,
					"chapter": 13
				},
				{
					"t": "p",
					"runs": ["macrocosm and in the microcosm will come a comprehension of the reason why the physical vehicle is never considered a principle at all by occultists. The Holy Spirit, the One Who overshadows and Who implants the germ of life in the waiting acquiescent Virgin Mother or matter (causing her to awaken and to commence her great work of producing the divine incarnation) is a primary factor from the standpoint of the second solar system. In a way incomprehensible to modern thinkers, the Mother, or the divine Aspirant to the mysteries of the cosmic marriage, was (in a previous system) the dominant factor. In this system in connection with substance it is the Holy Spirit. The work, therefore, on etheric levels, and the energy and activity originating therefrom, are the factors that primarily are responsible on the physical plane for all that is tangible, objective, and manifested. The accretion of matter around the vital body, and the densification of substance around the vital etheric nucleus are in themselves the result of interaction, and the final interchange of vibration between that which might be called the residue from an earlier manifestation, and the vibration of this present one. (3 — 916/7)."],
					"page": 141,
					"chapter": 13
				},
				{
					"t": "p",
					"runs": ["(9) This instinct to synthesis (concerning as it does the psychical nature of Deity) has nothing to do with the physical expression of sex. This is governed by other laws and is under the control of the physical nature. Let us not forget that H. P. B. has said (and truly) that the physical body is nota principle. (8 — 235)."],
					"page": 142,
					"chapter": 13,
					"kind": "extract"
				},
				{
					"t": "p",
					"runs": ["(10)... the latent “consciousness of desire,”... works under the Law of Attraction; it is the law for this system, and deals with the ability of the Logos to “love wisely,” in the occult sense of the term. It has relation to the polarisation of the Logos in His astral body, and produces the phenomenon called “sex activity” on all planes in the system. (3 —721)."],
					"page": 142,
					"chapter": 13
				}
			]
		},
		{
			"id": "c14",
			"title": "The Mystery of Sex",
			"page": 143,
			"blocks": [
				{
					"t": "h1",
					"id": "c14",
					"s": "The Mystery of Sex",
					"page": 143,
					"chapter": 14
				},
				{
					"t": "p",
					"runs": ["(1) In the case of human evolution certain types of force are generated, dealt with, assimilated, and used, at first unconsciously, and finally with full intelligence."],
					"page": 143,
					"chapter": 14,
					"kind": "extract"
				},
				{
					"t": "p",
					"runs": ["a. In the Hall of Ignorance the force or energy of Brahma (the activity and intelligence of substance) is that mostly dealt with, and the man has to learn the meaning of activity based on:—"],
					"page": 143,
					"chapter": 14
				},
				{
					"t": "p",
					"runs": ["a. Inherent energy."],
					"page": 143,
					"chapter": 14
				},
				{
					"t": "p",
					"runs": ["b. Absorbed energy."],
					"page": 143,
					"chapter": 14
				},
				{
					"t": "p",
					"runs": ["c. Group energy."],
					"page": 143,
					"chapter": 14
				},
				{
					"t": "p",
					"runs": ["d. Material energy, or that which is hidden in"],
					"page": 143,
					"chapter": 14
				},
				{
					"t": "p",
					"runs": ["physical plane matter."],
					"page": 143,
					"chapter": 14
				},
				{
					"t": "p",
					"runs": ["b. In the Hall of Learning he becomes aware of, and uses the energy of the second aspect in form building, in social relations, and in family affiliations. He comes to the recognition of sex and its relations, but as yet views this force as something to be controlled, but not consciously and constructively utilised. c. In the Hall of Wisdom he comes to the knowledge of the first aspect of energy, the dynamic use of will in sacrifice, and to him is then committed the key to the threefold mystery of energy. This energy in its threefold aspect he became aware of, in the other two Halls. At the third initiation, and at the fourth and fifth, the three keys to the three mysteries are given to him."],
					"page": 143,
					"chapter": 14
				},
				{
					"t": "p",
					"runs": [
						"The key to the mystery sensed in the first Hall, the mystery of Brahma, is handed to him, and he can then unlock the hidden energies of atomic substance. The key to the mystery of sex, or of the pairs of opposites, is thrust into his hand, and he",
						144,
						"can then unlock the hidden forces of the will aspect. The dynamo of the solar system is shown to him,—if it might be so expressed—and the intricacies of the mechanism revealed. (1 — 167/8). (2) The following are the three basic mysteries of the solar system:"
					],
					"page": 143,
					"chapter": 14
				},
				{
					"t": "li",
					"runs": ["1. The mystery of Electricity. The mystery of Brahma. The secret of the third aspect. It is latent in the physical sun."],
					"page": 144,
					"chapter": 14
				},
				{
					"t": "li",
					"runs": ["2. The mystery of Polarity, or of the universal sex impulse. The secret of the second aspect. It is latent in the Heart of the Sun, i. e., in the subjective Sun."],
					"page": 144,
					"chapter": 14
				},
				{
					"t": "li",
					"runs": ["3. The mystery of Fire itself, or the dynamic central systemic force. The secret of the first aspect. It is latent in the central spiritual sun."],
					"page": 144,
					"chapter": 14
				},
				{
					"t": "p",
					"runs": ["... At the third, fourth and fifth Initiations the three keys to the three mysteries are given to him.... The key to the mystery of sex, or of the pairs of opposites, is thrust into his hand, and he can then unlock the hidden forces within all forms."],
					"page": 144,
					"chapter": 14
				},
				{
					"t": "p",
					"runs": ["... These three mysteries which we have touched upon above, come in a peculiar sense under the jurisdiction of certain great Lords or Existences, and They have much to do with the revealing of the mystery to those prepared initiates Who come under Their influence during the final stages of the Path."],
					"page": 144,
					"chapter": 14
				},
				{
					"t": "p",
					"runs": [
						"..._In the mystery of Polarity, we have three different types of forces manifesting and thus it is apparent that the two mysteries deal with the six forces. These three types of force are manipulated by the Buddhas of Love. They, through Their sacrifice, concern Themselves with the problem of sex, or of “magnetic approach” on all the planes. The Buddha of Whom we speak and Who contacts His people at the full moon of Wesak, is one of the",
						145,
						"three connected with our globe, having taken the place of One Who passed on to higher work in connection with the Chain, for the same hierarchical grading is seen as in connection with the Buddhas of Action. One group might be considered the divine Carpenters of the planetary system, the other the divine Assemblers of its parts and the Ones Who, through the magnetic influence They wield, unite the diversities and build them into form."
					],
					"page": 144,
					"chapter": 14
				},
				{
					"t": "p",
					"runs": ["The present ideas anent Sex must be transmuted and raised from the existing lower connotation to its true significance. Sex—in the three worlds—has to do with the work of the lunar Pitris and the solar Lords. It signifies essentially the form-building work in substance, and its energising by the spiritual aspect. It signifies the elevation of the material aspect through the influence of Spirit as the two together perform their legitimate function in co-operation and thus—by their mutual union and blending—produce the Son in all His glory. This method of interpreting it is equally true of all the Existences manifesting on any plane, systemic and cosmic. Certain factors enter into the thought of sex which might be enumerated as follows:"],
					"page": 145,
					"chapter": 14
				},
				{
					"t": "li",
					"runs": ["a. Mutual attraction,"],
					"page": 145,
					"chapter": 14
				},
				{
					"t": "li",
					"runs": ["b. Complementary suitability,"],
					"page": 145,
					"chapter": 14
				},
				{
					"t": "li",
					"runs": ["c. Instinctual appeal,"],
					"page": 145,
					"chapter": 14
				},
				{
					"t": "li",
					"runs": ["d. Approach, and recognised co-operation,"],
					"page": 145,
					"chapter": 14
				},
				{
					"t": "li",
					"runs": ["e. Union,"],
					"page": 145,
					"chapter": 14
				},
				{
					"t": "li",
					"runs": ["f. The next stage is the temporary importance of the material aspect, that of the Mother, the feminine aspect,."],
					"page": 145,
					"chapter": 14
				},
				{
					"t": "li",
					"runs": ["g. The withdrawal into a temporary retirement of the Father,"],
					"page": 145,
					"chapter": 14
				},
				{
					"t": "li",
					"runs": ["h. The work of creating the Son,"],
					"page": 145,
					"chapter": 14
				},
				{
					"t": "li",
					"runs": ["i. The evolution and growth of the Son, both materially and in consciousness,"],
					"page": 146,
					"chapter": 14
				},
				{
					"t": "li",
					"runs": ["j. Emancipation of the Son from his Mother, or the liberation of the soul at maturity from matter,"],
					"page": 146,
					"chapter": 14
				},
				{
					"t": "li",
					"runs": ["k. Recognition by the Son of the Father and his return to that Father,"],
					"page": 146,
					"chapter": 14
				},
				{
					"t": "p",
					"runs": ["The final result of all these successive stages being that all the three aspects have performed their functions (their dharma) on the physical plane and all three have demonstrated certain types of energy."],
					"page": 146,
					"chapter": 14
				},
				{
					"t": "p",
					"runs": ["The Father aspect manifests in giving the initial impulse or the positive electrical demonstration which is the germ of the created Son, and Whose Life is embodied in the Son. The occult significance of the words of the Christ in answer to the cry “Lord, show us the Father” is little appreciated. “He that has seen Me has seen the Father, for land my Father are One,” He said.*"],
					"page": 146,
					"chapter": 14
				},
				{
					"t": "p",
					"runs": ["The Mother, or the negative aspect, builds and nourishes, guards and cherishes the Son through the antenatal, and the infant stages, and stands around Him during later stages, giving of the energy of her own body and activity in ministry to His need."],
					"page": 146,
					"chapter": 14
				},
				{
					"t": "p",
					"runs": ["The Son, the combined energy of Father and of Mother, embodies both types and all the dual sets of qualities, but has a character all His Own, an essence which is His peculiar nature, and an energy which leads Him to fulfil His Own ends and projects, and which will eventually cause Him to repeat the process of producing,—"],
					"page": 146,
					"chapter": 14
				},
				{
					"t": "li",
					"runs": ["1. Conception,"],
					"page": 146,
					"chapter": 14
				},
				{
					"t": "li",
					"runs": ["2. Creation,"],
					"page": 146,
					"chapter": 14
				},
				{
					"t": "p",
					"runs": ["* Bible. John XIV, 8."],
					"page": 146,
					"chapter": 14
				},
				{
					"t": "li",
					"runs": ["3. Conscious growth,"],
					"page": 147,
					"chapter": 14
				},
				{
					"t": "p",
					"runs": ["as did His Father. (3 — 872/6)."],
					"page": 147,
					"chapter": 14
				},
				{
					"t": "p",
					"runs": ["(3)... cleavages seem basic, and produce the divisions we find everywhere between race and race and between religion and religion, and can be traced back to the fundamental condition of manifestation which we call the relationship of positive and negative, of male and female, and, esoterically speaking, of the sun and the moon. The mystery of sex itself is bound up with the re-establishment of the sense of unity and of balance, of oneness or of wholeness. In its higher human aspect, this sexual differentiation is only the symbol or lowest expression of the cleavage or separativeness of which the mystic is aware and which makes him seek at-onement or union with what he calls divinity. (8 —416)."],
					"page": 147,
					"chapter": 14
				},
				{
					"t": "p",
					"runs": ["(4) At the fourth initiation another of the great secrets is revealed to him. It is called “the mystery of polarity,” and the clue to the significance of sex in every department of nature on all the planes is given to him. It is not possible to say much along these lines. All that can be done is to enumerate some of the subjects to which it gives the clue, adding to this the information that in our planetary scheme, owing to the point in evolution of our own Planetary Logos, this secret is the most vital. Our Planetary Logos is at the stage wherein He is consciously seeking the at-one-ment with his polar opposite, another Planetary Logos."],
					"page": 147,
					"chapter": 14,
					"kind": "extract"
				},
				{
					"t": "p",
					"runs": ["of The subjects on which this secret throws a flood"],
					"page": 147,
					"chapter": 14
				},
				{
					"t": "p",
					"runs": ["light are:—"],
					"page": 147,
					"chapter": 14
				},
				{
					"t": "li",
					"runs": ["a. Sex on the physical plane. It gives us a key to the mystery of the separation of the sexes in Lemurian days."],
					"page": 147,
					"chapter": 14
				},
				{
					"t": "li",
					"runs": ["b. The balancing of forces in all departments of nature."],
					"page": 147,
					"chapter": 14
				},
				{
					"t": "p",
					"runs": ["c. The clue as to which Scheme forms with ours a duality."],
					"page": 148,
					"chapter": 14
				},
				{
					"t": "p",
					"runs": ["d. The true name of our Planetary Logos and His relation to the Solar Logos."],
					"page": 148,
					"chapter": 14
				},
				{
					"t": "p",
					"runs": ["e. “The Marriage of the Lamb” and the problem of the heavenly bride. A clue to this lies in the solar system of S.... which must be read astrologically."],
					"page": 148,
					"chapter": 14
				},
				{
					"t": "p",
					"runs": ["f. The mystery of the Gemini, and the connection of our particular Planetary Logos with that constellation. (1 — 172/3)."],
					"page": 148,
					"chapter": 14
				},
				{
					"t": "p",
					"runs": ["Training for new age"],
					"page": 148,
					"chapter": 14
				},
				{
					"t": "p",
					"runs": ["discipleship is provided"],
					"page": 148,
					"chapter": 14
				},
				{
					"t": "p",
					"runs": ["by the Arcane School."],
					"page": 148,
					"chapter": 14
				},
				{
					"t": "p",
					"runs": ["The principles of the"],
					"page": 148,
					"chapter": 14
				},
				{
					"t": "p",
					"runs": ["Ageless Wisdom are"],
					"page": 148,
					"chapter": 14
				},
				{
					"t": "p",
					"runs": ["presented through esoteric"],
					"page": 148,
					"chapter": 14
				},
				{
					"t": "p",
					"runs": ["meditation, study and"],
					"page": 148,
					"chapter": 14
				},
				{
					"t": "p",
					"runs": ["_ Service as a way of life."],
					"page": 148,
					"chapter": 14
				},
				{
					"t": "p",
					"runs": ["Write to the publishers"],
					"page": 148,
					"chapter": 14
				},
				{
					"t": "p",
					"runs": ["for information."],
					"page": 148,
					"chapter": 14
				}
			]
		}
	]
};
var pdf_worker_min_default = "/assets/pdf.worker.min-CjEcRF4W.mjs";
var NO_TEXT = "No text layer in that PDF. Recto reads the embedded text, not a picture of the page.";
function titleFromName(filename) {
	return filename.replace(/\.(pdf|djvu|djv)$/i, "").replace(/[_]+/g, " ").replace(/\s+/g, " ").trim() || "Opened book";
}
async function pageOfDest(doc, dest) {
	try {
		const resolved = typeof dest === "string" ? await doc.getDestination(dest) : dest;
		if (!Array.isArray(resolved) || resolved[0] == null) return null;
		return await doc.getPageIndex(resolved[0]) + 1;
	} catch {
		return null;
	}
}
async function readOutline(doc, pageCount) {
	let raw = null;
	try {
		raw = await doc.getOutline();
	} catch {
		return [];
	}
	if (!raw?.length) return [];
	const cache = /* @__PURE__ */ new Map();
	const pageOf = async (dest) => {
		if (dest == null) return null;
		const key = typeof dest === "string" ? `s:${dest}` : JSON.stringify(dest);
		if (cache.has(key)) return cache.get(key) ?? null;
		const page = await pageOfDest(doc, dest);
		const safe = page && page >= 1 && page <= pageCount ? page : null;
		cache.set(key, safe);
		return safe;
	};
	let left = 400;
	async function walk(nodes, depth) {
		const out = [];
		for (const node of nodes) {
			if (left-- <= 0) break;
			const label = String(node.title || "").replace(/\s+/g, " ").trim().slice(0, 180);
			const page = await pageOf(node.dest);
			const children = depth < 1 && node.items?.length ? await walk(node.items, depth + 1) : [];
			if (!label) continue;
			out.push({
				label,
				page: page ?? children.find((c) => c.page)?.page ?? null,
				children
			});
		}
		return out;
	}
	return walk(raw, 0);
}
async function folioFromPdf(data, filename, onStatus) {
	onStatus?.("Opening the PDF");
	const pdfjs = await import("../_libs/pdfjs-dist.mjs").then((n) => n.t);
	pdfjs.GlobalWorkerOptions.workerSrc = pdf_worker_min_default;
	const doc = await pdfjs.getDocument({ data: new Uint8Array(data) }).promise;
	const lines = [];
	for (let n = 1; n <= doc.numPages; n++) {
		if (n === 1 || n % 20 === 0) onStatus?.(`Reading page ${n} of ${doc.numPages}`);
		const page = await doc.getPage(n);
		const view = page.getViewport({ scale: 1 });
		const content = await page.getTextContent();
		for (const ln of cluster(content.items)) lines.push({
			...ln,
			page: n,
			pageH: view.height,
			pageW: view.width
		});
	}
	let title = titleFromName(filename);
	let author = "";
	try {
		const info = (await doc.getMetadata())?.info;
		if (info?.Title && String(info.Title).trim()) title = String(info.Title).replace(/\s+/g, " ").trim();
		if (info?.Author) author = String(info.Author).replace(/\s+/g, " ").trim();
	} catch {}
	onStatus?.("Reading the contents");
	const outline = await readOutline(doc, doc.numPages);
	return assembleFolio(lines, {
		title,
		author,
		subtitle: author ? `${author} · from a PDF` : "From a PDF",
		sourceName: filename,
		outline,
		emptyMessage: NO_TEXT,
		onStatus
	});
}
async function folioFromFile(data, filename, onStatus) {
	const lower = filename.toLowerCase();
	if (lower.endsWith(".djvu") || lower.endsWith(".djv")) {
		const { folioFromDjvu } = await import("./from-djvu-CPeG5X7j.mjs");
		return folioFromDjvu(data, filename, onStatus);
	}
	const head = new Uint8Array(data.slice(0, 5));
	const pdf = head[0] === 37 && head[1] === 80 && head[2] === 68 && head[3] === 70;
	if (lower.endsWith(".pdf") || pdf) return folioFromPdf(data, filename, onStatus);
	throw new Error("Open a PDF or a DjVu file.");
}
var routes_exports = /* @__PURE__ */ __exportAll({ component: () => Desk });
var lucis = book_default;
var chaptersOf = (folio) => folio.chapters;
var tocOf = (folio) => folio.toc;
function ownerKey(chapterId, index, slot) {
	return `${chapterId}:${index}:${slot}`;
}
function buildOwners(chapters) {
	const pageOwner = /* @__PURE__ */ new Map();
	for (const chapter of chapters) chapter.blocks.forEach((block, index) => {
		if (block.t === "toc-entry") return;
		const take = (page, slot) => {
			if (!page || pageOwner.has(page)) return;
			pageOwner.set(page, ownerKey(chapter.id, index, slot));
		};
		take(block.page, "lead");
		(block.runs || []).forEach((run, runIndex) => {
			if (typeof run === "number") take(run, `r${runIndex}`);
		});
	});
	return pageOwner;
}
function owns(owners, chapterId, index, slot, page) {
	return !!page && owners.get(page) === ownerKey(chapterId, index, slot);
}
function textOf(block) {
	if (block.s) return block.s;
	if (block.t === "table") return (block.rows || []).map((r) => r.join(" ")).join(" ");
	return (block.runs || []).filter((r) => typeof r === "string").join(" ");
}
var PLACE_KEY = "recto-desk:place";
/** The reading desk. This surface stays: desk rail, paper page, cinnabar mark. */
function Desk() {
	const [folio, setFolio] = (0, import_react.useState)(lucis);
	const [open, setOpen] = (0, import_react.useState)(false);
	const [query, setQuery] = (0, import_react.useState)("");
	const [hit, setHit] = (0, import_react.useState)(0);
	const [pageQuery, setPageQuery] = (0, import_react.useState)("");
	const [active, setActive] = (0, import_react.useState)("title-page");
	const [filter, setFilter] = (0, import_react.useState)("");
	const [busy, setBusy] = (0, import_react.useState)("");
	const [note, setNote] = (0, import_react.useState)("");
	const chapters = chaptersOf(folio);
	const toc = tocOf(folio);
	const owners = (0, import_react.useMemo)(() => buildOwners(chapters), [chapters]);
	const lastPage = (0, import_react.useMemo)(() => {
		let max = 1;
		for (const chapter of chapters) for (const block of chapter.blocks) {
			if (block.page) max = Math.max(max, block.page);
			for (const run of block.runs || []) if (typeof run === "number") max = Math.max(max, run);
		}
		return max;
	}, [chapters]);
	const lucisEdition = folio === lucis;
	const hits = (0, import_react.useMemo)(() => {
		const needle = query.trim().toLowerCase();
		if (needle.length < 2) return [];
		const found = [];
		chapters.forEach((ch) => {
			ch.blocks.forEach((block, index) => {
				if (textOf(block).toLowerCase().includes(needle)) found.push(`b-${ch.id}-${index}`);
			});
		});
		return found;
	}, [query, chapters]);
	(0, import_react.useEffect)(() => {
		setHit(0);
	}, [query]);
	(0, import_react.useEffect)(() => {
		const placeKey = lucisEdition ? PLACE_KEY : `recto-desk:${folio.title}`;
		const scroller = document.querySelector("main");
		if (!scroller) return;
		const saved = Number(localStorage.getItem(placeKey));
		if (Number.isFinite(saved) && saved > 0) scroller.scrollTop = saved;
		else scroller.scrollTop = 0;
		let frame = 0;
		const onScroll = () => {
			cancelAnimationFrame(frame);
			frame = requestAnimationFrame(() => localStorage.setItem(placeKey, String(scroller.scrollTop)));
		};
		scroller.addEventListener("scroll", onScroll, { passive: true });
		return () => {
			cancelAnimationFrame(frame);
			scroller.removeEventListener("scroll", onScroll);
		};
	}, [folio.title, lucisEdition]);
	(0, import_react.useEffect)(() => {
		if (!("serviceWorker" in navigator)) return;
		const prefix = previewPathPrefix(window.location.hostname, window.location.pathname) ?? "";
		navigator.serviceWorker.register(`${prefix}/sw.js`, { scope: `${prefix}/` }).catch(() => {});
	}, []);
	(0, import_react.useEffect)(() => {
		const root = document.querySelector("main");
		const nodes = Array.from(document.querySelectorAll("[data-spy]"));
		const observer = new IntersectionObserver((entries) => {
			const id = entries.filter((entry) => entry.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]?.target.id;
			if (id) setActive(id);
		}, {
			root,
			rootMargin: "-8% 0px -75% 0px",
			threshold: .01
		});
		nodes.forEach((node) => observer.observe(node));
		return () => observer.disconnect();
	}, [folio]);
	function go(id) {
		const node = document.getElementById(id);
		node?.scrollIntoView({
			behavior: "smooth",
			block: "start"
		});
		setOpen(false);
		if (node?.dataset.spy) setActive(id);
	}
	function jumpToHit(next) {
		if (!hits.length) return;
		const index = (next + hits.length) % hits.length;
		setHit(index);
		go(hits[index]);
	}
	function jumpToPage(event) {
		event.preventDefault();
		const page = Number(pageQuery);
		if (!Number.isInteger(page) || page < 1 || page > lastPage) return;
		go(`page-${page}`);
	}
	function showLucis() {
		if (folio.epubHref) URL.revokeObjectURL(folio.epubHref);
		setFolio(lucis);
		setActive("title-page");
		setQuery("");
		setNote("");
		setOpen(false);
	}
	async function onBook(event) {
		const input = event.target;
		const file = input.files?.[0];
		input.value = "";
		if (!file) return;
		setBusy("Opening the book");
		setNote("");
		try {
			const next = await folioFromFile(await file.arrayBuffer(), file.name, setBusy);
			if (folio.epubHref) URL.revokeObjectURL(folio.epubHref);
			setFolio(next);
			setActive(next.toc[0]?.id || "c01");
			setQuery("");
			setOpen(false);
		} catch (err) {
			setNote(err instanceof Error ? err.message : "Could not read that book.");
		} finally {
			setBusy("");
		}
	}
	const filterText = filter.trim().toLowerCase();
	const visibleToc = toc.filter((entry) => {
		if (!filterText) return true;
		return `${entry.label} ${(entry.children || []).map((child) => child.label).join(" ")}`.toLowerCase().includes(filterText);
	});
	const activeChapter = toc.find((entry) => entry.id === active || entry.children.some((child) => child.id === active));
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "flex h-dvh bg-paper text-ink",
		children: [
			open ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
				type: "button",
				"aria-label": "Close contents",
				className: "fixed inset-0 z-20 bg-desk/40 md:hidden",
				onClick: () => setOpen(false)
			}) : null,
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("aside", {
				className: "fixed inset-y-0 left-0 z-30 w-full max-w-80 flex-col bg-desk text-desk-fg md:static md:flex md:w-80 " + (open ? "flex" : "hidden"),
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "flex items-center justify-between gap-3 px-5 pt-5 pb-3",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "flex items-center gap-2",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(BookOpen, {
								className: "size-5 text-cinnabar",
								"aria-hidden": "true"
							}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
								className: "text-sm font-medium tracking-wide",
								children: "Recto"
							}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
								className: "text-xs text-desk-muted",
								children: "Reading edition"
							})] })]
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
							type: "button",
							className: "grid size-11 place-items-center rounded-ui text-desk-fg md:hidden",
							onClick: () => setOpen(false),
							"aria-label": "Close",
							children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(X, { className: "size-5" })
						})]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
						className: "px-4 pb-3",
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
							className: "relative block",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Search, { className: "pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-desk-muted" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
								value: filter,
								onChange: (event) => setFilter(event.target.value),
								placeholder: "Filter contents",
								className: "w-full rounded-ui border border-desk-line bg-desk-soft py-2.5 pr-3 pl-9 text-sm text-desk-fg outline-none placeholder:text-desk-muted"
							})]
						})
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("nav", {
						"aria-label": "Contents",
						className: "min-h-0 flex-1 overflow-y-auto px-2 pb-4",
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ol", {
							className: "space-y-0.5",
							children: visibleToc.map((entry) => {
								const on = entry.id === active || entry.children.some((child) => child.id === active);
								return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
									type: "button",
									onClick: () => go(entry.id),
									className: "flex w-full items-baseline gap-3 rounded-ui px-3 py-2 text-left text-sm " + (on ? "bg-desk-soft text-cream" : "text-desk-fg hover:bg-desk-soft"),
									children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
										className: "min-w-0 flex-1 leading-snug",
										children: entry.label
									}), entry.page ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
										className: "shrink-0 text-xs text-desk-muted tabular-nums",
										children: entry.page
									}) : null]
								}), entry.children.length ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ol", {
									className: "mt-0.5 mb-1 ml-3 border-l border-desk-line",
									children: entry.children.map((child) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", { children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
										type: "button",
										onClick: () => go(child.id),
										className: "flex w-full items-baseline gap-3 py-1.5 pr-3 pl-3 text-left text-sm " + (active === child.id ? "text-cream" : "text-desk-muted hover:text-desk-fg"),
										children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
											className: "min-w-0 flex-1 leading-snug",
											children: child.label
										}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
											className: "shrink-0 text-xs tabular-nums",
											children: child.page
										})]
									}) }, child.id))
								}) : null] }, entry.id);
							})
						})
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "border-t border-desk-line px-4 py-3",
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
								className: "flex min-h-11 cursor-pointer items-center justify-center rounded-ui border border-desk-line bg-desk-soft px-3 py-2 text-center text-sm text-desk-fg",
								children: [busy ? busy : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
									className: "flex flex-col items-center leading-tight",
									children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "Open a book" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
										className: "text-xs text-desk-muted",
										children: "PDF or DjVu"
									})]
								}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
									type: "file",
									accept: "application/pdf,.pdf,.djvu,.djv,image/vnd.djvu,image/x-djvu",
									className: "sr-only",
									onChange: onBook,
									disabled: !!busy
								})]
							}),
							note ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
								className: "mt-2 text-xs leading-snug text-desk-muted",
								children: note
							}) : null,
							lucisEdition ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
								type: "button",
								className: "mt-2 h-11 w-full text-sm text-desk-muted",
								onClick: showLucis,
								children: "Lucis edition"
							})
						]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("form", {
						onSubmit: jumpToPage,
						className: "border-t border-desk-line px-4 py-3",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", {
							className: "mb-1 block text-xs tracking-wide text-desk-muted",
							htmlFor: "printed-page",
							children: "Page"
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "flex gap-2",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
								id: "printed-page",
								inputMode: "numeric",
								value: pageQuery,
								onChange: (event) => setPageQuery(event.target.value.replace(/[^\d]/g, "").slice(0, 5)),
								placeholder: `1–${lastPage}`,
								className: "w-full rounded-ui border border-desk-line bg-desk-soft px-3 py-2 text-sm text-desk-fg outline-none placeholder:text-desk-muted"
							}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
								type: "submit",
								className: "rounded-ui bg-cinnabar px-3 py-2 text-sm text-cream",
								children: "Go"
							})]
						})]
					})
				]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "flex min-w-0 flex-1 flex-col",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("header", {
						className: "sticky top-0 z-10 flex items-center gap-2 border-b border-rule bg-paper/95 px-3 py-2 backdrop-blur md:px-6",
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
								type: "button",
								className: "grid size-11 place-items-center rounded-ui md:hidden",
								"aria-label": "Open contents",
								onClick: () => setOpen(true),
								children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Menu, { className: "size-5" })
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
								className: "min-w-0 flex-1",
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
									className: "truncate text-sm font-medium",
									children: activeChapter?.label || book_default.title
								}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
									className: "truncate text-xs text-muted",
									children: folio.title
								})]
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
								className: "relative hidden sm:block",
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Search, { className: "pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
									value: query,
									onChange: (event) => setQuery(event.target.value),
									placeholder: "Find in the book",
									className: "w-56 rounded-ui border border-rule bg-paper-2 py-2 pr-3 pl-9 text-sm outline-none"
								})]
							}),
							hits.length ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
								className: "flex items-center gap-1 text-xs text-muted",
								children: [
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
										type: "button",
										className: "rounded-ui px-2 py-2",
										onClick: () => jumpToHit(hit - 1),
										"aria-label": "Previous match",
										children: "Prev"
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
										className: "tabular-nums",
										children: [
											hit + 1,
											"/",
											hits.length
										]
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
										type: "button",
										className: "rounded-ui px-2 py-2",
										onClick: () => jumpToHit(hit + 1),
										"aria-label": "Next match",
										children: "Next"
									})
								]
							}) : null,
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("a", {
								href: folio.epubHref || "/a-compilation-on-sex.epub",
								download: folio.epubName || "a-compilation-on-sex.epub",
								className: "inline-flex h-11 items-center gap-2 rounded-ui bg-cinnabar px-3 text-sm text-cream",
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Download, {
									className: "size-4",
									"aria-hidden": "true"
								}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
									className: "hidden sm:inline",
									children: "EPUB"
								})]
							})
						]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
						className: "border-b border-rule px-4 py-2 sm:hidden",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
							className: "sr-only",
							children: "Find in the book"
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
							value: query,
							onChange: (event) => setQuery(event.target.value),
							placeholder: "Find in the book",
							className: "w-full rounded-ui border border-rule bg-paper-2 px-3 py-2 text-sm outline-none"
						})]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("main", {
						className: "min-h-0 flex-1 overflow-y-auto",
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("article", {
							className: "folio mx-auto w-full max-w-2xl px-5 pt-8 pb-24 md:px-8",
							children: [
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
									className: "mb-8 text-center font-serif text-sm tracking-wide text-muted",
									children: lucisEdition ? "Alice A. Bailey and the Tibetan, Djwhal Khul · Lucis, 1980" : folio.subtitle
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Edition, {
									chapters,
									owners
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("footer", {
									className: "mt-16 border-t border-rule pt-6 text-center text-sm text-muted",
									children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", { children: [
										folio.stats.hyphensRejoined,
										" end-of-line hyphens rejoined, ",
										folio.stats.headersRemoved,
										" running heads removed,",
										" ",
										folio.stats.chapters,
										" ",
										folio.stats.chapters === 1 ? "chapter" : "chapters",
										" linked to the page numbers."
									] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
										className: "mt-2",
										children: lucisEdition ? "The Lucis Trust holds the copyright in the books this compilation was drawn from." : "Personal reading copy. Page numbers follow the file. The Lucis edition is still in the contents rail."
									})]
								})
							]
						})
					})
				]
			})
		]
	});
}
function Edition({ chapters, owners }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_jsx_runtime.Fragment, { children: chapters.map((chapter) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("section", {
		className: "mb-14",
		"aria-labelledby": chapter.id,
		children: chapter.blocks.map((block, index) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(BlockView, {
			chapterId: chapter.id,
			index,
			block,
			owners
		}, `${chapter.id}-${index}`))
	}, chapter.id)) });
}
function BlockView({ chapterId, index, block, owners }) {
	const anchor = `b-${chapterId}-${index}`;
	const lead = owns(owners, chapterId, index, "lead", block.page);
	if (block.t === "h1") return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [lead && block.page ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(PageMark, { page: block.page }) : null, /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h1", {
		id: block.id,
		"data-spy": true,
		className: "page-anchor",
		children: block.s
	})] });
	if (block.t === "h2") return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [lead && block.page ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(PageMark, { page: block.page }) : null, /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
		id: block.id,
		"data-spy": true,
		className: "page-anchor",
		children: block.s
	})] });
	if (block.t === "toc-entry") return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
		className: "tocline",
		children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("a", {
			href: `#c${String(block.n).padStart(2, "0")}`,
			className: "flex items-baseline justify-between gap-4 border-b border-rule py-2 text-ink no-underline",
			children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [
				block.n,
				". ",
				block.s
			] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
				className: "text-muted tabular-nums",
				children: block.page
			})]
		})
	});
	if (block.t === "table") return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
		className: "my-4 overflow-x-auto",
		children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("table", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("thead", { children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("tr", { children: (block.headers || []).map((header) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", { children: header }, header)) }) }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("tbody", { children: (block.rows || []).map((row) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("tr", { children: row.map((cell, cellIndex) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { children: cell }, cellIndex)) }, row[0] + row[1])) })] })
	});
	const classes = [
		block.t === "li" ? "item" : "",
		block.kind === "verse" ? "verse" : "",
		block.kind === "center" ? "center" : "",
		block.kind === "extract" ? "extract" : ""
	].filter(Boolean).join(" ");
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [lead && block.page ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(PageMark, { page: block.page }) : null, /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
		id: anchor,
		className: classes,
		children: (block.runs || []).map((run, runIndex) => typeof run === "number" ? owns(owners, chapterId, index, `r${runIndex}`, run) ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
			id: `page-${run}`,
			className: "page-anchor sr-only",
			children: ["Page ", run]
		}, runIndex) : null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: run }, runIndex))
	})] });
}
function PageMark({ page }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
		id: `page-${page}`,
		className: "page-anchor page-label",
		children: page
	});
}
//#endregion
export { assembleFolio as n, cluster as r, routes_exports as t };
