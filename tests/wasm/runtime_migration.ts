// Intentional output changes have separate reviewed fixtures. Tests never
// derive expectations from the candidate or edit the historical Go corpus.
import { Buffer } from "node:buffer";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { posix } from "node:path";

const hash = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
type Field = readonly [number, Buffer];
function fields(bytes: Buffer): Field[] {
  let cursor = 0;
  const uint = () => {
    let value = 0;
    for (let shift = 0; shift < 35; shift += 7) {
      assert.ok(cursor < bytes.length, "truncated frozen response integer");
      const byte = bytes[cursor++];
      value += (byte & 127) * 2 ** shift;
      if (!(byte & 128)) {
        assert.ok(value <= 0xffffffff, "oversized frozen response integer");
        return value;
      }
    }
    throw new Error("oversized frozen response integer");
  };
  const result: Field[] = [];
  while (cursor < bytes.length) {
    const key = uint();
    assert.equal(key % 8, 2, "unexpected frozen response wire type");
    const length = uint();
    assert.ok(
      length <= bytes.length - cursor,
      "truncated frozen response field",
    );
    result.push([Math.floor(key / 8), bytes.subarray(cursor, cursor + length)]);
    cursor += length;
  }
  return result;
}
function varint(value: number): Buffer {
  const bytes: number[] = [];
  do {
    const byte = value % 128;
    value = Math.floor(value / 128);
    bytes.push(byte | (value ? 128 : 0));
  } while (value);
  return Buffer.from(bytes);
}
const encode = (data: readonly Field[]) =>
  Buffer.concat(
    data.map(([number, bytes]) =>
      Buffer.concat([varint(number * 8 + 2), varint(bytes.length), bytes])
    ),
  );
export function responseFiles(response: Buffer): Map<string, string> {
  const result = new Map<string, string>();
  const files = fields(response).map(([number, bytes]) => {
    assert.equal(number, 1, "unexpected frozen response field");
    const file = fields(bytes);
    assert.deepEqual(
      file.map(([key]) => key),
      [1, 2],
      "unexpected frozen File fields",
    );
    assert.ok(encode(file).equals(bytes), "noncanonical frozen File encoding");
    const name = file[0][1].toString();
    assert.ok(!result.has(name), `duplicate generated file ${name}`);
    result.set(name, file[1][1].toString());
    return [1, encode(file)] as const;
  });
  assert.ok(
    encode(files).equals(response),
    "noncanonical frozen response encoding",
  );
  return result;
}

// A scanner for the generated grammar, independent of WAT templates. Keep
// strings/templates/comments intact: quoted braces cannot change boundaries.
interface Token {
  text: string;
  kind: "word" | "string" | "template" | "punct" | "comment";
}
function tokens(source: string): Token[] {
  const result: Token[] = [];
  for (let i = 0; i < source.length;) {
    const start = i, c = source[i++];
    if (/\s/.test(c)) continue;
    if (c === "'" || c === '"' || c === "`") {
      let ended = false;
      while (i < source.length) {
        const next = source[i++];
        if (next === "\\") i++;
        else if (next === c) {
          ended = true;
          break;
        }
      }
      assert.ok(ended, "unterminated generated string");
      result.push({
        text: source.slice(start, i),
        kind: c === "`" ? "template" : "string",
      });
    } else if (c === "/" && source[i] === "/") {
      while (i < source.length && source[i] !== "\n") i++;
      result.push({ text: source.slice(start, i), kind: "comment" });
    } else if (c === "/" && source[i] === "*") {
      const end = source.indexOf("*/", ++i);
      assert.ok(end >= 0, "unterminated generated comment");
      i = end + 2;
      result.push({ text: source.slice(start, i), kind: "comment" });
    } else if (/[\p{ID_Start}\p{ID_Continue}$]/u.test(c)) {
      while (i < source.length && /[\p{ID_Continue}$]/u.test(source[i])) i++;
      result.push({ text: source.slice(start, i), kind: "word" });
    } else result.push({ text: c, kind: "punct" });
  }
  return result;
}
const supportFile = (name: string) =>
  /^(?:runtime(?:_(?:common|postgresql|mysql|sqlite))?|codec_error|query_helpers)\.ts$/
    .test(name);
