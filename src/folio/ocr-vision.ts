import { linesFromRegion } from "./picture.ts";

const MODEL = "onnx-community/Florence-2-base-ft";
const TASK = "<OCR_WITH_REGION>";

type VisionProcessor = {
  construct_prompts: (text: string) => string[];
  (image: unknown, prompts: string[]): Promise<Record<string, unknown>>;
  batch_decode: (ids: unknown, options: { skip_special_tokens: boolean }) => string[];
  post_process_generation: (text: string, task: string, imageSize: [number, number]) => unknown;
};

type VisionRuntime = {
  read: (canvas: HTMLCanvasElement, page: number, pageW: number, pageH: number) => Promise<ReturnType<typeof linesFromRegion>>;
};

type GpuAdapter = { features?: { has: (feature: string) => boolean } };
type GpuNavigator = Navigator & {
  gpu?: {
    requestAdapter: (options?: { powerPreference?: "high-performance" | "low-power" }) => Promise<GpuAdapter | null>;
  };
};

let pending: Promise<VisionRuntime> | null = null;
let ready = false;
const listeners = new Set<(message: string) => void>();

function say(message: string) {
  for (const listener of listeners) listener(message);
}

function within<T>(work: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      },
    );
  });
}

/** A graphics chip, when this browser will hand one over. A slow or empty answer is not a chip. */
export async function graphicsChip() {
  return Boolean(await gpuAdapter());
}

async function gpuAdapter(): Promise<GpuAdapter | null> {
  const gpu = (navigator as GpuNavigator).gpu;
  if (!gpu?.requestAdapter) return null;
  const first = await within(gpu.requestAdapter(), 4000);
  if (first) return first;
  return within(gpu.requestAdapter({ powerPreference: "high-performance" }), 4000);
}

async function readRuntime(
  device: "webgpu" | "wasm",
  fp16: boolean,
  progress: (info: { status?: string; progress?: number }) => void,
): Promise<VisionRuntime> {
  const { env, Florence2ForConditionalGeneration, AutoProcessor, RawImage } = await import("@huggingface/transformers");
  env.allowLocalModels = false;
  const dtype =
    device === "wasm"
      ? "fp32"
      : {
          embed_tokens: fp16 ? "fp16" : "fp32",
          vision_encoder: fp16 ? "fp16" : "fp32",
          encoder_model: "q4",
          decoder_model_merged: "q4",
        };
  const model = await Florence2ForConditionalGeneration.from_pretrained(MODEL, {
    device,
    dtype,
    progress_callback: progress,
  });
  const processor = (await AutoProcessor.from_pretrained(MODEL, { progress_callback: progress })) as unknown as VisionProcessor;
  return {
    read: async (canvas: HTMLCanvasElement, page: number, pageW: number, pageH: number) => {
      const image = await RawImage.read(canvas);
      const prompts = processor.construct_prompts(TASK);
      const inputs = await processor(image, prompts);
      const generated = await model.generate({ ...inputs, max_new_tokens: 1536 });
      const decoded = processor.batch_decode(generated, { skip_special_tokens: false })[0] || "";
      const parsed = processor.post_process_generation(decoded, TASK, [image.height, image.width]);
      return linesFromRegion(parsed, page, pageW, pageH, image.width, image.height);
    },
  };
}

export function loadVision(onStatus?: (s: string) => void) {
  if (onStatus) listeners.add(onStatus);
  const stop = () => {
    if (onStatus) listeners.delete(onStatus);
  };
  if (ready && pending) {
    onStatus?.("The vision model is ready.");
    stop();
    return pending;
  }
  if (!pending) {
    let lastPercent = -1;
    const progress = (info: { status?: string; progress?: number }) => {
      if (typeof info.progress !== "number") return;
      if (info.status && info.status !== "progress") return;
      const percent = Math.max(0, Math.min(100, Math.round(info.progress)));
      if (percent === lastPercent) return;
      lastPercent = percent;
      say(`Fetching the vision model, ${percent}%`);
    };
    pending = (async () => {
      const adapter = await gpuAdapter();
      if (adapter) {
        const fp16 = Boolean(adapter.features?.has("shader-f16"));
        say(fp16 ? "Fetching the vision model" : "Fetching the vision model. This graphics chip needs full precision.");
        try {
          const runtime = await readRuntime("webgpu", fp16, progress);
          ready = true;
          say("The vision model is ready.");
          return runtime;
        } catch {
          lastPercent = -1;
          say("The graphics chip could not run the vision model. Fetching it for the processor.");
        }
      } else {
        say("No graphics chip answered. Fetching the vision model for the processor.");
      }
      const runtime = await readRuntime("wasm", false, progress);
      ready = true;
      say("The vision model is ready.");
      return runtime;
    })().catch((err: unknown) => {
      pending = null;
      ready = false;
      const detail = err instanceof Error ? err.message : "The vision model did not start.";
      throw new Error(detail);
    });
  }
  return pending.finally(() => stop());
}

/** Start the download as soon as the vision model is turned on. */
export function prefetchVision(onStatus?: (s: string) => void) {
  onStatus?.("Starting the vision model");
  return loadVision(onStatus);
}
