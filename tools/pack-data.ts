/** Pack active WAT data without changing executable source text. */
export const STATIC_LIMIT = 4 * 1024 * 1024;
export const PACKED_BEGIN = 32 * 1024 * 1024;
export const SCRATCH_LIMIT = 1024 * 1024;

export interface DataSegment {
  address: number;
  bytes: Uint8Array;
  begin: number;
  end: number;
}

interface Token {
  word: string;
  begin: number;
  end: number;
}

const encoder = new TextEncoder();
const whitespace = /\p{White_Space}/u;
const isWhitespace = (value: string) => {
  const code = value.charCodeAt(0);
  return whitespace.test(value) || (code >= 0x1c && code <= 0x1f);
};

/** Keep source spans so comments, functions, and all other text stay intact. */
export function* tokens(source: string): Generator<Token> {
  let at = 0;
  while (at < source.length) {
    if (isWhitespace(source[at])) {
      at++;
    } else if (source.startsWith(";;", at)) {
      const end = source.indexOf("\n", at);
      at = end < 0 ? source.length : end;
    } else if (source.startsWith("(;", at)) {
      let depth = 1;
      at += 2;
      while (depth && at < source.length) {
        if (source.startsWith("(;", at)) {
          depth++;
          at += 2;
        } else if (source.startsWith(";)", at)) {
          depth--;
          at += 2;
        } else at++;
      }
      if (depth) throw new Error("Unclosed WAT block comment");
    } else if (source[at] === "(" || source[at] === ")") {
      yield { word: source[at], begin: at, end: at + 1 };
      at++;
    } else if (source[at] === '"') {
      const begin = at++;
      while (at < source.length && source[at] !== '"') {
        at += source[at] === "\\" ? 2 : 1;
      }
      if (at >= source.length) throw new Error("Unclosed WAT string");
      at++;
      yield { word: source.slice(begin, at), begin, end: at };
    } else {
      const begin = at;
      while (
        at < source.length && !isWhitespace(source[at]) &&
        !'()"'.includes(source[at])
      ) at++;
      yield { word: source.slice(begin, at), begin, end: at };
    }
  }
}

/** Decode WAT byte escapes and Unicode scalars without replacement characters. */
export function stringBytes(word: string): Uint8Array {
  if (word.length < 2 || word[0] !== '"' || word.at(-1) !== '"') {
    throw new Error("Expected a WAT string");
  }
  const result: number[] = [];
  const short: Record<string, number> = {
    n: 10,
    r: 13,
    t: 9,
    "\\": 92,
    '"': 34,
    "'": 39,
  };
  const scalar = (value: number) => {
    if (value > 0x10ffff || (value >= 0xd800 && value <= 0xdfff)) {
      throw new Error("Invalid Unicode scalar in WAT string");
    }
    result.push(...encoder.encode(String.fromCodePoint(value)));
  };
  for (let at = 1; at < word.length - 1;) {
    if (word[at] !== "\\") {
      const value = word.codePointAt(at)!;
      if (value === 34) throw new Error("Unexpected quote in WAT string");
      if (value < 32 || value === 127) {
        throw new Error("Unescaped control in WAT string");
      }
      scalar(value);
      at += value > 0xffff ? 2 : 1;
    } else if (at + 1 >= word.length - 1) {
      throw new Error("Unclosed WAT string escape");
    } else if (Object.hasOwn(short, word[at + 1])) {
      result.push(short[word[at + 1]]);
      at += 2;
    } else if (word.startsWith("\\u{", at)) {
      const end = word.indexOf("}", at + 3);
      const hex = word.slice(at + 3, end);
      if (end < 0 || !/^[\da-f](?:_?[\da-f])*$/i.test(hex)) {
        throw new Error("Invalid WAT Unicode escape");
      }
      scalar(Number.parseInt(hex.replaceAll("_", ""), 16));
      at = end + 1;
    } else {
      const hex = word.slice(at + 1, at + 3);
      if (!/^[\da-f]{2}$/i.test(hex)) {
        throw new Error("Invalid WAT byte escape");
      }
      result.push(Number.parseInt(hex, 16));
      at += 3;
    }
  }
  return Uint8Array.from(result);
}

