import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { BookOpen, ChevronDown, Download, Menu, Search, X } from "lucide-react";
import book from "@/data/book.json";
import { previewPathPrefix } from "@/lib/preview-path-prefix";
import { folioFromFile, runPage, type Block, type Folio, type Run, type TocNode } from "@/folio/from-pdf";
import { republish } from "@/folio/assemble";
import { PassageEditor, SelectionMenu, type SelectionPick } from "@/folio/editor";
import { applyChapters, bookKey, loadBook, proseSpan, rememberRevision, saveBook, sourceOf, syncToc, type Revision } from "@/folio/revise";
import { detectKind, keepSource, loadSource, originalLabel, type Retained } from "@/folio/source";
import { SourcePane } from "@/folio/source-view";
import {
  bareDesk,
  entryKey,
  forgetEntry,
  isSampleBook,
  keepFolio,
  listHoldings,
  listShelf,
  loadFolio,
  loadShelf,
  rememberOpened,
  rememberRecent,
  restoreSamples,
  SAMPLES,
  saveShelf,
  type ShelfEntry,
  type ShelfState,
} from "@/folio/shelf";
import {
  catalogFromOpened,
  DC_ELEMENTS,
  DC_LABEL,
  ID_LABEL,
  ITEM_IDS,
  recordFor,
  SERIAL_IDS,
  sortRecords,
  storeRecord,
  entryTitle,
  TABLE_COLUMNS,
  type CatalogRecord,
  type DcElement,
} from "@/folio/library";
import { loadSettings, saveSettings, type DeskSettings } from "@/folio/settings";

export const Route = createFileRoute("/")({ component: Desk });

const lucis = book as Folio;
const chaptersOf = (folio: Folio) => folio.chapters;
const tocOf = (folio: Folio) => folio.toc as TocNode[];

function pinViewport() {
  if (window.scrollY !== 0 || document.documentElement.scrollTop !== 0 || document.body.scrollTop !== 0) {
    window.scrollTo(0, 0);
  }
}

function scrollInReader(id: string) {
  const node = document.getElementById(id);
  const scroller = document.querySelector("main");
  if (!node || !(scroller instanceof HTMLElement)) return null;
  const top = node.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
  scroller.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
  pinViewport();
  return node;
}

function ownerKey(chapterId: string, index: number, slot: string) {
  return `${chapterId}:${index}:${slot}`;
}

function buildOwners(chapters: Folio["chapters"]) {
  const pageOwner = new Map<string, string>();
  for (const chapter of chapters) {
    chapter.blocks.forEach((block, index) => {
      if (block.t === "toc-entry") return;
      const take = (page: number | string | null | undefined, slot: string) => {
        if (page == null || page === "" || pageOwner.has(String(page))) return;
        pageOwner.set(String(page), ownerKey(chapter.id, index, slot));
      };
      take(block.page, "lead");
      (block.runs || []).forEach((run, runIndex) => {
        take(runPage(run), `r${runIndex}`);
      });
    });
  }
  return pageOwner;
}

function owns(owners: Map<string, string>, chapterId: string, index: number, slot: string, page: number | string | null | undefined) {
  return page != null && page !== "" && owners.get(String(page)) === ownerKey(chapterId, index, slot);
}

function textOf(block: Block) {
  if (block.s) return block.s;
  if (block.t === "table") return (block.rows || []).map((r) => r.join(" ")).join(" ");
  return (block.runs || []).filter((r): r is string => typeof r === "string").join(" ");
}

const PLACE_KEY = "recto-desk:place";

