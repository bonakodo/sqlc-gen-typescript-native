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
-- name: GetRecord :one
SELECT * FROM records WHERE id = sqlc.arg(id);