/** Read active constant-offset data, preserving declaration order. */
export function readData(source: string): DataSegment[] {
  const items = [...tokens(source)], result: DataSegment[] = [];
  if (items[0]?.word !== "(" || items[1]?.word !== "module") {
    throw new Error("Expected a complete WAT module");
  }
  let depth = 0;
  for (let at = 0; at < items.length;) {
    const { word, begin } = items[at];
    if (word === "(" && depth === 1 && items[at + 1]?.word === "data") {
      if (
        items[at + 2]?.word !== "(" || items[at + 3]?.word !== "i32.const" ||
        items[at + 5]?.word !== ")"
      ) {
        throw new Error(
          "Only active data with a constant i32 offset can be packed",
        );
      }
      const literal = items[at + 4].word;
      if (!/^[+-]?(?:0x[\da-f](?:_?[\da-f])*|\d(?:_?\d)*)$/i.test(literal)) {
        throw new Error("Invalid WAT data offset");
      }
      const normalized = literal.replaceAll("_", "");
      const sign = normalized.startsWith("-") ? -1 : 1;
      const magnitude = normalized.replace(/^[+-]/, "");
      const address = sign *
        Number.parseInt(magnitude, /^0x/i.test(magnitude) ? 16 : 10);
      let end = at + 6;
      const data: Uint8Array[] = [];
      while (items[end]?.word.startsWith('"')) {
        data.push(stringBytes(items[end++].word));
      }
      if (!data.length || items[end]?.word !== ")") {
        throw new Error("Unexpected active data syntax");
      }
      const length = data.reduce((sum, part) => sum + part.length, 0);
      if (
        address < 0 || address > STATIC_LIMIT || length > STATIC_LIMIT - address
      ) {
        throw new Error("Static data must fit below 4 MiB");
      }
      const bytes = new Uint8Array(length);
      let cursor = 0;
      for (const part of data) {
        bytes.set(part, cursor);
        cursor += part.length;
      }
      result.push({ address, bytes, begin, end: items[end].end });
      at = end + 1;
      continue;
    }
    depth += Number(word === "(") - Number(word === ")");
    if (depth < 0 || (depth === 0 && at !== items.length - 1)) {
      throw new Error("Unbalanced WAT source");
    }
    at++;
  }
  if (depth) throw new Error("Unbalanced WAT source");
  return result;
}

/** Merge gaps up to eight bytes and keep Wasm's last-write rule for overlaps. */
export function layout(
  data: readonly Pick<DataSegment, "address" | "bytes">[],
): Uint8Array {
  let size = 0;
  for (const { address, bytes } of data) {
    if (
      !Number.isInteger(address) || address < 0 || address > STATIC_LIMIT ||
      bytes.length > STATIC_LIMIT - address
    ) {
      throw new Error("Static data must fit below 4 MiB");
    }
    size = Math.max(size, address + bytes.length);
  }
  const image = new Uint8Array(size);
  for (const { address, bytes } of data) image.set(bytes, address);
  const ranges: [number, number][] = [];
  for (
    const { address, bytes } of [...data].sort((a, b) => a.address - b.address)
  ) {
    if (!bytes.length) continue;
    const end = address + bytes.length, last = ranges.at(-1);
    if (last && address <= last[1] + 8) last[1] = Math.max(end, last[1]);
    else ranges.push([address, end]);
  }
  const length = 4 + ranges.length * 8 +
    ranges.reduce((sum, [a, b]) => sum + b - a, 0);
  if (length > SCRATCH_LIMIT) {
    throw new Error("Static layout exceeds the 1 MiB decoder scratch bound");
  }
  const result = new Uint8Array(length), view = new DataView(result.buffer);
  view.setUint32(0, ranges.length, true);
  let cursor = 4 + ranges.length * 8;
  ranges.forEach(([begin, end], i) => {
    view.setUint32(4 + i * 8, begin, true);
    view.setUint32(8 + i * 8, end - begin, true);
    result.set(image.subarray(begin, end), cursor);
    cursor += end - begin;
  });
  return result;
}

/** Greedy LZ packing: 64 KiB history, 256 candidates, newest equal match wins. */
export function pack(data: Uint8Array): Uint8Array {
  if (data.length > SCRATCH_LIMIT) {
    throw new Error("Static layout exceeds the 1 MiB decoder scratch bound");
  }
  const result: number[] = [], chains = new Map<number, number[]>();
  let anchor = 0, position = 0;
  const key = (at: number) =>
    data[at] | data[at + 1] << 8 | data[at + 2] << 16 | data[at + 3] << 24;
  const extension = (length: number) => {
    while (length >= 255) {
      result.push(255);
      length -= 255;
    }
    result.push(length);
  };
  const remember = (at: number) => {
    if (at + 4 > data.length) return;
    const word = key(at);
    let chain = chains.get(word);
    if (!chain) chains.set(word, chain = []);
    chain.push(at);
    while (at - chain[0] > 65535 || chain.length > 256) chain.shift();
  };
  while (position + 4 <= data.length) {
    let best = 0, distance = 0;
    const chain = chains.get(key(position)) ?? [];
    for (let i = chain.length - 1; i >= 0; i--) {
      const earlier = chain[i];
      if (position - earlier > 65535) break;
      let length = 4;
      while (
        position + length < data.length &&
        data[earlier + length] === data[position + length]
      ) length++;
      if (length > best) {
        best = length;
        distance = position - earlier;
        if (position + best === data.length) break;
      }
    }
    if (best < 4) {
      remember(position++);
      continue;
    }
    const literal = position - anchor, match = best - 4;
    result.push(Math.min(literal, 15) * 16 + Math.min(match, 15));
    if (literal >= 15) extension(literal - 15);
    for (let at = anchor; at < position; at++) result.push(data[at]);
    result.push(distance & 255, distance >>> 8);
    if (match >= 15) extension(match - 15);
    for (let at = position; at < position + best; at++) remember(at);
    position += best;
    anchor = position;
  }
  if (anchor < data.length) {
    const literal = data.length - anchor;
    result.push(Math.min(literal, 15) * 16);
    if (literal >= 15) extension(literal - 15);
    for (let at = anchor; at < data.length; at++) result.push(data[at]);
  }
  if (result.length > SCRATCH_LIMIT) {
    throw new Error("Packed bytes exceed the 1 MiB decoder scratch bound");
  }
  return Uint8Array.from(result);
}

