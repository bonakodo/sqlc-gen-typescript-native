import { Buffer } from "node:buffer";
import { command, type Pair, wabt } from "./test_helpers.ts";
import assert from "node:assert/strict";
import { join } from "node:path";

Deno.test("WAT text", async () => {
  interface Exports {
    memory: WebAssembly.Memory;
    access: (
      a0: number,
      a1: number,
      a2: number,
      a3: number,
    ) => [number, number];
    comment: (a0: number, a1: number) => [number, number];
    compare: (a0: number, a1: number, a2: number, a3: number) => number;
    decimal: (a0: bigint) => [number, number];
    declaration_name: (a0: number, a1: number) => [number, number];
    equal_fold: (a0: number, a1: number, a2: number, a3: number) => number;
    field_name: (
      a0: number,
      a1: number,
      a2: number,
      a3: number,
    ) => [number, number];
    go_quote: (a0: number, a1: number) => [number, number];
    go_quote_rune: (a0: number) => [number, number];
    identifier: (a0: number, a1: number) => number;
    lower_first: (a0: number, a1: number) => [number, number];
    name_scope: () => number;
    name_scope_raw: () => number;
    name_take: (a0: number, a1: number, a2: number) => [number, number];
    name_used: (a0: number, a1: number, a2: number) => number;
    property: (a0: number, a1: number) => [number, number];
    quote: (a0: number, a1: number) => [number, number];
    retain_text: (a0: number, a1: number) => [number, number];
    singular: (a0: number, a1: number) => [number, number];
    template: (a0: number, a1: number) => [number, number];
    text_copy: (a0: number, a1: number) => [number, number];
    text_mark: () => number;
    text_reset: (a0: number) => void;
    trim_space: (a0: number, a1: number) => [number, number];
    type_array: (a0: number, a1: number, a2: number) => [number, number];
    type_precedence: (a0: number, a1: number) => number;
    unicode_case: (a0: number, a1: number) => number;
    unicode_flags: (a0: number) => number;
    unicode_fold: (a0: number) => number;
    upper_first: (a0: number, a1: number) => [number, number];
  }
  // Exact byte comparisons against the prior generator's frozen reference.
  // Fixtures retain invalid UTF-8 bytes.
  const directory = await Deno.makeTempDir({ prefix: "sqlc-wat-text-" });
  const names = [
    "quote",
    "template",
    "property",
    "access",
    "field_name",
    "declaration_name",
    "upper_first",
    "lower_first",
    "trim_space",
    "singular",
    "go_quote",
    "comment",
  ] as const;
  const helperNames = [
    "identifier",
    "name_scope",
    "name_scope_raw",
    "name_take",
    "name_used",
    "retain_text",
    "text_reset",
    "text_mark",
    "text_copy",
    "compare",
    "decimal",
    "unicode_flags",
    "unicode_case",
    "unicode_fold",
    "equal_fold",
    "go_quote_rune",
    "type_precedence",
    "type_array",
  ];
  let api: Exports;
  try {
    const source = (await Promise.all(
      ["core", "unicode", "inflection-data", "text"].map((n) =>
        Deno.readTextFile(new URL(`../../src/${n}.wat`, import.meta.url))
      ),
    )).join("\n");
    const exports = [...names, ...helperNames].filter((n) =>
      source.includes(`(func $${n} `)
    ).map((n) => `(export "${n}" (func $${n}))`).join("\n");
    await Deno.writeTextFile(
      join(directory, "text.wat"),
      `(module\n${source}\n${exports}\n)`,
    );
    const compile = await command(wabt("wat2wasm"), [
      join(directory, "text.wat"),
      "-o",
      join(directory, "text.wasm"),
    ], { encoding: "utf8" });
    assert.equal(compile.status, 0, compile.stderr);
    const { instance } = await WebAssembly.instantiate(
      await Deno.readFile(join(directory, "text.wasm")),
      {
        wasi_snapshot_preview1: {
          fd_read: () => 0,
          fd_write: () => 0,
          proc_exit: (code: number) => {
            throw Error(`unexpected exit ${code}`);
          },
        },
      },
    );
    api = instance.exports as unknown as Exports;
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
  const memory = Buffer.from(api.memory.buffer);
  const ptr = 33554432;
  const fallback = 33685504;
  memory.write("fallback", fallback);
  const object = 33685632;
  memory.write("row", object);
  const take = ([p, n]: Pair) => Buffer.from(memory.subarray(p, p + n));
  const source = JSON.parse(
    await Deno.readTextFile(
      new URL("./fixtures/text-oracle.json", import.meta.url),
    ),
  );
  for (const [index, item] of source.cases.entries()) {
    const input = Buffer.from(item.input, "base64");
    memory.set(input, ptr);
    for (let i = 0; i < names.length; i++) {
      const name = names[i];
      if (!api[name]) continue;
      api.text_reset(20971520);
      if (name === "comment") {
        memory.writeUInt32LE(ptr, 30000);
        memory.writeUInt32LE(input.length, 30004);
      }
      const args = name === "comment"
        ? [30000, 1]
        : name === "access"
        ? [object, 3, ptr, input.length]
        : name === "field_name"
        ? [ptr, input.length, fallback, 8]
        : [ptr, input.length];
      const result = take((api[name] as (...args: number[]) => Pair)(...args));
      assert.deepEqual(
        result,
        Buffer.from(item.Values[i], "base64"),
        `${name} case${index} input${item.input}`,
      );
    }
    assert.equal(
      api.identifier(ptr, input.length),
      Number(item.Identifier),
      `identifier case${index}`,
    );
  }
  api.text_reset(20971520);
  const scope = api.name_scope();
  for (
    const [base, want] of [
      ["class", "class_2"],
      ["class", "class_3"],
      ["Class", "Class"],
      ["Database", "Database_2"],
      ["GetUser", "GetUser"],
      ["GetUser", "GetUser_2"],
    ] as const
  ) {
    memory.write(base, ptr);
    // Names refer to stable source bytes, just as the generator's compact input
    // and saved text do. Copy the changing test input before retaining its name.
    const [p, n] = api.text_copy(ptr, Buffer.byteLength(base));
    assert.equal(take(api.name_take(scope, p, n)).toString(), want);
  }
  const raw = api.name_scope_raw();
  memory.write("class", ptr);
  assert.equal(
    take(api.name_take(raw, ...api.text_copy(ptr, 5))).toString(),
    "class",
  );
  for (
    const value of [
      0n,
      1n,
      -1n,
      9223372036854775807n,
      -9223372036854775808n,
    ] as const
  ) {
    assert.equal(take(api.decimal(value)).toString(), String(value));
  }
  assert.equal(api.compare(ptr, 0, ptr, 0), 0);
  console.log(
    `text: ${source.cases.length} exact oracle cases across${
      names.filter((n) => api[n]).length
    } string functions; identifiers, scopes, and signed decimals passed`,
  );

  for (
    const [r, want] of [
      [0, "'\\x00'"],
      [7, "'\\a'"],
      [39, "'\\''"],
      [92, "'\\\\'"],
      [10, "'\\n'"],
      [128, "'\\u0080'"],
      [160, "'\\u00a0'"],
      [128512, "'😀'"],
      [-1, "'�'"],
    ] as const
  ) assert.equal(take(api.go_quote_rune(r)).toString(), want);
  for (
    const [s, want] of [["Name", 3], ["A | B", 1], ["() => string", 0], [
      "A extends B ? C : D",
      0,
    ], ["name[]", 3]] as const
  ) {
    memory.write(s, ptr);
    assert.equal(api.type_precedence(ptr, Buffer.byteLength(s)), want, s);
  }
  assert.equal(take(api.comment(30000, 0)).length, 0);

  for (
    const [a, b, want] of [
      ["σ", "ς", 1],
      ["Σ", "ς", 1],
      ["ſ", "S", 1],
      ["K", "k", 1],
      ["µ", "Μ", 1],
      ["Å", "Å", 1],
      ["İ", "i", 0],
      ["ı", "I", 0],
      ["ß", "SS", 0],
      ["ẞ", "ß", 1],
      ["日本語", "日本語", 1],
      ["a", "ab", 0],
      ["", "", 1],
    ] as const
  ) {
    memory.write(a, ptr);
    memory.write(b, ptr + 100);
    assert.equal(
      api.equal_fold(
        ptr,
        Buffer.byteLength(a),
        ptr + 100,
        Buffer.byteLength(b),
      ),
      want,
      a + " / " + b,
    );
  }

  // Explicit retention keeps live scope names after the scratch bytes are reused.
  api.text_reset(20971520);
  const retainedScope = api.name_scope_raw();
  memory.write("ScratchName", ptr);
  const retainedName = api.name_take(retainedScope, ...api.text_copy(ptr, 11));
  api.text_reset(20971520);
  memory.write("XXXXXXXXXXX", ptr);
  api.text_copy(ptr, 11);
  assert.equal(take(retainedName).toString(), "ScratchName");
  memory.write("ScratchName", ptr);
  assert.equal(api.name_used(retainedScope, ptr, 11), 1);
  assert.equal(
    take(api.name_take(retainedScope, ...api.text_copy(ptr, 11))).toString(),
    "ScratchName_2",
  );
  assert.deepEqual(api.retain_text(ptr, 11), [ptr, 11]);
  assert.deepEqual(api.retain_text(...retainedName), retainedName);
});
