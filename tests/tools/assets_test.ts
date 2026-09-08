import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from "@std/assert";
import { toFileUrl } from "@std/path";
import {
  compactSupportText,
  compileRuntimeTemplates,
  generateAssets,
  renderAssets,
  renderRuntimeTemplates,
  runtimeFiles,
  type Templates,
} from "../../tools/assets.ts";

const emptyTemplates: Templates = {
  runtime_common: "",
  runtime_sqlite: "",
  runtime_postgresql: "",
  runtime_mysql: "",
  json: "",
  codec_error: "",
};

Deno.test("assets preserve UTF-8, NUL, and byte addresses", () => {
  const source = renderAssets(
    { mixed: "A\0é猫😀", empty: "", after: "Z" },
    emptyTemplates,
  );
  assertStringIncludes(
    source,
    '(data (i32.const 2686976) "\\41\\00\\c3\\a9\\e7\\8c\\ab\\f0\\9f\\98\\80")',
  );
  assertStringIncludes(
    source,
    "(func $c_mixed (result i32 i32) (i32.const 2686976) (i32.const 11))",
  );
  assertStringIncludes(
    source,
    "(func $c_empty (result i32 i32) (i32.const 2686987) (i32.const 0))",
  );
  assertStringIncludes(source, '(data (i32.const 2686987) "\\5a")');
});

Deno.test("assets omit trusted JSDoc while retaining other source bytes", () => {
  const text = [
    "/** Heading */",
    "export const text = '/** inside a literal */';",
    "  /**",
    "   * Details",
    "   */",
    "// Keep ordinary comments and indentation.",
    "  export const n = 1;",
    "/* Keep ordinary block comments. */",
    "",
  ].join("\n");
  assertEquals(
    compactSupportText(text),
    [
      "export const text = '/** inside a literal */';",
      "// Keep ordinary comments and indentation.",
      "  export const n = 1;",
      "/* Keep ordinary block comments. */",
      "",
    ].join("\n"),
  );
});

Deno.test("assets reject names that could alter WAT syntax", () => {
  for (const name of ["", "___", "a-b", "a\n(func $bad)", "猫", "a\0b"]) {
    assertThrows(
      () => renderAssets({ [name]: "text" }, emptyTemplates),
      Error,
      "Invalid constant name",
    );
  }
});

Deno.test("assets enforce fixed regions using encoded byte lengths", () => {
  const constants = "é".repeat((2899968 - 2686976) / 2);
  renderAssets({ exact: constants }, emptyTemplates);
  assertThrows(
    () => renderAssets({ overflow: constants + "x" }, emptyTemplates),
    Error,
    "Generator constants exceed their fixed memory region",
  );
  assertThrows(
    () =>
      renderAssets({}, {
        ...emptyTemplates,
        json: "猫".repeat(1024 * 1024 / 3),
      }),
    Error,
    "Support text exceeds its fixed read-only memory region",
  );
  assertThrows(
    () =>
      compileRuntimeTemplates({
        ...emptyTemplates,
        runtime_common: Array.from(
          { length: 257 },
          (_, i) => `// @part p${i}\nconst p${i} = 0;\n`,
        ).join(""),
      }),
    Error,
    "fixed selection table",
  );
});

