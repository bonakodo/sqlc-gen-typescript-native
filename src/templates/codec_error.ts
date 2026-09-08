/** Shared names retained once per query and result field. */
export type QueryContext = readonly [query: string, file: string];
export type FieldContext = readonly [field: string, expectedType: string];

export function codecContext(query: QueryContext, field: FieldContext): CodecContext {
  return { query: query[0], file: query[1], field: field[0], expectedType: field[1] };
}

/** Static query metadata attached to value conversion failures. */
export interface CodecContext {
  readonly query: string;
  readonly file: string;
  readonly field: string;
  readonly expectedType: string;
}

const causes = new WeakMap<QueryCodecError, unknown>();

/**
 * A value failed conversion before binding or after reading a result. The error
 * and its public cause contain no supplied or stored values. originalCause()
 * is an explicit debugging escape hatch: a custom codec's error may hold data
 * and must not be sent to application logs or returned to clients.
 */
export class QueryCodecError extends TypeError {
  readonly query: string;
  readonly file: string;
  readonly field: string;
  readonly expectedType: string;
  readonly phase: "encode" | "decode";

  constructor(
    context: CodecContext,
    phase: "encode" | "decode",
    cause: unknown,
  ) {
    super(
      `Cannot ${phase} ${phase === "encode" ? "argument" : "result"} ${
        JSON.stringify(context.field)
      } for query ${JSON.stringify(context.query)} in ${
        JSON.stringify(context.file)
      }; expected ${context.expectedType}`,
      { cause: new Error("Value conversion failed") },
    );
    this.name = "QueryCodecError";
    this.query = context.query;
    this.file = context.file;
    this.field = context.field;
    this.expectedType = context.expectedType;
    this.phase = phase;
    causes.set(this, cause);
  }

  originalCause(): unknown {
    return causes.get(this);
  }
}

/** Add source metadata only after conversion fails; driver errors stay unchanged. */
export function throwCodecError(
  cause: unknown,
  phase: "encode" | "decode",
  context?: CodecContext | QueryContext,
  field?: FieldContext,
): never {
  if (context === undefined) throw cause;
  const details = "query" in context ? context : codecContext(context, field!);
  if (
    cause instanceof QueryCodecError && cause.phase === phase &&
    cause.query === details.query && cause.file === details.file &&
    cause.field === details.field &&
    cause.expectedType === details.expectedType
  ) throw cause;
  throw new QueryCodecError(details, phase, cause);
}

/** Only the conversion callback is wrapped; driver errors stay unchanged. */
export function withCodecContext<T>(
  context: CodecContext | QueryContext | undefined,
  phase: "encode" | "decode",
  convert: () => T,
  field?: FieldContext,
): T {
  try {
    return convert();
  } catch (cause) {
    throwCodecError(cause, phase, context, field);
  }
}

/** Expanded SQL slices require an array before individual values can convert. */
export function encodeSlice<T>(
  value: unknown,
  convert: (value: unknown) => T,
  context?: CodecContext | QueryContext,
  field?: FieldContext,
): T[] {
  try {
    if (!Array.isArray(value)) {
      throw new TypeError("Expected a SQL slice array");
    }
    return value.map(convert);
  } catch (cause) {
    throwCodecError(cause, "encode", context, field);
  }
}
