import { test } from "node:test";
import { readFile, writeFile, rm, mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { pathToFileURL as toFileUrl } from "node:url";
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

test("assets preserve UTF-8, NUL, and byte addresses", () => {
  const source = renderAssets(
    { mixed: "A\0é猫😀", empty: "", after: "Z" },
    emptyTemplates,
  );
  includes(
    source,
    '(data (i32.const 2686976) "\\41\\00\\c3\\a9\\e7\\8c\\ab\\f0\\9f\\98\\80")',
  );
  includes(
    source,
    "(func $c_mixed (result i32 i32) (i32.const 2686976) (i32.const 11))",
  );
  includes(
    source,
    "(func $c_empty (result i32 i32) (i32.const 2686987) (i32.const 0))",
  );
  includes(source, '(data (i32.const 2686987) "\\5a")');
});

test("assets omit trusted JSDoc while retaining other source bytes", () => {
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
  assert.deepEqual(
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

test("assets reject names that could alter WAT syntax", () => {
  for (const name of ["", "___", "a-b", "a\n(func $bad)", "猫", "a\0b"]) {
    assert.throws(() => renderAssets({ [name]: "text" }, emptyTemplates), {
      message: new RegExp("Invalid constant name"),
    });
  }
});

test("assets enforce fixed regions using encoded byte lengths", () => {
  const constants = "é".repeat((2899968 - 2686976) / 2);
  renderAssets({ exact: constants }, emptyTemplates);
  assert.throws(
    () => renderAssets({ overflow: constants + "x" }, emptyTemplates),
    {
      message: new RegExp(
        "Generator constants exceed their fixed memory region",
      ),
    },
  );
  assert.throws(
    () =>
      renderAssets(
        {},
        {
          ...emptyTemplates,
          json: "猫".repeat((1024 * 1024) / 3),
        },
      ),
    {
      message: new RegExp(
        "Support text exceeds its fixed read-only memory region",
      ),
    },
  );
  assert.throws(
    () =>
      compileRuntimeTemplates({
        ...emptyTemplates,
        runtime_common: Array.from(
          { length: 257 },
          (_, i) => `// @part p${i}\nconst p${i} = 0;\n`,
        ).join(""),
      }),
    { message: new RegExp("fixed selection table") },
  );
});

test("asset files normalize line endings and reject invalid UTF-8", async () => {
  const directory = await mkdtemp(join(tmpdir(), "sqlc-assets-utf8-"));
  const root = toFileUrl(`${directory}/`);
  const runtime = new URL("src/templates/runtime_common.ts", root);
  const constants = new URL("src/strings.json", root);
  const source = '// @part x\r\nexport const x = "猫";\r// Keep this line.\n';
  try {
    await mkdir(new URL("src/templates/", root), { recursive: true });
    await writeFile(constants, '{\r\n  "name": "é"\r\n}\r\n');
    for (const name of [
      ...Object.keys(emptyTemplates),
      "execution_sqlite",
      "execution_postgresql",
      "execution_mysql",
    ]) {
      await writeFile(new URL(`src/templates/${name}.ts`, root), "");
    }
    await writeFile(runtime, source);
    assert.deepEqual(
      await generateAssets(root),
      renderAssets(
        { name: "é" },
        {
          ...emptyTemplates,
          runtime_common:
            '// @part x\nexport const x = "猫";\n// Keep this line.\n',
        },
      ),
    );
    await writeFile(runtime, new Uint8Array([0xc0, 0xaf]));
    await assert.rejects(() => generateAssets(root), TypeError);
    await writeFile(runtime, source);
    await writeFile(
      constants,
      new Uint8Array([0x7b, 0x22, 0x78, 0x22, 0x3a, 0x22, 0xff, 0x22, 0x7d]),
    );
    await assert.rejects(() => generateAssets(root), TypeError);
  } finally {
    await rm(directory, { recursive: true });
  }
});

test("runtime graph expands shared and conditional dependencies once", () => {
  const templates = {
    ...emptyTemplates,
    runtime_common:
      '// @part shared\nexport const shared = "猫";\n// @part unused\nexport const unused = 0;\n',
    runtime_sqlite:
      '// @part shared common.shared\nimport { shared } from "./runtime_common.ts";\n// @part parsed\nconst parsed = 1;\n// @part convert\nfunction convert() {\n// @when json\nreturn parsed;\n// @endwhen\nreturn shared; // unused is only a comment\n}\n',
  };
  const basic = renderRuntimeTemplates(templates, 4, ["convert"], ["string"]);
  assert.deepEqual(
    basic.get("runtime_common.ts"),
    'export const shared = "猫";\n',
  );
  assert.deepEqual(
    basic.get("runtime_sqlite.ts"),
    'import { shared } from "./runtime_common.ts";\nfunction convert() {\nreturn shared; // unused is only a comment\n}\n',
  );
  includes(
    renderRuntimeTemplates(templates, 6, ["convert"], ["json"]).get(
      "runtime_sqlite.ts",
    )!,
    "const parsed = 1;",
  );
});

test("runtime graph tracks type references, driver variants, and forced kinds", () => {
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
  for (const [driver, label] of [
    [1, "pg"],
    [2, "postgres"],
  ] as const) {
    const output = renderRuntimeTemplates(
      templates,
      driver,
      ["custom"],
      [],
    ).get("runtime_postgresql.ts")!;
    includes(output, "type Types = number;");
    includes(output, `const driver = "${label}";`);
    includes(output, "const extra = 1;");
  }
});

test("node:sqlite runtime parts select built-in statements and prune other drivers", () => {
  const templates = {
    ...emptyTemplates,
    runtime_sqlite: [
      "// @part Database",
      "type Database = unknown;",
      "// @part prepare @node-sqlite",
      "function prepare(database: Database) { return database; }",
      "// @part prepare @better-sqlite3 @bun-sqlite",
      "function prepare() { throw new Error('other driver'); }",
      "// @part execute",
      "function execute(database: Database) { return prepare(database); }",
      "// @part unused",
      "function unused() {}",
      "",
    ].join("\n"),
  };
  const output = renderRuntimeTemplates(templates, 6, ["execute"], []).get(
    "runtime_sqlite.ts",
  )!;
  includes(output, "type Database = unknown;");
  includes(output, "function prepare(database: Database)");
  includes(output, "function execute(database: Database)");
  assert(!output.includes("other driver"));
  assert(!output.includes("unused"));
});

test("runtime markers reject missing, overlapping, and malformed declarations", () => {
  for (const [source, message] of [
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
  ]) {
    assert.throws(
      () =>
        compileRuntimeTemplates({ ...emptyTemplates, runtime_sqlite: source! }),
      { message: new RegExp(message) },
    );
  }
  for (const driver of [-1, 0, 8, 1.5, NaN]) {
    assert.throws(
      () => renderRuntimeTemplates(emptyTemplates, driver, [], []),
      { message: new RegExp("driver") },
    );
  }
});

test("runtime descriptors retain complete UTF-8 source and declaration metadata", () => {
  const source = renderAssets(
    {},
    {
      ...emptyTemplates,
      runtime_common: '// @part shared\nexport const shared = "猫";\n',
    },
  );
  const spans = new Map<number, Uint8Array>();
  for (const match of source.matchAll(
    /^\(data \(i32.const (\d+)\) "((?:\\[0-9a-f]{2})*)"\)$/gm,
  )) {
    spans.set(
      Number(match[1]),
      Uint8Array.from(match[2]!.match(/\\[0-9a-f]{2}/g) ?? [], (byte) =>
        Number.parseInt(byte.slice(1), 16),
      ),
    );
  }
  includes(source, "(global $asset_runtime_parts_n i32 (i32.const 1))");
  const tableAddress = Number(
    /\(global \$asset_runtime_parts_p i32 \(i32.const (\d+)\)\)/.exec(
      source,
    )![1],
  );
  const table = new DataView(spans.get(tableAddress)!.buffer);
  assert.deepEqual(table.getUint32(0, true), 222);
  assert.deepEqual(table.getUint32(4, true), 0);
  const decoder = new TextDecoder("utf-8", { fatal: true });
  assert.deepEqual(
    decoder.decode(spans.get(table.getUint32(8, true))),
    "shared",
  );
  const fragment = new DataView(spans.get(table.getUint32(16, true))!.buffer);
  assert.deepEqual(
    decoder.decode(spans.get(fragment.getUint32(4, true))),
    'export const shared = "猫";\n',
  );
});

test("real runtime templates prune unused helpers and engine-specific branches", async () => {
  const templates = { ...emptyTemplates };
  for (const [key, filename] of runtimeFiles) {
    templates[key] = await readFile(
      new URL(`../../src/templates/${filename}`, import.meta.url),
      "utf8",
    );
  }
  for (const driver of [1, 2, 3]) {
    const files = renderRuntimeTemplates(
      templates,
      driver,
      ["encodeValue", "decodeValue"],
      ["string"],
    );
    const output = [...files.values()].join("");
    includes(output, 'case "string":');
    for (const unused of [
      "checkedJson",
      "Buffer",
      "mysqlInsertId",
      "parseArrayText",
      "encodeArray",
      "encodeCustom",
      "jsonDriver",
    ]) {
      assert(
        !output.includes(unused),
        `${unused} should be pruned for driver ${driver}`,
      );
    }
  }
  const sqlite = renderRuntimeTemplates(
    templates,
    6,
    ["decodeValue"],
    ["string"],
  ).get("runtime_sqlite.ts")!;
  for (const unused of [
    "dateValue",
    "finiteNumber",
    "minInt64",
    "jsonText",
    "TextEncoder",
    "lastInsertId",
  ])
    assert(!sqlite.includes(unused), unused);
  const json = renderRuntimeTemplates(templates, 6, ["jsonText"], []).get(
    "runtime_sqlite.ts",
  )!;
  includes(json, "function createJsonTextCodec");
  assert(!json.includes("safeInteger"));
  const pg = renderRuntimeTemplates(
    templates,
    1,
    ["decodeArray"],
    ["string"],
  ).get("runtime_postgresql.ts")!;
  includes(pg, "function parseArrayText");
  assert(!pg.includes("mysqlInsertId"));
  const mysql = renderRuntimeTemplates(templates, 3, ["mysqlInsertId"], []);
  includes(mysql.get("runtime_common.ts")!, "function integerResult");
  includes(mysql.get("runtime_mysql.ts")!, "export { integerResult }");
  assert(![...mysql.values()].join("").includes("PostgreSQL"));
  const external = renderRuntimeTemplates(templates, 6, ["externalCodecs"], []);
  for (const name of [
    "safeInteger",
    "epochMilliseconds",
    "sqliteBoolean",
    "jsonText",
    "createJsonTextCodec",
  ]) {
    includes(external.get("runtime_sqlite.ts")!, name);
  }
  assert(!external.get("runtime_sqlite.ts")!.includes("lastInsertId"));
});

test("common server implementations retain only their engine reexports", () => {
  const templates = {
    ...emptyTemplates,
    runtime_common:
      "// @part helper @pg @postgres @mysql2 postgresql.helper mysql.helper\nexport function helper() { return 1; }\n",
    runtime_postgresql:
      '// @part helper common.helper\nexport { helper } from "./runtime_common.ts";\n',
    runtime_mysql:
      '// @part helper common.helper\nexport { helper } from "./runtime_common.ts";\n',
  };
  for (const [driver, engine] of [
    [1, "postgresql"],
    [2, "postgresql"],
    [3, "mysql"],
  ] as const) {
    const output = renderRuntimeTemplates(templates, driver, ["helper"], []);
    includes(output.get("runtime_common.ts")!, "function helper");
    includes(output.get(`runtime_${engine}.ts`)!, "export { helper }");
    assert.deepEqual(
      [...output.values()].join("").match(/function helper/g)?.length,
      1,
    );
    assert.deepEqual(output.size, 2);
  }
});

function includes(actual: string, expected: string) {
  assert.ok(
    actual.includes(expected),
    `Expected ${JSON.stringify(actual)} to include ${JSON.stringify(expected)}`,
  );
}
