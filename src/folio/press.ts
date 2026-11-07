import { checkpoint } from "./job.ts";

/** Public-domain encyclopedias kept at the Internet Archive, not in the app. */

export type PressVolume = {
  id: string;
  volume: string;
  label: string;
  file: string;
  bytes: number;
};

export type PressWork = {
  id: string;
  title: string;
  date: string;
  rights: string;
  item: string;
  volumes: PressVolume[];
};

const BRITANNICA = [
  ["01", "A–Androphagi", 35160160],
  ["02", "Andros–Austria", 39662194],
  ["03", "Austria lower–Bisectrix", 37416373],
  ["04", "Bisharin–Calgary", 36657016],
  ["05", "Calhoun–Chatelaine", 37397013],
  ["06", "Chatelet–Constantine", 34879897],
  ["07", "Constantine Pavlovich–Demidov", 29840321],
  ["08", "Demijohn–Edward the black prince", 31689413],
  ["09", "Edwardes–Evangelical Association", 35048749],
  ["10", "Evangelical church conference–Francis Joseph I", 35864331],
  ["11", "Franciscans–Gibson William", 34641264],
  ["12", "Gichtel Johann–Harmonium", 34769279],
  ["13", "Harmony–Hurstmonceaux", 40898419],
  ["14", "Husband–Italic", 43831194],
  ["15", "Italy–Kyshtym", 34887339],
  ["16", "L–Lord Advocate", 41761207],
  ["17", "Lord Chamberlain–Mecklenburg", 37305332],
  ["18", "Medal–Mumps", 34740897],
  ["19", "Mun Adrien–Oddfellows", 42648903],
  ["20", "Ode–Payment of members", 37418889],
  ["21", "Payn James–Polka", 39019652],
  ["22", "Poll–Reeves", 35789089],
  ["23", "Refectory–Sainte Beuve", 39328069],
  ["24", "Sainte-Claire Deville–Shuttle", 42065149],
  ["25", "Shwebo–Subliminal self", 44789896],
  ["26", "Submarine mines–Tom-Tom", 45230207],
  ["27", "Tonalite–Vesuvius", 41985628],
  ["28", "Vetch–Zymotic diseases", 51762863],
  ["29", "Index–List of contributors", 35721436],
] as const;

function britannicaFile(pair: (typeof BRITANNICA)[number]) {
  const slug = pair[1].replace(/–/g, "_-_").replace(/ /g, "_");
  return `Encyclopedia_Britannica_${pair[0]}_${slug}.djvu`;
}

const NIE_BYTES = [
  85856806, 104425808, 105028316, 95495490, 124998739, 112663939, 135549652, 150644279, 154139100,
  120779428, 167167192, 137808623, 129868340, 157452569, 123911930, 124442651, 126373226,
];

export const PRESS: PressWork[] = [
  {
    id: "britannica-11",
    title: "Encyclopædia Britannica",
    date: "1911",
    rights: "Public domain. Eleventh edition, 1910–1911.",
    item: "EncyclopaediaBritannica1911HQDJVU",
    volumes: BRITANNICA.map((pair) => ({
      id: `britannica-11-${pair[0]}`,
      volume: String(Number(pair[0])),
      label: pair[1],
      file: britannicaFile(pair),
      bytes: pair[2],
    })),
  },
  {
    id: "new-international",
    title: "The New International Encyclopaedia",
    date: "1902",
    rights: "Public domain. Gilman, Peck, and Colby, 1902–1904.",
    item: "",
    volumes: NIE_BYTES.map((bytes, index) => {
      const n = String(index + 1).padStart(2, "0");
      const item = `newinternationa${n}gilm`;
      return {
        id: `new-international-${n}`,
        volume: String(index + 1),
        label: `Volume ${index + 1}`,
        file: `${item}.pdf`,
        bytes,
      };
    }),
  },
];

/** Each New International volume is its own item. Britannica shares one. */
export function pressItem(work: PressWork, volume: PressVolume) {
  if (work.id === "new-international") return volume.file.replace(/\.pdf$/, "");
  return work.item;
}

/** Same-origin browsers cannot read archive.org downloads: the file host omits CORS.
 *  cors.archive.org echoes the page origin and streams the volume. */
export function pressUrl(work: PressWork, volume: PressVolume) {
  const item = pressItem(work, volume);
  return `https://cors.archive.org/cors/${item}/${encodeURI(volume.file)}`;
}

/** The bytes of one volume. A cancelled opening stops the download. */
export async function fetchPress(url: string, onProgress?: (got: number, total: number) => void): Promise<ArrayBuffer> {
  const response = await fetch(url);
  checkpoint();
  if (!response.ok) throw new Error("That volume could not be fetched.");
  const total = Number(response.headers.get("content-length") || 0);
  if (!response.body) return response.arrayBuffer();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let got = 0;
  for (;;) {
    const step = await reader.read();
    checkpoint();
    if (step.done) break;
    chunks.push(step.value);
    got += step.value.byteLength;
    onProgress?.(got, total);
  }
  const bytes = new Uint8Array(got);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.byteLength;
  }
  return bytes.buffer;
}
