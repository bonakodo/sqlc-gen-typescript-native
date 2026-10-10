import { command as execute } from "../wasm/test_helpers.ts";
import { readFile, writeFile, mkdir, stat, readdir } from "node:fs/promises";
import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join, relative } from "node:path";

export const root = fileURLToPath(new URL("../../", import.meta.url));
export const output = fileURLToPath(new URL("./.generated/", import.meta.url));
const pinnedSqlc = join(root, "bin/.tools/sqlc-1.31.1/sqlc");
export const sqlc =
  process.env["SQLC"] ??
  (await stat(pinnedSqlc)
    .then(() => pinnedSqlc)
    .catch(() => "sqlc"));
export type Options = Record<string, unknown>;

export async function run(command: string, args: string[]) {
  const result = await execute(command, args, { cwd: root });
  assert.equal(
    result.status,
    0,
    `${command} ${args.join(" ")}\n${result.stdout}${result.stderr}`,
  );
  return result;
}

export async function plugins() {
  return await Promise.all(
    ["wasm", "raw"].map(async (name) => {
      const path = join(
        root,
        "bin",
        `sqlc-gen-typescript-native${name === "raw" ? ".raw" : ""}.wasm`,
      );
      const bytes = await readFile(path);
      const digest = new Uint8Array(
        await crypto.subtle.digest("SHA-256", bytes),
      );
      const sha256 = [...digest]
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
      return { name, wasm: { url: pathToFileURL(path).href, sha256 } };
    }),
  );
}

export async function generate(directory: string, sql: unknown[]) {
  await mkdir(directory, { recursive: true });
  const config = join(directory, "sqlc.json");
  await writeFile(
    config,
    JSON.stringify({ version: "2", plugins: await plugins(), sql }, null, 2),
  );
  await run(sqlc, ["generate", "-f", config]);
}

export function block(
  engine: string,
  fixture: string,
  directory: string,
  options: Options,
  name = "",
) {
  const source = relative(directory, join(root, "tests", "fixtures", fixture));
  return {
    engine,
    schema: join(source, "schema.sql"),
    queries: join(source, "query.sql"),
    codegen: ["wasm", "raw"].map((plugin) => ({
      plugin,
      out: join(name, plugin),
      options,
    })),
  };
}

export async function files(
  directory: string,
): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for await (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      for (const [name, source] of Object.entries(
        await files(join(directory, entry.name)),
      )) {
        result[join(entry.name, name)] = source;
      }
    } else {
      result[entry.name] = new TextDecoder("utf-8", { fatal: true }).decode(
        await readFile(join(directory, entry.name)),
      );
    }
  }
  return result;
}

export async function compareBuilds(directory: string) {
  const optimized = await files(join(directory, "wasm"));
  assert.deepEqual(
    optimized,
    await files(join(directory, "raw")),
    "raw and optimized WASM output differs",
  );
  return optimized;
}

// Keep generated-code checks strict, including checks of deliberately invalid modules.
export const typecheckArgs = [
  "--ignoreConfig",
  "--noEmit",
  "--allowImportingTsExtensions",
  "--module",
  "NodeNext",
  "--moduleResolution",
  "NodeNext",
  "--target",
  "ES2023",
  "--strict",
  "--noUnusedLocals",
  "--noUnusedParameters",
  "--noUncheckedIndexedAccess",
  "--exactOptionalPropertyTypes",
  "--verbatimModuleSyntax",
  "--types",
  "node",
];
export const tsc = join(root, "node_modules/typescript/bin/tsc");
