import type { Block, Folio, Run } from "./assemble.ts";
import { repairText, type WordList } from "./repair.ts";

function pageBlocks(text: string, page: number): Block[] {
  const parts = text
    .split(/\n+/)
    .map((part) => part.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  return parts.map((part) => ({ t: "p", runs: [part], src: page }));
}

/** Put a corrected reading in place of one file page. The other pages stay. */
export function applyPageReading(folio: Folio, page: number, text: string): Folio {
  const blocks = pageBlocks(text, page);
  let placed = false;
  const chapters = folio.chapters.map((chapter) => {
    if (!chapter.blocks.some((block) => block.src === page)) return chapter;
    placed = true;
    const next: Block[] = [];
    let injected = false;
    for (const block of chapter.blocks) {
      if (block.src === page) {
        if (!injected) {
          next.push(...blocks);
          injected = true;
        }
        continue;
      }
      next.push(block);
    }
    return { ...chapter, blocks: next.length ? next : chapter.blocks.filter((block) => block.t === "h1") };
  });
  if (!placed && blocks.length) {
    let host = 0;
    let best = -1;
    chapters.forEach((chapter, index) => {
      const srcs = chapter.blocks.map((block) => block.src || 0);
      const under = Math.max(0, ...srcs.filter((src) => src < page));
      if (under >= best) {
        best = under;
        host = index;
      }
    });
    const chapter = chapters[host] || chapters[0];
    if (chapter) {
      const at = chapter.blocks.findIndex((block) => (block.src || 0) > page);
      const next = [...chapter.blocks];
      next.splice(at < 0 ? next.length : at, 0, ...blocks);
      chapters[host] = { ...chapter, blocks: next };
    }
  }
  const doubt = folio.doubt?.filter((item) => item.page !== page);
  return { ...folio, chapters, doubt: doubt?.length ? doubt : undefined };
}

/** Repair one page with the word list. Returns the same book when nothing changed. */
export function correctPageWords(folio: Folio, page: number, lexicon: WordList): Folio | null {
  let changed = false;
  const chapters = folio.chapters.map((chapter) => ({
    ...chapter,
    blocks: chapter.blocks.map((block) => {
      if (block.src !== page || !block.runs) return block;
      const runs: Run[] = block.runs.map((run) => {
        if (typeof run !== "string") return run;
        const next = repairText(run, lexicon);
        if (next !== run) changed = true;
        return next;
      });
      return { ...block, runs };
    }),
  }));
  if (!changed) return null;
  const doubt = folio.doubt?.filter((item) => item.page !== page);
  return { ...folio, chapters, doubt: doubt?.length ? doubt : undefined };
}

export function keepDoubtPage(folio: Folio, page: number): Folio {
  const doubt = folio.doubt?.filter((item) => item.page !== page);
  return { ...folio, doubt: doubt?.length ? doubt : undefined };
}
