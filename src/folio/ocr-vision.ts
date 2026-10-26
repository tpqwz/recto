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

type GpuNavigator = Navigator & { gpu?: { requestAdapter: () => Promise<unknown> } };

let pending: Promise<VisionRuntime> | null = null;

export function graphicsChip() {
  const gpu = (navigator as GpuNavigator).gpu;
  if (!gpu?.requestAdapter) return Promise.resolve(false);
  return gpu
    .requestAdapter()
    .then((adapter) => Boolean(adapter))
    .catch(() => false);
}

export function loadVision(onStatus?: (s: string) => void) {
  if (!pending) {
    onStatus?.("Fetching the vision model");
    pending = (async () => {
      const { env, Florence2ForConditionalGeneration, AutoProcessor, RawImage } = await import("@huggingface/transformers");
      env.allowLocalModels = false;
      const model = await Florence2ForConditionalGeneration.from_pretrained(MODEL, {
        device: "webgpu",
        dtype: {
          embed_tokens: "fp16",
          vision_encoder: "fp16",
          encoder_model: "q4",
          decoder_model_merged: "q4",
        },
      });
      const processor = (await AutoProcessor.from_pretrained(MODEL)) as unknown as VisionProcessor;
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
    })().catch((err: unknown) => {
      pending = null;
      const detail = err instanceof Error ? err.message : "The vision model did not start.";
      throw new Error(detail);
    });
  }
  return pending;
}
