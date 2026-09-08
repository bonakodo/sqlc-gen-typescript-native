CREATE TYPE mood AS ENUM ('quiet', 'busy');
CREATE TABLE authors (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  bio TEXT,
  score DOUBLE PRECISION NOT NULL DEFAULT 0
);
CREATE TABLE records (
  id BIGINT PRIMARY KEY,
  tags TEXT[] NOT NULL,
  state mood NOT NULL,
  active BOOLEAN NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  payload BYTEA,
  document JSONB
);
