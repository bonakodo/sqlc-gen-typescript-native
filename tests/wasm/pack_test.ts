import { Buffer } from "node:buffer";
import {
  layout as staticLayout,
  pack,
  readData,
  transform,
} from "../../tools/pack-data.ts";
import { command, wabt } from "./test_helpers.ts";
import assert from "node:assert/strict";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

Deno.test("WAT pack", async () => {
  interface Exports {
    memory: WebAssembly.Memory;
    init_data: () => void;
    packed_begin: { value: number };
    packed_end: { value: number };
    unpacked_size: { value: number };
  }
  // Packing changes only static bytes. Compare all 4 MiB of restored static
  // memory with direct WAT assembly, then test the hand-written decoder against
  // a separate reference reader and the Deno encoder using bounded, deterministic cases.

  const directory = dirname(fileURLToPath(import.meta.url));
  const root = resolve(directory, "../..");
  const assembler = wabt("wat2wasm");
  const stem = resolve(
    Deno.args[0] || join(root, "bin/sqlc-gen-typescript-native"),
  );
  const temporary = Deno.makeTempDirSync({ prefix: "sqlc-wat-pack-" });
  const START = 33554432, DECODED = 37748736, LIMIT = 1048576, STATIC = 4194304;
  let checks = 0;
  async function run(program: string, args: string[], input?: string) {
    const result = await command(program, args, { input, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    return result.stdout;
  }
  async function compile(name: string, text: string) {
    const path = join(temporary, name);
    Deno.writeTextFileSync(`${path}.wat`, text);
    await run(assembler, [`${path}.wat`, "-o", `${path}.wasm`]);
    const module = await WebAssembly.compile(Deno.readFileSync(`${path}.wasm`));
    const imports: WebAssembly.Imports = {};
    for (
      const { module: space, name, kind } of WebAssembly.Module.imports(module)
    ) {
      assert.equal(kind, "function");
      (imports[space] ||= {})[name] = () => {
        throw new Error(`Unexpected startup import: ${space}.${name}`);
      };
    }
    return (await WebAssembly.instantiate(module, imports))
      .exports as unknown as Exports;
  }
  function layout(spans: [number, Buffer][]) {
    const head = Buffer.alloc(4 + spans.length * 8);
    head.writeUInt32LE(spans.length);
    spans.forEach(([address, data], i: number) => {
      head.writeUInt32LE(address, 4 + i * 8);
      head.writeUInt32LE(data.length, 8 + i * 8);
    });
    return Buffer.concat([head, ...spans.map(([, data]) => data)]);
  }
  function literals(bytes: Uint8Array) {
    const prefix = [Math.min(bytes.length, 15) << 4];
    if (bytes.length >= 15) {
      let left = bytes.length - 15;
      while (left >= 255) {
        prefix.push(255);
        left -= 255;
      }
      prefix.push(left);
    }
    return Buffer.concat([Buffer.from(prefix), bytes]);
  }
  // Deliberately separate from both the build tool and WAT control flow.
  function reference(bytes: Uint8Array, expectedSize: number) {
    if (bytes.length > LIMIT || expectedSize < 4 || expectedSize > LIMIT) {
      throw Error("size");
    }
    let cursor = 0;
    const result = [];
    const byte = () => {
      if (cursor >= bytes.length) throw Error("truncated");
      return bytes[cursor++];
    };
    const extended = (length: number) => {
      let value;
      do {
        value = byte();
        length += value;
        if (length > LIMIT) throw Error("length");
      } while (value === 255);
      return length;
    };
    while (cursor < bytes.length) {
      const token = byte();
      const count = token >> 4 === 15 ? extended(15) : token >> 4;
      if (
        count > expectedSize - result.length || count > bytes.length - cursor
      ) throw Error("literal");
      for (let i = 0; i < count; i++) result.push(byte());
      if (cursor === bytes.length) break;
      const distance = byte() | byte() << 8;
      if (!distance || distance > result.length) throw Error("distance");
      const count2 = (token & 15) === 15 ? extended(19) : (token & 15) + 4;
      if (count2 > expectedSize - result.length) throw Error("match");
      for (let i = 0; i < count2; i++) {
        result.push(result[result.length - distance]);
      }
    }
    if (result.length !== expectedSize) throw Error("size");
    const decoded = Buffer.from(result), spans = decoded.readUInt32LE(0);
    if (spans > (decoded.length - 4) >>> 3) throw Error("table");
    let data = 4 + spans * 8;
    const image = Buffer.alloc(STATIC);
    for (let i = 0; i < spans; i++) {
      const address = decoded.readUInt32LE(4 + i * 8),
        length = decoded.readUInt32LE(8 + i * 8);
      if (
        address > STATIC || length > STATIC - address ||
        length > decoded.length - data
      ) throw Error("span");
      decoded.copy(image, address, data, data + length);
      data += length;
    }
    if (data !== decoded.length) throw Error("extra data");
    return image;
  }

  try {
    const plainText = Deno.readTextFileSync(`${stem}.wat`);
    const packedText = Deno.readTextFileSync(`${stem}.packed.wat`);
    const plain = await compile("plain", plainText);
    const close = packedText.lastIndexOf(")");
    const packed = await compile(
      "packed",
      `${
        packedText.slice(0, close)
      }\n(export "init_data" (func $init_data))\n)`,
    );
    packed.init_data();
    assert.deepEqual(
      Buffer.from(packed.memory.buffer, 0, STATIC),
      Buffer.from(plain.memory.buffer, 0, STATIC),
      "Every static byte must equal direct WAT assembly",
    );
    checks++;
    console.log(
      "PASS original and restored 4 MiB static memory images match exactly",
    );

    const decoder = await compile(
      "decoder",
      `(module
    (memory (export "memory") 1024 1024)
    (global $packed_begin (export "packed_begin") (mut i32) (i32.const ${START}))
    (global $packed_end (export "packed_end") (mut i32) (i32.const ${START}))
    (global $unpacked_size (export "unpacked_size") (mut i32) (i32.const 4))
    ${Deno.readTextFileSync(join(root, "src/init-data.wat"))}
    (export "init_data" (func $init_data)))`,
    );
    const memory = new Uint8Array(decoder.memory.buffer);
    const exercise = (bytes: Uint8Array, size: number, label: string) => {
      let expected, invalid = false;
      try {
        expected = reference(bytes, size);
      } catch {
        invalid = true;
      }
      memory.fill(0, 0, STATIC);
      memory.fill(0xa5, STATIC, STATIC + 32);
      memory.fill(0xb6, START - 32, START);
      memory.fill(0xc7, START + LIMIT, START + LIMIT + 32);
      memory.fill(0xd8, DECODED - 32, DECODED);
      memory.fill(0xe9, DECODED + LIMIT, DECODED + LIMIT + 32);
      memory.set(bytes, START);
      decoder.packed_begin.value = START;
      decoder.packed_end.value = START + bytes.length;
      decoder.unpacked_size.value = size;
      if (invalid) {
        assert.throws(
          () => decoder.init_data(),
          WebAssembly.RuntimeError,
          label,
        );
      } else {
        decoder.init_data();
        assert.deepEqual(
          Buffer.from(memory.buffer, 0, STATIC),
          expected,
          label,
        );
      }
      for (
        const [at, value] of [
          [STATIC, 0xa5],
          [START - 32, 0xb6],
          [START + LIMIT, 0xc7],
          [DECODED - 32, 0xd8],
          [DECODED + LIMIT, 0xe9],
        ] as const
      ) {
        assert.ok(
          memory.subarray(at, at + 32).every((byte) => byte === value),
          `${label}: scratch guard ${at}`,
        );
      }
      checks++;
      return !invalid;
    };
    let seed = 0x628ef209;
    const random = () => {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      return seed >>> 0;
    };
    const samples = [
      layout([]),
      layout([[0, Buffer.from("a")]]),
      layout([[STATIC - 1, Buffer.from("z")]]),
    ];
    for (
      const length of [
        3,
        4,
        14,
        15,
        18,
        19,
        254,
        255,
        256,
        269,
        270,
        271,
        65534,
        65535,
        65536,
        65537,
        131073,
        LIMIT - 12,
      ] as const
    ) {
      samples.push(
        layout([[100, Buffer.alloc(Math.min(length, STATIC - 100), 97)]]),
      );
      if (length < LIMIT - 12) {
        samples.push(layout([[
          0,
          Buffer.from(Array.from({ length }, () => random() & 255)),
        ]]));
      }
    }
    for (let i = 0; i < 350; i++) {
      const spans: [number, Buffer][] = [];
      for (let j = 0, count = random() % 6; j < count; j++) {
        const length = random() % 1400, address = random() % (STATIC - length);
        const alphabet = [1, 2, 7, 32, 256][random() % 5];
        spans.push([
          address,
          Buffer.from(Array.from({ length }, () => random() % alphabet)),
        ]);
      }
      samples.push(layout(spans));
    }
    const encoded = samples.map(pack);
    encoded.forEach((value, i: number) =>
      assert.ok(
        exercise(
          value,
          samples[i].length,
          `round trip ${i}`,
        ),
      )
    );
    console.log(
      `PASS ${samples.length} random and boundary layouts through Deno packer and hand-WAT decoder`,
    );

    // Hand-encoded matches make overlap coverage independent of the packer's
    // match choices. Use non-uniform periods as well as distance-one runs, and
    // stop just before/at/after repeated doubling and extension boundaries.
    for (const distance of [1, 2, 3, 7, 16, 255, 256, 65535] as const) {
      for (
        const length of new Set([
          4,
          18,
          19,
          20,
          254,
          255,
          256,
          269,
          270,
          271,
          ...[
            distance - 1,
            distance,
            distance + 1,
            2 * distance - 1,
            2 * distance,
            2 * distance + 1,
          ].filter((n) => n >= 4),
        ])
      ) {
        const data = Buffer.from(
          Array.from(
            { length: distance + length },
            (_, i) => (i % distance * 17 + 31) & 255,
          ),
        );
        const decoded = layout([[100, data]]),
          initial = decoded.subarray(0, 12 + distance);
        const stream = literals(initial);
        stream[0] |= Math.min(length - 4, 15);
        const tail = [distance & 255, distance >>> 8];
        if (length >= 19) {
          let left = length - 19;
          while (left >= 255) {
            tail.push(255);
            left -= 255;
          }
          tail.push(left);
        }
        assert.ok(
          exercise(
            Buffer.concat([stream, Buffer.from(tail)]),
            decoded.length,
            `distance ${distance}, length ${length}`,
          ),
        );
      }
    }

    // Large literal runs stress both 255-byte extension boundaries and the exact
    // encoded scratch bound, without depending on the packer's match finder.
    let largestLiteral = LIMIT;
    const literalSize = (n: number) =>
      n + 1 + (n >= 15 ? 1 + Math.floor((n - 15) / 255) : 0);
    while (literalSize(largestLiteral) > LIMIT) largestLiteral--;
    const large = layout([[0, Buffer.alloc(largestLiteral - 12)]]);
    assert.ok(
      exercise(literals(large), large.length, "largest encoded literal stream"),
    );
    exercise(Buffer.alloc(0), 4, "empty compressed stream");
    for (
      const bytes of [[0xf0], [0x40, 1, 2], [0, 1], [0x10, 1, 0, 0], [
        0x10,
        1,
        2,
        0,
      ], [0x1f, 0, 1, 0, 255]] as const
    ) {
      assert.equal(
        exercise(Buffer.from(bytes), 20, `malformed token ${bytes}`),
        false,
      );
    }
    exercise(
      Buffer.from([0xf0, ...Array(4113).fill(255), 0]),
      LIMIT,
      "literal extension overflow",
    );
    exercise(
      Buffer.from([0x1f, 0, 1, 0, ...Array(4113).fill(255), 0]),
      LIMIT,
      "match extension overflow",
    );
    const badLayouts = [
      Buffer.from([255, 255, 255, 255]),
      Buffer.alloc(5),
      layout([[STATIC + 1, Buffer.from("a")]]),
      layout([[STATIC, Buffer.from("a")]]),
    ];
    const excessiveLength = layout([[0, Buffer.from("a")]]);
    excessiveLength.writeUInt32LE(0xffffffff, 8);
    badLayouts.push(excessiveLength);
    const shortTable = layout([[0, Buffer.from("a")]]).subarray(0, 11);
    badLayouts.push(shortTable);
    for (const [i, bytes] of badLayouts.entries()) {
      assert.equal(
        exercise(literals(bytes), bytes.length, `invalid span ${i}`),
        false,
      );
    }
    exercise(literals(layout([])), 3, "short decoded layout");
    exercise(literals(layout([])), LIMIT + 1, "decoded size overflow");
    for (
      const [name, value] of [
        ["packed_begin", START + 1],
        ["packed_end", START - 1],
        ["packed_end", START + LIMIT + 1],
        ["unpacked_size", -1],
      ] as const
    ) {
      decoder.packed_begin.value = START;
      decoder.packed_end.value = START + 5;
      decoder.unpacked_size.value = 4;
      decoder[name].value = value;
      assert.throws(
        () => decoder.init_data(),
        WebAssembly.RuntimeError,
        `${name} range`,
      );
      checks++;
    }

    // Mutations may remain valid compression. Compare acceptance and, whenever
    // valid, every output byte; requiring every random edit to fail is incorrect.
    for (let i = 0; i < 1500; i++) {
      const at = random() % encoded.length,
        original = Buffer.from(encoded[at]);
      let bytes = Buffer.from(original);
      if (bytes.length) {
        const position = random() % bytes.length;
        if (i % 3 === 0) bytes = bytes.subarray(0, position);
        else bytes[position] ^= 1 << (random() % 8);
      }
      exercise(bytes, samples[at].length, `mutation ${i}`);
    }

    // The source reader must preserve overlapping writes, Unicode byte escapes,
    // and executable text. Comments that mention data are never declarations.
    const source = String
      .raw`(module (; (data (i32.const 9) "ignored") (; nested ;) ;)
;; (data (i32.const 8) "ignored")
(data (i32.const 20) "abc" "\00")
(data (i32.const 21) "Z")
(data (i32.const 40) "\u{1f600}")
(func $keep (result i32) (i32.const 123)))`;
    const data = readData(source);
    assert.equal(data.length, 3);
    assert.deepEqual(data[0].bytes, new TextEncoder().encode("abc\0"));
    assert.deepEqual(data[2].bytes, new TextEncoder().encode("😀"));
    assert.deepEqual(
      staticLayout(data).subarray(20, 24),
      new TextEncoder().encode("aZc\0"),
    );
    const transformed = transform(source).source;
    assert.ok(
      transformed.includes("(func $keep (result i32) (i32.const 123))"),
    );
    assert.ok(transformed.includes('"ignored"'));
    for (const address of [-1, STATIC + 1]) {
      assert.throws(() =>
        readData(`(module (data (i32.const ${address}) "x"))`)
      );
    }
    checks++;
    console.log(`${checks} static packing checks passed`);
  } finally {
    Deno.removeSync(temporary, { recursive: true });
  }
});
