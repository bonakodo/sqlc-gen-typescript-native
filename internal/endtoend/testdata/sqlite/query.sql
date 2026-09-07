-- name: CreateAuthor :one
INSERT INTO authors (id, name, bio, score)
VALUES (sqlc.arg(id), sqlc.arg(name), sqlc.narg(bio), sqlc.arg(score)) RETURNING *;
-- name: GetAuthor :one
SELECT * FROM authors WHERE id = sqlc.arg(id);
-- name: ListAuthors :many
SELECT * FROM authors ORDER BY id;
-- name: RenameAuthor :exec
UPDATE authors SET name = sqlc.arg(name) WHERE id = sqlc.arg(id);
-- name: DeleteAuthor :execrows
DELETE FROM authors WHERE id = sqlc.arg(id);
-- name: InsertAuthor :execlastid
INSERT INTO authors (id, name) VALUES (sqlc.arg(id), sqlc.arg(name));
-- name: InsertAuthorResult :execresult
INSERT INTO authors (id, name) VALUES (sqlc.arg(id), sqlc.arg(name));
-- name: FindAuthors :many
SELECT * FROM authors WHERE id IN (sqlc.slice('ids')) ORDER BY id;
-- name: CreateRecord :one
INSERT INTO records (id, event_count, active, created_at, payload, document)
VALUES (sqlc.arg(id), sqlc.arg(event_count), sqlc.arg(active), sqlc.arg(created_at), sqlc.narg(payload), sqlc.narg(document)) RETURNING *;