const modulePath = (file: string, path: string) =>
  path.startsWith(".")
    ? posix.normalize(posix.join(posix.dirname(file), path))
    : path;
const typePath = (path: string) =>
  path.replace(
    /(^|\/)runtime_(?:common|postgresql|mysql|sqlite)\.ts$/,
    "$1runtime.ts",
  );
interface Import {
  path: string;
  name: string;
}
interface Source {
  file: string;
  allTokens: Token[];
  tokens: Token[];
  imports: Map<string, Import>;
  declarations: Token[][];
}
function parse(file: string, text: string): Source {
  const allTokens = tokens(text);
  const all = allTokens.filter((token) => token.kind !== "comment");
  const result: Source = {
    file,
    allTokens,
    tokens: all,
    imports: new Map(),
    declarations: [],
  };
  for (let i = 0; i < all.length;) {
    const start = i;
    let depth = 0;
    do {
      const value = all[i++].text;
      if (value === "{") depth++;
      if (value === "}") depth--;
      if (depth === 0 && (value === ";" || value === "}")) break;
    } while (i < all.length);
    const declaration = all.slice(start, i);
    if (declaration[0].text === "import") {
      const from = declaration.findIndex((token) => token.text === "from");
      // Imports finish after their braces; continue through the semicolon.
      if (from < 0) {
        while (i < all.length && all[i - 1].text !== ";") {
          declaration.push(all[i++]);
        }
      }
      const fromAt = declaration.findIndex((token) => token.text === "from");
      assert.ok(fromAt >= 0, `unsupported generated import in ${file}`);
      const path = modulePath(file, JSON.parse(declaration[fromAt + 1].text));
      let at = declaration.findIndex((token) => token.text === "{") + 1;
      assert.ok(at > 0, `unsupported generated import in ${file}`);
      while (declaration[at].text !== "}") {
        if (declaration[at].text === "type") at++;
        const name = declaration[at++].text;
        let alias = name;
        if (declaration[at].text === "as") {
          at++;
          alias = declaration[at++].text;
        }
        result.imports.set(alias, { path, name });
        if (declaration[at].text === ",") at++;
      }
    } else {
      if (
        declaration[0].text === "export" &&
        (declaration[1]?.text === "{" ||
          (declaration[1]?.text === "type" && declaration[2]?.text === "{"))
      ) {
        while (i < all.length && all[i - 1].text !== ";") {
          declaration.push(all[i++]);
        }
      }
      result.declarations.push(declaration);
    }
  }
  return result;
}
function fieldComments(
  sources: Map<string, Source>,
  source: Source,
  name: string,
  seen = new Set<string>(),
): string[] {
  const key = `${source.file}:${name}`;
  assert.ok(!seen.has(key), `cyclic generated interface ${key}`);
  seen.add(key);
  const imported = source.imports.get(name);
  if (imported && sources.has(imported.path)) {
    return fieldComments(
      sources,
      sources.get(imported.path)!,
      imported.name,
      seen,
    );
  }
  const all = source.allTokens;
  const at = all.findIndex((token, index) =>
    (token.text === "interface" || token.text === "type") &&
    all[index + 1]?.text === name
  );
  assert.ok(at >= 0, `missing shared interface ${key}`);
  let open = at + 2;
  const inherited: string[] = [];
  if (all[open]?.text === "extends") {
    while (all[++open]?.text !== "{") {
      if (all[open].text !== ",") {
        inherited.push(
          ...fieldComments(sources, source, all[open].text, new Set(seen)),
        );
      }
    }
  } else while (all[open]?.text !== "{") open++;
  let depth = 1;
  const result = [...inherited];
  for (let i = open + 1; depth > 0 && i < all.length; i++) {
    if (all[i].kind === "comment") result.push(all[i].text);
    if (all[i].text === "{") depth++;
    if (all[i].text === "}") depth--;
  }
  return result;
}
function otherComments(source: Source): string[] {
  const all = source.allTokens, result: string[] = [];
  for (let i = 0; i < all.length; i++) {
    if (all[i].text === "interface") {
      while (i < all.length && all[i].text !== "{") i++;
      let depth = 1;
      while (depth > 0 && ++i < all.length) {
        if (all[i].text === "{") depth++;
        if (all[i].text === "}") depth--;
      }
    } else if (
      all[i].kind === "comment" && !all[i].text.startsWith("// Code generated")
    ) result.push(all[i].text);
  }
  return result;
}
function canonical(source: Source, values: Token[]): string[] {
  return values.map((token, index) => {
    const imported = token.kind === "word" && source.imports.get(token.text);
    return imported && values[index + 1]?.text !== ":"
      ? `import(${typePath(imported.path)},${imported.name})`
      : token.text;
  });
}
function interfaceBody(
  sources: Map<string, Source>,
  source: Source,
  name: string,
  seen = new Set<string>(),
): string[] {
  const key = `${source.file}:${name}`;
  assert.ok(!seen.has(key), `cyclic generated interface ${key}`);
  seen.add(key);
  const imported = source.imports.get(name);
  if (imported && sources.has(imported.path)) {
    return interfaceBody(
      sources,
      sources.get(imported.path)!,
      imported.name,
      seen,
    );
  }
  const declaration = source.declarations.find((decl) => {
    const at = decl[0].text === "export" ? 1 : 0;
    return (decl[at]?.text === "interface" || decl[at]?.text === "type") &&
      decl[at + 1]?.text === name;
  });
  assert.ok(declaration, `missing shared interface ${key}`);
  const open = declaration.findIndex((token) => token.text === "{");
  assert.ok(open >= 0, `shared type is not an object: ${key}`);
  const close = declaration.findLastIndex((token) => token.text === "}");
  const body: string[] = [];
  const extension = declaration.findIndex((token) => token.text === "extends");
  if (extension >= 0) {
    for (const token of declaration.slice(extension + 1, open)) {
      if (token.text === ",") continue;
      assert.equal(
        token.kind,
        "word",
        `unsupported shared inheritance: ${key}`,
      );
      body.push(...interfaceBody(sources, source, token.text, new Set(seen)));
    }
  }
  body.push(...canonical(source, declaration.slice(open + 1, close)));
  return body;
}
function publicAPI(sources: Map<string, Source>, source: Source): string[][] {
  return source.declarations.filter((declaration) =>
    declaration[0].text === "export"
  ).map((declaration) => {
    if (declaration[1]?.text === "interface") {
      const name = declaration[2].text;
      return [
        "export",
        "interface",
        name,
        "{",
        ...interfaceBody(sources, source, name),
        "}",
      ];
    }
    const functionAt = declaration[1]?.text === "async" ? 2 : 1;
    if (declaration[functionAt]?.text === "function") {
      const open = declaration.findIndex((token) => token.text === "{");
      const closeParen = declaration.findLastIndex((token, index) =>
        index < open && token.text === ")"
      );
      // Factories infer return types from their bodies; compare them in full.
      if (declaration[closeParen + 1]?.text === ":") {
        return canonical(source, declaration.slice(0, open));
      }
    }
    return canonical(source, declaration);
  });
}
function importsValid(before: Map<string, string>, after: Map<string, string>) {
  const paths = (file: string, text: string) =>
    [...text.matchAll(/^(?:import|export)[^\n]* from ("(?:\\.|[^"\\])*");$/gm)]
      .map((
        match,
      ) => modulePath(file, JSON.parse(match[1])));
  const external = new Set<string>();
  for (const [file, text] of before) {
    for (const path of paths(file, text)) {
      if (!before.has(path)) external.add(path);
    }
  }
  for (const [file, text] of after) {
    for (const path of paths(file, text)) {
      if (path.startsWith("@") || !path.endsWith(".ts")) continue;
      assert.ok(
        after.has(path) || external.has(path),
        `${file}: missing generated import ${path}`,
      );
    }
  }
}
// Exact snapshots still check every byte. This independent comparison prevents
// reviewed output changes from also changing the existing public API or SQL.
export function assertPreservedOutput(beforeBytes: Buffer, afterBytes: Buffer) {
  const before = responseFiles(beforeBytes), after = responseFiles(afterBytes);
  assert.deepEqual(
    [...after.keys()].filter((name) => !supportFile(name)),
    [...before.keys()].filter((name) => !supportFile(name)),
    "public output files/order changed",
  );
  const oldSources = new Map(
    [...before].filter(([name]) => !supportFile(name)).map((
      [name, text],
    ) => [name, parse(name, text)]),
  );
  const newSources = new Map(
    [...after].filter(([name]) =>
      !/^runtime(?:_|\.)|^codec_error\.ts$/.test(name)
    ).map(([name, text]) => [name, parse(name, text)]),
  );
  for (const [name, old] of oldSources) {
    const current = newSources.get(name)!;
    assert.deepEqual(
      publicAPI(newSources, current),
      publicAPI(oldSources, old),
      `${name}: public declarations changed`,
    );
    const sql = (source: Source) =>
      source.tokens.filter((token) =>
        token.kind === "template" && token.text.includes("-- name:")
      ).map((token) => token.text);
    assert.deepEqual(sql(current), sql(old), `${name}: SQL text changed`);
    assert.deepEqual(
      otherComments(current),
      otherComments(old),
      `${name}: user comments changed`,
    );
    for (const declaration of old.declarations) {
      if (
        declaration[0]?.text !== "export" ||
        declaration[1]?.text !== "interface"
      ) continue;
      const type = declaration[2].text;
      assert.deepEqual(
        fieldComments(newSources, current, type),
        fieldComments(oldSources, old, type),
        `${name}: ${type} field comments changed`,
      );
    }
  }
  importsValid(before, after);
}
export interface OutputCorpus {
  format: 1;
  description: string;
  response_blobs: string[];
  changes: {
    before_sha256: string;
    after_sha256: string;
    response_chunks: number[];
  }[];
}
export async function createRuntimeMigration() {
  const corpus: OutputCorpus = JSON.parse(
    gunzipSync(
      await Deno.readFile(
        new URL("./fixtures/compact-output.json.gz", import.meta.url),
      ),
    ).toString(),
  );
  assert.equal(corpus.format, 1, "unsupported compact output fixture format");
  const blobs = corpus.response_blobs.map((text) =>
    Buffer.from(text, "base64")
  );
  const expected = new Map<string, Buffer>();
  for (const change of corpus.changes) {
    assert.match(change.before_sha256, /^[a-f0-9]{64}$/);
    assert.ok(
      !expected.has(change.before_sha256),
      "duplicate compact output fixture",
    );
    const response = Buffer.concat(change.response_chunks.map((index) => {
      assert.ok(
        Number.isInteger(index) && index >= 0 && index < blobs.length,
        "invalid compact output chunk",
      );
      return blobs[index];
    }));
    assert.equal(
      hash(response),
      change.after_sha256,
      "compact output fixture hash",
    );
    responseFiles(response);
    expected.set(change.before_sha256, response);
  }
  const covered = new Set<string>();
  return {
    migrate(response: Buffer): Buffer {
      const files = responseFiles(response);
      const key = hash(response), changed = expected.get(key);
      if (changed) {
        assertPreservedOutput(response, changed);
        covered.add(key);
        return changed;
      }
      assert.ok(
        !files.has("runtime.ts"),
        `unreviewed historical runtime response ${key}`,
      );
      return response;
    },
    assertCoverage() {
      assert.deepEqual(
        [...covered].sort(),
        [...expected.keys()].sort(),
        "compact output migrations lost historical coverage",
      );
    },
    assertRuntimeOutput(response: Buffer) {
      const files = responseFiles(response);
      assert.ok(
        !files.has("runtime.ts"),
        "output retained the old combined runtime",
      );
      const engines = [...files.keys()].filter((name) =>
        /^runtime_(?:postgresql|mysql|sqlite)\.ts$/.test(name)
      );
      if (files.has("runtime_common.ts")) {
        assert.equal(
          engines.length,
          1,
          "runtime must include exactly one selected engine",
        );
      } else {
        assert.equal(
          engines.length,
          0,
          "engine runtime has no common runtime",
        );
      }
      for (const [name, text] of files) {
        if (supportFile(name)) {
          assert.doesNotMatch(
            text,
            /^\s*\/\/ @(?:if|endif)\b/m,
            `${name}: leaked runtime section marker`,
          );
        }
      }
    },
  };
}
