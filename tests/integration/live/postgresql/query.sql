-- name: InsertProbe :exec
INSERT INTO live_probes (id, document, states, numbers, pt, disk, boxes)
VALUES ($1, $2, $3, $4, $5, $6, $7);

-- name: GetProbe :one
SELECT * FROM live_probes WHERE id = $1;

-- name: RepeatedProbe :many
SELECT id FROM live_probes WHERE id = sqlc.narg('id') OR sqlc.narg('id') IS NULL ORDER BY id;

-- name: LiteralProbe :one
SELECT '?'::text AS literal, $1::text AS value /* $9 */;

-- name: DeleteProbes :execrows
DELETE FROM live_probes;

-- name: SetJSONArrays :one
UPDATE live_probes SET json_documents = $2, documents = $3,
  optional_document = $4, optional_documents = $5
WHERE id = $1 RETURNING json_documents, documents, optional_document, optional_documents;
