// Check the built module itself, including changes made by the optimizer.
import { assert, assertEquals, assertNotMatch } from "@std/assert";
import { basename } from "@std/path";

const [binaryPath, textPath, outputPath] = Deno.args;
assert(
  binaryPath && textPath && outputPath,
  "Expected binary, WAT, and output paths",
);
const bytes = await Deno.readFile(binaryPath);
const module = new WebAssembly.Module(bytes);
assertEquals(
  WebAssembly.Module.imports(module).map((
    { module, name, kind },
  ) => [module, name, kind]).sort(),
  ["args_get", "args_sizes_get", "fd_read", "fd_write", "proc_exit"]
    .map((name) => ["wasi_snapshot_preview1", name, "function"]).sort(),
  "Only WASI argument, byte-I/O, and exit imports are allowed",
);
assertEquals(
  WebAssembly.Module.exports(module).map(({ name, kind }) => [name, kind])
    .sort(),
  [["_start", "function"], ["memory", "memory"]],
);
assertNotMatch(
  await Deno.readTextFile(textPath),
  /\bmemory\.grow\b/,
  "Memory must not grow",
);

let cursor = 8;
function uint(): number {
  let value = 0, shift = 0;
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
  const id = bytes[cursor++], size = uint(), end = cursor + size;
  assert(end <= bytes.length, "Malformed WASM section");
  if (id === 5) {
    assertEquals(uint(), 1, "The module must own one memory");
    assertEquals(uint(), 1, "Memory must have a fixed explicit maximum");
    assertEquals(uint(), 1024, "Initial memory must be 64 MiB");
    assertEquals(uint(), 1024, "Maximum memory must be 64 MiB");
    assertEquals(cursor, end);
    memories++;
  }
  cursor = end;
}
assertEquals(memories, 1, "The module must define its memory");
const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))
  .toHex();
await Deno.writeTextFile(
  `${binaryPath}.sha256`,
  `${hash}  ${basename(outputPath)}\n`,
);
console.log(
  `WASM: ${bytes.length.toLocaleString("en-US")} bytes; SHA-256: ${hash}`,
);