/** Independently check each packed byte stream before publishing source. */
export function unpack(data: Uint8Array): Uint8Array {
  if (data.length > SCRATCH_LIMIT) {
    throw new Error("Packed bytes exceed the 1 MiB decoder scratch bound");
  }
  const result = new Uint8Array(SCRATCH_LIMIT);
  let cursor = 0, size = 0;
  const byte = () => {
    if (cursor >= data.length) throw new Error("Truncated packed data");
    return data[cursor++];
  };
  const extend = (length: number) => {
    let value;
    do {
      value = byte();
      length += value;
      if (length > SCRATCH_LIMIT) throw new Error("Invalid packed length");
    } while (value === 255);
    return length;
  };
  while (cursor < data.length) {
    const token = byte(), literal = token >> 4 === 15 ? extend(15) : token >> 4;
    if (literal > data.length - cursor || literal > SCRATCH_LIMIT - size) {
      throw new Error("Invalid packed literal length");
    }
    result.set(data.subarray(cursor, cursor + literal), size);
    size += literal;
    cursor += literal;
    if (cursor === data.length) break;
    const distance = byte() | byte() << 8;
    if (distance === 0 || distance > size) {
      throw new Error("Invalid packed backward distance");
    }
    const length = (token & 15) === 15 ? extend(19) : (token & 15) + 4;
    if (length > SCRATCH_LIMIT - size) {
      throw new Error("Invalid packed match length");
    }
    for (let i = 0; i < length; i++, size++) {
      result[size] = result[size - distance];
    }
  }
  return result.slice(0, size);
}

export function transform(
  source: string,
): { source: string; unpackedSize: number; packedSize: number } {
  const data = readData(source),
    original = layout(data),
    packed = pack(original);
  const restored = unpack(packed);
  if (
    restored.length !== original.length ||
    restored.some((byte, i) => byte !== original[i])
  ) throw new Error("Static data did not survive packing exactly");
  for (const { begin, end } of [...data].reverse()) {
    source = source.slice(0, begin) +
      "(; Static data restored by init_data. ;)" + source.slice(end);
  }
  const end = [...tokens(source)].at(-1);
  if (end?.word !== ")") throw new Error("Expected a complete WAT module");
  const quoted = Array.from(
    packed,
    (byte) => `\\${byte.toString(16).padStart(2, "0")}`,
  ).join("");
  const declaration =
    "\n;; Losslessly packed STATIC DATA ONLY; see pack-data.ts and init-data.wat.\n" +
    `(global $packed_begin i32 (i32.const ${PACKED_BEGIN}))\n` +
    `(global $packed_end i32 (i32.const ${PACKED_BEGIN + packed.length}))\n` +
    `(global $unpacked_size i32 (i32.const ${original.length}))\n` +
    `(data (i32.const ${PACKED_BEGIN}) "${quoted}")\n`;
  return {
    source: source.slice(0, end.begin) + declaration + source.slice(end.begin),
    unpackedSize: original.length,
    packedSize: packed.length,
  };
}

if (import.meta.main) {
  if (Deno.args.length !== 2) {
    throw new Error(
      "Usage: deno run --allow-read --allow-write tools/pack-data.ts source.wat output.wat",
    );
  }
  const source = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true })
    .decode(await Deno.readFile(Deno.args[0])).replace(/\r\n?/g, "\n");
  const result = transform(source);
  await Deno.writeTextFile(Deno.args[1], result.source);
  console.log(
    `Static data: ${
      result.unpackedSize.toLocaleString("en-US")
    } layout bytes -> ${
      result.packedSize.toLocaleString("en-US")
    } packed bytes`,
  );
}
