// Shapes used by the frozen reference data and the WAT record builders.
export interface Identifier {
  catalog?: string;
  schema?: string;
  name?: string;
}

export interface Column {
  name?: string;
  comment?: string;
  scope?: string;
  table_alias?: string;
  original_name?: string;
  not_null?: boolean;
  is_array?: boolean;
  length?: number;
  is_named_param?: boolean;
  is_func_call?: boolean;
  is_sqlc_slice?: boolean;
  unsigned?: boolean;
  array_dims?: number;
  table?: Identifier;
  type?: Identifier;
  embed_table?: Identifier;
}

export interface Table {
  rel?: Identifier;
  columns?: Column[];
}

export interface Enum {
  name: string;
  vals?: string[];
}

export interface Schema {
  name: string;
  tables?: Table[];
  enums?: Enum[];
}

export interface Options {
  runtime: "node" | "bun" | "deno";
  _driver_name:
    | "pg"
    | "postgres"
    | "mysql2"
    | "better-sqlite3"
    | "@bonakodo/sqlite";
  sqlite_type_mode?: string;
  types_only?: boolean;
  emit_null_as_undefined?: boolean;
  optional_nullable_args?: boolean;
  emit_query_factory?: boolean;
  emit_sql_as_const?: boolean;
  mysql2?: {
    support_big_numbers?: boolean;
    big_number_strings?: boolean;
    insert_id_unsigned?: boolean | null;
  };
}

export interface DriverField {
  Name: string;
  Type: string;
  Kind: string;
  Nullable: boolean;
  Slice: boolean;
  Dims: number;
  Codec: { path: string; name: string } | null;
  Children: DriverField[];
}

export interface GeneratorCase {
  name: string;
  request: string;
  request_sha256: string;
  response_chunks: number[];
  response_sha256: string;
  args: string[];
  status: number;
  stderr: string;
}

export interface GeneratorCorpus {
  format: number;
  provenance: { source_commit: string; source_sha256: string };
  response_blobs: string[];
  cases: GeneratorCase[];
}
