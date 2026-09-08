;; Restore static data before the first argument or request byte is read.
;;
;; pack-data.ts encodes DATA ONLY. It leaves every executable WAT function as
;; written. The packed stream sits at 32 MiB; this decoder expands its bytes at
;; 36 MiB, then copies each named span to its original address below 4 MiB.
;; Both scratch areas belong to the existing input buffer. Arguments and then
;; protobuf input overwrite them after this function returns. No allocation,
;; memory growth, imported decompressor, or extra memory is involved.
;;
;; Compression uses a small LZ4-style block format. Each token holds a literal
;; count in its high nibble and a match count minus four in its low nibble. A
;; nibble of 15 adds extension bytes (255 means another follows). Literal bytes
;; precede a two-byte little-endian backward distance and the match extension.
;; A final literal run may end the stream without a distance. The decoder also
;; accepts a final match; the packer need not add an empty trailing token.
;;
;; The expanded layout is: span count (u32), count pairs of destination/length
;; (u32 each), then the concatenated span contents. It contains no code. Fixed
;; checks protect both scratch regions and every scatter destination. A damaged
;; compiled-in stream traps with unreachable: the normal error strings are not
;; available until restoration succeeds, so startup cannot use them safely.

;; Read one extended run length. The caller passes 15 for literals or 19 for
;; matches only when the token requests extension bytes. Results are next input
;; and length; no shared cursor or scratch survives the call. The 1 MiB cap
;; prevents wrap before the caller checks its remaining input/output spans.
(func $packed_length (param $p i32) (param $end i32) (param $length i32) (result i32 i32)
  (local $byte i32)
  (loop $extension
    (if (i32.ge_u (local.get $p) (local.get $end)) (then (unreachable)))
    (local.set $byte (i32.load8_u (local.get $p)))
    (local.set $p (i32.add (local.get $p) (i32.const 1)))
    (local.set $length (i32.add (local.get $length) (local.get $byte)))
    (if (i32.gt_u (local.get $length) (i32.const 1048576)) (then (unreachable)))
    (br_if $extension (i32.eq (local.get $byte) (i32.const 255))))
  (local.get $p) (local.get $length))

