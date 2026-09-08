import { Buffer } from "node:buffer";
import { command, filenames, wabt } from "./test_helpers.ts";
import assert from "node:assert/strict";
import { join } from "node:path";

Deno.test("WAT protocol", async () => {
  interface Exports {
    memory: WebAssembly.Memory;
    child: (a0: number, a1: number) => number;
    next: (a0: number) => number;
    number: (a0: number, a1: number) => number;
    parse_type: (type: number, p: number, n: number) => number;
    pb_parse: (a0: number, a1: number) => number;
    present: (a0: number, a1: number) => number;
    record_count: { value: number };
    slot: (a0: number, a1: number) => number;
    text_end: { value: number };
    text_len: (a0: number, a1: number) => number;
    text_ptr: (a0: number, a1: number) => number;
  }
  // Independently decode protobuf and compare it with the WAT fixed record table.
  // Run: deno test -A tests/wasm/protocol_test.ts -- [captured-corpus-directory]

  const base = 33554432;
  const directory = await Deno.makeTempDir({ prefix: "sqlc-wat-protocol-" });
  let compiled;
  try {
    const fragments = await Promise.all(
      ["core.wat", "protocol.wat"].map((name) =>
        Deno.readTextFile(new URL(`../../src/${name}`, import.meta.url))
      ),
    );
    const source = `(module\n${fragments.join("\n")}\n
    (export "pb_parse" (func $pb_parse))
    (export "slot" (func $slot))
    (export "child" (func $child))
    (export "text_ptr" (func $text_ptr))
    (export "text_len" (func $text_len))
    (export "number" (func $number))
    (export "present" (func $present))
    (export "next" (func $next))
    (export "record_count" (global $pb_count))
    (export "text_end" (global $pb_text))
    (func (export "parse_type") (param $t i32) (param $p i32) (param $n i32) (result i32)
      (local $r i32)
      (global.set $pb_count (i32.const 0))
      (global.set $pb_text (local.get $p))
      (local.set $r (call $pb_record (local.get $t)))
      (call $pb_message (local.get $r) (local.get $p) (local.get $n) (i32.const 0))
      (local.get $r))
  )`;
    await Deno.writeTextFile(join(directory, "test.wat"), source);
    const result = await command(wabt("wat2wasm"), [
      join(directory, "test.wat"),
      "-o",
      join(directory, "test.wasm"),
    ], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    compiled = await WebAssembly.compile(
      await Deno.readFile(join(directory, "test.wasm")),
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }

  // Schema table copied from codegen.proto, without reading the WAT descriptors.
  // s=string, b=bytes, v=bool, i=int32; arrays denote repeated fields.
  type Kind = "s" | "b" | "v" | "i" | number;
  type FieldValue = string | number | boolean | Message;
  interface Message {
    type: number;
    [field: number]: FieldValue | FieldValue[];
  }
  const schemas: Record<number, Record<number, Kind | [Kind]>> = {
    1: { 1: "s", 2: "b" },
    2: { 1: "s", 2: "s", 3: ["s"], 4: ["s"], 12: 3 },
    3: { 1: "s", 2: "s", 3: "b", 4: ["s"], 5: 4, 6: 5 },
    4: { 1: "s" },
    5: { 1: "s", 2: "s" },
    6: { 1: "s", 2: "s", 3: "s", 4: [7] },
    7: { 1: "s", 2: "s", 3: [10], 4: [9], 5: [8] },
    8: { 1: "s", 2: "s" },
    9: { 1: "s", 2: ["s"], 3: "s" },
    10: { 1: 11, 2: [12], 3: "s" },
    11: { 1: "s", 2: "s", 3: "s" },
    12: {
      1: "s",
      3: "v",
      4: "v",
      5: "s",
      6: "i",
      7: "v",
      8: "v",
      9: "s",
      10: 11,
      11: "s",
      12: 11,
      13: "v",
      14: 11,
      15: "s",
      16: "v",
      17: "i",
    },
    13: { 1: "s", 2: "s", 3: "s", 4: [12], 5: [14], 6: ["s"], 7: "s", 8: 11 },
    14: { 1: "i", 2: 12 },
    15: { 1: 2, 2: 6, 3: [13], 4: "s", 5: "b", 6: "b" },
    16: { 1: [1] },
  };
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  function reference(
    bytes: Buffer,
    type: number,
    result: Message = { type },
    depth = 0,
  ): Message {
    if (depth >= 100) throw new Error("depth");
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
    function tag() {
      const value = readVarint();
      if (value < 8n || value > 0xffffffffn) throw new Error("tag");
      return [Number(value >> 3n), Number(value & 7n)];
    }
    function value(number: number, wire: number, nesting: number) {
      if (wire === 0) return readVarint();
      if (wire === 3) {
        if (nesting >= 100) throw new Error("depth");
        for (;;) {
          const [n, w] = tag();
          if (w === 4) {
            if (n !== number) throw new Error("group");
            return null;
          }
          value(n, w, nesting + 1);
        }
      }
      const length = wire === 2
        ? readVarint()
        : wire === 1
        ? 8n
        : wire === 5
        ? 4n
        : -1n;
      if (length < 0n || length > BigInt(bytes.length - p)) {
        throw new Error("length");
      }
      const data = bytes.subarray(p, p + Number(length));
      p += Number(length);
      return data;
    }
    while (p < bytes.length) {
      const [number, wire] = tag();
      const raw = value(number, wire, depth + 1);
      const descriptor = schemas[type][number];
      if (!descriptor) continue;
      const repeated = Array.isArray(descriptor);
      const kind = repeated ? descriptor[0] : descriptor;
      if (wire !== (kind === "v" || kind === "i" ? 0 : 2)) continue;
      let decoded;
      if (kind === "v" || kind === "i") {
        assert.equal(typeof raw, "bigint");
        decoded = kind === "v"
          ? raw !== 0n
          : Number(BigInt.asIntN(32, raw as bigint));
      } else {
        assert.ok(Buffer.isBuffer(raw));
        if (kind === "s") decoded = decoder.decode(raw);
        else if (kind === "b") decoded = raw.toString("hex");
        else {decoded = reference(
            raw,
            kind,
            repeated
              ? undefined
              : result[Number(number)] as Message | undefined,
            depth + 1,
          );}
      }
      if (repeated) {
        ((result[Number(number)] ??= []) as FieldValue[]).push(decoded);
      } else result[Number(number)] = decoded;
    }
    return result;
  }

  class Exit extends Error {
    constructor(readonly code: number) {
      super(`WASI exit ${code}`);
    }
  }

  const diagnostics: string[] = [];
  const instance: WebAssembly.Instance = new WebAssembly.Instance(compiled, {
    wasi_snapshot_preview1: {
      proc_exit(code: number) {
        throw new Exit(code);
      },
      fd_read() {
        throw new Error("Parser tests must not read stdin");
      },
      fd_write(fd: number, iovs: number, count: number, output: number) {
        assert.equal(fd, 2, "The parser must never write a response");
        const view = new DataView(
          (instance.exports.memory as WebAssembly.Memory).buffer,
        );
        let length = 0;
        for (let i = 0; i < count; i++) {
          const pointer = view.getUint32(iovs + i * 8, true);
          const size = view.getUint32(iovs + i * 8 + 4, true);
          diagnostics.push(Buffer.from(view.buffer, pointer, size).toString());
          length += size;
        }
        view.setUint32(output, length, true);
        return 0;
      },
    },
  });
  const api = instance.exports as unknown as Exports;
  const memory = new Uint8Array(api.memory.buffer);
  const view = new DataView(api.memory.buffer);

  function actual(record: number): Message {
    assert.ok(
      record >= 4194304 && record < 20971520 && record % 256 === 0,
      "Record pointer escapes its fixed table",
    );
    const type = view.getUint32(record, true);
    const result: Message = { type };
    for (const [number, descriptor] of Object.entries(schemas[type])) {
      const n = Number(number);
      if (!api.present(record, n)) continue;
      const repeated = Array.isArray(descriptor);
      const kind = repeated ? descriptor[0] : descriptor;
      const item = (r: number, f: number): FieldValue => {
        if (typeof kind === "number") return actual(r);
        if (kind === "v") return api.number(r, f) !== 0;
        if (kind === "i") return api.number(r, f);
        const p = api.text_ptr(r, f), length = api.text_len(r, f);
        assert.ok(
          p >= base && p + length <= api.text_end.value,
          "Text pointer escapes the compacted input prefix",
        );
        const bytes = Buffer.from(memory.subarray(p, p + length));
        return kind === "s" ? decoder.decode(bytes) : bytes.toString("hex");
      };
      if (repeated) {
        const items: FieldValue[] = [];
        result[n] = items;
        let last = 0;
        for (let child = api.child(record, n); child; child = api.next(child)) {
          assert.ok(items.length < 65536, "Repeated record list has a cycle");
          items.push(item(child, 1));
          last = child;
        }
        assert.equal(
          items.length,
          api.present(record, n),
          "Repeated count differs from list length",
        );
        assert.equal(
          last,
          view.getUint32(api.slot(record, n) + 4, true),
          "Repeated tail pointer differs",
        );
      } else {result[Number(number)] = typeof kind === "number"
          ? actual(api.child(record, n))
          : item(record, n);}
    }
    return result;
  }

  let count = 0;
  function compare(
    name: string,
    input: readonly number[] | Uint8Array,
    type = 15,
  ) {
    const bytes = Buffer.from(input);
    let expected, invalid = false;
    try {
      expected = reference(bytes, type);
    } catch {
      invalid = true;
    }
    memory.set(bytes, base);
    memory.fill(0xa5, base + bytes.length, base + bytes.length + 16);
    diagnostics.length = 0;
    if (invalid) {
      assert.throws(
        () => api.parse_type(type, base, bytes.length),
        (error) => error instanceof Exit && error.code === 2,
        name,
      );
      assert.ok(diagnostics.length > 0, `${name}: missing diagnostic`);
    } else {
      const record = api.parse_type(type, base, bytes.length);
      assert.deepEqual(actual(record), expected, name);
      assert.ok(
        api.text_end.value <= base + bytes.length,
        `${name}: compaction grew the input`,
      );
      assert.deepEqual(
        [...memory.subarray(base + bytes.length, base + bytes.length + 16)],
        Array(16).fill(0xa5),
        `${name}: parser overwrote bytes after input`,
      );
      assert.equal(
        diagnostics.length,
        0,
        `${name}: successful parse wrote a diagnostic`,
      );
    }
    count++;
  }

  function varint(input: number | bigint) {
    let value = BigInt(input);
    value = BigInt.asUintN(64, BigInt(value));
    const bytes = [];
    do {
      let byte = Number(value & 127n);
      value >>= 7n;
      if (value) byte |= 128;
      bytes.push(byte);
    } while (value);
    return Buffer.from(bytes);
  }
  const concat = (...items: (readonly number[] | Uint8Array)[]) =>
    Buffer.concat(items.map((item) => Buffer.from(item)));
  const tag = (field: number, wire: number) => varint(field * 8 + wire);
  const dataField = (field: number, data: string | Buffer) =>
    concat(
      tag(field, 2),
      varint(Buffer.byteLength(data)),
      typeof data === "string" ? Buffer.from(data) : data,
    );
  const intField = (field: number, value: number | bigint) =>
    concat(tag(field, 0), varint(value));
  function populated(type: number, variant = 0): Buffer {
    const fields = [];
    for (const [number, descriptor] of Object.entries(schemas[type])) {
      const repeated = Array.isArray(descriptor),
        kind = repeated ? descriptor[0] : descriptor;
      for (let i = 0; i < (repeated ? 2 : 1); i++) {
        if (kind === "i") {
          fields.push(
            intField(Number(number), variant ? -2147483648 : 2147483647),
          );
        } else if (kind === "v") {
          fields.push(intField(Number(number), variant ? 0 : 0x100000000n));
        } else {fields.push(dataField(
            Number(number),
            typeof kind === "number"
              ? populated(kind, variant)
              : kind === "b"
              ? Buffer.from([0, 255, 128, variant])
              : `type${type}/field${number}/${i}/${variant}/日本語😀`,
          ));}
      }
    }
    return concat(...fields);
  }
  for (let type = 1; type <= 16; type++) {
    compare(`empty schema ${type}`, [], type);
    compare(`every field in schema ${type}`, populated(type), type);
    compare(
      `duplicates merge or append in schema ${type}`,
      concat(populated(type), populated(type, 1)),
      type,
    );
    const wrongWires = Object.entries(schemas[type]).map(
      ([number, descriptor]) => {
        const kind = Array.isArray(descriptor) ? descriptor[0] : descriptor;
        return kind === "i" || kind === "v"
          ? dataField(Number(number), "ignored")
          : intField(Number(number), 7);
      },
    );
    compare(
      `wrong wire types in schema ${type}`,
      concat(...wrongWires, populated(type)),
      type,
    );
  }
  compare(
    "later singular child merges fields from its earlier occurrence",
    concat(
      dataField(1, dataField(1, "1.31.1")),
      dataField(1, dataField(2, "sqlite")),
    ),
  );
  compare(
    "empty last scalar overrides earlier data",
    concat(dataField(4, "old"), dataField(4, "")),
  );
  compare("invalid UTF-8 strings fail", dataField(4, Buffer.from([255])));
  compare(
    "arbitrary bytes are not UTF-8 strings",
    dataField(5, Buffer.from([255])),
  );
  // FuzzWireOracle/ebd5058a35faaaa9 selected Catalog (old selector 3, WAT type 6).
  // All three fields are unknown: a wide varint and a nonminimal fixed64 tag
  // remain valid input, so Catalog must accept them without retaining fields.
  const catalogRegression = Buffer.from(
    "a0303030ffffffffffff30a9003030303030303030",
    "hex",
  );
  assert.deepEqual(reference(catalogRegression, 6), { type: 6 });
  compare(
    "historical Catalog wire seed ebd5058a35faaaa9 accepts unknown fields",
    catalogRegression,
    6,
  );
  for (
    const [name, bytes] of [["bad tag", [0]], ["truncated child", [10, 4, 1]], [
      "overflowing scalar",
      [8, ...Array(9).fill(255), 2],
    ], ["unknown fixed64", [201, 62, 1, 2, 3, 4, 5, 6, 7, 8]]] as const
  ) compare(name, bytes);
  for (const depth of [98, 99, 100] as const) {
    const groups = concat(
      ...Array(depth).fill(tag(500, 3)),
      ...Array(depth).fill(tag(500, 4)),
    );
    compare(`root groups depth ${depth}`, groups);
    compare(`nested message groups depth ${depth}`, dataField(1, groups));
  }

  // Unknown bytes can sit between retained fields. Large gaps and nested lengths
  // force substantial overlapping copies, exposing accidental unread-byte loss.
  compare(
    "compaction across discarded nested metadata",
    concat(
      dataField(500, Buffer.alloc(65536, 0x55)),
      dataField(
        1,
        concat(dataField(500, Buffer.alloc(65536, 0x77)), populated(2)),
      ),
      dataField(500, Buffer.alloc(65536, 0x66)),
      populated(15),
    ),
  );

  let state = 0x597a839b;
  const random = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return state >>> 0;
  };
  for (let i = 0; i < 1500; i++) {
    const type = 1 + random() % 16;
    let bytes = i % 2
      ? Buffer.from(Uint8Array.from({ length: random() % 64 }, random))
      : populated(type, i % 3);
    if (i % 2 === 0) {
      for (let j = 0; j < 1 + random() % 4; j++) {
        bytes[random() % bytes.length] = random();
      }
      if (i % 3 === 0) bytes = bytes.subarray(0, random() % bytes.length);
    }
    compare(`deterministic mutation ${i}`, bytes, type);
  }

  const corpus = Deno.args[0];
  if (corpus) {
    for (
      const name of (await filenames(corpus)).filter((name) =>
        name.endsWith(".json")
      ).sort()
    ) {
      const record = JSON.parse(await Deno.readTextFile(join(corpus, name)));
      if (!record.non_wire_reason) {
        compare(
          `reference corpus ${name}`,
          Buffer.from(record.request || "", "base64"),
        );
      }
    }
  }

  // The root itself consumes one record. Empty repeated messages stress the
  // table without requiring a large input or deep recursion.
  const exact = Buffer.alloc(65535 * 2);
  for (let i = 0; i < exact.length; i += 2) exact[i] = 26;
  memory.set(exact, base);
  api.pb_parse(base, exact.length);
  assert.equal(
    api.record_count.value,
    65536,
    "Exact record-table capacity must work",
  );
  memory.set(concat(exact, [26, 0]), base);
  assert.throws(
    () => api.pb_parse(base, exact.length + 2),
    (error) => error instanceof Exit && error.code === 2,
    "Record-table exhaustion must fail without a trap",
  );
  count += 2;
  console.log(`WAT protocol: ${count} checks passed`);
});
