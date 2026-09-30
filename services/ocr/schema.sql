CREATE TABLE IF NOT EXISTS image_ocr (
                   image_id         TEXT PRIMARY KEY REFERENCES images(id) ON DELETE CASCADE,
                   text             TEXT NOT NULL DEFAULT '',
                   language         TEXT,
                   derived_title    TEXT,
                   producer_version TEXT NOT NULL,
                   processed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
               );

CREATE INDEX IF NOT EXISTS image_ocr_stale ON image_ocr(producer_version);

CREATE INDEX IF NOT EXISTS image_ocr_fts
               ON image_ocr USING GIN (to_tsvector('simple', text));
