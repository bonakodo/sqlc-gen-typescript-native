import { Buffer } from "node:buffer";
// Shared WASI test host. Any unexpected exception (including a Wasm trap)
// escapes to the runner. Only the guest's explicit proc_exit sets exit status.
import assert from "node:assert/strict";
const MEMORY_BYTES = 64 * 1024 * 1024;

class Exit extends Error {
  constructor(readonly status: number) {
    super(`guest exit ${status}`);
  }
}

// Each request gets a fresh instance, as a sqlc process invocation does. The
// host copies writes immediately because the guest may reuse its memory later.
export async function runPlugin(
  module: WebAssembly.Module,
  request: Uint8Array,
  args: string[] = [],
  io: IOOptions = {},
) {
  let inputOffset = 0,
    ioCalls = 0,
    outputBytes = 0;
  const stdout: Buffer[] = [], stderr: Buffer[] = [];
  const argv = ["sqlc-gen-typescript-native", ...args].map((s) =>
    Buffer.from(`${s}\0`)
  );
  const readChunk = io.readChunk ?? 65521, writeChunk = io.writeChunk ?? 65519;
  function tick() {
    assert.ok(++ioCalls <= 100000, "guest made too many I/O calls");
  }
  function range(p: number, n: number) {
    p >>>= 0;
    n >>>= 0;
    assert.ok(
      p + n <=
        (instance.exports.memory as WebAssembly.Memory).buffer.byteLength,
      "guest I/O outside memory",
    );
    return new Uint8Array(
      (instance.exports.memory as WebAssembly.Memory).buffer,
      p,
      n,
    );
  }
  function get32(p: number) {
    range(p, 4);
    return new DataView((instance.exports.memory as WebAssembly.Memory).buffer)
      .getUint32(p >>> 0, true);
  }
  function put32(p: number, n: number) {
    range(p, 4);
    new DataView((instance.exports.memory as WebAssembly.Memory).buffer)
      .setUint32(p >>> 0, n, true);
  }
  const imports = {
    args_sizes_get(argc: number, bytes: number) {
      if (io.argsSizeError) return 29;
      if (io.argc !== undefined) {
        put32(argc, io.argc);
        put32(bytes, io.argBytes ?? 0);
        return 0;
      }
      put32(argc, argv.length);
      put32(bytes, argv.reduce((n, b) => n + b.length, 0));
      return 0;
    },
    args_get(pointers: number, bytes: number) {
      if (io.argsGetError) return 29;
      for (const [i, arg] of argv.entries()) {
        put32(pointers + i * 4, bytes);
        range(bytes, arg.length).set(arg);
        bytes += arg.length;
      }
      if (io.methodPointer !== undefined) put32(pointers + 4, io.methodPointer);
      if (io.unterminatedMethod) range(bytes - 1, 1)[0] = 65;
      return 0;
    },
    fd_read(fd: number, vectors: number, count: number, result: number) {
      tick();
      assert.equal(fd, 0, "guest read descriptor");
      if (io.readError) return 29;
      let total = 0;
      for (let i = 0; i < count && total < readChunk; i++) {
        const p = get32(vectors + i * 8), n = get32(vectors + i * 8 + 4);
        range(p, n);
        const copied = Math.min(
          n,
          readChunk - total,
          request.length - inputOffset,
        );
        range(p, copied).set(
          request.subarray(inputOffset, inputOffset + copied),
        );
        inputOffset += copied;
        total += copied;
        if (copied < n) break;
      }
      put32(result, io.readOverreport ? 0xffffffff : total);
      return 0;
    },
    fd_write(fd: number, vectors: number, count: number, result: number) {
      tick();
      assert.ok(fd === 1 || fd === 2, "guest write descriptor");
      if ((fd === 1 && io.stdoutError) || (fd === 2 && io.stderrError)) {
        return 29;
      }
      if ((fd === 1 && io.stdoutZero) || (fd === 2 && io.stderrZero)) {
        put32(result, 0);
        return 0;
      }
      if (
        (fd === 1 && io.stdoutOverreport) || (fd === 2 && io.stderrOverreport)
      ) {
        put32(result, 0xffffffff);
        return 0;
      }
      let total = 0;
      for (let i = 0; i < count && total < writeChunk; i++) {
        const p = get32(vectors + i * 8), n = get32(vectors + i * 8 + 4);
        range(p, n);
        const copied = Math.min(n, writeChunk - total);
        outputBytes += copied;
        assert.ok(
          outputBytes <= MEMORY_BYTES,
          "guest output exceeded test host capacity",
        );
        (fd === 1 ? stdout : stderr).push(Buffer.from(range(p, copied)));
        total += copied;
        if (copied < n) break;
      }
      put32(result, total);
      return 0;
    },
    proc_exit(status: number) {
      throw new Exit(status);
    },
  };
  const instance: WebAssembly.Instance = await WebAssembly.instantiate(module, {
    wasi_snapshot_preview1: imports,
  });
  assert.equal(
    (instance.exports.memory as WebAssembly.Memory).buffer.byteLength,
    MEMORY_BYTES,
    "initial memory size",
  );
  let status = 0;
  try {
    (instance.exports._start as () => void)();
  } catch (error) {
    if (!(error instanceof Exit)) throw error;
    status = error.status;
  }
  assert.equal(
    (instance.exports.memory as WebAssembly.Memory).buffer.byteLength,
    MEMORY_BYTES,
    "memory changed during request",
  );
  return {
    status,
    stdout: Buffer.concat(stdout),
    stderr: Buffer.concat(stderr),
    ioCalls,
    inputBytes: inputOffset,
  };
}

export interface IOOptions {
  readChunk?: number;
  writeChunk?: number;
  argsSizeError?: boolean;
  argc?: number;
  argBytes?: number;
  argsGetError?: boolean;
  methodPointer?: number;
  unterminatedMethod?: boolean;
  readError?: boolean;
  readOverreport?: boolean;
  stdoutError?: boolean;
  stderrError?: boolean;
  stdoutZero?: boolean;
  stderrZero?: boolean;
  stdoutOverreport?: boolean;
  stderrOverreport?: boolean;
}