/** The reading desk. This surface stays: desk rail, paper page, cinnabar mark. */
function Desk() {
  const [folio, setFolio] = useState<Folio>(lucis);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hit, setHit] = useState(0);
  const [pageQuery, setPageQuery] = useState("");
  const [active, setActive] = useState("title-page");
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState("");
  const [log, setLog] = useState<string[]>([]);
  const [logOpen, setLogOpen] = useState(false);
  const logBox = useRef<HTMLDivElement>(null);
  const [note, setNote] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [settings, setSettings] = useState<DeskSettings>(() => loadSettings());
  const [pick, setPick] = useState<SelectionPick | null>(null);
  const [menuNote, setMenuNote] = useState("");
  const [editing, setEditing] = useState<{ chapterId: string; from: number; to: number } | null>(null);
  const [revisions, setRevisions] = useState<Revision[]>([]);
  const [source, setSource] = useState<Retained | null>(null);
  const [sourcePage, setSourcePage] = useState(1);
  const [sourceQuote, setSourceQuote] = useState("");
  const [shelf, setShelf] = useState<ShelfState>(() => loadShelf());
  const [pending, setPending] = useState<{ entry: ShelfEntry; step: 1 | 2 } | null>(null);
  const [wheel, setWheel] = useState(false);
  const [wheelChapter, setWheelChapter] = useState<string | null>(null);
  const chapters = chaptersOf(folio);
  const toc = tocOf(folio);

  function begin(message: string) {
    setLog([message]);
    setBusy(message);
  }

  function report(message: string) {
    if (!message) {
      setBusy("");
      return;
    }
    setBusy(message);
    setLog((prev) => (prev[prev.length - 1] === message ? prev : [...prev, message]));
  }
  const owners = useMemo(() => buildOwners(chapters), [chapters]);
  const lastPage = useMemo(() => {
    let max = 1;
    for (const chapter of chapters) {
      for (const block of chapter.blocks) {
        if (typeof block.page === "number") max = Math.max(max, block.page);
        for (const run of block.runs || []) if (typeof run === "number") max = Math.max(max, run);
      }
    }
    return max;
  }, [chapters]);
  const lucisEdition = folio.title === lucis.title && (folio.author || "") === (lucis.author || "");

  const hits = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle.length < 2) return [] as string[];
    const found: string[] = [];
    chapters.forEach((ch) => {
      ch.blocks.forEach((block, index) => {
        if (textOf(block).toLowerCase().includes(needle)) found.push(`b-${ch.id}-${index}`);
      });
    });
    return found;
  }, [query, chapters]);

  useEffect(() => {
    setHit(0);
  }, [query]);

  useEffect(() => {
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

  useEffect(() => {
    const pin = () => pinViewport();
    window.addEventListener("scroll", pin, { passive: true });
    const onLink = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = (event.target as Element | null)?.closest?.("a[href^='#']");
      if (!link) return;
      const id = decodeURIComponent((link.getAttribute("href") || "").slice(1));
      if (!id || !document.getElementById(id)) return;
      event.preventDefault();
      const node = scrollInReader(id);
      setOpen(false);
      setWheel(false);
      if (node?.dataset.spy) setActive(id);
    };
    document.addEventListener("click", onLink);
    return () => {
      window.removeEventListener("scroll", pin);
      document.removeEventListener("click", onLink);
    };
  }, []);

  useEffect(() => {
    if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
    const prefix = previewPathPrefix(window.location.hostname, window.location.pathname) ?? "";
    navigator.serviceWorker.register(`${prefix}/sw.js`, { scope: `${prefix}/`, updateViaCache: "none" }).catch(() => {});
    const onPreloadError = (event: Event) => {
      event.preventDefault();
      if (sessionStorage.getItem("recto-chunk-reload")) return;
      sessionStorage.setItem("recto-chunk-reload", "1");
      location.reload();
    };
    window.addEventListener("vite:preloadError", onPreloadError);
    return () => window.removeEventListener("vite:preloadError", onPreloadError);
  }, []);

  useEffect(() => {
    const root = document.querySelector("main");
    const nodes = Array.from(document.querySelectorAll<HTMLElement>("[data-spy]"));
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        const id = visible[0]?.target.id;
        if (id) setActive(id);
      },
      { root, rootMargin: "-8% 0px -75% 0px", threshold: 0.01 },
    );
    nodes.forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, [folio]);

  function go(id: string) {
    const node = scrollInReader(id);
    setOpen(false);
    setWheel(false);
    if (node?.dataset.spy) setActive(id);
  }

  function jumpToHit(next: number) {
    if (!hits.length) return;
    const index = (next + hits.length) % hits.length;
    setHit(index);
    go(hits[index]);
  }

  function jumpToPage(event: FormEvent) {
    event.preventDefault();
    const raw = pageQuery.trim().toLowerCase();
    if (!raw) return;
    if (/^\d+$/.test(raw)) {
      const page = Number(raw);
      if (!Number.isInteger(page) || page < 1 || page > lastPage) return;
      go(`page-${page}`);
      return;
    }
    if (document.getElementById(`page-${raw}`)) go(`page-${raw}`);
  }

  useEffect(() => {
    setEditing(null);
    setPick(null);
    setRevisions(loadBook(bookKey(folio))?.revisions ?? []);
    if (!folio.origin) setSource(null);
  }, [folio.title, folio.author, folio.origin]);

  useEffect(() => {
    let frame = 0;
    let timer = 0;
    let pointerDown = false;
    let shown: SelectionPick | null = null;
    const read = (): SelectionPick | null => {
      if (editing) return null;
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
      const range = sel.getRangeAt(0);
      const blockOf = (node: Node) => {
        const el = node instanceof Element ? node : node.parentElement;
        return el?.closest<HTMLElement>("article.folio [data-block]") ?? null;
      };
      const start = blockOf(range.startContainer);
      const end = blockOf(range.endContainer);
      const host = start || end;
      if (!host || host.closest("[data-editing]") || host.closest("[data-selection-menu]")) return null;
      const text = sel.toString().replace(/\s+/g, " ").trim();
      if (!text) return null;
      const chapterId = (start || host).dataset.chapter || "";
      const indexes = [start, end]
        .filter((item): item is HTMLElement => !!item && item.dataset.chapter === chapterId)
        .map((item) => Number(item.dataset.block))
        .filter((n) => Number.isInteger(n));
      if (!indexes.length) return null;
      const rect = range.getBoundingClientRect();
      const srcRaw = Number((start || host).dataset.src);
      return {
        text,
        page: (start || host).dataset.page || null,
        src: Number.isInteger(srcRaw) && srcRaw > 0 ? srcRaw : null,
        top: rect.top,
        bottom: rect.bottom,
        left: rect.left,
        chapterId,
        from: Math.min(...indexes),
        to: Math.max(...indexes),
      };
    };
    const unchanged = (next: SelectionPick | null) =>
      shown === next ||
      (!!shown &&
        !!next &&
        shown.text === next.text &&
        shown.chapterId === next.chapterId &&
        shown.from === next.from &&
        shown.to === next.to &&
        shown.top === next.top &&
        shown.left === next.left);
    const commit = () => {
      frame = 0;
      const next = read();
      if (unchanged(next)) return;
      if (shown?.text !== next?.text) setMenuNote("");
      shown = next;
      setPick(next);
    };
    const schedule = () => {
      if (pointerDown || frame) return;
      frame = requestAnimationFrame(commit);
    };
    const onSelection = () => {
      if (pointerDown) return;
      schedule();
    };
    const onDown = () => {
      pointerDown = true;
      window.clearTimeout(timer);
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
    };
    const onUp = () => {
      pointerDown = false;
      window.clearTimeout(timer);
      timer = window.setTimeout(schedule, 60);
    };
    document.addEventListener("selectionchange", onSelection);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", onUp);
    return () => {
      window.clearTimeout(timer);
      if (frame) cancelAnimationFrame(frame);
      document.removeEventListener("selectionchange", onSelection);
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onUp);
    };
  }, [editing]);

  async function copyPick() {
    if (!pick) return;
    await navigator.clipboard.writeText(pick.text);
    setMenuNote("Copied");
  }

  async function sharePick() {
    if (!pick) return;
    const text = folio.title ? `${pick.text}\n— ${folio.title}` : pick.text;
    if (navigator.share) {
      try {
        await navigator.share({ title: folio.title, text });
        setPick(null);
        return;
      } catch {
        /* the share sheet was closed */
      }
    }
    await navigator.clipboard.writeText(text);
    setMenuNote("Copied");
  }

  function editPick() {
    if (!pick) return;
    const chapter = folio.chapters.find((item) => item.id === pick.chapterId);
    const span = chapter ? proseSpan(chapter.blocks, pick.from, pick.to) : null;
    if (!span) return;
    setEditing({ chapterId: pick.chapterId, from: span.from, to: span.to });
    setPick(null);
    window.getSelection()?.removeAllRanges();
  }

  async function openOriginal() {
    if (!pick || !folio.origin) return;
    const chosen = pick;
    begin("Opening the original");
    setNote("");
    try {
      const record = (await loadSource(bookKey(folio))) || source;
      if (!record) {
        setNote("The original is not on this device.");
        return;
      }
      setSource(record);
      setSourcePage(chosen.src || 1);
      setSourceQuote(chosen.text);
      setPick(null);
      window.getSelection()?.removeAllRanges();
    } catch (err) {
      setNote(err instanceof Error ? err.message : "Could not open the original.");
    } finally {
      setBusy("");
    }
  }

  function commitPassage(chapterId: string, beforeBlocks: Block[], afterBlocks: Block[]) {
    const before = beforeBlocks.map(sourceOf).filter(Boolean).join("\n");
    const after = afterBlocks.map(sourceOf).filter(Boolean).join("\n");
    if (before === after) {
      setEditing(null);
      return;
    }
    const chapter = folio.chapters.find((item) => item.id === chapterId);
    const revision: Revision = {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      at: Date.now(),
      chapterId,
      label: chapter?.title || "Chapter",
      before,
      after,
      beforeBlocks,
      afterBlocks,
    };
    const memory = rememberRevision(loadBook(bookKey(folio)), revision, chapterId, afterBlocks);
    saveBook(bookKey(folio), memory);
    setRevisions(memory.revisions);
    setFolio(republish(syncToc(applyChapters(folio, memory.chapters))));
    setEditing(null);
    setNote("Saved. The EPUB includes this revision.");
  }

  function savePassage(nextBlocks: Block[]) {
    if (!editing) return;
    const chapter = folio.chapters.find((item) => item.id === editing.chapterId);
    if (!chapter) return;
    const after = [...chapter.blocks.slice(0, editing.from), ...nextBlocks, ...chapter.blocks.slice(editing.to + 1)];
    commitPassage(editing.chapterId, chapter.blocks, after);
  }

  function restoreRevision(revision: Revision) {
    const chapter = folio.chapters.find((item) => item.id === revision.chapterId);
    if (!chapter) return;
    commitPassage(revision.chapterId, chapter.blocks, revision.afterBlocks);
  }

  function releaseEpub(href?: string) {
    if (href?.startsWith("blob:")) URL.revokeObjectURL(href);
  }

  function showLucis() {
    releaseEpub(folio.epubHref);
    setFolio(lucis);
    setActive("title-page");
    setQuery("");
    setNote("");
    setSettingsOpen(false);
    setLibraryOpen(false);
    setOpen(false);
    const entry = SAMPLES.find((item) => item.sampleId === "dhammapada");
    if (entry) {
      const next = rememberRecent(loadShelf(), entryKey(entry));
      saveShelf(next);
      setShelf(next);
    }
  }

  async function openSample(id: string) {
    if (id === "dhammapada") {
      showLucis();
      return;
    }
    begin("Opening the edition");
    setNote("");
    try {
      const res = await fetch(`/samples/${id}.json`);
      if (!res.ok) throw new Error("That edition could not be opened.");
      const next = (await res.json()) as Folio;
      next.epubHref = `/samples/${id}.epub`;
      releaseEpub(folio.epubHref);
      setFolio(next);
      setActive(next.toc[0]?.id || "title-page");
      setQuery("");
      setSettingsOpen(false);
      setLibraryOpen(false);
      setOpen(false);
      const entry = SAMPLES.find((item) => item.sampleId === id);
      if (entry) {
        const nextShelf = rememberRecent(loadShelf(), entryKey(entry));
        saveShelf(nextShelf);
        setShelf(nextShelf);
      }
    } catch (err) {
      setNote(err instanceof Error ? err.message : "That edition could not be opened.");
    } finally {
      setBusy("");
    }
  }

  async function onBook(event: ChangeEvent<HTMLInputElement>) {
    const input = event.target;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    begin("Opening the book");
    setNote("");
    try {
      const bytes = await file.arrayBuffer();
      const next = await folioFromFile(bytes.slice(0), file.name, report, loadSettings());
      const kind = next.origin?.kind || detectKind(file.name, new Uint8Array(bytes));
      next.origin = { name: file.name, kind };
      let shelfNote = "";
      try {
        await keepSource(bookKey(next), file.name, kind, bytes);
        const saved = loadBook(bookKey(next));
        const adopted = saved && Object.keys(saved.chapters).length ? republish(syncToc(applyChapters(next, saved.chapters))) : next;
        if (!isSampleBook(adopted)) {
          await keepFolio(bookKey(adopted), adopted);
          const record = catalogFromOpened({
            title: adopted.title,
            author: adopted.author,
            subtitle: adopted.subtitle,
            filename: adopted.origin?.name,
            format: adopted.origin?.kind === "djvu" ? "image/vnd.djvu" : adopted.origin?.kind === "pdf" ? "application/pdf" : "text",
          });
          const entry = {
            id: bookKey(adopted),
            title: adopted.title,
            author: adopted.author || "",
            kind: "opened" as const,
            originName: adopted.origin?.name,
            work: record.work,
            edition: record.source,
            translator: record.contributor,
            year: record.date,
            language: record.language,
            volume: record.volume,
          };
          const kept = rememberOpened(loadShelf(), entry);
          const remembered = kept.records?.[entry.id] ? kept : storeRecord(kept, entry, record);
          saveShelf(remembered);
          setShelf(remembered);
        }
        releaseEpub(folio.epubHref);
        setFolio(adopted);
        setRevisions(saved?.revisions ?? []);
      } catch (err) {
        shelfNote = err instanceof Error ? err.message : "The book opened, but it could not be kept on the shelf.";
        releaseEpub(folio.epubHref);
        setFolio(next);
      }
      setSource(null);
      setActive(next.toc[0]?.id || "c01");
      setQuery("");
      setNote([next.warning, shelfNote].filter(Boolean).join(" "));
      setSettingsOpen(false);
      setLibraryOpen(false);
      setOpen(false);
    } catch (err) {
      setNote(err instanceof Error ? err.message : "Could not read that book.");
    } finally {
      setBusy("");
    }
  }

  async function openKept(entry: ShelfEntry) {
    begin("Opening the book");
    setNote("");
    try {
      const next = await loadFolio(entry.id);
      if (!next) {
        const cleared = await forgetEntry(shelf, entry);
        saveShelf(cleared);
        setShelf(cleared);
        setNote("That book is no longer on this device.");
        return;
      }
      const saved = loadBook(bookKey(next));
      const adopted = saved && Object.keys(saved.chapters).length ? republish(syncToc(applyChapters(next, saved.chapters))) : republish(next);
      releaseEpub(folio.epubHref);
      setFolio(adopted);
      setRevisions(saved?.revisions ?? []);
      setActive(adopted.toc[0]?.id || "c01");
      setQuery("");
      setSettingsOpen(false);
      setLibraryOpen(false);
      setOpen(false);
      setSource(null);
      const nextShelf = rememberRecent(loadShelf(), entryKey(entry));
      saveShelf(nextShelf);
      setShelf(nextShelf);
    } catch (err) {
      setNote(err instanceof Error ? err.message : "Could not open that book.");
    } finally {
      setBusy("");
    }
  }

  async function openNext(state: ShelfState) {
    const rest = listShelf(state);
    const first = rest[0];
    if (!first) {
      releaseEpub(folio.epubHref);
      setFolio(bareDesk);
      setActive("empty");
      setSource(null);
      setEditing(null);
      return;
    }
    if (first.kind === "sample" && first.sampleId) {
      await openSample(first.sampleId);
      return;
    }
    await openKept(first);
  }

  async function confirmRemove() {
    if (!pending) return;
    if (pending.step === 1) {
      setPending({ entry: pending.entry, step: 2 });
      return;
    }
    const entry = pending.entry;
    const removingOpen = bookKey(folio) === entryKey(entry);
    const next = await forgetEntry(shelf, entry);
    saveShelf(next);
    setShelf(next);
    setPending(null);
    setPick(null);
    setEditing(null);
    if (removingOpen) setSource(null);
    setNote(`${entry.title} was removed from this device.`);
    if (removingOpen) await openNext(next);
  }

  const shelfEntries = listShelf(shelf);

  useEffect(() => {
    const entries = listShelf(loadShelf());
    if (entries.some((item) => item.sampleId === "dhammapada")) return;
    const first = entries[0];
    if (!first) {
      setFolio(bareDesk);
      setActive("empty");
      return;
    }
    if (first.kind === "sample" && first.sampleId) {
      void openSample(first.sampleId);
      return;
    }
    void openKept(first);
  }, []);

  useEffect(() => {
    if (!wheel || !wheelChapter) return;
    const node = document.getElementById(`wheel-${wheelChapter}`);
    const scroller = node?.parentElement;
    if (!node || !scroller) return;
    scroller.scrollTop = node.offsetTop - scroller.clientHeight / 2 + node.clientHeight / 2;
  }, [wheel]);

  useEffect(() => {
    if (!logOpen) return;
    const node = logBox.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [log, logOpen]);

  useEffect(() => {
    if (!pending && !wheel && !logOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (logOpen) setLogOpen(false);
      else if (wheel) setWheel(false);
      else setPending(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [pending, wheel, logOpen]);

  const filterText = filter.trim().toLowerCase();
  const visibleToc = toc.filter((entry) => {
    if (!filterText) return true;
    const blob = `${entry.label} ${(entry.children || []).map((child) => child.label).join(" ")}`.toLowerCase();
    return blob.includes(filterText);
  });

  const activeChapter = toc.find((entry) => entry.id === active || entry.children.some((child) => child.id === active));
  const pointed = toc.find((entry) => entry.id === wheelChapter) || activeChapter;
  const wheelSections = pointed?.children || [];

  return (
    <div className="flex h-dvh overflow-hidden bg-paper text-ink">
      {open ? (
        <button
          type="button"
          aria-label="Close contents"
          className="fixed inset-0 z-20 bg-desk/40 md:hidden"
          onClick={() => setOpen(false)}
        />
      ) : null}
      <aside
        className={
          "fixed inset-y-0 left-0 z-30 w-full max-w-80 flex-col bg-desk text-desk-fg md:static md:flex md:h-full md:min-h-0 md:w-80 md:overflow-hidden " +
          (open ? "flex" : "hidden")
        }
      >
        <div className="flex items-center justify-between gap-3 px-5 pt-5 pb-3">
          <div className="flex items-center gap-2">
            <BookOpen className="size-5 text-cinnabar" aria-hidden="true" />
            <div>
              <p className="text-sm font-medium tracking-wide">Recto</p>
              <p className="text-xs text-desk-muted">Reading edition</p>
            </div>
          </div>
          <button
            type="button"
            className="grid size-11 place-items-center rounded-ui text-desk-fg md:hidden"
            onClick={() => setOpen(false)}
            aria-label="Close"
          >
            <X className="size-5" />
          </button>
        </div>
        <div className="px-4 pb-3">
          <label className="relative block">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-desk-muted" />
            <input
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder="Filter contents"
              className="w-full rounded-ui border border-desk-line bg-desk-soft py-2.5 pr-3 pl-9 text-sm text-desk-fg outline-none placeholder:text-desk-muted"
            />
          </label>
        </div>
        <nav aria-label="Contents" className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
          <ol className="space-y-0.5">
            {visibleToc.map((entry) => {
              const on = entry.id === active || entry.children.some((child) => child.id === active);
              return (
                <li key={entry.id}>
                  <button
                    type="button"
                    onClick={() => go(entry.id)}
                    className={
                      "flex w-full items-baseline gap-3 rounded-ui px-3 py-2 text-left text-sm " +
                      (on ? "bg-desk-soft text-cream" : "text-desk-fg hover:bg-desk-soft")
                    }
                  >
                    <span className="min-w-0 flex-1 leading-snug">{entry.label}</span>
                    {entry.page ? <span className="shrink-0 text-xs text-desk-muted tabular-nums">{entry.page}</span> : null}
                  </button>
                  {entry.children.length ? (
                    <ol className="mt-0.5 mb-1 ml-3 border-l border-desk-line">
                      {entry.children.map((child) => (
                        <li key={child.id}>
                          <button
                            type="button"
                            onClick={() => go(child.id)}
                            className={
                              "flex w-full items-baseline gap-3 py-1.5 pr-3 pl-3 text-left text-sm " +
                              (active === child.id ? "text-cream" : "text-desk-muted hover:text-desk-fg")
                            }
                          >
                            <span className="min-w-0 flex-1 leading-snug">{child.label}</span>
                            <span className="shrink-0 text-xs tabular-nums">{child.page}</span>
                          </button>
                        </li>
                      ))}
                    </ol>
                  ) : null}
                </li>
              );
            })}
          </ol>
        </nav>
        <div className="border-t border-desk-line px-4 py-3">
          {busy ? (
            <button
              type="button"
              aria-expanded={logOpen}
              onClick={() => setLogOpen((openNow) => !openNow)}
              className="flex min-h-11 w-full items-center justify-center rounded-ui border border-desk-line bg-desk-soft px-3 py-2 text-center text-sm text-desk-fg"
            >
              <span className="line-clamp-3">{busy}</span>
            </button>
          ) : (
            <label className="flex min-h-11 cursor-pointer items-center justify-center rounded-ui border border-desk-line bg-desk-soft px-3 py-2 text-center text-sm text-desk-fg">
              <span className="flex flex-col items-center leading-tight">
                <span>Open a book</span>
                <span className="text-xs text-desk-muted">PDF or DjVu</span>
              </span>
              <input
                type="file"
                accept="application/pdf,.pdf,.djvu,.djv,image/vnd.djvu,image/x-djvu"
                className="sr-only"
                onChange={onBook}
              />
            </label>
          )}
          {note ? <p className="mt-2 text-xs leading-snug text-desk-muted">{note}</p> : null}
          <div className="mt-2">
            <p className="px-0.5 text-xs tracking-wide text-desk-muted uppercase">Shelf</p>
            {shelfEntries.map((entry) => (
              <div key={entry.id} className="flex items-center gap-1">
                <button
                  type="button"
                  className="block h-8 min-w-0 flex-1 truncate text-left text-xs text-desk-muted"
                  onClick={() => (entry.kind === "sample" && entry.sampleId ? openSample(entry.sampleId) : openKept(entry))}
                  disabled={!!busy}
                >
                  {entryTitle(shelf, entry)}
                </button>
                <button
                  type="button"
                  className="h-8 shrink-0 px-1 text-xs text-desk-muted"
                  aria-label={`Remove ${entry.title}`}
                  onClick={() => setPending({ entry, step: 1 })}
                  disabled={!!busy}
                >
                  Remove
                </button>
              </div>
            ))}
            {shelfEntries.length === 0 ? <p className="mt-1 text-xs text-desk-muted">The shelf is empty.</p> : null}
            <button
              type="button"
              className="mt-1 h-8 text-left text-xs text-desk-muted"
              onClick={() => {
                setLibraryOpen((openNow) => !openNow);
                setSettingsOpen(false);
                setOpen(false);
              }}
            >
              {libraryOpen ? "The book" : `Library (${listHoldings(shelf).length})`}
            </button>
            {shelf.hidden.length ? (
              <button
                type="button"
                className="mt-1 h-8 text-left text-xs text-desk-muted"
                onClick={() => {
                  const next = restoreSamples(shelf);
                  saveShelf(next);
                  setShelf(next);
                }}
                disabled={!!busy}
              >
                Put the sample editions back
              </button>
            ) : null}
          </div>
          <button
            type="button"
            className="mt-2 h-11 w-full text-sm text-desk-muted"
            onClick={() => {
              setSettingsOpen((openNow) => !openNow);
              setLibraryOpen(false);
              setOpen(false);
            }}
          >
            {settingsOpen ? "The book" : "Settings"}
          </button>
        </div>
        <form onSubmit={jumpToPage} className="border-t border-desk-line px-4 py-3">
          <label className="mb-1 block text-xs tracking-wide text-desk-muted" htmlFor="printed-page">
            Page
          </label>
          <div className="flex gap-2">
            <input
              id="printed-page"
              inputMode="text"
              value={pageQuery}
              onChange={(event) => setPageQuery(event.target.value.replace(/[^0-9ivxlcdm]/gi, "").slice(0, 8))}
              placeholder={`1–${lastPage}`}
              className="w-full rounded-ui border border-desk-line bg-desk-soft px-3 py-2 text-sm text-desk-fg outline-none placeholder:text-desk-muted"
            />
            <button type="submit" className="rounded-ui bg-cinnabar px-3 py-2 text-sm text-cream">
              Go
            </button>
          </div>
        </form>
      </aside>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <header className="relative z-30 flex shrink-0 items-center gap-2 border-b border-rule bg-paper px-3 py-2 md:px-6">
          <button
            type="button"
            className="grid size-11 place-items-center rounded-ui md:hidden"
            aria-label="Open contents"
            onClick={() => setOpen(true)}
          >
            <Menu className="size-5" />
          </button>
          <button
            type="button"
            className="min-w-0 flex-1 text-left"
            aria-expanded={wheel}
            aria-haspopup="listbox"
            disabled={settingsOpen || libraryOpen || toc.length === 0}
            onClick={() => {
              if (settingsOpen || !toc.length) return;
              setWheel((open) => {
                if (open) return false;
                const parent = toc.find((entry) => entry.id === active || entry.children.some((child) => child.id === active));
                setWheelChapter(parent?.id || toc[0]?.id || null);
                return true;
              });
            }}
          >
            <p className="flex items-center gap-1 text-sm font-medium">
              <span className="truncate">{settingsOpen ? "Settings" : libraryOpen ? "Library" : activeChapter?.label || book.title}</span>
              {settingsOpen || libraryOpen || !toc.length ? null : (
                <ChevronDown className={"size-4 shrink-0 text-muted" + (wheel ? " rotate-180" : "")} aria-hidden="true" />
              )}
            </p>
            <p className="truncate text-xs text-muted">
              {settingsOpen ? "Used the next time you open a book" : libraryOpen ? "Works, editions, and volumes" : folio.title}
            </p>
          </button>
          <label className="relative hidden sm:block">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Find in the book"
              className="w-56 rounded-ui border border-rule bg-paper-2 py-2 pr-3 pl-9 text-sm outline-none"
            />
          </label>
          {hits.length ? (
            <div className="flex items-center gap-1 text-xs text-muted">
              <button type="button" className="rounded-ui px-2 py-2" onClick={() => jumpToHit(hit - 1)} aria-label="Previous match">
                Prev
              </button>
              <span className="tabular-nums">
                {hit + 1}/{hits.length}
              </span>
              <button type="button" className="rounded-ui px-2 py-2" onClick={() => jumpToHit(hit + 1)} aria-label="Next match">
                Next
              </button>
            </div>
          ) : null}
          <a
            href={folio.epubHref || "/the-dhammapada.epub"}
            download={folio.epubName || "the-dhammapada.epub"}
            className="inline-flex h-11 items-center gap-2 rounded-ui bg-cinnabar px-3 text-sm text-cream"
          >
            <Download className="size-4" aria-hidden="true" />
            <span className="hidden sm:inline">EPUB</span>
          </a>
          {wheel && !settingsOpen ? (
            <>
              <button
                type="button"
                aria-label="Close the contents wheel"
                className="absolute inset-x-0 top-full z-20 h-dvh cursor-default"
                onClick={() => setWheel(false)}
              />
              <div className="absolute inset-x-0 top-full z-30 border-b border-rule bg-paper">
                <div className="mx-auto flex max-h-72 max-w-3xl">
                  <div className="folio-wheel min-h-0 flex-1 overflow-y-auto py-1" role="listbox" aria-label="Chapters">
                    {toc.map((entry) => {
                      const on = entry.id === active || entry.children.some((child) => child.id === active);
                      return (
                        <button
                          key={entry.id}
                          id={`wheel-${entry.id}`}
                          type="button"
                          role="option"
                          aria-selected={on}
                          className={
                            "flex w-full snap-center items-baseline gap-3 px-4 py-2.5 text-left text-sm " +
                            (on ? "text-cinnabar" : "text-ink")
                          }
                          onMouseEnter={() => setWheelChapter(entry.id)}
                          onFocus={() => setWheelChapter(entry.id)}
                          onClick={() => go(entry.id)}
                        >
                          <span className="min-w-0 flex-1 leading-snug">{entry.label}</span>
                          {entry.page ? <span className="shrink-0 text-xs text-muted tabular-nums">{entry.page}</span> : null}
                        </button>
                      );
                    })}
                  </div>
                  {wheelSections.length ? (
                    <div className="folio-wheel min-h-0 flex-1 overflow-y-auto border-l border-rule py-1" role="listbox" aria-label="Sections">
                      {wheelSections.map((child) => (
                        <button
                          key={child.id}
                          type="button"
                          role="option"
                          aria-selected={child.id === active}
                          className={
                            "flex w-full snap-center items-baseline gap-3 px-4 py-2.5 text-left text-sm " +
                            (child.id === active ? "text-cinnabar" : "text-ink")
                          }
                          onClick={() => go(child.id)}
                        >
                          <span className="min-w-0 flex-1 leading-snug">{child.label}</span>
                          {child.page ? <span className="shrink-0 text-xs text-muted tabular-nums">{child.page}</span> : null}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            </>
          ) : null}
        </header>
        <label className="border-b border-rule px-4 py-2 sm:hidden">
          <span className="sr-only">Find in the book</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Find in the book"
            className="w-full rounded-ui border border-rule bg-paper-2 px-3 py-2 text-sm outline-none"
          />
        </label>
        <main className="min-h-0 flex-1 overflow-y-auto">
          {settingsOpen ? (
            <SettingsSheet
              settings={settings}
              onChange={(next) => {
                setSettings(next);
                saveSettings(next);
              }}
              onClose={() => setSettingsOpen(false)}
            />
          ) : libraryOpen ? (
            <LibrarySheet
              shelf={shelf}
              onOpen={(entry) => (entry.kind === "sample" && entry.sampleId ? openSample(entry.sampleId) : openKept(entry))}
              onRemove={(entry) => setPending({ entry, step: 1 })}
              onSave={(entry, record) => {
                const next = storeRecord(loadShelf(), entry, record);
                saveShelf(next);
                setShelf(next);
              }}
              onClose={() => setLibraryOpen(false)}
            />
          ) : (
          <article className="folio mx-auto w-full max-w-2xl px-5 pt-8 pb-24 md:px-8">
            {folio.cover ? (
              <img src={`data:image/jpeg;base64,${folio.cover}`} alt="" className="mx-auto mb-8 block max-h-[28rem] w-auto max-w-full" />
            ) : null}
            <p className="mb-8 text-center font-serif text-sm tracking-wide text-muted">
              {lucisEdition ? "F. Max Müller · Sacred Books of the East, 1881" : folio.subtitle}
            </p>
            <Edition
              chapters={chapters}
              owners={owners}
              editing={editing}
              revisions={revisions}
              onSave={savePassage}
              onCancel={() => setEditing(null)}
              onRestore={restoreRevision}
            />
            <footer className="mt-16 border-t border-rule pt-6 text-center text-sm text-muted">
              <p>
                {folio.stats.hyphensRejoined} end-of-line hyphens rejoined, {folio.stats.headersRemoved} running heads removed,{" "}
                {folio.stats.chapters} {folio.stats.chapters === 1 ? "chapter" : "chapters"} linked to the page numbers.
              </p>
              <p className="mt-2">
                {folio.rights
                  ? folio.rights
                  : lucisEdition
                    ? "F. Max Müller’s English translation, 1881. Public domain."
                    : "Personal reading copy. Page numbers follow the file. The sample editions are in the contents rail."}
              </p>
              {folio.warning ? <p className="mt-2">{folio.warning}</p> : null}
            </footer>
          </article>
          )}
        </main>
      </div>
      {source && folio.origin ? (
        <SourcePane record={source} page={sourcePage} quote={sourceQuote} onPage={setSourcePage} onClose={() => setSource(null)} />
      ) : null}
      {pick && !editing ? (
        <SelectionMenu
          pick={pick}
          note={menuNote}
          original={folio.origin ? originalLabel(folio.origin.kind) : undefined}
          onCopy={() => void copyPick()}
          onEdit={editPick}
          onShare={() => void sharePick()}
          onOriginal={folio.origin ? () => void openOriginal() : undefined}
        />
      ) : null}
      {logOpen ? (
        <div className="fixed inset-x-0 bottom-0 z-50 flex h-[min(50dvh,32rem)] flex-col border-t border-desk-line bg-desk text-desk-fg">
          <div className="flex shrink-0 items-center justify-between px-4 py-1 md:px-6">
            <p className="text-xs tracking-wide text-desk-muted uppercase">Opening</p>
            <button type="button" className="h-11 px-2 text-sm text-desk-muted" onClick={() => setLogOpen(false)}>
              Close
            </button>
          </div>
          <div ref={logBox} className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 md:px-6">
            <ol className="opening-log">
              {log.map((line, index) => (
                <li
                  key={`${index}-${line}`}
                  className={"py-0.5 text-sm leading-relaxed " + (index === log.length - 1 ? "text-cream" : "text-desk-muted")}
                >
                  {line}
                </li>
              ))}
            </ol>
          </div>
        </div>
      ) : null}
      {pending ? (
        <div className="fixed inset-0 z-[80] grid place-items-center bg-desk/50 px-4" onClick={() => setPending(null)}>
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="remove-title"
            aria-describedby="remove-body"
            className="w-full max-w-md rounded-ui border border-rule bg-paper p-5 text-ink"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 id="remove-title" className="font-serif text-2xl">
              {pending.step === 1 ? `Remove “${pending.entry.title}”?` : `Delete “${pending.entry.title}” from this device?`}
            </h2>
            <p id="remove-body" className="mt-3 text-sm leading-relaxed text-muted">
              {pending.step === 1
                ? "This is the title on the shelf. Continue only if it is the one you mean to take off."
                : pending.entry.kind === "sample"
                  ? "The reading place and any saved edits for this edition will be deleted. You can put the sample back on the shelf later. The copy that came with the app stays."
                  : `The reading place, saved edits, converted text${pending.entry.originName ? `, and the original file ${pending.entry.originName}` : ""} will be deleted. This cannot be undone.`}
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" className="h-11 px-3 text-sm" autoFocus onClick={() => setPending(null)}>
                Keep it
              </button>
              <button type="button" className="h-11 rounded-ui bg-cinnabar px-3 text-sm text-cream" onClick={() => void confirmRemove()}>
                {pending.step === 1 ? "Continue" : "Remove this title"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function LibrarySheet({
  shelf,
  onOpen,
  onRemove,
  onSave,
  onClose,
}: {
  shelf: ShelfState;
  onOpen: (entry: ShelfEntry) => void;
  onRemove: (entry: ShelfEntry) => void;
  onSave: (entry: ShelfEntry, record: CatalogRecord) => void;
  onClose: () => void;
}) {
  const [filter, setFilter] = useState("");
  const [sortKey, setSortKey] = useState<DcElement>("creator");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [editing, setEditing] = useState<ShelfEntry | null>(null);
  const [draft, setDraft] = useState<CatalogRecord | null>(null);
  const [idsOpen, setIdsOpen] = useState(false);
  const rows = sortRecords(
    listHoldings(shelf)
      .map((entry) => ({ entry, record: recordFor(shelf, entry) }))
      .filter(({ record }) => {
        const q = filter.trim().toLowerCase();
        if (!q) return true;
        const blob = [
          ...DC_ELEMENTS.map((key) => record[key]),
          record.work,
          record.expression,
          record.volume,
          ...Object.values(record.ids),
        ]
          .join(" ")
          .toLowerCase();
        return blob.includes(q);
      }),
    sortKey,
    sortDir,
  );
  if (editing && draft) {
    const set = (key: DcElement, value: string) => setDraft({ ...draft, [key]: value });
    return (
      <form
        className="mx-auto w-full max-w-3xl px-5 pt-8 pb-24 md:px-8"
        onSubmit={(event) => {
          event.preventDefault();
          onSave(editing, draft);
          setEditing(null);
        }}
      >
        <button type="button" className="text-sm text-muted" onClick={() => setEditing(null)}>
          Back to the catalog
        </button>
        <h1 id="meta-title" className="mt-6 font-serif text-3xl">
          Dublin Core
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">Fifteen elements. A semicolon separates several creators, contributors, or languages.</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {DC_ELEMENTS.map((key) => (
            <label key={key} className={key === "description" || key === "rights" ? "sm:col-span-2" : ""}>
              <span className="text-sm text-muted">{DC_LABEL[key]}</span>
              {key === "description" || key === "rights" ? (
                <textarea
                  value={draft[key]}
                  rows={3}
                  onChange={(event) => set(key, event.target.value)}
                  className="mt-1 w-full rounded-ui border border-rule bg-paper-2 p-2 text-sm outline-none"
                />
              ) : (
                <input
                  value={draft[key]}
                  onChange={(event) => set(key, event.target.value)}
                  className="mt-1 h-11 w-full rounded-ui border border-rule bg-paper-2 px-2 text-sm outline-none"
                />
              )}
            </label>
          ))}
        </div>
        <h2 className="mt-8 font-serif text-xl">Work, expression, volume</h2>
        <p className="mt-1 text-sm leading-relaxed text-muted">
          Dublin Core describes this file. These three say which text it is, which translation, and which volume.
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          {(
            [
              ["work", "Work"],
              ["expression", "Expression"],
              ["volume", "Volume"],
            ] as const
          ).map(([key, label]) => (
            <label key={key}>
              <span className="text-sm text-muted">{label}</span>
              <input
                value={draft[key]}
                onChange={(event) => setDraft({ ...draft, [key]: event.target.value })}
                className="mt-1 h-11 w-full rounded-ui border border-rule bg-paper-2 px-2 text-sm outline-none"
              />
            </label>
          ))}
        </div>
        <button type="button" className="mt-6 text-sm text-cinnabar" aria-expanded={idsOpen} onClick={() => setIdsOpen((open) => !open)}>
          {idsOpen ? "Hide serial and item numbers" : "Serial and item numbers"}
        </button>
        {idsOpen ? (
          <div className="mt-3 grid gap-6 sm:grid-cols-2">
            <IdFields title="Serial numbers" keys={SERIAL_IDS} draft={draft} onChange={(key, value) => setDraft({ ...draft, ids: { ...draft.ids, [key]: value } })} />
            <IdFields title="Item numbers" keys={ITEM_IDS} draft={draft} onChange={(key, value) => setDraft({ ...draft, ids: { ...draft.ids, [key]: value } })} />
          </div>
        ) : null}
        <div className="mt-6 flex gap-2">
          <button type="submit" className="h-11 rounded-ui bg-cinnabar px-4 text-sm text-cream">
            Save record
          </button>
          <button type="button" className="h-11 px-3 text-sm text-muted" onClick={() => setEditing(null)}>
            Cancel
          </button>
        </div>
      </form>
    );
  }
  return (
    <div className="w-full px-3 pt-8 pb-24 md:px-6">
      <button type="button" className="text-sm text-muted" onClick={onClose}>
        Back to the book
      </button>
      <h1 className="mt-6 font-serif text-3xl">Library</h1>
      <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted">
        Each volume is a Dublin Core record. Sort any column, filter the catalog, and edit the metadata. Serial and item numbers stay on the record, not in this table.
      </p>
      <label className="mt-4 flex w-full max-w-xs flex-col gap-1 text-sm text-muted">
        Filter records
        <input
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Creator, subject, ISBN…"
          className="h-11 rounded-ui border border-rule bg-paper-2 px-3 text-sm text-ink outline-none"
        />
      </label>
      <div className="mt-4 overflow-x-auto border-t border-rule">
        <table className="w-full min-w-[52rem] border-collapse text-left">
          <thead>
            <tr className="border-b border-rule">
              {TABLE_COLUMNS.map((key) => {
                const on = sortKey === key;
                return (
                  <th key={key} className="px-2 py-2 text-sm font-medium text-muted" aria-sort={on ? (sortDir === "asc" ? "ascending" : "descending") : "none"}>
                    <button
                      type="button"
                      className="h-10 text-left"
                      onClick={() => {
                        if (on) setSortDir((dir) => (dir === "asc" ? "desc" : "asc"));
                        else {
                          setSortKey(key);
                          setSortDir("asc");
                        }
                      }}
                    >
                      {DC_LABEL[key]}
                      {on ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
                    </button>
                  </th>
                );
              })}
              <th className="px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map(({ entry, record }) => (
              <tr key={entry.id} className="border-b border-rule align-top">
                {TABLE_COLUMNS.map((key) => (
                  <td key={key} className="px-2 py-3 text-sm">
                    {key === "title" ? (
                      <button type="button" className="text-left text-ink" onClick={() => onOpen(entry)}>
                        {record.title}
                      </button>
                    ) : (
                      record[key]
                    )}
                  </td>
                ))}
                <td className="px-2 py-3 text-sm whitespace-nowrap">
                  <button
                    type="button"
                    className="text-cinnabar"
                    onClick={() => {
                      const next = recordFor(shelf, entry);
                      setDraft(next);
                      setIdsOpen(Object.values(next.ids).some((value) => value?.trim()));
                      setEditing(entry);
                    }}
                  >
                    Edit
                  </button>
                  <button type="button" className="ml-3 text-muted" onClick={() => onRemove(entry)}>
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 ? <p className="py-8 font-serif text-lg text-muted">No record matches that filter.</p> : null}
      </div>
    </div>
  );
}

function IdFields({
  title,
  keys,
  draft,
  onChange,
}: {
  title: string;
  keys: readonly (keyof CatalogRecord["ids"])[];
  draft: CatalogRecord;
  onChange: (key: keyof CatalogRecord["ids"], value: string) => void;
}) {
  return (
    <fieldset>
      <legend className="text-sm font-medium tracking-wide text-muted uppercase">{title}</legend>
      <div className="mt-2 grid gap-3">
        {keys.map((key) => (
          <label key={key}>
            <span className="text-sm text-muted">{ID_LABEL[key]}</span>
            <input
              value={draft.ids[key] || ""}
              onChange={(event) => onChange(key, event.target.value)}
              className="mt-1 h-11 w-full rounded-ui border border-rule bg-paper-2 px-2 text-sm outline-none"
            />
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function Choice({ on, label, hint, onPick }: { on: boolean; label: string; hint: string; onPick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onPick}
      className={"block w-full rounded-ui border px-3 py-2 text-left " + (on ? "border-cinnabar bg-paper-2" : "border-rule")}
    >
      <span className="text-sm">{label}</span>
      <span className="mt-1 block text-xs leading-relaxed text-muted">{hint}</span>
    </button>
  );
}

function SettingsSheet({
  settings,
  onChange,
  onClose,
}: {
  settings: DeskSettings;
  onChange: (next: DeskSettings) => void;
  onClose: () => void;
}) {
  return (
    <div className="mx-auto w-full max-w-2xl px-5 pt-8 pb-24 md:px-8">
      <button type="button" className="text-sm text-muted" onClick={onClose}>
        Back to the book
      </button>
      <h1 className="mt-6 font-serif text-3xl">Settings</h1>
      <p className="mt-2 text-sm text-muted">Used the next time you open a book. The sample edition is unchanged.</p>
      <fieldset className="mt-8">
        <legend className="text-sm font-medium">Pictures of pages</legend>
        <div className="mt-3 grid gap-2">
          <Choice
            on={settings.pictures === "off"}
            label="Off"
            hint="Leave a scan unread."
            onPick={() => onChange({ ...settings, pictures: "off" })}
          />
          <Choice
            on={settings.pictures === "empty"}
            label="Empty pages"
            hint="Read a page only when it has no text. A page that already has text is left alone."
            onPick={() => onChange({ ...settings, pictures: "empty" })}
          />
        </div>
      </fieldset>
      <div className="mt-10 border-t border-rule pt-6">
        <p className="text-sm font-medium">PP-OCR</p>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          This reads those empty pages. It is included with the desk, and it uses the graphics chip when this browser can, and the processor otherwise.
        </p>
        <button
          type="button"
          aria-pressed={settings.kind === "vision"}
          onClick={() => onChange({ ...settings, kind: settings.kind === "vision" ? "pp" : "vision" })}
          className={
            "mt-4 block w-full rounded-ui border px-3 py-2 text-left " +
            (settings.kind === "vision" ? "border-cinnabar bg-paper-2" : "border-rule")
          }
        >
          <span className="text-sm">Use a vision model instead</span>
          <span className="mt-1 block text-xs leading-relaxed text-muted">
            Off unless you turn this on. The first picture page downloads a few hundred megabytes. It runs only through WebGPU. If
            that is not available, those pages are read with PP-OCR.
          </span>
        </button>
        <p className="mt-3 text-xs leading-relaxed text-muted">
          WebGPU is already on in current Chrome, Edge, and Brave on Windows and macOS, when hardware acceleration is on. On Linux
          the same browsers usually need WebGPU switched on, and there WebGPU is Vulkan. Firefox has WebGPU on Windows and on Apple
          silicon, and not on Linux. Brave can also hide the graphics chip. The desk cannot turn any of this on.
        </p>
      </div>
    </div>
  );
}

function Edition({
  chapters,
  owners,
  editing,
  revisions,
  onSave,
  onCancel,
  onRestore,
}: {
  chapters: Folio["chapters"];
  owners: Map<string, string>;
  editing: { chapterId: string; from: number; to: number } | null;
  revisions: Revision[];
  onSave: (blocks: Block[]) => void;
  onCancel: () => void;
  onRestore: (revision: Revision) => void;
}) {
  return (
    <>
      {chapters.map((chapter) => {
        const rows = [];
        for (let index = 0; index < chapter.blocks.length; index++) {
          const editingHere = editing?.chapterId === chapter.id && index >= editing.from && index <= editing.to;
          if (editing && editing.chapterId === chapter.id && index === editing.from) {
            const slice = chapter.blocks.slice(editing.from, editing.to + 1);
            rows.push(
              <PassageEditor
                key={`${chapter.id}-edit`}
                chapterId={chapter.id}
                blocks={slice}
                marks={slice.map((block, offset) => owns(owners, chapter.id, editing.from + offset, "lead", block.page))}
                revisions={revisions}
                onSave={onSave}
                onCancel={onCancel}
                onRestore={onRestore}
              />,
            );
            index = editing.to;
            continue;
          }
          if (editingHere) continue;
          const block = chapter.blocks[index];
          rows.push(<BlockView key={`${chapter.id}-${index}`} chapterId={chapter.id} index={index} block={block} owners={owners} />);
        }
        return (
          <section key={chapter.id} className="mb-14" aria-labelledby={chapter.id}>
            {rows}
          </section>
        );
      })}
    </>
  );
}

function BlockView({
  chapterId,
  index,
  block,
  owners,
}: {
  chapterId: string;
  index: number;
  block: Block;
  owners: Map<string, string>;
}) {
  const anchor = `b-${chapterId}-${index}`;
  const lead = owns(owners, chapterId, index, "lead", block.page);
  const place = {
    "data-chapter": chapterId,
    "data-block": index,
    "data-src": block.src || "",
    "data-page": block.page ?? "",
  };
  if (block.t === "h1") {
    return (
      <>
        {lead && block.page ? <PageMark page={block.page} /> : null}
        <h1 id={block.id} data-spy className="page-anchor" {...place}>
          {block.s}
        </h1>
      </>
    );
  }
  if (block.t === "h2") {
    return (
      <>
        {lead && block.page ? <PageMark page={block.page} /> : null}
        <h2 id={block.id} data-spy className="page-anchor" {...place}>
          {block.s}
        </h2>
      </>
    );
  }
  if (block.t === "toc-entry") {
    return (
      <p className="tocline" {...place}>
        <a
          href={`#${block.id || `c${String(block.n).padStart(2, "0")}`}`}
          className={
            "flex items-baseline justify-between gap-4 border-b border-rule py-2 text-ink no-underline" +
            (block.kind === "section" ? " pl-6" : "")
          }
        >
          <span>{block.n ? `${block.n}. ${block.s}` : block.s}</span>
          <span className="text-muted tabular-nums">{block.page}</span>
        </a>
      </p>
    );
  }
  if (block.t === "table") {
    return (
      <div className="my-4 overflow-x-auto" {...place}>
        <table>
          <thead>
            <tr>
              {(block.headers || []).map((header) => (
                <th key={header}>{header}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(block.rows || []).map((row) => (
              <tr key={row[0] + row[1]}>
                {row.map((cell, cellIndex) => (
                  <td key={cellIndex}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  const classes = [
    block.t === "li" ? "item" : "",
    block.kind === "verse" ? "verse" : "",
    block.kind === "center" ? "center" : "",
    block.kind === "extract" ? "extract" : "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <>
      {lead && block.page ? <PageMark page={block.page} /> : null}
      <p id={anchor} className={classes} {...place}>
        {(block.runs || []).map((run, runIndex) => {
          const page = runPage(run);
          if (page != null) {
            return owns(owners, chapterId, index, `r${runIndex}`, page) ? (
              <span key={runIndex} id={`page-${page}`} className="page-anchor sr-only">
                Page {page}
              </span>
            ) : null;
          }
          if (typeof run !== "string") return null;
          const prev = runIndex > 0 ? runPage((block.runs as Run[])[runIndex - 1]) : null;
          const gap = prev != null && /^[A-Za-z0-9]/.test(run) ? " " : "";
          return (
            <span key={runIndex}>
              {gap}
              {run}
            </span>
          );
        })}
      </p>
    </>
  );
}

function PageMark({ page }: { page: number | string }) {
  return (
    <span id={`page-${page}`} className="page-anchor page-label">
      {page}
    </span>
  );
}
