/** Counts generated source and optional Vite/Rollup module attribution. */
import { basename, join } from "node:path";

const [directory, attribution] = Deno.args;
if (!directory) {
  throw new Error(
    "Usage: deno run --allow-read tools/measure-generated.ts GENERATED_DIR [BUNDLE_JSON]",
  );
}
const bytes = (source: string) => new TextEncoder().encode(source).length;
const files = [];
for await (const file of Deno.readDir(directory)) {
  if (!file.isFile || !file.name.endsWith(".ts")) continue;
  const source = await Deno.readTextFile(join(directory, file.name));
  files.push({ name: file.name, source, bytes: bytes(source) });
}
const source = files.map((file) => file.source).join("\n");
const queries = [
  ...source.matchAll(/export const \w+Query =\s*(`(?:\\.|[^`])*`);/g),
];
const report: Record<string, unknown> = {
  files: files.length,
  generatedBytes: files.reduce((sum, file) => sum + file.bytes, 0),
  sqlLiteralSourceBytes: queries.reduce(
    (sum, query) => sum + bytes(query[1]!),
    0,
  ),
  queries: queries.length,
  prepareCalls: [...source.matchAll(/database\.prepare\(/g)].length,
  eagerFieldContextCalls: [...source.matchAll(/_codecContext\(_q,/g)].length,
  unpackedBindingWrappers:
    [...source.matchAll(/const \[[^\]]*\] = _bind/g)].length,
  fileBytes: Object.fromEntries(
    files.sort((a, b) => a.name.localeCompare(b.name)).map((
      file,
    ) => [file.name, file.bytes]),
  ),
};
if (attribution) {
  interface Chunk {
    bytes: number;
    imports: string[];
    modules: { id: string; renderedLength: number }[];
  }
  const chunks: Chunk[] = JSON.parse(await Deno.readTextFile(attribution));
  const modules = chunks.flatMap((chunk) => chunk.modules);
  const generated = modules.filter((module) =>
    module.id.includes("/server/db/generated/")
  );
  report.bundle = {
    chunkBytes: chunks.reduce((sum, chunk) => sum + chunk.bytes, 0),
    generatedRenderedBytes: generated.reduce(
      (sum, module) => sum + module.renderedLength,
      0,
    ),
    generatedModuleBytes: Object.fromEntries(
      generated.map((module) => [basename(module.id), module.renderedLength]),
    ),
    bundledDependencyRenderedBytes: modules.filter((module) =>
      module.id.includes("/node_modules/")
    ).reduce((sum, module) => sum + module.renderedLength, 0),
    externalImports: [
      ...new Set(
        chunks.flatMap((chunk) => chunk.imports).filter((name) =>
          !name.startsWith(".") && !name.startsWith("chunks/")
        ),
      ),
    ].sort(),
  };
}
console.log(JSON.stringify(report, null, 2));
