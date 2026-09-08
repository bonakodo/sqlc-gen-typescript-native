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
  const child = new Deno.Command(program, {
    args,
    signal: options.timeout === undefined
      ? undefined
      : AbortSignal.timeout(options.timeout),
    cwd: options.cwd,
    env: options.env,
    stdin: options.input === undefined ? "null" : "piped",
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  const write = async () => {
    if (options.input === undefined) return;
    const writer = child.stdin.getWriter();
    try {
      await writer.write(
        typeof options.input === "string"
          ? new TextEncoder().encode(options.input)
          : options.input,
      );
      await writer.close();
    } catch (error) {
      // A plugin can reject its method before reading any request bytes.
      // Keep its exit status and diagnostic when it closes stdin early.
      if (!(error instanceof Deno.errors.BrokenPipe)) throw error;
    } finally {
      writer.releaseLock();
    }
  };
  const [result] = await Promise.all([child.output(), write()]);
  const decode = (bytes: Uint8Array) =>
    options.encoding === null
      ? Buffer.from(bytes)
      : new TextDecoder().decode(bytes);
  return {
    status: result.code,
    stdout: decode(result.stdout),
    stderr: decode(result.stderr),
  };
}

export async function filenames(path: string): Promise<string[]> {
  return (await Array.fromAsync(Deno.readDir(path))).map((entry) => entry.name);
}

export type Pair = [number, number];
export type Json = null | boolean | number | string | Json[] | {
  [key: string]: Json;
};

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// Use explicit tool overrides, then the pinned local toolchain, then PATH.
export function wabt(name: "wat2wasm" | "wasm2wat"): string {
  const override = Deno.env.get(name.toUpperCase());
  if (override) return override;
  const pinned = new URL(
    `../../bin/.tools/wabt-1.0.41/bin/${name}`,
    import.meta.url,
  );
  try {
    if (Deno.statSync(pinned).isFile) return fileURLToPath(pinned);
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
  return name;
}
