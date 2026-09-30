CREATE TABLE IF NOT EXISTS image_annotations (
                   id               BIGSERIAL PRIMARY KEY,
                   image_id         TEXT NOT NULL REFERENCES images(id) ON DELETE CASCADE,
                   label            TEXT NOT NULL,
                   confidence       REAL NOT NULL,
                   x1               REAL NOT NULL CHECK (x1 >= 0 AND x1 <= 1),
                   y1               REAL NOT NULL CHECK (y1 >= 0 AND y1 <= 1),
                   x2               REAL NOT NULL CHECK (x2 >= 0 AND x2 <= 1),
                   y2               REAL NOT NULL CHECK (y2 >= 0 AND y2 <= 1),
                   producer_version TEXT NOT NULL,
                   processed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
               );

CREATE INDEX IF NOT EXISTS image_annotations_image ON image_annotations(image_id);

CREATE INDEX IF NOT EXISTS image_annotations_label ON image_annotations(label);
