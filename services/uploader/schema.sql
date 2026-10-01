CREATE TABLE IF NOT EXISTS users (
    id BIGSERIAL PRIMARY KEY,
    email TEXT UNIQUE,
    subject TEXT UNIQUE,
    name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS boards (
    id TEXT PRIMARY KEY CHECK (id ~ '^[a-z0-9]{1,16}$'),
    name TEXT NOT NULL,
    icon TEXT NOT NULL DEFAULT '📌',
    blurb TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS images (
    id           TEXT PRIMARY KEY,
    board        TEXT NOT NULL DEFAULT 'b' REFERENCES boards(id),
    title        TEXT NOT NULL DEFAULT '',
    filename     TEXT NOT NULL,
    content_type TEXT NOT NULL,
    size         BIGINT NOT NULL DEFAULT 0,
    user_id      BIGINT REFERENCES users(id),
    author       TEXT NOT NULL DEFAULT 'Anonymous',
    user_agent   TEXT NOT NULL DEFAULT '',
    uploaded_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS comments (
    id         BIGSERIAL PRIMARY KEY,
    image_id   TEXT NOT NULL REFERENCES images(id) ON DELETE CASCADE,
    body       TEXT NOT NULL,
    user_id    BIGINT REFERENCES users(id),
    author     TEXT NOT NULL DEFAULT 'Anonymous',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO boards (id, name, icon, blurb) SELECT * FROM (VALUES
    ('b', 'Random', '🎲', 'Anything goes'),
    ('ck', 'Food & Cooking', '🍳', 'Good food and kitchen experiments'),
    ('g', 'Technology', '💾', 'Wires and yak shaving'),
    ('k', 'Weapons', '⚔️', 'Pointy things'),
    ('a', 'Anime', '🌸', 'Big eyes, big feelings'),
    ('mu', 'Music', '🎵', 'Loud and otherwise'),
    ('v', 'Video Games', '🎮', 'Backlog denial')
) AS defaults(id,name,icon,blurb) WHERE NOT EXISTS (SELECT 1 FROM boards)
ON CONFLICT (id) DO NOTHING;

CREATE INDEX IF NOT EXISTS comments_image_id ON comments(image_id);
CREATE INDEX IF NOT EXISTS images_board ON images(board, uploaded_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS images_user_id ON images(user_id);
CREATE INDEX IF NOT EXISTS comments_user_id ON comments(user_id);

-- No image FK: deletion events must survive deletion of the image itself.
CREATE TABLE IF NOT EXISTS image_outbox (
    sequence BIGSERIAL PRIMARY KEY,
    image_id TEXT NOT NULL,
    payload BYTEA
);
