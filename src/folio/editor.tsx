import { useLayoutEffect, useRef, useState } from "react";
import type { Block } from "./assemble.ts";
import { parseBlock, proseOf, sourceOf, unifiedDiff, type Revision } from "./revise.ts";

export type SelectionPick = {
  text: string;
  page: string | null;
  src: number | null;
  top: number;
  bottom: number;
  left: number;
  chapterId: string;
  from: number;
  to: number;
};

function caretOffset(el: HTMLElement) {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return 0;
  const range = sel.getRangeAt(0);
  const pre = range.cloneRange();
  pre.selectNodeContents(el);
  pre.setEnd(range.endContainer, range.endOffset);
  return pre.toString().length;
}

function setCaret(el: HTMLElement, offset: number) {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let left = offset;
  let node: Text | null = null;
  while (walker.nextNode()) {
    const text = walker.currentNode as Text;
    if (left <= text.length) {
      node = text;
      break;
    }
    left -= text.length;
  }
  const range = document.createRange();
  if (node) range.setStart(node, Math.max(0, left));
  else {
    range.selectNodeContents(el);
    range.collapse(false);
  }
  range.collapse(true);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}

function placeMenu(pick: SelectionPick, width: number, height: number) {
  const viewport = window.visualViewport;
  const top0 = viewport?.offsetTop ?? 0;
  const left0 = viewport?.offsetLeft ?? 0;
  const viewW = viewport?.width ?? window.innerWidth;
  const viewH = viewport?.height ?? window.innerHeight;
  const boxW = width || Math.min(320, viewW - 16);
  const boxH = height || 52;
  const minLeft = left0 + 8;
  const maxLeft = left0 + viewW - boxW - 8;
  const left = Math.max(minLeft, Math.min(pick.left, Math.max(minLeft, maxLeft)));
  const minTop = top0 + 8;
  const maxTop = top0 + viewH - boxH - 8;
  const above = pick.top - boxH - 8;
  const below = pick.bottom + 8;
  let top = above >= minTop ? above : below;
  if (top > maxTop) top = maxTop;
  if (top < minTop) top = minTop;
  return { top, left };
}

export function SelectionMenu({
  pick,
  note,
  original,
  onCopy,
  onEdit,
  onShare,
  onOriginal,
}: {
  pick: SelectionPick;
  note: string;
  original?: string;
  onCopy: () => void;
  onEdit: () => void;
  onShare: () => void;
  onOriginal?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const width = Math.ceil(rect.width);
    const height = Math.ceil(rect.height);
    setBox((prev) => (prev.width === width && prev.height === height ? prev : { width, height }));
  });
  return (
    <div
      ref={ref}
      data-selection-menu="true"
      role="menu"
      aria-label="Passage"
      className="fixed z-[70] flex max-w-[calc(100vw-1rem)] flex-wrap items-center gap-1 rounded-ui border border-rule bg-paper-2 p-1"
      style={placeMenu(pick, box.width, box.height)}
      onPointerDown={(event) => event.preventDefault()}
    >
      {pick.page ? <span className="px-2 text-sm text-muted">p. {pick.page}</span> : null}
      <button type="button" role="menuitem" className="h-11 px-3 text-sm text-ink" onClick={onCopy}>
        Copy
      </button>
      <button type="button" role="menuitem" className="h-11 px-3 text-sm text-cinnabar" onClick={onEdit}>
        Edit
      </button>
      <button type="button" role="menuitem" className="h-11 px-3 text-sm text-ink" onClick={onShare}>
        Share
      </button>
      {original && onOriginal ? (
        <button type="button" role="menuitem" className="h-11 px-3 text-sm text-ink" onClick={onOriginal}>
          {original}
        </button>
      ) : null}
      {note ? <span className="px-2 text-sm text-muted">{note}</span> : null}
    </div>
  );
}

function kindOf(block: Block) {
  if (block.t === "h1") return "h1";
  if (block.t === "h2") return "h2";
  return "p";
}

function Editable({
  block,
  chapterId,
  index,
  active,
  caret,
  onActivate,
  onDraft,
  onSplit,
  onMerge,
  onCaretUsed,
}: {
  block: Block;
  chapterId: string;
  index: number;
  active: boolean;
  caret: number | null;
  onActivate: () => void;
  onDraft: (block: Block, caret: number | null) => void;
  onSplit: (head: Block, tail: string) => void;
  onMerge: () => void;
  onCaretUsed: () => void;
}) {
  const ref = useRef<HTMLElement>(null);
  const kind = kindOf(block);
  const Tag = kind === "h1" ? "h1" : kind === "h2" ? "h2" : "p";

  useLayoutEffect(() => {
    const el = ref.current;
    if (!active || !el) return;
    const want = sourceOf(block);
    if (caret != null) {
      if (el.textContent !== want) el.textContent = want;
      el.focus();
      setCaret(el, caret);
      onCaretUsed();
      return;
    }
    if (document.activeElement !== el) {
      el.textContent = want;
      el.focus();
      setCaret(el, want.length);
    }
  }, [active, block, caret, onCaretUsed]);

  if (!active) {
    const className = ["cursor-text", block.kind || ""].filter(Boolean).join(" ");
    if (kind === "h1" || kind === "h2") {
      const Heading = kind;
      return (
        <Heading id={block.id} data-spy className="page-anchor" onClick={onActivate}>
          {proseOf(block)}
        </Heading>
      );
    }
    return (
      <p className={className} onClick={onActivate}>
        {proseOf(block)}
      </p>
    );
  }

  return (
    <Tag
      ref={ref as never}
      id={kind === "p" ? undefined : block.id}
      data-spy={kind === "p" ? undefined : true}
      contentEditable
      suppressContentEditableWarning
      role="textbox"
      aria-label="Edit this passage"
      spellCheck
      className={(block.kind || "") + " outline-none"}
      onInput={(event) => {
        const value = event.currentTarget.textContent || "";
        const next = parseBlock(value, block, chapterId, index);
        const changed = next.t !== block.t || next.kind !== block.kind;
        onDraft(next, changed ? Math.max(0, caretOffset(event.currentTarget) - (sourceOf(next).length - value.length)) : null);
      }}
      onKeyDown={(event) => {
        const el = event.currentTarget;
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          const at = caretOffset(el);
          const value = el.textContent || "";
          onSplit(parseBlock(value.slice(0, at), block, chapterId, index), value.slice(at));
        } else if (event.key === "Backspace" && caretOffset(el) === 0) {
          event.preventDefault();
          onMerge();
        }
      }}
      onPaste={(event) => {
        event.preventDefault();
        const text = event.clipboardData.getData("text/plain").replace(/\s*\n\s*/g, " ");
        document.execCommand("insertText", false, text);
      }}
    />
  );
}

