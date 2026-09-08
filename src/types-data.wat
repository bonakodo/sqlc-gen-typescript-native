;; LiteralDATA for types.wat, held in the reserved64KiB type region.
;; bigint: bigint
(data (i32.const 3031040) "\62\69\67\69\6e\74")
(func $t_bigint (result i32 i32) (i32.const 3031040) (i32.const 6))
;; number: number
(data (i32.const 3031046) "\6e\75\6d\62\65\72")
(func $t_number (result i32 i32) (i32.const 3031046) (i32.const 6))
;; boolean: boolean
(data (i32.const 3031052) "\62\6f\6f\6c\65\61\6e")
(func $t_boolean (result i32 i32) (i32.const 3031052) (i32.const 7))
;; date: Date
(data (i32.const 3031059) "\44\61\74\65")
(func $t_date (result i32 i32) (i32.const 3031059) (i32.const 4))
;; bytes: Uint8Array
(data (i32.const 3031063) "\55\69\6e\74\38\41\72\72\61\79")
(func $t_bytes (result i32 i32) (i32.const 3031063) (i32.const 10))
;; string: string
(data (i32.const 3031073) "\73\74\72\69\6e\67")
(func $t_string (result i32 i32) (i32.const 3031073) (i32.const 6))
;; unknown: unknown
(data (i32.const 3031079) "\75\6e\6b\6e\6f\77\6e")
(func $t_unknown (result i32 i32) (i32.const 3031079) (i32.const 7))
;; any: any
(data (i32.const 3031086) "\61\6e\79")
(func $t_any (result i32 i32) (i32.const 3031086) (i32.const 3))
;; buffer: Buffer
(data (i32.const 3031089) "\42\75\66\66\65\72")
(func $t_buffer (result i32 i32) (i32.const 3031089) (i32.const 6))
;; json: JsonValue
(data (i32.const 3031095) "\4a\73\6f\6e\56\61\6c\75\65")
(func $t_json (result i32 i32) (i32.const 3031095) (i32.const 9))
;; interval: IPostgresInterval
(data (i32.const 3031104) "\49\50\6f\73\74\67\72\65\73\49\6e\74\65\72\76\61\6c")
(func $t_interval (result i32 i32) (i32.const 3031104) (i32.const 17))
;; point: { x: number; y: number }
(data (i32.const 3031121) "\7b\20\78\3a\20\6e\75\6d\62\65\72\3b\20\79\3a\20\6e\75\6d\62\65\72\20\7d")
(func $t_point (result i32 i32) (i32.const 3031121) (i32.const 24))
;; circle: { x: number; y: number; radius: number }
(data (i32.const 3031145) "\7b\20\78\3a\20\6e\75\6d\62\65\72\3b\20\79\3a\20\6e\75\6d\62\65\72\3b\20\72\61\64\69\75\73\3a\20\6e\75\6d\62\65\72\20\7d")
(func $t_circle (result i32 i32) (i32.const 3031145) (i32.const 40))
;; number_string: number | string
(data (i32.const 3031185) "\6e\75\6d\62\65\72\20\7c\20\73\74\72\69\6e\67")
(func $t_number_string (result i32 i32) (i32.const 3031185) (i32.const 15))
;; number_bigint: number | bigint
(data (i32.const 3031200) "\6e\75\6d\62\65\72\20\7c\20\62\69\67\69\6e\74")
(func $t_number_bigint (result i32 i32) (i32.const 3031200) (i32.const 15))
;; pg_catalog_prefix: pg_catalog.
(data (i32.const 3031215) "\70\67\5f\63\61\74\61\6c\6f\67\2e")
(func $t_pg_catalog_prefix (result i32 i32) (i32.const 3031215) (i32.const 11))
;; null: null
(data (i32.const 3031226) "\6e\75\6c\6c")
(func $t_null (result i32 i32) (i32.const 3031226) (i32.const 4))
;; undefined: undefined
(data (i32.const 3031230) "\75\6e\64\65\66\69\6e\65\64")
(func $t_undefined (result i32 i32) (i32.const 3031230) (i32.const 9))
;; readonly_array: ReadonlyArray<
(data (i32.const 3031239) "\52\65\61\64\6f\6e\6c\79\41\72\72\61\79\3c")
(func $t_readonly_array (result i32 i32) (i32.const 3031239) (i32.const 14))
;; union:  |
(data (i32.const 3031253) "\20\7c\20")
(func $t_union (result i32 i32) (i32.const 3031253) (i32.const 3))
;; compatible: _sqlcCompatible<%s, %s>
(data (i32.const 3031256) "\5f\73\71\6c\63\43\6f\6d\70\61\74\69\62\6c\65\3c\25\73\2c\20\25\73\3e")
(func $t_compatible (result i32 i32) (i32.const 3031256) (i32.const 23))
;; reference: $sqlcReference
(data (i32.const 3031279) "\24\73\71\6c\63\52\65\66\65\72\65\6e\63\65")
(func $t_reference (result i32 i32) (i32.const 3031279) (i32.const 14))
;; node_buffer: node:buffer
(data (i32.const 3031293) "\6e\6f\64\65\3a\62\75\66\66\65\72")
(func $t_node_buffer (result i32 i32) (i32.const 3031293) (i32.const 11))
;; pg_interval: postgres-interval
(data (i32.const 3031304) "\70\6f\73\74\67\72\65\73\2d\69\6e\74\65\72\76\61\6c")
(func $t_pg_interval (result i32 i32) (i32.const 3031304) (i32.const 17))
;; enums_path: ./enums.ts
(data (i32.const 3031321) "\2e\2f\65\6e\75\6d\73\2e\74\73")
(func $t_enums_path (result i32 i32) (i32.const 3031321) (i32.const 10))
;; json_path: ./json.ts
(data (i32.const 3031331) "\2e\2f\6a\73\6f\6e\2e\74\73")
(func $t_json_path (result i32 i32) (i32.const 3031331) (i32.const 9))
;; models_path: ./models.ts
(data (i32.const 3031340) "\2e\2f\6d\6f\64\65\6c\73\2e\74\73")
(func $t_models_path (result i32 i32) (i32.const 3031340) (i32.const 11))
;; comma: ,
(data (i32.const 3031351) "\2c\20")
(func $t_comma (result i32 i32) (i32.const 3031351) (i32.const 2))
;; true: true
(data (i32.const 3031353) "\74\72\75\65")
(func $t_true (result i32 i32) (i32.const 3031353) (i32.const 4))
;; false: false
(data (i32.const 3031357) "\66\61\6c\73\65")
(func $t_false (result i32 i32) (i32.const 3031357) (i32.const 5))
;; optional_args: optional_nullable_args
(data (i32.const 3031362) "\6f\70\74\69\6f\6e\61\6c\5f\6e\75\6c\6c\61\62\6c\65\5f\61\72\67\73")
(func $t_optional_args (result i32 i32) (i32.const 3031362) (i32.const 22))
;; dimensions_error: column %q has invalid array dimensions %d; expected 0 through 6
(data (i32.const 3031384) "\63\6f\6c\75\6d\6e\20\25\71\20\68\61\73\20\69\6e\76\61\6c\69\64\20\61\72\72\61\79\20\64\69\6d\65\6e\73\69\6f\6e\73\20\25\64\3b\20\65\78\70\65\63\74\65\64\20\30\20\74\68\72\6f\75\67\68\20\36")
(func $t_dimensions_error (result i32 i32) (i32.const 3031384) (i32.const 63))
;; pg_slice_error: PostgreSQL sqlc.slice parameter %q is unsupported; use a native array with = ANY($1::type[]) instead
(data (i32.const 3031447) "\50\6f\73\74\67\72\65\53\51\4c\20\73\71\6c\63\2e\73\6c\69\63\65\20\70\61\72\61\6d\65\74\65\72\20\25\71\20\69\73\20\75\6e\73\75\70\70\6f\72\74\65\64\3b\20\75\73\65\20\61\20\6e\61\74\69\76\65\20\61\72\72\61\79\20\77\69\74\68\20\3d\20\41\4e\59\28\24\31\3a\3a\74\79\70\65\5b\5d\29\20\69\6e\73\74\65\61\64")
(func $t_pg_slice_error (result i32 i32) (i32.const 3031447) (i32.const 100))
;; array_error: %s array column %q requires sqlc.slice or a JSON codec
(data (i32.const 3031547) "\25\73\20\61\72\72\61\79\20\63\6f\6c\75\6d\6e\20\25\71\20\72\65\71\75\69\72\65\73\20\73\71\6c\63\2e\73\6c\69\63\65\20\6f\72\20\61\20\4a\53\4f\4e\20\63\6f\64\65\63")
(func $t_array_error (result i32 i32) (i32.const 3031547) (i32.const 54))
;; override_error: override for %q: %s
(data (i32.const 3031601) "\6f\76\65\72\72\69\64\65\20\66\6f\72\20\25\71\3a\20\25\73")
(func $t_override_error (result i32 i32) (i32.const 3031601) (i32.const 19))
;; import_error: invalid type import name %q
(data (i32.const 3031620) "\69\6e\76\61\6c\69\64\20\74\79\70\65\20\69\6d\70\6f\72\74\20\6e\61\6d\65\20\25\71")
(func $t_import_error (result i32 i32) (i32.const 3031620) (i32.const 27))
;; codec_error: invalid codec import name %q
(data (i32.const 3031647) "\69\6e\76\61\6c\69\64\20\63\6f\64\65\63\20\69\6d\70\6f\72\74\20\6e\61\6d\65\20\25\71")
(func $t_codec_error (result i32 i32) (i32.const 3031647) (i32.const 28))
;; requires_codec: override %q changes %s to %s and requires a codec
(data (i32.const 3031675) "\6f\76\65\72\72\69\64\65\20\25\71\20\63\68\61\6e\67\65\73\20\25\73\20\74\6f\20\25\73\20\61\6e\64\20\72\65\71\75\69\72\65\73\20\61\20\63\6f\64\65\63")
(func $t_requires_codec (result i32 i32) (i32.const 3031675) (i32.const 49))
;; missing_column: missing column metadata at position %d
(data (i32.const 3031724) "\6d\69\73\73\69\6e\67\20\63\6f\6c\75\6d\6e\20\6d\65\74\61\64\61\74\61\20\61\74\20\70\6f\73\69\74\69\6f\6e\20\25\64")
(func $t_missing_column (result i32 i32) (i32.const 3031724) (i32.const 38))
;; embedded_override: query override for embedded result %q only supports nullable
(data (i32.const 3031762) "\71\75\65\72\79\20\6f\76\65\72\72\69\64\65\20\66\6f\72\20\65\6d\62\65\64\64\65\64\20\72\65\73\75\6c\74\20\25\71\20\6f\6e\6c\79\20\73\75\70\70\6f\72\74\73\20\6e\75\6c\6c\61\62\6c\65")
(func $t_embedded_override (result i32 i32) (i32.const 3031762) (i32.const 60))
;; missing_embed: embedded table %q is absent from the catalog
(data (i32.const 3031822) "\65\6d\62\65\64\64\65\64\20\74\61\62\6c\65\20\25\71\20\69\73\20\61\62\73\65\6e\74\20\66\72\6f\6d\20\74\68\65\20\63\61\74\61\6c\6f\67")
(func $t_missing_embed (result i32 i32) (i32.const 3031822) (i32.const 44))
;; embed_type: { [K in keyof %s]: %s[K] | %s }
(data (i32.const 3031866) "\7b\20\5b\4b\20\69\6e\20\6b\65\79\6f\66\20\25\73\5d\3a\20\25\73\5b\4b\5d\20\7c\20\25\73\20\7d")
(func $t_embed_type (result i32 i32) (i32.const 3031866) (i32.const 31))
;; col_prefix: col
(data (i32.const 3031897) "\63\6f\6c")
(func $t_col_prefix (result i32 i32) (i32.const 3031897) (i32.const 3))
;; safe_integer: safe_integer
(data (i32.const 3031900) "\73\61\66\65\5f\69\6e\74\65\67\65\72")
(func $t_safe_integer (result i32 i32) (i32.const 3031900) (i32.const 12))
;; epoch_milliseconds: epoch_milliseconds
(data (i32.const 3031912) "\65\70\6f\63\68\5f\6d\69\6c\6c\69\73\65\63\6f\6e\64\73")
(func $t_epoch_milliseconds (result i32 i32) (i32.const 3031912) (i32.const 18))
;; sqlite_boolean: sqlite_boolean
(data (i32.const 3031930) "\73\71\6c\69\74\65\5f\62\6f\6f\6c\65\61\6e")
(func $t_sqlite_boolean (result i32 i32) (i32.const 3031930) (i32.const 14))
;; sqlite: sqlite
(data (i32.const 3031944) "\73\71\6c\69\74\65")
(func $t_sqlite (result i32 i32) (i32.const 3031944) (i32.const 6))
;; postgresql: postgresql
(data (i32.const 3031950) "\70\6f\73\74\67\72\65\73\71\6c")
(func $t_postgresql (result i32 i32) (i32.const 3031950) (i32.const 10))
;; mysql: mysql
(data (i32.const 3031960) "\6d\79\73\71\6c")
(func $t_mysql (result i32 i32) (i32.const 3031960) (i32.const 5))
;; encodeValue: encodeValue
(data (i32.const 3031965) "\65\6e\63\6f\64\65\56\61\6c\75\65")
(func $t_encodeValue (result i32 i32) (i32.const 3031965) (i32.const 11))
;; encodeCustom: encodeCustom
(data (i32.const 3031976) "\65\6e\63\6f\64\65\43\75\73\74\6f\6d")
(func $t_encodeCustom (result i32 i32) (i32.const 3031976) (i32.const 12))
;; encodeArray: encodeArray
(data (i32.const 3031988) "\65\6e\63\6f\64\65\41\72\72\61\79")
(func $t_encodeArray (result i32 i32) (i32.const 3031988) (i32.const 11))
;; encodeArrayCustom: encodeArrayCustom
(data (i32.const 3031999) "\65\6e\63\6f\64\65\41\72\72\61\79\43\75\73\74\6f\6d")
(func $t_encodeArrayCustom (result i32 i32) (i32.const 3031999) (i32.const 17))
;; decodeValue: decodeValue
(data (i32.const 3032016) "\64\65\63\6f\64\65\56\61\6c\75\65")
(func $t_decodeValue (result i32 i32) (i32.const 3032016) (i32.const 11))
;; decodeCustom: decodeCustom
(data (i32.const 3032027) "\64\65\63\6f\64\65\43\75\73\74\6f\6d")
(func $t_decodeCustom (result i32 i32) (i32.const 3032027) (i32.const 12))
;; decodeArray: decodeArray
(data (i32.const 3032039) "\64\65\63\6f\64\65\41\72\72\61\79")
(func $t_decodeArray (result i32 i32) (i32.const 3032039) (i32.const 11))
;; decodeArrayCustom: decodeArrayCustom
(data (i32.const 3032050) "\64\65\63\6f\64\65\41\72\72\61\79\43\75\73\74\6f\6d")
(func $t_decodeArrayCustom (result i32 i32) (i32.const 3032050) (i32.const 17))
;; kind_1: integer
(data (i32.const 3032067) "\69\6e\74\65\67\65\72")
(func $t_kind_1 (result i32 i32) (i32.const 3032067) (i32.const 7))
;; kind_2: number
(data (i32.const 3032074) "\6e\75\6d\62\65\72")
(func $t_kind_2 (result i32 i32) (i32.const 3032074) (i32.const 6))
;; kind_3: boolean
(data (i32.const 3032080) "\62\6f\6f\6c\65\61\6e")
(func $t_kind_3 (result i32 i32) (i32.const 3032080) (i32.const 7))
;; kind_4: date
(data (i32.const 3032087) "\64\61\74\65")
(func $t_kind_4 (result i32 i32) (i32.const 3032087) (i32.const 4))
;; kind_5: bytes
(data (i32.const 3032091) "\62\79\74\65\73")
(func $t_kind_5 (result i32 i32) (i32.const 3032091) (i32.const 5))
;; kind_6: json
(data (i32.const 3032096) "\6a\73\6f\6e")
(func $t_kind_6 (result i32 i32) (i32.const 3032096) (i32.const 4))
;; kind_7: string
(data (i32.const 3032100) "\73\74\72\69\6e\67")
(func $t_kind_7 (result i32 i32) (i32.const 3032100) (i32.const 6))
;; kind_8: unknown
(data (i32.const 3032106) "\75\6e\6b\6e\6f\77\6e")
(func $t_kind_8 (result i32 i32) (i32.const 3032106) (i32.const 7))
;; kind_9: buffer
(data (i32.const 3032113) "\62\75\66\66\65\72")
(func $t_kind_9 (result i32 i32) (i32.const 3032113) (i32.const 6))
;; kind_10: point
(data (i32.const 3032119) "\70\6f\69\6e\74")
(func $t_kind_10 (result i32 i32) (i32.const 3032119) (i32.const 5))
;; kind_11: circle
(data (i32.const 3032124) "\63\69\72\63\6c\65")
(func $t_kind_11 (result i32 i32) (i32.const 3032124) (i32.const 6))
;; kind_12: interval
(data (i32.const 3032130) "\69\6e\74\65\72\76\61\6c")
(func $t_kind_12 (result i32 i32) (i32.const 3032130) (i32.const 8))
;; kind_13: box
(data (i32.const 3032138) "\62\6f\78")
(func $t_kind_13 (result i32 i32) (i32.const 3032138) (i32.const 3))
;; kind_14: number-or-string
(data (i32.const 3032141) "\6e\75\6d\62\65\72\2d\6f\72\2d\73\74\72\69\6e\67")
(func $t_kind_14 (result i32 i32) (i32.const 3032141) (i32.const 16))
;; kind_15: sqlite-integer
(data (i32.const 3032157) "\73\71\6c\69\74\65\2d\69\6e\74\65\67\65\72")
(func $t_kind_15 (result i32 i32) (i32.const 3032157) (i32.const 14))
;; sql_blob: blob
(data (i32.const 3032171) "\62\6c\6f\62")
(func $t_sql_blob (result i32 i32) (i32.const 3032171) (i32.const 4))
;; sql_bytea: bytea
(data (i32.const 3032175) "\62\79\74\65\61")
(func $t_sql_bytea (result i32 i32) (i32.const 3032175) (i32.const 5))
;; sql_box: box
(data (i32.const 3032180) "\62\6f\78")
(func $t_sql_box (result i32 i32) (i32.const 3032180) (i32.const 3))
;; sql_point: point
(data (i32.const 3032183) "\70\6f\69\6e\74")
(func $t_sql_point (result i32 i32) (i32.const 3032183) (i32.const 5))
;; sql_circle: circle
(data (i32.const 3032188) "\63\69\72\63\6c\65")
(func $t_sql_circle (result i32 i32) (i32.const 3032188) (i32.const 6))
;; sql_interval: interval
(data (i32.const 3032194) "\69\6e\74\65\72\76\61\6c")
(func $t_sql_interval (result i32 i32) (i32.const 3032194) (i32.const 8))
;; sql_json: json
(data (i32.const 3032202) "\6a\73\6f\6e")
(func $t_sql_json (result i32 i32) (i32.const 3032202) (i32.const 4))
;; sql_any: any
(data (i32.const 3032206) "\61\6e\79")
(func $t_sql_any (result i32 i32) (i32.const 3032206) (i32.const 3))
;; sql_unknown: unknown
(data (i32.const 3032209) "\75\6e\6b\6e\6f\77\6e")
(func $t_sql_unknown (result i32 i32) (i32.const 3032209) (i32.const 7))
;; sql_int: int
(data (i32.const 3032216) "\69\6e\74")
(func $t_sql_int (result i32 i32) (i32.const 3032216) (i32.const 3))
;; Exact SQL-name list sqlite_int.
(data (i32.const 3032219) "\69\6e\74\00\69\6e\74\65\67\65\72\00\74\69\6e\79\69\6e\74\00\73\6d\61\6c\6c\69\6e\74\00\6d\65\64\69\75\6d\69\6e\74\00\62\69\67\69\6e\74\00\75\6e\73\69\67\6e\65\64\62\69\67\69\6e\74\00\69\6e\74\32\00\69\6e\74\38\00\00")
(func $tl_sqlite_int (result i32) (i32.const 3032219))
;; Exact SQL-name list native_number.
(data (i32.const 3032291) "\72\65\61\6c\00\64\6f\75\62\6c\65\00\64\6f\75\62\6c\65\70\72\65\63\69\73\69\6f\6e\00\66\6c\6f\61\74\00\64\65\63\69\6d\61\6c\00\6e\75\6d\65\72\69\63\00\00")
(func $tl_native_number (result i32) (i32.const 3032291))
;; Exact SQL-name list sqlite_number.
(data (i32.const 3032342) "\72\65\61\6c\00\64\6f\75\62\6c\65\00\64\6f\75\62\6c\65\70\72\65\63\69\73\69\6f\6e\00\66\6c\6f\61\74\00\00")
(func $tl_sqlite_number (result i32) (i32.const 3032342))
;; Exact SQL-name list bool.
(data (i32.const 3032377) "\62\6f\6f\6c\65\61\6e\00\62\6f\6f\6c\00\00")
(func $tl_bool (result i32) (i32.const 3032377))
;; Exact SQL-name list date.
(data (i32.const 3032391) "\64\61\74\65\00\64\61\74\65\74\69\6d\65\00\74\69\6d\65\73\74\61\6d\70\00\00")
(func $tl_date (result i32) (i32.const 3032391))
;; Exact SQL-name list json.
(data (i32.const 3032416) "\6a\73\6f\6e\00\6a\73\6f\6e\62\00\00")
(func $tl_json (result i32) (i32.const 3032416))
;; Exact SQL-name list native_text.
(data (i32.const 3032428) "\74\65\78\74\00\63\68\61\72\00\63\6c\6f\62\00\00")
(func $tl_native_text (result i32) (i32.const 3032428))
;; Exact SQL-name list native_text_prefix.
(data (i32.const 3032444) "\63\68\61\72\61\63\74\65\72\00\76\61\72\63\68\61\72\00\76\61\72\79\69\6e\67\63\68\61\72\61\63\74\65\72\00\6e\63\68\61\72\00\6e\61\74\69\76\65\63\68\61\72\61\63\74\65\72\00\6e\76\61\72\63\68\61\72\00\00")
(func $tl_native_text_prefix (result i32) (i32.const 3032444))
;; Exact SQL-name list sqlite_text.
(data (i32.const 3032511) "\74\65\78\74\00\63\68\61\72\00\63\68\61\72\61\63\74\65\72\00\63\6c\6f\62\00\76\61\72\63\68\61\72\00\76\61\72\79\69\6e\67\63\68\61\72\61\63\74\65\72\00\6e\63\68\61\72\00\6e\61\74\69\76\65\63\68\61\72\61\63\74\65\72\00\6e\76\61\72\63\68\61\72\00\00")
(func $tl_sqlite_text (result i32) (i32.const 3032511))
;; Exact SQL-name list pg_number.
(data (i32.const 3032593) "\73\6d\61\6c\6c\69\6e\74\00\69\6e\74\65\67\65\72\00\69\6e\74\00\69\6e\74\32\00\69\6e\74\34\00\73\6d\61\6c\6c\73\65\72\69\61\6c\00\73\65\72\69\61\6c\00\73\65\72\69\61\6c\32\00\73\65\72\69\61\6c\34\00\66\6c\6f\61\74\34\00\66\6c\6f\61\74\38\00\72\65\61\6c\00\64\6f\75\62\6c\65\20\70\72\65\63\69\73\69\6f\6e\00\6f\69\64\00\00")
(func $tl_pg_number (result i32) (i32.const 3032593))
;; Exact SQL-name list numeric.
(data (i32.const 3032700) "\6e\75\6d\65\72\69\63\00\64\65\63\69\6d\61\6c\00\00")
(func $tl_numeric (result i32) (i32.const 3032700))
;; Exact SQL-name list pg_date.
(data (i32.const 3032717) "\64\61\74\65\00\74\69\6d\65\73\74\61\6d\70\00\74\69\6d\65\73\74\61\6d\70\20\77\69\74\68\6f\75\74\20\74\69\6d\65\20\7a\6f\6e\65\00\74\69\6d\65\73\74\61\6d\70\74\7a\00\74\69\6d\65\73\74\61\6d\70\20\77\69\74\68\20\74\69\6d\65\20\7a\6f\6e\65\00\00")
(func $tl_pg_date (result i32) (i32.const 3032717))
;; Exact SQL-name list mysql_bigint.
(data (i32.const 3032798) "\62\69\67\69\6e\74\00\62\69\67\69\6e\74\20\75\6e\73\69\67\6e\65\64\00\62\69\67\69\6e\74\20\73\69\67\6e\65\64\00\00")
(func $tl_mysql_bigint (result i32) (i32.const 3032798))
;; Exact SQL-name list mysql_number.
(data (i32.const 3032836) "\74\69\6e\79\69\6e\74\00\73\6d\61\6c\6c\69\6e\74\00\6d\65\64\69\75\6d\69\6e\74\00\69\6e\74\00\69\6e\74\65\67\65\72\00\79\65\61\72\00\66\6c\6f\61\74\00\64\6f\75\62\6c\65\00\64\6f\75\62\6c\65\20\70\72\65\63\69\73\69\6f\6e\00\72\65\61\6c\00\62\6f\6f\6c\00\62\6f\6f\6c\65\61\6e\00\00")
(func $tl_mysql_number (result i32) (i32.const 3032836))
;; Exact SQL-name list mysql_buffer.
(data (i32.const 3032929) "\62\69\6e\61\72\79\00\76\61\72\62\69\6e\61\72\79\00\62\69\74\00\62\6c\6f\62\00\74\69\6e\79\62\6c\6f\62\00\6d\65\64\69\75\6d\62\6c\6f\62\00\6c\6f\6e\67\62\6c\6f\62\00\00")
(func $tl_mysql_buffer (result i32) (i32.const 3032929))
;; Exact SQL-name list mysql_string.
(data (i32.const 3032985) "\64\65\63\69\6d\61\6c\00\64\65\63\00\66\69\78\65\64\00\6e\75\6d\65\72\69\63\00\74\69\6d\65\00\63\68\61\72\00\76\61\72\63\68\61\72\00\74\65\78\74\00\74\69\6e\79\74\65\78\74\00\6d\65\64\69\75\6d\74\65\78\74\00\6c\6f\6e\67\74\65\78\74\00\65\6e\75\6d\00\73\65\74\00\00")
(func $tl_mysql_string (result i32) (i32.const 3032985))
;; Exact SQL-name list primitive.
(data (i32.const 3033073) "\73\74\72\69\6e\67\00\6e\75\6d\62\65\72\00\62\69\67\69\6e\74\00\62\6f\6f\6c\65\61\6e\00\44\61\74\65\00\55\69\6e\74\38\41\72\72\61\79\00\42\75\66\66\65\72\00\75\6e\6b\6e\6f\77\6e\00\61\6e\79\00\6f\62\6a\65\63\74\00\6e\75\6c\6c\00\75\6e\64\65\66\69\6e\65\64\00\73\79\6d\62\6f\6c\00\76\6f\69\64\00\00")
(func $tl_primitive (result i32) (i32.const 3033073))

(data (i32.const 3035000) "\65\78\70\6f\72\74\20\69\6e\74\65\72\66\61\63\65\20\25\73\20\7b")
(func $t_interface_header (result i32 i32) (i32.const 3035000) (i32.const 21))

(data (i32.const 3035021) "\25\73\25\73\3a\20\25\73\3b")
(func $t_property_line (result i32 i32) (i32.const 3035021) (i32.const 9))

(data (i32.const 3035030) "\3f")
(func $t_question (result i32 i32) (i32.const 3035030) (i32.const 1))

(data (i32.const 3035031) "\7d")
(func $t_brace_close (result i32 i32) (i32.const 3035031) (i32.const 1))

(data (i32.const 3035032) "")
(func $t_empty (result i32 i32) (i32.const 3035032) (i32.const 0))
