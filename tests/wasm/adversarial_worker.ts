/// <reference lib="deno.worker" />
// The parent owns the deadline, so it can stop an instruction-only Wasm loop.
import { type IOOptions, runPlugin } from "./wasi_test_host.ts";
import { errorMessage } from "./test_helpers.ts";

type Message = { binary: Uint8Array } | {
  request: Uint8Array;
  args?: string[];
  io?: IOOptions;
};
let module: WebAssembly.Module | undefined;
self.onmessage = async ({ data }: MessageEvent<Message>) => {
  try {
    if ("binary" in data) {
      module = await WebAssembly.compile(new Uint8Array(data.binary));
      self.postMessage({ ready: true });
    } else {
      if (!module) {
        throw new Error("Initialize the worker before sending requests");
      }
      self.postMessage({
        result: await runPlugin(module, data.request, data.args, data.io),
      });
    }
  } catch (error) {
    self.postMessage({
      error: error instanceof Error
        ? `${error.name}: ${error.message}`
        : errorMessage(error),
    });
  }
};
