import { readFile, writeFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
/**
 * Review intentional fixture changes; never invoked by tests or builds.
 *
 * helpers permits only token-level private helper renames and import ordering.
 * inline-bindings removes only one-use fixed binding locals.
 * All modes check every byte and the historical public API.
 *
 * Install the pinned dependencies with npm ci first. Run with --write only
 * after reviewing source changes and their behavior tests.
 */
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import type { GeneratorCorpus } from "../tests/wasm/fixture_types.ts";
import {
  assertPreservedOutput,
  type OutputCorpus,
  responseFiles,
} from "../tests/wasm/runtime_migration.ts";
import { runPlugin } from "../tests/wasm/wasi_test_host.ts";
import { reviewSqliteReaders } from "./review-sqlite-readers.ts";

const [mode, binary, write] = process.argv.slice(2);
const modes = new Set((mode ?? "").split("+"));
if (
  !binary ||
  [...modes].some(
    (part) => !["helpers", "inline-bindings", "sqlite-readers"].includes(part),
  ) ||
  (write && write !== "--write")
) {
  throw new Error(
    "Usage: node tools/review-output.ts helpers|inline-bindings|sqlite-readers (join modes with +) CANDIDATE.wasm [--write]",
  );
}
const root = fileURLToPath(new URL("../", import.meta.url));
const ts = createRequire(import.meta.url)("typescript");
const fixturePath = `${root}/tests/wasm/fixtures/compact-output.json.gz`;
const fixture: OutputCorpus = JSON.parse(
  gunzipSync(await readFile(fixturePath)).toString(),
);
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const historical = new Map<
  string,
  { request: string; args: string[]; response: Buffer }
>();
for (const name of ["generator", "generator-large"]) {
  const corpus: GeneratorCorpus = JSON.parse(
    gunzipSync(
      await readFile(`${root}/tests/wasm/fixtures/${name}.json.gz`),
    ).toString(),
  );
  for (const c of corpus.cases) {
    historical.set(c.response_sha256, {
      ...c,
      response: Buffer.concat(
        c.response_chunks.map((i: number) =>
          Buffer.from(corpus.response_blobs[i], "base64"),
        ),
      ),
    });
  }
}
const module = await WebAssembly.compile(await readFile(binary));

function names(source: string): string[] {
  return Array.from(
    source.matchAll(
      /^export (?:interface|function|const) ([\p{ID_Continue}$]+)/gmu,
    ),
    (m) => m[1],
  );
}
function imports(source: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const match of source.matchAll(
    /^import (?:type )?\{ (.*?) \} from (.*);$/gm,
  )) {
    for (const specifier of match[1].split(", ")) {
      const [name, alias = name] = specifier.split(" as ");
      result.set(`${match[2]}:${name}`, alias);
    }
  }
  return result;
}
function rename(source: string, mapping: Map<string, string>): string {
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    false,
    ts.LanguageVariant.Standard,
    source,
  );
  let result = "",
    previous = 0;
  while (scanner.scan() !== ts.SyntaxKind.EndOfFileToken) {
    if (scanner.getToken() !== ts.SyntaxKind.Identifier) continue;
    const replacement = mapping.get(scanner.getTokenText());
    if (replacement) {
      result += source.slice(previous, scanner.getTokenPos()) + replacement;
      previous = scanner.getTextPos();
    }
  }
  return result + source.slice(previous);
}
function sortImports(source: string): string {
  return source.replace(
    /^(import (?:type )?\{ )(.*?)( \} from .*;)$/gm,
    (_, start, list, end) =>
      start +
      list
        .split(", ")
        .sort((a: string, b: string) =>
          Buffer.compare(
            Buffer.from(a.split(" as ")[0]),
            Buffer.from(b.split(" as ")[0]),
          ),
        )
        .join(", ") +
      end,
  );
}
function inlineBindings(source: string): string {
  return source.replace(
    /^ {2}const (_sqlcBindings) = (_bind[\w$]*\(args, _q(?:_\d+)?\));\n([\s\S]*?)(?=^})/gm,
    (_, variable: string, expression: string, rest: string) => {
      const scanner = ts.createScanner(
        ts.ScriptTarget.Latest,
        false,
        ts.LanguageVariant.Standard,
        rest,
      );
      let uses = 0;
      while (scanner.scan() !== ts.SyntaxKind.EndOfFileToken) {
        if (
          scanner.getToken() === ts.SyntaxKind.Identifier &&
          scanner.getTokenText() === variable
        )
          uses++;
      }
      assert.equal(uses, 1, "a fixed binding local must have exactly one use");
      return rename(rest, new Map([[variable, expression]]));
    },
  );
}
let count = 0,
  oldSize = 0,
  newSize = 0;
