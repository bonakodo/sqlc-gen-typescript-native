import { Buffer } from "node:buffer";
import assert from "node:assert/strict";
import { join } from "node:path";
import {
  layout as staticLayout,
  pack,
  readData,
  stringBytes,
  transform,
  unpack,
} from "../../tools/pack-data.ts";

Deno.test("WAT data parser preserves Unicode scalars and byte escapes", () => {
  const text = new TextEncoder();
  for (
    const [source, expected] of [
      ['"日本😀"', text.encode("日本😀")],
      [String.raw`"\00\7f\80\ff"`, Uint8Array.of(0, 127, 128, 255)],
      [String.raw`"\n\r\t\\\"\'"`, Uint8Array.of(10, 13, 9, 92, 34, 39)],
      [
        String.raw`"\u{0}\u{7f}\u{1_f600}\u{10ffff}"`,
        text.encode("\0\x7f😀\u{10ffff}"),
      ],
    ] as const
  ) assert.deepEqual(stringBytes(source), expected);
  const source = String.raw`(module $data
    (; 日本😀 (; (data (i32.const 0) "ignored") ;) ;)
    (data (i32.const +0x0_010) "日本" "\u{1_f600}")
    (data (i32.const 4_194_304) "")
    (func $keep (result i32) (i32.const 9)))`;
  const segments = readData(source);
  assert.equal(segments.length, 2);
  assert.equal(segments[0].address, 16);
  assert.deepEqual(segments[0].bytes, text.encode("日本😀"));
  assert.equal(segments[1].address, 4194304);
  assert.equal(segments[1].bytes.length, 0);
  for (const segment of segments) {
    assert.ok(source.slice(segment.begin, segment.end).startsWith("(data "));
    assert.ok(source.slice(segment.begin, segment.end).endsWith(")"));
  }
  const result = transform(source);
  assert.ok(
    result.source.includes('(; 日本😀 (; (data (i32.const 0) "ignored") ;) ;)'),
  );
  assert.ok(result.source.includes("(func $keep (result i32) (i32.const 9))"));
});

Deno.test("WAT data parser rejects malformed source without replacing bytes", () => {
  for (
    const word of [
      '"\\"',
      '"\\0"',
      '"\\gg"',
      '"\\u{}"',
      '"\\u{_41}"',
      '"\\u{41_}"',
      '"\\u{1__2}"',
      '"\\u{110000}"',
      '"\\u{d800}"',
      '"\\u{dfff}"',
      '"\\u{41"',
      '"\ud800"',
      '"\udfff"',
      '"\0"',
      '"\n"',
      '"a"b"',
    ]
  ) assert.throws(() => stringBytes(word), Error, word);
  for (
    const source of [
      "",
      "module",
      "()",
      "(func)",
      "(module",
      "(module))",
      "(module)(module)",
      "(module (; unclosed)",
      '(module (data (i32.const 0) "unclosed))',
      '(module (data "passive"))',
      '(module (data (global.get $offset) "x"))',
      '(module (data (i32.const) "x"))',
      "(module (data (i32.const 0)))",
      '(module (data (i32.const 0) "x" extra))',
      '(module (data (i32.const 1xyz) "x"))',
      '(module (data (i32.const -1) "x"))',
      '(module (data (i32.const 4194304) "x"))',
      '(module (data (i32.const 4194303) "xy"))',
      '(module (data (i32.const 9999999999999999999999999) "x"))',
    ]
  ) assert.throws(() => readData(source), Error, source);
});

