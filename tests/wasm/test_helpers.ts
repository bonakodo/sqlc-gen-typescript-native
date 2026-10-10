import { spawn } from "node:child_process";
import { statSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { Buffer } from "node:buffer";
import { fileURLToPath } from "node:url";

export interface CommandOptions {
  cwd?: string;
  env?: Record<string, string>;
  input?: string | Uint8Array;
  encoding?: "utf8" | null;
  timeout?: number;
}

interface CommandResult<T> {
  status: number;
  stdout: T;
  stderr: T;
}

export function command(
  program: string,
  args: string[],
  options: CommandOptions & { encoding: null },
): Promise<CommandResult<Buffer>>;
export function command(
  program: string,
  args: string[],
  options?: CommandOptions,
): Promise<CommandResult<string>>;
export async function command(
  program: string,
  args: string[],
  options: CommandOptions = {},
): Promise<CommandResult<string | Buffer>> {
  return await new Promise((resolve, reject) => {
    const child = spawn(program, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: [options.input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
      timeout: options.timeout,
      killSignal: "SIGKILL",
    });
    const stdout: Buffer[] = [],
      stderr: Buffer[] = [];
    child.stdout!.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr!.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", reject);
    child.stdin?.on("error", (error: NodeJS.ErrnoException) => {
      // A plugin may reject its method before reading the request.
      if (error.code !== "EPIPE") reject(error);
    });
    if (options.input !== undefined) child.stdin!.end(options.input);
    child.on("close", (code, signal) => {
      if (signal) {
        reject(new Error(`${program} terminated by ${signal}`));
        return;
      }
      const decode = (chunks: Buffer[]) =>
        options.encoding === null
          ? Buffer.concat(chunks)
          : Buffer.concat(chunks).toString("utf8");
      resolve({
        status: code ?? 1,
        stdout: decode(stdout),
        stderr: decode(stderr),
      });
    });
  });
}

export async function filenames(path: string): Promise<string[]> {
  return (await readdir(path, { withFileTypes: true })).map(
    (entry) => entry.name,
  );
}

export type Pair = [number, number];
export type Json =
  | null
  | boolean
  | number
  | string
  | Json[]
  | {
      [key: string]: Json;
    };

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// Component fixtures retain the reference printer's exact text. The complete
// generator and integration suites exercise sharing; these guards trap if a
// component accidentally enters that path without the full generation pass.
export const legacyOutputHarness = `
  (global $compact_active i32 (i32.const 0))
  (global $compact_in_helper i32 (i32.const 0))
  (func $compact_context (param i32 i32 i32 i32 i32) (result i32 i32) unreachable)
  (func $compact_field_context (param i32 i32 i32 i32 i32) (result i32 i32) unreachable)
  (func $compact_row_call (param i32 i32) (result i32 i32) unreachable)
  (func $runtime_path (param i32 i32) (result i32 i32) unreachable)
  (func $runtime_file_path (param i32) (result i32 i32) (i32.const 0) (i32.const 0))
  (func $runtime_kind (param i32 i32) unreachable)
  (func $runtime_external_sqlite_codec unreachable)
`;

// Use explicit tool overrides, then the pinned local toolchain, then PATH.
export function wabt(name: "wat2wasm" | "wasm2wat"): string {
  const override = process.env[name.toUpperCase()];
  if (override) return override;
  const pinned = new URL(
    `../../bin/.tools/wabt-1.0.41/bin/${name}`,
    import.meta.url,
  );
  try {
    if (statSync(pinned).isFile()) return fileURLToPath(pinned);
  } catch (error) {
    if (!((error as NodeJS.ErrnoException).code === "ENOENT")) throw error;
  }
  return name;
}

// Keep the frozen Go corpus intact while testing the added driver labels.
export function migrateDriverDiagnostic(text: string): string {
  return text
    .replace(
      "driver is required; use pg, postgres, mysql2, better-sqlite3, or @bonakodo/sqlite",
      "driver is required; use pg, postgres, mysql2, better-sqlite3, node:sqlite, or bun:sqlite",
    )
    .replace(
      "better-sqlite3, @bonakodo/sqlite, node:sqlite",
      "better-sqlite3, node:sqlite",
    )
    .replace(/; use node, bun, or deno/g, "; use node or bun")
    .replace(
      /driver version selectors require runtime: deno; pin the package in package.json for (bun|node)/g,
      "pin driver versions in package.json for Node or Bun",
    );
}

// Historical corpora retain the removed option; current requests omit it.
export function sqliteDefaultOptions(options: Record<string, unknown>) {
  const { sqlite_type_mode: _removed, ...current } = options;
  // Type/override component cases remain useful with the supported Node target.
  if (current.runtime === "deno") current.runtime = "node";
  if (String(current.driver).includes("@bonakodo/sqlite")) {
    current.driver = "node:sqlite";
  }
  return current;
}

export function removedTarget(options: Record<string, unknown>): boolean {
  return Object.entries(options).some(
    ([key, value]) =>
      (key.toLowerCase() === "runtime" && value === "deno") ||
      (key.toLowerCase() === "driver" &&
        String(value).includes("@bonakodo/sqlite")),
  );
}
