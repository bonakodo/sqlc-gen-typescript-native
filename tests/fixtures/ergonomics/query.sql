-- name: CreateAuthor :one
-- Creates an author and returns the stored values.
INSERT INTO authors (id, name, created_at, active, notes, settings)
VALUES (sqlc.arg('id'), sqlc.arg('name'), sqlc.arg('createdAt'),
        sqlc.arg('active'), sqlc.narg('notes'), sqlc.arg('settings'))
RETURNING *;

-- name: GetAuthor :one
SELECT * FROM authors WHERE id = sqlc.arg('id');

-- name: ListAuthors :many
SELECT * FROM authors ORDER BY id;

-- name: FindAuthors :many
SELECT * FROM authors WHERE id IN (sqlc.slice('ids')) ORDER BY id;

-- name: GetLatestExpiry :one
SELECT CAST(MAX(expires_at) AS INTEGER) AS "latestExpiry"
FROM records WHERE author_id = sqlc.arg('authorId');

-- name: GetDisplayName :one
SELECT COALESCE((SELECT name FROM authors WHERE id = sqlc.arg('id')), '')
AS "displayName";

-- name: HasStarted :one
SELECT CASE WHEN created_at <= sqlc.arg('nowMillis') THEN 1 ELSE 0 END AS "started"
FROM authors WHERE id = sqlc.arg('id');

-- name: DeleteAuthor :execrows
DELETE FROM authors WHERE id = sqlc.arg('id');
