import { n as previewPathPrefix } from "./router-B5CoSwtJ.mjs";
import { n as assembleFolio, r as cluster } from "./routes-v4v9HlYs.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/from-djvu-CPeG5X7j.js
var NO_TEXT = "No text layer in that DjVu. Recto reads the hidden text, not a picture of the page.";
var loading = null;
function loadDjVu() {
	const host = window;
	if (host.DjVu?.Worker) return Promise.resolve(host.DjVu);
	if (loading) return loading;
	loading = new Promise((resolve, reject) => {
		const script = document.createElement("script");
		script.src = `${previewPathPrefix(window.location.hostname, window.location.pathname) ?? ""}/vendor/djvu.js`;
		script.onload = () => host.DjVu?.Worker ? resolve(host.DjVu) : reject(/* @__PURE__ */ new Error("Could not load the DjVu reader."));
		script.onerror = () => reject(/* @__PURE__ */ new Error("Could not load the DjVu reader."));
		document.head.appendChild(script);
	});
	return loading;
}
function asList(count, result) {
	if (count === 1) return [result];
	return Array.isArray(result) ? result : [result];
}
function titleFromName(filename) {
	return filename.replace(/\.(djvu|djv)$/i, "").replace(/[_]+/g, " ").replace(/\s+/g, " ").trim() || "Opened book";
}
async function readOutline(worker, pageCount) {
	const contents = await worker.run(worker.doc.getContents());
	if (!Array.isArray(contents) || !contents.length) return [];
	const flat = [];
	const walk = (nodes, depth) => {
		for (const node of nodes) {
			flat.push(node);
			if (depth < 1 && node.children?.length) walk(node.children, depth + 1);
		}
	};
	walk(contents.slice(0, 400), 0);
	const urls = flat.map((node) => node.url && node.url.startsWith("#") ? node.url : "#");
	const found = asList(urls.length, await worker.run(...urls.map((url) => worker.doc.getPageNumberByUrl(url))));
	let cursor = 0;
	const build = (nodes, depth) => nodes.slice(0, 400).map((node) => {
		const page = found[cursor++];
		const children = depth < 1 && node.children?.length ? build(node.children, depth + 1) : [];
		return {
			label: String(node.description || "").replace(/\s+/g, " ").trim().slice(0, 180),
			page: (typeof page === "number" && page >= 1 && page <= pageCount ? page : null) ?? children.find((c) => c.page)?.page ?? null,
			children
		};
	});
	return build(contents, 0).filter((item) => item.label);
}
async function folioFromDjvu(data, filename, onStatus) {
	onStatus?.("Opening the DjVu");
	const worker = new (await (loadDjVu())).Worker();
	try {
		const copy = data.slice(0);
		await worker.createDocument(copy, { memoryLimit: Math.min(536870912, Math.max(67108864, copy.byteLength * 8)) });
		if (!await worker.run(worker.doc.isBundled())) throw new Error("That DjVu is split into separate page files. Open the single bundled file.");
		const quantity = await worker.run(worker.doc.getPagesQuantity());
		const sizes = await worker.run(worker.doc.getPagesSizes());
		const lines = [];
		const batch = 6;
		for (let start = 1; start <= quantity; start += batch) {
			onStatus?.(`Reading page ${start} of ${quantity}`);
			const nums = [];
			const tasks = [];
			for (let n = start; n < start + batch && n <= quantity; n++) {
				nums.push(n);
				tasks.push(worker.doc.getPage(n).getNormalizedTextZones());
			}
			const zonesList = asList(nums.length, await worker.run(...tasks));
			for (let i = 0; i < nums.length; i++) {
				const n = nums[i];
				const size = sizes[n - 1] || {
					width: 800,
					height: 1100
				};
				const scale = 800 / (size.height || 1100);
				const pageW = size.width * scale;
				const pageH = size.height * scale;
				const zones = zonesList[i];
				if (zones?.length) {
					const items = zones.filter((z) => z && String(z.text || "").trim()).map((z) => ({
						str: String(z.text),
						transform: [
							1,
							0,
							0,
							1,
							z.x * scale,
							pageH - (z.y + z.height) * scale
						],
						width: Math.max(z.width * scale, 1),
						height: Math.max((z.height || 8) * scale, 1)
					}));
					for (const ln of cluster(items)) lines.push({
						...ln,
						page: n,
						pageH,
						pageW
					});
					continue;
				}
				String(await worker.run(worker.doc.getPage(n).getText()) || "").split(/\n/).map((row) => row.trim()).filter(Boolean).forEach((row, rowIndex) => {
					lines.push({
						text: row,
						y: pageH - 48 - rowIndex * 16,
						x0: 48,
						x1: Math.max(120, pageW - 48),
						h: 12,
						page: n,
						pageH,
						pageW
					});
				});
			}
		}
		onStatus?.("Reading the contents");
		const outline = await readOutline(worker, quantity);
		return assembleFolio(lines, {
			title: titleFromName(filename),
			subtitle: "From a DjVu",
			sourceName: filename,
			outline,
			emptyMessage: NO_TEXT,
			onStatus
		});
	} finally {
		worker.terminate();
	}
}
//#endregion
export { folioFromDjvu };