Deno.test("asset files normalize line endings and reject invalid UTF-8", async () => {
  const directory = await Deno.makeTempDir({ prefix: "sqlc-assets-utf8-" });
  const root = toFileUrl(`${directory}/`);
  const runtime = new URL("src/templates/runtime_common.ts", root);
  const constants = new URL("src/strings.json", root);
  const source = '// @part x\r\nexport const x = "猫";\r// Keep this line.\n';
  try {
    await Deno.mkdir(new URL("src/templates/", root), { recursive: true });
    await Deno.writeTextFile(constants, '{\r\n  "name": "é"\r\n}\r\n');
    for (const name of Object.keys(emptyTemplates)) {
      await Deno.writeTextFile(new URL(`src/templates/${name}.ts`, root), "");
    }
    await Deno.writeTextFile(runtime, source);
    assertEquals(
      await generateAssets(root),
      renderAssets({ name: "é" }, {
        ...emptyTemplates,
        runtime_common:
          '// @part x\nexport const x = "猫";\n// Keep this line.\n',
      }),
    );
    await Deno.writeFile(runtime, new Uint8Array([0xc0, 0xaf]));
    await assertRejects(() => generateAssets(root), TypeError);
    await Deno.writeTextFile(runtime, source);
    await Deno.writeFile(
      constants,
      new Uint8Array([0x7b, 0x22, 0x78, 0x22, 0x3a, 0x22, 0xff, 0x22, 0x7d]),
    );
    await assertRejects(() => generateAssets(root), TypeError);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("runtime graph expands shared and conditional dependencies once", () => {
  const templates = {
    ...emptyTemplates,
    runtime_common:
      '// @part shared\nexport const shared = "猫";\n// @part unused\nexport const unused = 0;\n',
    runtime_sqlite:
      '// @part shared common.shared\nimport { shared } from "./runtime_common.ts";\n// @part parsed\nconst parsed = 1;\n// @part convert\nfunction convert() {\n// @when json\nreturn parsed;\n// @endwhen\nreturn shared; // unused is only a comment\n}\n',
  };
  const basic = renderRuntimeTemplates(templates, 4, ["convert"], ["string"]);
  assertEquals(basic.get("runtime_common.ts"), 'export const shared = "猫";\n');
  assertEquals(
    basic.get("runtime_sqlite.ts"),
    'import { shared } from "./runtime_common.ts";\nfunction convert() {\nreturn shared; // unused is only a comment\n}\n',
  );
  assertStringIncludes(
    renderRuntimeTemplates(templates, 5, ["convert"], ["json"]).get(
      "runtime_sqlite.ts",
    )!,
    "const parsed = 1;",
  );
});

Deno.test("runtime graph tracks type references, driver variants, and forced kinds", () => {
  const templates = {
    ...emptyTemplates,
    runtime_postgresql: [
      "// @part Types",
      "type Types = number;",
      "// @part driver @pg",
      'const driver = "pg";',
      "// @part driver @postgres",
      'const driver = "postgres";',
      "// @part extra",
      "const extra = 1;",
      "// @part scalar",
      "function scalar(): Types {",
      "// @when unknown",
      "return extra;",
      "// @endwhen",
      "return driver.length;",
      "}",
      "// @part custom",
      "// @kind unknown",
      "function custom() { return scalar(); }",
      "",
    ].join("\n"),
  };
  for (const [driver, label] of [[1, "pg"], [2, "postgres"]] as const) {
    const output = renderRuntimeTemplates(templates, driver, ["custom"], [])
      .get("runtime_postgresql.ts")!;
    assertStringIncludes(output, "type Types = number;");
    assertStringIncludes(output, `const driver = "${label}";`);
    assertStringIncludes(output, "const extra = 1;");
  }
});

Deno.test("runtime markers reject missing, overlapping, and malformed declarations", () => {
  for (
    const [source, message] of [
      ["const x = 1;", "precedes"],
      ["// @part", "identifier"],
      ["// @part x @bad\n", "Unknown runtime driver"],
      ["// @part x @pg\n", "does not belong"],
      ["// @part x missing\n", "Missing runtime dependency"],
      ["// @part x\n// @part x\n", "Duplicate"],
      ["// @part x\n// @when json\n// @when date\n", "cannot nest"],
      ["// @part x\n// @when bad\n", "Unknown runtime kind"],
      ["// @part x\n// @when json\n", "missing @endwhen"],
      ["// @part x\n// @endwhen\n", "unmatched"],
      ["// @part x\n// @kind\n", "requires"],
      ["// @wrong x\n", "Unknown runtime directive"],
    ]
  ) {
    assertThrows(
      () =>
        compileRuntimeTemplates({ ...emptyTemplates, runtime_sqlite: source! }),
      Error,
      message,
    );
  }
  for (const driver of [-1, 0, 6, 1.5, NaN]) {
    assertThrows(
      () => renderRuntimeTemplates(emptyTemplates, driver, [], []),
      Error,
      "driver",
    );
  }
});

Deno.test("runtime descriptors retain complete UTF-8 source and declaration metadata", () => {
  const source = renderAssets({}, {
    ...emptyTemplates,
    runtime_common: '// @part shared\nexport const shared = "猫";\n',
  });
  const spans = new Map<number, Uint8Array>();
  for (
    const match of source.matchAll(
      /^\(data \(i32.const (\d+)\) "((?:\\[0-9a-f]{2})*)"\)$/gm,
    )
  ) {
    spans.set(
      Number(match[1]),
      Uint8Array.from(
        match[2]!.match(/\\[0-9a-f]{2}/g) ?? [],
        (byte) => Number.parseInt(byte.slice(1), 16),
      ),
    );
  }
  assertStringIncludes(
    source,
    "(global $asset_runtime_parts_n i32 (i32.const 1))",
  );
  const tableAddress = Number(
    /\(global \$asset_runtime_parts_p i32 \(i32.const (\d+)\)\)/.exec(
      source,
    )![1],
  );
  const table = new DataView(spans.get(tableAddress)!.buffer);
  assertEquals(table.getUint32(0, true), 62);
  assertEquals(table.getUint32(4, true), 0);
  const decoder = new TextDecoder("utf-8", { fatal: true });
  assertEquals(decoder.decode(spans.get(table.getUint32(8, true))), "shared");
  const fragment = new DataView(spans.get(table.getUint32(16, true))!.buffer);
  assertEquals(
    decoder.decode(spans.get(fragment.getUint32(4, true))),
    'export const shared = "猫";\n',
  );
});

Deno.test("real runtime templates prune unused helpers and engine-specific branches", async () => {
  const templates = { ...emptyTemplates };
  for (const [key, filename] of runtimeFiles) {
    templates[key] = await Deno.readTextFile(
      new URL(`../../src/templates/${filename}`, import.meta.url),
    );
  }
  for (const driver of [1, 2, 3]) {
    const files = renderRuntimeTemplates(templates, driver, [
      "encodeValue",
      "decodeValue",
    ], ["string"]);
    const output = [...files.values()].join("");
    assertStringIncludes(output, 'case "string":');
    for (
      const unused of [
        "checkedJson",
        "Buffer",
        "mysqlInsertId",
        "parseArrayText",
        "encodeArray",
        "encodeCustom",
        "jsonDriver",
      ]
    ) {
      assert(
        !output.includes(unused),
        `${unused} should be pruned for driver ${driver}`,
      );
    }
  }
  const sqlite = renderRuntimeTemplates(templates, 5, ["decodeValue"], [
    "string",
  ]).get("runtime_sqlite.ts")!;
  for (
    const unused of [
      "dateValue",
      "finiteNumber",
      "minInt64",
      "jsonText",
      "TextEncoder",
      "lastInsertId",
    ]
  ) assert(!sqlite.includes(unused), unused);
  const json = renderRuntimeTemplates(templates, 5, ["jsonText"], []).get(
    "runtime_sqlite.ts",
  )!;
  assertStringIncludes(json, "function createJsonTextCodec");
  assert(!json.includes("safeInteger"));
  const pg = renderRuntimeTemplates(templates, 1, ["decodeArray"], ["string"])
    .get("runtime_postgresql.ts")!;
  assertStringIncludes(pg, "function parseArrayText");
  assert(!pg.includes("mysqlInsertId"));
  const mysql = renderRuntimeTemplates(templates, 3, ["mysqlInsertId"], []);
  assertStringIncludes(
    mysql.get("runtime_common.ts")!,
    "function integerResult",
  );
  assertStringIncludes(
    mysql.get("runtime_mysql.ts")!,
    "export { integerResult }",
  );
  assert(![...mysql.values()].join("").includes("PostgreSQL"));
  const external = renderRuntimeTemplates(templates, 5, ["externalCodecs"], []);
  for (
    const name of [
      "safeInteger",
      "epochMilliseconds",
      "sqliteBoolean",
      "jsonText",
      "createJsonTextCodec",
    ]
  ) {
    assertStringIncludes(external.get("runtime_sqlite.ts")!, name);
  }
  assert(!external.get("runtime_sqlite.ts")!.includes("lastInsertId"));
});

Deno.test("common server implementations retain only their engine reexports", () => {
  const templates = {
    ...emptyTemplates,
    runtime_common:
      "// @part helper @pg @postgres @mysql2 postgresql.helper mysql.helper\nexport function helper() { return 1; }\n",
    runtime_postgresql:
      '// @part helper common.helper\nexport { helper } from "./runtime_common.ts";\n',
    runtime_mysql:
      '// @part helper common.helper\nexport { helper } from "./runtime_common.ts";\n',
  };
  for (
    const [driver, engine] of [[1, "postgresql"], [2, "postgresql"], [
      3,
      "mysql",
    ]] as const
  ) {
    const output = renderRuntimeTemplates(templates, driver, ["helper"], []);
    assertStringIncludes(output.get("runtime_common.ts")!, "function helper");
    assertStringIncludes(
      output.get(`runtime_${engine}.ts`)!,
      "export { helper }",
    );
    assertEquals(
      [...output.values()].join("").match(/function helper/g)?.length,
      1,
    );
    assertEquals(output.size, 2);
  }
});
