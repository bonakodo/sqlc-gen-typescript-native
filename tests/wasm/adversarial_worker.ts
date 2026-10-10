import { parentPort } from "node:worker_threads";
if (!parentPort) throw new Error("This module must run in a worker");
const port = parentPort;
// The parent owns the deadline, so it can stop an instruction-only Wasm loop.
import { type IOOptions, runPlugin } from "./wasi_test_host.ts";
import { errorMessage } from "./test_helpers.ts";

type Message =
  | { binary: Uint8Array }
  | {
      request: Uint8Array;
      args?: string[];
      io?: IOOptions;
    };
let module: WebAssembly.Module | undefined;
port.on("message", async (data: Message) => {
  try {
    if ("binary" in data) {
      module = await WebAssembly.compile(new Uint8Array(data.binary));
      port.postMessage({ ready: true });
    } else {
      if (!module) {
        throw new Error("Initialize the worker before sending requests");
      }
      port.postMessage({
        result: await runPlugin(module, data.request, data.args, data.io),
      });
    }
  } catch (error) {
    port.postMessage({
      error:
        error instanceof Error
          ? `${error.name}: ${error.message}`
          : errorMessage(error),
    });
  }
});
