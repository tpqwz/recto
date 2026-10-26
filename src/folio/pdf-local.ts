import { previewPathPrefix } from "@/lib/preview-path-prefix";

/** CMaps, standard fonts, and image decoders that ship with the desk. */
export function pdfAssetOptions() {
  const prefix = typeof window === "undefined" ? "" : (previewPathPrefix(window.location.hostname, window.location.pathname) ?? "");
  const base = `${prefix}/vendor/pdfjs`;
  return {
    cMapUrl: `${base}/cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${base}/standard_fonts/`,
    wasmUrl: `${base}/wasm/`,
  };
}

/** The PDF reader is its own file. After a publish, an open tab can still ask for the previous one. */
export async function loadPdfjs() {
  try {
    const pdfjs = await import("pdfjs-dist");
    try {
      sessionStorage.removeItem("recto-chunk-reload");
    } catch {
      /* ignore */
    }
    return pdfjs;
  } catch (error) {
    const missed = error instanceof Error && /dynamically imported module|Importing a module script failed|Failed to fetch/i.test(error.message);
    if (missed && typeof sessionStorage !== "undefined" && !sessionStorage.getItem("recto-chunk-reload")) {
      sessionStorage.setItem("recto-chunk-reload", "1");
      location.reload();
    }
    throw error;
  }
}
