import { Buffer } from "node:buffer";
import { command, wabt } from "./test_helpers.ts";
import assert from "node:assert/strict";
import { join } from "node:path";

Deno.test("WAT core", async (t) => {
  interface Exports {
    memory: WebAssembly.Memory;
    field: (
      a0: number,
      a1: number,
    ) => [number, number, number, bigint, number, number];
    find: (a0: number, a1: number, a2: number) => [number, number];
    read_input: () => number;
    utf8: (a0: number, a1: number) => void;
    varint: (a0: number, a1: number) => [number, bigint];
    write_all: (a0: number, a1: number, a2: number) => void;
  }
  // Tests for the hand-written WASI/protobuf core.
  // Run: deno test -A tests/wasm/core_test.ts --

  const source = await Deno.readTextFile(
    new URL("../../src/core.wat", import.meta.url),
  );
  const directory = await Deno.makeTempDir({ prefix: "sqlc-wat-core-" });
  let module: WebAssembly.Module;
  try {
    await Deno.writeTextFile(
      join(directory, "core.wat"),
      `(module\n${source}\n
    (export "varint" (func $varint))
    (export "field" (func $field))
    (export "find" (func $find))
    (export "utf8" (func $utf8))
    (export "read_input" (func $read_input))
    (export "write_all" (func $write_all))
  )\n`,
    );
    const compile = await command(wabt("wat2wasm"), [
      join(directory, "core.wat"),
      "-o",
      join(directory, "core.wasm"),
    ], { encoding: "utf8" });
    assert.equal(compile.status, 0, `WAT did not compile:\n${compile.stderr}`);
    const binary = await Deno.readFile(join(directory, "core.wasm"));
    const decode = await command(wabt("wasm2wat"), [
      join(directory, "core.wasm"),
    ], { encoding: "utf8" });
    assert.equal(decode.status, 0, decode.stderr);
    assert.doesNotMatch(
      decode.stdout,
      /\bmemory\.grow\b/,
      "The core must never grow memory",
    );
    const memories = [
      ...decode.stdout.matchAll(/\(memory(?:\s+\(;\d+;\))?\s+(\d+)\s+(\d+)\)/g),
    ];
    assert.equal(
      memories.length,
      1,
      "Declare one fixed-size memory with an explicit maximum",
    );
    assert.equal(
      memories[0][1],
      memories[0][2],
      "Memory initial and maximum sizes must match",
    );
    module = await WebAssembly.compile(binary);
    assert.deepEqual(
      WebAssembly.Module.imports(module).map((
        { module, name, kind },
      ) => [module, name, kind]).sort(),
      [
        ["wasi_snapshot_preview1", "fd_read", "function"],
        ["wasi_snapshot_preview1", "fd_write", "function"],
        ["wasi_snapshot_preview1", "proc_exit", "function"],
      ].sort(),
      "Only WASI byte transport and exit may come from the host",
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }

  class Exit extends Error {
    constructor(readonly code: number) {
      super(`WASI exit ${code}`);
    }
  }

  // A deliberately small host implementation exposes short reads and writes.
  // It reads every iovec from the guest's actual memory, so bogus pointers fail.
  function host(
    {
      input = Buffer.alloc(0),
      readChunk = Infinity,
      writeChunk = Infinity,
      readErrno = 0,
      writeErrno = 0,
    } = {},
  ) {
    let consumed = 0;
    const output: Buffer[][] = [[], [], []];
    const imports = {
      wasi_snapshot_preview1: {
        proc_exit(code: number) {
          throw new Exit(code);
        },
        fd_read(fd: number, iovs: number, count: number, result: number) {
          if (readErrno) return readErrno;
          assert.equal(fd, 0);
          const view = new DataView(
            (instance.exports.memory as WebAssembly.Memory).buffer,
          );
          let amount = 0;
          for (let i = 0; i < count && amount < readChunk; i++) {
            const pointer = view.getUint32(iovs + 8 * i, true);
            const length = view.getUint32(iovs + 8 * i + 4, true);
            const take = Math.min(
              length,
              input.length - consumed,
              readChunk - amount,
            );
            new Uint8Array(view.buffer, pointer, take).set(
              input.subarray(consumed, consumed + take),
            );
            consumed += take;
            amount += take;
          }
          view.setUint32(result, amount, true);
          return 0;
        },
        fd_write(fd: number, iovs: number, count: number, result: number) {
          // Keep error reporting usable when stdout itself is broken.
          if (writeErrno && fd === 1) return writeErrno;
          const view = new DataView(
            (instance.exports.memory as WebAssembly.Memory).buffer,
          );
          let amount = 0;
          for (
            let i = 0;
            i < count && amount < (fd === 2 ? Infinity : writeChunk);
            i++
          ) {
            const pointer = view.getUint32(iovs + 8 * i, true);
            const length = view.getUint32(iovs + 8 * i + 4, true);
            const take = Math.min(
              length,
              (fd === 2 ? Infinity : writeChunk) - amount,
            );
            output[fd].push(
              Buffer.from(new Uint8Array(view.buffer, pointer, take)),
            );
            amount += take;
          }
          view.setUint32(result, amount, true);
          return 0;
        },
      },
    };
    const instance: WebAssembly.Instance = new WebAssembly.Instance(
      module,
      imports,
    );
    return {
      api: instance.exports as unknown as Exports,
      bytes: new Uint8Array(
        (instance.exports.memory as WebAssembly.Memory).buffer,
      ),
      output: (fd: number) => Buffer.concat(output[fd]),
      consumed: () => consumed,
    };
  }

  const base = 33554432;
  const inputCapacity = 16777216;
  async function test(name: string, fn: () => void) {
    await t.step(name, fn);
  }
  function rejected(fn: () => unknown, h: ReturnType<typeof host>) {
    assert.throws(
      fn,
      (error) => error instanceof Exit && error.code === 2,
      "Bad input must exit 2, without a Wasm trap",
    );
    assert.equal(
      h.output(1).length,
      0,
      "Do not write a partial response on failure",
    );
    assert.ok(h.output(2).length > 0, "Failure must have a diagnostic");
  }
  function withBytes(data: ArrayLike<number>) {
    const h = host();
    h.bytes.set(data, base);
    return h;
  }
  function varint(input: number | bigint) {
    let value = BigInt(input);
    const bytes = [];
    value = BigInt(value);
    do {
      let byte = Number(value & 127n);
      value >>= 7n;
      if (value) byte |= 128;
      bytes.push(byte);
    } while (value);
    return bytes;
  }
  const tag = (number: number, wire: number) =>
    varint(BigInt(number) * 8n + BigInt(wire));
  const lengthField = (
    number: number,
    bytes: readonly number[] | Uint8Array,
  ) => [...tag(number, 2), ...varint(bytes.length), ...bytes];

  await test("varints preserve the full unsigned 64-bit range", () => {
    for (
      const value of [
        0n,
        1n,
        127n,
        128n,
        16383n,
        16384n,
        (1n << 32n) - 1n,
        1n << 32n,
        1n << 63n,
        (1n << 64n) - 1n,
      ] as const
    ) {
      const bytes = varint(value), h = withBytes(bytes);
      const [next, actual] = h.api.varint(base, base + bytes.length);
      assert.equal(next, base + bytes.length);
      assert.equal(BigInt.asUintN(64, actual), value);
    }
  });
  await test("non-minimal but legal varints remain accepted", () => {
    const h = withBytes([0x80, 0]);
    assert.deepEqual(h.api.varint(base, base + 2), [base + 2, 0n]);
  });
  await test("truncated and overflowing varints fail cleanly", () => {
    for (
      const bytes of [[], [0x80], Array(10).fill(0x80), [
        ...Array(9).fill(0xff),
        2,
      ], [...Array(10).fill(0xff), 0]] as const
    ) {
      const h = withBytes(bytes);
      rejected(() => h.api.varint(base, base + bytes.length), h);
    }
  });
  await test("scalar fields expose varints and skip fixed-width unknown fields", () => {
    for (
      const [number, wire, payload, value] of [
        [1, 0, varint(150), 150n],
        [536870911, 0, varint((1n << 64n) - 1n), (1n << 64n) - 1n],
        [21, 1, [8, 7, 6, 5, 4, 3, 2, 1], 0n],
        [22, 5, [4, 3, 2, 1], 0n],
      ] as const
    ) {
      const bytes = [...tag(number, wire), ...payload], h = withBytes(bytes);
      const result = h.api.field(base, base + bytes.length);
      assert.equal(result[0], base + bytes.length);
      assert.equal(result[1], number);
      assert.equal(result[2], wire);
      assert.equal(BigInt.asUintN(64, result[3]), value);
    }
  });
  await test("length-delimited fields borrow input bytes without changing them", () => {
    for (
      const bytes of [[], [0, 255, 34], [...Buffer.from("日本語")]] as const
    ) {
      const wire = lengthField(5, bytes), h = withBytes(wire);
      const [next, number, kind, , pointer, length] = h.api.field(
        base,
        base + wire.length,
      );
      assert.equal(next, base + wire.length);
      assert.equal(number, 5);
      assert.equal(kind, 2);
      assert.equal(length, bytes.length);
      assert.deepEqual([...h.bytes.subarray(pointer, pointer + length)], bytes);
      assert.deepEqual([...h.bytes.subarray(base, base + wire.length)], wire);
    }
  });
  await test("invalid tags, wire types, lengths, and fixed scalars fail", () => {
    const bad = [
      [0],
      [1],
      [6],
      [7],
      [12],
      [...tag(536870912, 0), 0],
      [8, 128],
      [9, 1, 2],
      [13, 1, 2],
      [10, 3, 1],
      [10, ...varint(1n << 32n)],
    ];
    for (const bytes of bad) {
      const h = withBytes(bytes);
      rejected(() => h.api.field(base, base + bytes.length), h);
    }
  });
  await test("find returns the last matching byte field and ignores other wire types", () => {
    const bytes = [
      ...lengthField(5, [1, 2]),
      ...tag(5, 0),
      42,
      ...lengthField(6, [9]),
      ...lengthField(5, [3, 4, 5]),
    ];
    const h = withBytes(bytes);
    const [pointer, length] = h.api.find(base, bytes.length, 5);
    assert.deepEqual([...h.bytes.subarray(pointer, pointer + length)], [
      3,
      4,
      5,
    ]);
    assert.deepEqual(h.api.find(base, bytes.length, 7), [0, 0]);
  });
  await test("unknown groups require matching closing tags", () => {
    const valid = [...tag(100, 3), ...tag(2, 0), 7, ...tag(100, 4)];
    const h = withBytes(valid);
    assert.equal(
      h.api.field(base, base + valid.length)[0],
      base + valid.length,
    );
    for (
      const bytes of [[...tag(100, 3)], [
        ...tag(100, 3),
        ...tag(99, 4),
      ]] as const
    ) {
      const bad = withBytes(bytes);
      rejected(() => bad.api.field(base, base + bytes.length), bad);
    }
  });
  await test("unknown groups honor the 100-level protobuf message budget", () => {
    for (const depth of [99, 100] as const) {
      const bytes = [
        ...Array.from({ length: depth }, () => tag(100, 3)).flat(),
        ...Array.from({ length: depth }, () => tag(100, 4)).flat(),
      ];
      const h = withBytes(bytes);
      if (depth < 100) {
        assert.equal(
          h.api.field(base, base + bytes.length)[0],
          base + bytes.length,
        );
      } else rejected(() => h.api.field(base, base + bytes.length), h);
    }
  });

  await test("UTF-8 accepts Unicode scalar boundaries and rejects invalid encodings", () => {
    const valid = [
      [],
      [0],
      [127],
      [0xc2, 0x80],
      [0xdf, 0xbf],
      [0xe0, 0xa0, 0x80],
      [0xed, 0x9f, 0xbf],
      [0xee, 0x80, 0x80],
      [0xf0, 0x90, 0x80, 0x80],
      [0xf4, 0x8f, 0xbf, 0xbf],
      [...Buffer.from("abc 日本語 😀")],
    ];
    const invalid = [
      [0x80],
      [0xc0, 0x80],
      [0xc1, 0xbf],
      [0xc2],
      [0xe0, 0x9f, 0xbf],
      [0xed, 0xa0, 0x80],
      [0xf0, 0x8f, 0xbf, 0xbf],
      [0xf4, 0x90, 0x80, 0x80],
      [0xf5, 0x80, 0x80, 0x80],
      [0xff],
      [0xe2, 0x28, 0xa1],
    ];
    for (const bytes of valid) {
      const h = withBytes(bytes);
      h.api.utf8(base, bytes.length);
    }
    for (const bytes of invalid) {
      const h = withBytes(bytes);
      rejected(() => h.api.utf8(base, bytes.length), h);
    }
  });
  await test("input reads handle EOF and short reads", () => {
    for (const length of [0, 1, 31, 65537] as const) {
      const input = Buffer.from(Array.from({ length }, (_, i) => i % 251));
      const h = host({ input, readChunk: 17 });
      assert.equal(h.api.read_input(), input.length);
      assert.equal(h.consumed(), input.length);
      assert.deepEqual(
        Buffer.from(h.bytes.subarray(base, base + length)),
        input,
      );
    }
  });
  await test("input exhaustion and host I/O failures produce errors instead of traps", () => {
    const empty = host({ readErrno: 29 });
    rejected(() => empty.api.read_input(), empty);
    const h = host({ input: Buffer.alloc(inputCapacity + 1, 65) });
    const originalSize = h.bytes.length;
    rejected(() => h.api.read_input(), h);
    assert.equal(h.api.memory.buffer.byteLength, originalSize);
  });
  await test("an input that exactly fills the fixed buffer is accepted", () => {
    const input = Buffer.alloc(inputCapacity, 65);
    const h = host({ input });
    assert.equal(h.api.read_input(), inputCapacity);
    assert.equal(h.consumed(), inputCapacity);
    assert.equal(h.bytes[base + inputCapacity - 1], 65);
  });
  await test("output retries short writes, including an empty output", () => {
    const bytes = Buffer.from("a complete byte stream 日本語");
    for (const writeChunk of [1, 7, 1024] as const) {
      const h = host({ writeChunk });
      h.bytes.set(bytes, base);
      h.api.write_all(1, base, 0);
      h.api.write_all(1, base, bytes.length);
      assert.deepEqual(h.output(1), bytes);
    }
  });
  await test("zero-progress writes and host write errors terminate cleanly", () => {
    for (const options of [{ writeChunk: 0 }, { writeErrno: 29 }] as const) {
      const h = host(options);
      rejected(() => h.api.write_all(1, base, 1), h);
    }
  });

  // Compare arbitrary UTF-8 byte strings with the platform's strict decoder.
  // The PRNG is fixed so failures reproduce without a saved random seed.
  await test("3,000 deterministic UTF-8 cases match the strict platform decoder", () => {
    let state = 0x68f9a137;
    const random = () => {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      return state >>> 0;
    };
    const decoder = new TextDecoder("utf-8", { fatal: true });
    const h = host();
    for (let i = 0; i < 3000; i++) {
      const bytes = Uint8Array.from({ length: random() % 24 }, random);
      let valid = true;
      try {
        decoder.decode(bytes);
      } catch {
        valid = false;
      }
      h.bytes.set(bytes, base);
      if (valid) h.api.utf8(base, bytes.length);
      else rejected(() => h.api.utf8(base, bytes.length), h);
    }
  });

  // This small reference reader is test code, not code embedded into Wasm.
  // Compare the parser's acceptance and cursor with independent arithmetic.
  await test("4,000 deterministic wire cases match an independent reader", () => {
    let state = 0x45b1f337;
    const random = () => {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      return state >>> 0;
    };
    function reference(bytes: Uint8Array) {
      let p = 0;
      function readVarint() {
        let value = 0n;
        for (let i = 0; i < 10; i++) {
          if (p >= bytes.length) throw new Error("truncated");
          const byte = bytes[p++];
          if (i === 9 && byte > 1) throw new Error("overflow");
          value |= BigInt(byte & 127) << BigInt(i * 7);
          if (byte < 128) return value;
        }
        throw new Error("overflow");
      }
      function readTag() {
        const value = readVarint();
        if (value > 0xffffffffn || value < 8n) throw new Error("tag");
        return [Number(value >> 3n), Number(value & 7n)];
      }
      function skip(number: number, wire: number, depth: number) {
        if (wire === 0) {
          readVarint();
          return;
        }
        if (wire === 3) {
          if (depth >= 100) throw new Error("depth");
          for (;;) {
            const [inner, kind] = readTag();
            if (kind === 4) {
              if (inner !== number) throw new Error("group");
              return;
            }
            skip(inner, kind, depth + 1);
          }
        }
        const size = wire === 1
          ? 8n
          : wire === 5
          ? 4n
          : wire === 2
          ? readVarint()
          : -1n;
        if (size < 0n || size > BigInt(bytes.length - p)) {
          throw new Error("length");
        }
        p += Number(size);
      }
      const [number, wire] = readTag();
      skip(number, wire, 1);
      return p;
    }
    const h = host();
    for (let i = 0; i < 4000; i++) {
      let bytes;
      if (i % 2 === 0) {
        bytes = Uint8Array.from({ length: random() % 48 }, random);
      } else {
        const payload = Uint8Array.from({ length: random() % 30 }, random);
        bytes = Uint8Array.from(lengthField(1 + random() % 100000, payload));
        if (i % 3 === 0) bytes[random() % bytes.length] = random();
      }
      let expected;
      try {
        expected = reference(bytes);
      } catch {
        expected = null;
      }
      h.bytes.set(bytes, base);
      if (expected === null) {
        rejected(() => h.api.field(base, base + bytes.length), h);
      } else {assert.equal(
          h.api.field(base, base + bytes.length)[0],
          base + expected,
          `wire case ${i}: ${Buffer.from(bytes).toString("hex")}`,
        );}
    }
  });
});