(func $init_data
  (local $p i32) (local $end i32) (local $out i32) (local $out_end i32)
  (local $token i32) (local $length i32) (local $chunk i32) (local $distance i32)
  (local $count i32) (local $entry i32) (local $data i32) (local $address i32)
  (local.set $p (global.get $packed_begin))
  (local.set $end (global.get $packed_end))
  ;; The encoded stream and decoded layout each have a 1 MiB startup bound.
  ;; Subtractions follow bounds checks, so unsigned wrap cannot admit a range.
  (if (i32.ne (local.get $p) (i32.const 33554432)) (then (unreachable)))
  (if (i32.or (i32.lt_u (local.get $end) (local.get $p))
              (i32.gt_u (local.get $end) (i32.const 34603008))) (then (unreachable)))
  (if (i32.or (i32.lt_u (global.get $unpacked_size) (i32.const 4))
              (i32.gt_u (global.get $unpacked_size) (i32.const 1048576))) (then (unreachable)))
  (local.set $out (i32.const 37748736))
  (local.set $out_end (i32.add (local.get $out) (global.get $unpacked_size)))
  (block $decoded (loop $tokens
    (br_if $decoded (i32.eq (local.get $p) (local.get $end)))
    (local.set $token (i32.load8_u (local.get $p)))
    (local.set $p (i32.add (local.get $p) (i32.const 1)))
    (local.set $length (i32.shr_u (local.get $token) (i32.const 4)))
    (if (i32.eq (local.get $length) (i32.const 15)) (then
      (call $packed_length (local.get $p) (local.get $end) (local.get $length))
      (local.set $length) (local.set $p)))
    (if (i32.or (i32.gt_u (local.get $length) (i32.sub (local.get $end) (local.get $p)))
                (i32.gt_u (local.get $length) (i32.sub (local.get $out_end) (local.get $out))))
      (then (unreachable)))
    (memory.copy (local.get $out) (local.get $p) (local.get $length))
    (local.set $p (i32.add (local.get $p) (local.get $length)))
    (local.set $out (i32.add (local.get $out) (local.get $length)))
    (br_if $decoded (i32.eq (local.get $p) (local.get $end)))
    (if (i32.lt_u (i32.sub (local.get $end) (local.get $p)) (i32.const 2)) (then (unreachable)))
    (local.set $distance (i32.load16_u (local.get $p)))
    (local.set $p (i32.add (local.get $p) (i32.const 2)))
    (if (i32.or (i32.eqz (local.get $distance))
                (i32.gt_u (local.get $distance) (i32.sub (local.get $out) (i32.const 37748736))))
      (then (unreachable)))
    (local.set $length (i32.add (i32.and (local.get $token) (i32.const 15)) (i32.const 4)))
    (if (i32.eq (local.get $length) (i32.const 19)) (then
      (call $packed_length (local.get $p) (local.get $end) (local.get $length))
      (local.set $length) (local.set $p)))
    (if (i32.gt_u (local.get $length) (i32.sub (local.get $out_end) (local.get $out))) (then (unreachable)))
    ;; Copy only bytes already decoded: one memory.copy cannot expand an
    ;; overlapping LZ match. After each full chunk, twice as much repeated text
    ;; is available at the same source address. Doubling the distance therefore
    ;; needs logarithmically many copies, even for a long distance-one run.
    ;; length <= 1 MiB and distance starts as u16, so doubling cannot wrap.
    (loop $match_chunks
      (local.set $chunk (select (local.get $length) (local.get $distance)
        (i32.lt_u (local.get $length) (local.get $distance))))
      (memory.copy (local.get $out) (i32.sub (local.get $out) (local.get $distance)) (local.get $chunk))
      (local.set $out (i32.add (local.get $out) (local.get $chunk)))
      (local.set $length (i32.sub (local.get $length) (local.get $chunk)))
      (local.set $distance (i32.shl (local.get $distance) (i32.const 1)))
      (br_if $match_chunks (local.get $length)))
    (br $tokens)))
  (if (i32.ne (local.get $out) (local.get $out_end)) (then (unreachable)))

  ;; Check the descriptor table before reading it. All decoded data lives in a
  ;; separate fixed region, so even overlapping static spans cannot damage the
  ;; table, unread decoded bytes, or the compressed stream during this copy.
  (local.set $count (i32.load (i32.const 37748736)))
  (if (i32.gt_u (local.get $count)
      (i32.shr_u (i32.sub (global.get $unpacked_size) (i32.const 4)) (i32.const 3))) (then (unreachable)))
  (local.set $entry (i32.const 37748740))
  (local.set $data (i32.add (local.get $entry) (i32.shl (local.get $count) (i32.const 3))))
  (block $scattered (loop $spans
    (br_if $scattered (i32.eqz (local.get $count)))
    (local.set $address (i32.load (local.get $entry)))
    (local.set $length (i32.load offset=4 (local.get $entry)))
    (if (i32.gt_u (local.get $address) (i32.const 4194304)) (then (unreachable)))
    (if (i32.or (i32.gt_u (local.get $length) (i32.sub (i32.const 4194304) (local.get $address)))
                (i32.gt_u (local.get $length) (i32.sub (local.get $out_end) (local.get $data))))
      (then (unreachable)))
    (memory.copy (local.get $address) (local.get $data) (local.get $length))
    (local.set $entry (i32.add (local.get $entry) (i32.const 8)))
    (local.set $data (i32.add (local.get $data) (local.get $length)))
    (local.set $count (i32.sub (local.get $count) (i32.const 1)))
    (br $spans)))
  (if (i32.ne (local.get $data) (local.get $out_end)) (then (unreachable))))