export function PassageEditor({
  chapterId,
  blocks,
  marks,
  revisions,
  onSave,
  onCancel,
  onRestore,
}: {
  chapterId: string;
  blocks: Block[];
  marks: boolean[];
  revisions: Revision[];
  onSave: (blocks: Block[]) => void;
  onCancel: () => void;
  onRestore: (revision: Revision) => void;
}) {
  const [draft, setDraft] = useState(blocks);
  const [focus, setFocus] = useState(0);
  const [caret, setCaret] = useState<number | null>(0);
  const [open, setOpen] = useState(false);
  const live = useRef<(HTMLElement | null)[]>([]);

  function readDraft() {
    return draft.map((block, index) => {
      const el = live.current[index];
      if (el && document.activeElement === el) return parseBlock(el.textContent || "", block, chapterId, index);
      return block;
    });
  }

  const here = revisions.filter((revision) => revision.chapterId === chapterId);

  return (
    <div data-editing="true">
      <div className="mb-4 flex flex-wrap items-center gap-1 rounded-ui border border-rule bg-paper-2 p-1">
        <span className="px-2 text-xs tracking-wide text-muted uppercase">Editing</span>
        <button
          type="button"
          className="h-11 px-3 text-sm text-cinnabar"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onSave(readDraft().filter((block) => proseOf(block) || block.t === "h1"))}
        >
          Save
        </button>
        <button type="button" className="h-11 px-3 text-sm text-ink" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="h-11 px-3 text-sm text-muted" onClick={() => setOpen((value) => !value)}>
          {open ? "Hide revisions" : `Revisions${here.length ? ` (${here.length})` : ""}`}
        </button>
        <p className="w-full px-2 pb-1 text-xs leading-relaxed text-muted">
          Type # for a heading, ## for a smaller one, and a greater-than sign for an extract. Each save is kept on this device, with the difference.
        </p>
      </div>
      {open ? (
        <div className="mb-6">
          {here.length === 0 ? <p className="text-sm text-muted">No saved edit in this chapter yet.</p> : null}
          {here.map((revision) => {
            const diff = unifiedDiff(revision.before, revision.after);
            return (
              <article key={revision.id} className="mb-4 border-t border-rule pt-3">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="text-sm text-ink">
                    {new Date(revision.at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                    <span className="text-muted"> · {revision.label}</span>
                  </p>
                  <button type="button" className="h-11 shrink-0 px-2 text-sm text-cinnabar" onClick={() => onRestore(revision)}>
                    Return to this
                  </button>
                </div>
                {diff ? (
                  <pre className="mt-2 font-mono text-xs leading-relaxed whitespace-pre-wrap">
                    {diff.split("\n").map((line, index) => (
                      <span key={index} className={line.startsWith("+") ? "block text-cinnabar" : "block text-muted"}>
                        {line}
                      </span>
                    ))}
                  </pre>
                ) : (
                  <p className="mt-2 text-xs text-muted">No change in the words.</p>
                )}
              </article>
            );
          })}
        </div>
      ) : null}
      {draft.map((block, index) => (
        <div key={`${chapterId}-${index}-${kindOf(block)}`} ref={(node) => { live.current[index] = node?.querySelector("[contenteditable]") ?? null; }}>
          {marks[index] && block.page != null && block.page !== "" ? (
            <span className="page-anchor page-label">{block.page}</span>
          ) : null}
          <Editable
            block={block}
            chapterId={chapterId}
            index={index}
            active={focus === index}
            caret={focus === index ? caret : null}
            onActivate={() => {
              setFocus(index);
              setCaret(null);
            }}
            onCaretUsed={() => setCaret(null)}
            onDraft={(next, nextCaret) => {
              setDraft((current) => current.map((item, itemIndex) => (itemIndex === index ? next : item)));
              if (nextCaret != null) setCaret(nextCaret);
            }}
            onSplit={(head, tail) => {
              const rest = parseBlock(tail, { ...block, id: undefined, t: "p", s: undefined, kind: undefined }, chapterId, index + 1);
              setDraft((current) => [...current.slice(0, index), head, rest, ...current.slice(index + 1)]);
              setFocus(index + 1);
              setCaret(sourceOf(rest).length > 0 && tail.startsWith("#") ? 0 : 0);
            }}
            onMerge={() => {
              if (index === 0) return;
              setDraft((current) => {
                const prev = current[index - 1];
                const joined = `${sourceOf(prev)} ${sourceOf(block)}`.trim();
                const merged = parseBlock(joined, prev, chapterId, index - 1);
                return [...current.slice(0, index - 1), merged, ...current.slice(index + 1)];
              });
              setFocus(index - 1);
              setCaret(null);
            }}
          />
        </div>
      ))}
    </div>
  );
}
