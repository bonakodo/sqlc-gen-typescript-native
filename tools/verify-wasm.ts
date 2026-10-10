import { readFile, writeFile } from "node:fs/promises";
// Check the built module itself, including changes made by the optimizer.
import assert from "node:assert/strict";
import { basename } from "node:path";

const [binaryPath, textPath, outputPath] = process.argv.slice(2);
assert(
  binaryPath && textPath && outputPath,
  "Expected binary, WAT, and output paths",
);
const bytes = await readFile(binaryPath);
const module = new WebAssembly.Module(bytes);
assert.deepEqual(
  WebAssembly.Module.imports(module)
    .map(({ module, name, kind }) => [module, name, kind])
    .sort(),
  ["args_get", "args_sizes_get", "fd_read", "fd_write", "proc_exit"]
    .map((name) => ["wasi_snapshot_preview1", name, "function"])
    .sort(),
  "Only WASI argument, byte-I/O, and exit imports are allowed",
);
assert.deepEqual(
  WebAssembly.Module.exports(module)
    .map(({ name, kind }) => [name, kind])
    .sort(),
  [
    ["_start", "function"],
    ["memory", "memory"],
  ],
);
assert.doesNotMatch(
  await readFile(textPath, "utf8"),
  /\bmemory\.grow\b/,
  "Memory must not grow",
);

let cursor = 8;
function uint(): number {
  let value = 0,
    shift = 0;
  for (;;) {
    assert(cursor < bytes.length && shift < 35, "Malformed WASM integer");
    const byte = bytes[cursor++];
    value += (byte & 127) * 2 ** shift;
    if (!(byte & 128)) return value;
    shift += 7;
  }
}
let memories = 0;
while (cursor < bytes.length) {
  const id = bytes[cursor++],
    size = uint(),
    end = cursor + size;
  assert(end <= bytes.length, "Malformed WASM section");
  if (id === 5) {
    assert.deepEqual(uint(), 1, "The module must own one memory");
    assert.deepEqual(uint(), 1, "Memory must have a fixed explicit maximum");
    assert.deepEqual(uint(), 1024, "Initial memory must be 64 MiB");
    assert.deepEqual(uint(), 1024, "Maximum memory must be 64 MiB");
    assert.deepEqual(cursor, end);
    memories++;
  }
  cursor = end;
}
assert.deepEqual(memories, 1, "The module must define its memory");
const hash = new Uint8Array(
  await crypto.subtle.digest("SHA-256", bytes),
).toHex();
await writeFile(`${binaryPath}.sha256`, `${hash}  ${basename(outputPath)}\n`);
console.log(
  `WASM: ${bytes.length.toLocaleString("en-US")} bytes; SHA-256: ${hash}`,
);