const blobs: string[] = [];
const blobIndexes = new Map<string, number>();
function varint(value: number): Buffer {
  const bytes = [];
  do {
    const byte = value % 128;
    value = Math.floor(value / 128);
    bytes.push(byte | (value ? 128 : 0));
  } while (value);
  return Buffer.from(bytes);
}
function field(number: number, data: Buffer): Buffer {
  return Buffer.concat([varint(number * 8 + 2), varint(data.length), data]);
}
for (const change of fixture.changes) {
  const old = Buffer.concat(
    change.response_chunks.map((i: number) =>
      Buffer.from(fixture.response_blobs[i], "base64"),
    ),
  );
  assert.equal(sha(old), change.after_sha256);
  const original = historical.get(change.before_sha256)!;
  assert(original);
  const run = await runPlugin(
    module,
    Buffer.from(original.request, "base64"),
    original.args,
  );
  assert.equal(run.status, 0, run.stderr.toString());
  const previous = responseFiles(old),
    candidate = responseFiles(run.stdout);
  oldSize += [...previous.values()].reduce(
    (sum, source) => sum + Buffer.byteLength(source),
    0,
  );
  const prior = modes.has("sqlite-readers")
    ? await reviewSqliteReaders(previous, candidate)
    : previous;
  assert.deepEqual([...candidate.keys()], [...prior.keys()]);
  const oldNames = names(prior.get("query_helpers.ts") ?? "");
  const newNames = names(candidate.get("query_helpers.ts") ?? "");
  if (modes.has("helpers")) assert.equal(newNames.length, oldNames.length);
  const mapping = new Map(oldNames.map((name, i) => [name, newNames[i]]));
  const audited = new Map<string, string>();
  for (const [name, source] of prior) {
    const local =
      name === "query_helpers.ts"
        ? new Map(mapping)
        : new Map<string, string>();
    const targetImports = imports(candidate.get(name)!);
    for (const [key, alias] of modes.has("helpers") ? imports(source) : []) {
      const colon = key.lastIndexOf(":");
      const path = key.slice(0, colon),
        imported = key.slice(colon + 1);
      const symbol = path.endsWith('/query_helpers.ts"')
        ? (mapping.get(imported) ?? imported)
        : imported;
      const target = targetImports.get(`${path}:${symbol}`);
      assert(target, `${name}: missing ${path}:${symbol}`);
      if (symbol !== imported) local.set(imported, symbol);
      local.set(alias, target);
    }
    let transformed = modes.has("helpers")
      ? sortImports(rename(source, local))
      : source;
    if (modes.has("inline-bindings")) transformed = inlineBindings(transformed);
    if (transformed !== candidate.get(name)) {
      const diagnostic = await mkdtemp(join(tmpdir(), "sqlc-review-"));
      await writeFile(`${diagnostic}/expected.ts`, transformed);
      await writeFile(`${diagnostic}/actual.ts`, candidate.get(name)!);
      throw new Error(
        `${change.before_sha256} ${name}: contains a change outside ${mode}; compare ${diagnostic}`,
      );
    }
    audited.set(name, transformed);
    newSize += Buffer.byteLength(transformed);
  }
  const chunks = [...audited].map(([name, source]) =>
    field(
      1,
      Buffer.concat([
        field(1, Buffer.from(name)),
        field(2, Buffer.from(source)),
      ]),
    ),
  );
  const next = Buffer.concat(chunks);
  assert(next.equals(run.stdout));
  assertPreservedOutput(original.response, next);
  change.after_sha256 = sha(next);
  change.response_chunks = chunks.map((chunk) => {
    const digest = sha(chunk);
    let index = blobIndexes.get(digest);
    if (index === undefined) {
      index = blobs.length;
      blobs.push(chunk.toString("base64"));
      blobIndexes.set(digest, index);
    }
    return index;
  });
  count++;
}
fixture.response_blobs = blobs;
if (write) {
  for (const mode of modes) {
    const note =
      mode === "helpers"
        ? " Stable private helper labels derive from their full resolved field contracts; SQL, public types, and runtime support remain unchanged."
        : mode === "inline-bindings"
          ? " Fixed binding arrays reach execution helpers directly without a one-use local."
          : " SQLite write queries use shared static result readers with unchanged conversion contracts.";
    if (!fixture.description.includes(note)) fixture.description += note;
  }
  await writeFile(
    fixturePath,
    gzipSync(JSON.stringify(fixture) + "\n", { level: 9 }),
  );
}
console.log(
  JSON.stringify({
    responses: count,
    oldSourceBytes: oldSize,
    newSourceBytes: newSize,
    addedBytes: newSize - oldSize,
    addedPercent: (100 * (newSize - oldSize)) / oldSize,
  }),
);
