import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryPlatform } from "../platform/memory";

let setPlatform: typeof import("../platform/platform").setPlatform;
let thumbnail: typeof import("../services/extract").thumbnail;

const pdfjs = vi.hoisted(() => ({
  getDocument: vi.fn(),
  GlobalWorkerOptions: { workerSrc: "" },
}));

vi.mock("pdfjs-dist", () => pdfjs);

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

async function waitFor(check: () => boolean) {
  for (let attempt = 0; attempt < 100 && !check(); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  expect(check()).toBe(true);
}

async function settles<T>(promise: Promise<T>) {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("thumbnail did not stop after abort")), 500)),
  ]);
}

function canvasStub() {
  const context = { drawImage: vi.fn(), fillRect: vi.fn(), fillStyle: "" };
  const canvas = {
    width: 0,
    height: 0,
    getContext: vi.fn(() => context),
    toBlob: vi.fn((callback: BlobCallback) => callback(new Blob(["jpeg"], { type: "image/jpeg" }))),
    toDataURL: vi.fn(() => "data:image/jpeg;base64,b2xk"),
  };
  return { canvas, context };
}

class TestFileReader {
  result: string | ArrayBuffer | null = null;
  error: DOMException | null = null;
  onloadend: ((this: FileReader, ev: ProgressEvent<FileReader>) => unknown) | null = null;
  abort = vi.fn();

  readAsDataURL() {
    this.result = "data:image/jpeg;base64,anBlZw==";
    queueMicrotask(() => this.onloadend?.call(this as unknown as FileReader, {} as ProgressEvent<FileReader>));
  }
}

beforeEach(async () => {
  vi.resetModules();
  ({ setPlatform } = await import("../platform/platform"));
  ({ thumbnail } = await import("../services/extract"));
  const platform = new MemoryPlatform("{}");
  await platform.writeBytes("/file.pdf", new Uint8Array([1, 2, 3]));
  await platform.writeBytes("/file.jpg", new Uint8Array([4, 5, 6]));
  setPlatform(platform);
  pdfjs.getDocument.mockReset();
  const { canvas } = canvasStub();
  vi.stubGlobal("document", { createElement: vi.fn(() => canvas) });
  vi.stubGlobal("FileReader", TestFileReader);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("thumbnail cancellation", () => {
  it("destroys a PDF loading task and settles when the request is aborted", async () => {
    const loading = deferred<never>();
    const task = {
      promise: loading.promise,
      destroy: vi.fn(async () => loading.reject(new Error("loading cancelled"))),
    };
    pdfjs.getDocument.mockReturnValue(task);
    const controller = new AbortController();

    const result = thumbnail("/file.pdf", 120, controller.signal);
    await waitFor(() => pdfjs.getDocument.mock.calls.length === 1);
    controller.abort();

    await expect(settles(result)).resolves.toBeNull();
    expect(task.destroy).toHaveBeenCalledOnce();
  });

  it("cancels an active PDF render and never starts JPEG encoding", async () => {
    const rendering = deferred<never>();
    const renderTask = {
      promise: rendering.promise,
      cancel: vi.fn(() => rendering.reject(new Error("render cancelled"))),
    };
    const page = {
      getViewport: vi.fn(() => ({ width: 600, height: 800 })),
      render: vi.fn(() => renderTask),
    };
    const doc = { getPage: vi.fn(async () => page) };
    const loadingTask = { promise: Promise.resolve(doc), destroy: vi.fn(async () => undefined) };
    pdfjs.getDocument.mockReturnValue(loadingTask);
    const { canvas } = canvasStub();
    vi.stubGlobal("document", { createElement: vi.fn(() => canvas) });
    const controller = new AbortController();

    const result = thumbnail("/file.pdf", 120, controller.signal);
    await waitFor(() => page.render.mock.calls.length === 1);
    expect(pdfjs.getDocument).toHaveBeenCalledWith(expect.objectContaining({ isOffscreenCanvasSupported: false }));
    expect(canvas.getContext).toHaveBeenCalledWith("2d", { willReadFrequently: true });
    controller.abort();

    await expect(settles(result)).resolves.toBeNull();
    expect(renderTask.cancel).toHaveBeenCalledOnce();
    expect(loadingTask.destroy).toHaveBeenCalledOnce();
    expect(canvas.toBlob).not.toHaveBeenCalled();
    expect(canvas.toDataURL).not.toHaveBeenCalled();
  });

  it("drops an aborted queued request without reading its file and leaves the queue reusable", async () => {
    const decodes = [
      deferred<{ width: number; height: number; close: ReturnType<typeof vi.fn> }>(),
      deferred<{ width: number; height: number; close: ReturnType<typeof vi.fn> }>(),
    ];
    const bitmaps = decodes.map(() => ({ width: 240, height: 320, close: vi.fn() }));
    const decode = vi.fn()
      .mockReturnValueOnce(decodes[0].promise)
      .mockReturnValueOnce(decodes[1].promise);
    vi.stubGlobal("createImageBitmap", decode);
    const platform = new MemoryPlatform("{}");
    await platform.writeBytes("/first.jpg", new Uint8Array([1]));
    await platform.writeBytes("/second.jpg", new Uint8Array([2]));
    await platform.writeBytes("/queued.jpg", new Uint8Array([3]));
    setPlatform(platform);
    const readBytes = vi.spyOn(platform, "readBytes");
    const firstController = new AbortController();
    const secondController = new AbortController();
    const queuedController = new AbortController();
    const first = thumbnail("/first.jpg", 120, firstController.signal);
    const second = thumbnail("/second.jpg", 120, secondController.signal);
    await waitFor(() => decode.mock.calls.length === 2);

    const queued = thumbnail("/queued.jpg", 120, queuedController.signal);
    queuedController.abort();

    await expect(settles(queued)).resolves.toBeNull();
    expect(readBytes).not.toHaveBeenCalledWith("/queued.jpg");

    firstController.abort();
    secondController.abort();
    decodes[0].resolve(bitmaps[0]);
    decodes[1].resolve(bitmaps[1]);
    await expect(settles(first)).resolves.toBeNull();
    await expect(settles(second)).resolves.toBeNull();
    expect(bitmaps.every((bitmap) => bitmap.close.mock.calls.length === 1)).toBe(true);

    const retryBitmap = { width: 240, height: 320, close: vi.fn() };
    decode.mockResolvedValueOnce(retryBitmap);
    await expect(thumbnail("/queued.jpg", 120, new AbortController().signal)).resolves.toMatch(/^data:image\/jpeg/);
    expect(readBytes).toHaveBeenCalledWith("/queued.jpg");
    expect(retryBitmap.close).toHaveBeenCalledOnce();
  });

  it("closes an image bitmap that finishes decoding after cancellation", async () => {
    const decoded = deferred<{ width: number; height: number; close: ReturnType<typeof vi.fn> }>();
    const bitmap = { width: 240, height: 320, close: vi.fn() };
    vi.stubGlobal("createImageBitmap", vi.fn(() => decoded.promise));
    const { canvas } = canvasStub();
    vi.stubGlobal("document", { createElement: vi.fn(() => canvas) });
    const controller = new AbortController();

    const result = thumbnail("/file.jpg", 120, controller.signal);
    await waitFor(() => vi.mocked(createImageBitmap).mock.calls.length === 1);
    controller.abort();
    decoded.resolve(bitmap);

    await expect(settles(result)).resolves.toBeNull();
    expect(bitmap.close).toHaveBeenCalledOnce();
    expect(canvas.toBlob).not.toHaveBeenCalled();
    expect(canvas.toDataURL).not.toHaveBeenCalled();
  });
});
