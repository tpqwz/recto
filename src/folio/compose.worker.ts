import { assembleFolio, epubArchive, type Line, type OutlineItem } from "./assemble";
import { loadLexicon } from "./repair";

type Job = {
  id: number;
  lines: Line[];
  title: string;
  subtitle: string;
  author?: string;
  sourceName: string;
  outline?: OutlineItem[];
  emptyMessage: string;
  lexiconPrefix: string;
  cover?: string;
};

self.onmessage = (event: MessageEvent<Job>) => {
  const job = event.data;
  void finish(job);
};

async function finish(job: Job) {
  try {
    const lexicon = await loadLexicon(job.lexiconPrefix);
    const folio = assembleFolio(job.lines, {
      title: job.title,
      subtitle: job.subtitle,
      author: job.author,
      sourceName: job.sourceName,
      outline: job.outline,
      emptyMessage: job.emptyMessage,
      lexicon,
      cover: job.cover,
      skipEpub: true,
      onStatus: (status) => self.postMessage({ id: job.id, status }),
    });
    self.postMessage({ id: job.id, status: "Making the EPUB" });
    const bytes = epubArchive(folio, job.sourceName);
    self.postMessage({ id: job.id, folio, bytes }, { transfer: [bytes.buffer] });
  } catch (err) {
    self.postMessage({ id: job.id, error: err instanceof Error ? err.message : "Could not assemble that book." });
  }
}
