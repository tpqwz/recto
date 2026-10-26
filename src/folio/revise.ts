import type { Block, Folio } from "./assemble.ts";

export type Revision = {
  id: string;
  at: number;
  chapterId: string;
  label: string;
  before: string;
  after: string;
  beforeBlocks: Block[];
  afterBlocks: Block[];
};

export type BookMemory = {
  chapters: Record<string, Block[]>;
  revisions: Revision[];
};

const LIMIT = 30;

export function bookKey(folio: { title: string; author?: string }) {
  return `${folio.title}\n${folio.author || ""}`;
}

export function proseOf(block: Block) {
  if (block.s) return block.s;
  return (block.runs || [])
    .filter((run): run is string => typeof run === "string")
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

export function sourceOf(block: Block) {
  const text = proseOf(block);
  if (block.t === "h1") return `# ${text}`.trimEnd();
  if (block.t === "h2") return `## ${text}`.trimEnd();
  if (block.kind === "extract") return `> ${text}`.trimEnd();
  if (block.kind === "item") return `- ${text}`.trimEnd();
  return text;
}

export function isProse(block: Block) {
  return block.t === "h1" || block.t === "h2" || block.t === "p";
}

/** The blocks a selection can edit: one contiguous run of prose. */
export function proseSpan(blocks: Block[], from: number, to: number) {
  let start = Math.min(from, to);
  let end = Math.max(from, to);
  while (start <= end && !isProse(blocks[start])) start++;
  while (end >= start && !isProse(blocks[end])) end--;
  for (let i = start; i <= end; i++) {
    if (!isProse(blocks[i])) {
      end = i - 1;
      break;
    }
  }
  return start <= end ? { from: start, to: end } : null;
}

export function parseBlock(source: string, previous: Block, chapterId: string, index: number): Block {
  const markers = (previous.runs || []).filter((run) => typeof run !== "string");
  const page = previous.page ?? null;
  const line = source.replace(/\s+/g, " ").trim();
  const heading = (level: "h1" | "h2", text: string): Block => ({
    t: level,
    id: previous.id || (level === "h1" ? chapterId : `${chapterId}-s${index}`),
    s: text,
    page,
    section: level === "h2" ? true : undefined,
  });
  if (line.startsWith("## ")) return heading("h2", line.slice(3).trim());
  if (line.startsWith("# ")) return heading("h1", line.slice(2).trim());
  let kind = "";
  let text = line;
  if (line.startsWith("> ")) {
    kind = "extract";
    text = line.slice(2).trim();
  } else if (line.startsWith("- ") || line.startsWith("* ")) {
    kind = "item";
    text = line.slice(2).trim();
  } else if (previous.kind === "verse" || previous.kind === "center") {
    kind = previous.kind;
  }
  const block: Block = { t: "p", page, runs: [...markers, text] };
  if (kind) block.kind = kind;
  return block;
}

export function unifiedDiff(before: string, after: string) {
  const a = before.split("\n");
  const b = after.split("\n");
  const n = a.length;
  const m = b.length;
  if (n * m > 160000) return before === after ? "" : `- ${before.slice(0, 400)}\n+ ${after.slice(0, 400)}`;
  const dp: number[][] = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  }
  const lines: string[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      lines.push(`  ${a[i]}`);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      lines.push(`- ${a[i]}`);
      i++;
    } else {
      lines.push(`+ ${b[j]}`);
      j++;
    }
  }
  while (i < n) lines.push(`- ${a[i++]}`);
  while (j < m) lines.push(`+ ${b[j++]}`);
  return lines.filter((line) => line.startsWith("+") || line.startsWith("-")).join("\n");
}

export function syncToc(folio: Folio): Folio {
  const chapters = folio.chapters.map((chapter) => {
    const title = chapter.blocks.find((block) => block.t === "h1")?.s || chapter.title;
    return { ...chapter, title };
  });
  const toc = chapters.map((chapter) => ({
    id: chapter.id,
    label: chapter.blocks.find((block) => block.t === "h1")?.s || chapter.title,
    page: chapter.page,
    children: chapter.blocks
      .filter((block) => block.t === "h2" && block.id && block.s)
      .map((block) => ({ id: block.id || "", label: block.s || "", page: block.page ?? null, children: [] })),
  }));
  return { ...folio, chapters, toc };
}

export function applyChapters(folio: Folio, chapters: Record<string, Block[]>) {
  if (!Object.keys(chapters).length) return folio;
  return {
    ...folio,
    chapters: folio.chapters.map((chapter) => (chapters[chapter.id] ? { ...chapter, blocks: chapters[chapter.id] } : chapter)),
  };
}

function storageKey(key: string) {
  return `recto-revisions:v1:${key}`;
}

export function loadBook(key: string): BookMemory | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(storageKey(key));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as BookMemory;
    if (!parsed || typeof parsed !== "object" || !parsed.chapters || !Array.isArray(parsed.revisions)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveBook(key: string, memory: BookMemory) {
  if (typeof localStorage === "undefined") return;
  const next = { ...memory, revisions: memory.revisions.slice(0, LIMIT) };
  try {
    localStorage.setItem(storageKey(key), JSON.stringify(next));
  } catch {
    next.revisions = next.revisions.slice(0, 8);
    try {
      localStorage.setItem(storageKey(key), JSON.stringify(next));
    } catch {
      /* the revision is still in this visit */
    }
  }
}

export function dropBook(key: string) {
  if (typeof localStorage === "undefined") return;
  localStorage.removeItem(storageKey(key));
}

export function rememberRevision(
  memory: BookMemory | null,
  revision: Revision,
  chapterId: string,
  blocks: Block[],
): BookMemory {
  const prior = memory || { chapters: {}, revisions: [] };
  return {
    chapters: { ...prior.chapters, [chapterId]: blocks },
    revisions: [revision, ...prior.revisions].slice(0, LIMIT),
  };
}