Deno.test("WAT data layout retains last writes and exact gap and size limits", () => {
  const data = [
    { address: 10, bytes: Uint8Array.of(1, 2, 3) },
    { address: 0, bytes: Uint8Array.of(9, 8) },
    { address: 11, bytes: Uint8Array.of(4) },
    { address: 0, bytes: Uint8Array.of(7) },
  ];
  const result = staticLayout(data), view = new DataView(result.buffer);
  assert.equal(view.getUint32(0, true), 1);
  assert.equal(view.getUint32(4, true), 0);
  assert.equal(view.getUint32(8, true), 13);
  assert.deepEqual([...result.subarray(12)], [
    7,
    8,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    1,
    4,
    3,
  ]);
  assert.deepEqual(staticLayout([]), new Uint8Array(4));
  const separate = staticLayout([
    { address: 0, bytes: Uint8Array.of(1, 2) },
    { address: 11, bytes: Uint8Array.of(3) },
  ]);
  assert.equal(new DataView(separate.buffer).getUint32(0, true), 2);
  const exact = staticLayout([{
    address: 0,
    bytes: new Uint8Array(1048576 - 12),
  }]);
  assert.equal(exact.length, 1048576);
  assert.throws(() =>
    staticLayout([{ address: 0, bytes: new Uint8Array(1048576 - 11) }])
  );
  for (const address of [-1, 0.5, NaN, Infinity, 4194304]) {
    assert.throws(() => staticLayout([{ address, bytes: Uint8Array.of(1) }]));
  }
});

Deno.test("WAT packer retains prior token choices and bounds its reader", () => {
  const text = new TextEncoder();
  // Frozen byte output from the prior packer: equal matches use the nearest one.
  for (
    const [input, expected] of [
      [text.encode("abcd0abcd1abcd2"), "5061626364300500103105001032"],
      [text.encode("a".repeat(19)), "1e610100"],
      [text.encode("a".repeat(270)), "1f610100fa"],
      [
        Uint8Array.from({ length: 16 }, (_, i) => i),
        "f001000102030405060708090a0b0c0d0e0f",
      ],
    ] as const
  ) {
    const packed = pack(input);
    assert.equal(packed.toHex(), expected);
    assert.deepEqual(unpack(packed), input);
  }
  assert.deepEqual(unpack(pack(new Uint8Array())), new Uint8Array());
  for (
    const bytes of [
      [0xf0],
      [0x40, 1, 2],
      [0, 1],
      [0x10, 1, 0, 0],
      [0x10, 1, 2, 0],
      [0x1f, 0, 1, 0, 255],
      [0xf0, ...Array(4113).fill(255), 0],
      [0x1f, 0, 1, 0, ...Array(4113).fill(255), 0],
    ]
  ) assert.throws(() => unpack(Uint8Array.from(bytes)));
  assert.throws(() => pack(new Uint8Array(1048577)));
  assert.throws(() => unpack(new Uint8Array(1048577)));
});

Deno.test("WAT packer CLI rejects invalid UTF-8 and normalizes source newlines", async () => {
  const directory = await Deno.makeTempDir({ prefix: "sqlc-pack-cli-" });
  const input = join(directory, "source.wat"),
    output = join(directory, "output.wat");
  const invoke = () =>
    new Deno.Command(Deno.execPath(), {
      args: [
        "run",
        "--allow-read",
        "--allow-write",
        new URL("../../tools/pack-data.ts", import.meta.url).href,
        input,
        output,
      ],
      stdin: "null",
      stdout: "piped",
      stderr: "piped",
    }).output();
  try {
    const source =
      '(module\r\n;; Windows and legacy line endings\r(data (i32.const 0) "x"))\r';
    await Deno.writeTextFile(input, source);
    const valid = await invoke();
    assert.equal(valid.code, 0, new TextDecoder().decode(valid.stderr));
    assert.equal(
      await Deno.readTextFile(output),
      transform(source.replace(/\r\n?/g, "\n")).source,
    );
    const malformed = Buffer.concat([
      Buffer.from('(module (data (i32.const 0) "'),
      Buffer.from([0xff]),
      Buffer.from('"))'),
    ]);
    await Deno.writeFile(input, malformed);
    await Deno.writeTextFile(output, "unchanged");
    const invalid = await invoke();
    assert.notEqual(invalid.code, 0);
    assert.equal(await Deno.readTextFile(output), "unchanged");
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});
