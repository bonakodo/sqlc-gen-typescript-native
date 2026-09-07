-- name: InsertProbe :execlastid
INSERT INTO live_probes (document, label) VALUES (?, '? literal');

-- name: GetProbe :one
SELECT * FROM live_probes WHERE id = ?;

-- name: LiteralProbe :one
SELECT '?' AS literal, CAST(? AS CHAR) AS value /* ? */;

-- name: FindProbes :many
SELECT id FROM live_probes WHERE id IN (sqlc.slice('ids')) ORDER BY id;

-- name: DeleteProbes :execrows
DELETE FROM live_probes;

-- name: InsertExactID :execlastid
INSERT INTO live_insert_ids (label) VALUES (?);

-- name: InsertExactResult :execresult
INSERT INTO live_insert_ids (label) VALUES (?);

-- name: InsertSignedID :execlastid
INSERT INTO live_insert_ids (id, label) VALUES (?, ?);

-- name: InsertSignedResult :execresult
INSERT INTO live_insert_ids (id, label) VALUES (?, ?);

-- name: InsertUnsignedID :execlastid
INSERT INTO live_unsigned_insert_ids (label) VALUES (?);

-- name: InsertUnsignedResult :execresult
INSERT INTO live_unsigned_insert_ids (label) VALUES (?);

-- name: InsertUnsignedValue :execlastid
INSERT INTO live_unsigned_insert_ids (id, label) VALUES (?, ?);

-- name: InsertUnsignedValueResult :execresult
INSERT INTO live_unsigned_insert_ids (id, label) VALUES (?, ?);
