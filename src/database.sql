CREATE TABLE IF NOT EXISTS users (
    id BIGSERIAL PRIMARY KEY,

    user_code VARCHAR(20)
    GENERATED ALWAYS AS (
        'SS' || LPAD(id::TEXT, 4, '0')
    ) STORED UNIQUE,

    username VARCHAR(50) NOT NULL,

    email VARCHAR(255) NOT NULL UNIQUE,

    password TEXT NOT NULL,

    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS messages (
    id BIGSERIAL PRIMARY KEY,

    sender_id BIGINT NOT NULL
    REFERENCES users(id) ON DELETE CASCADE,

    receiver_id BIGINT NOT NULL
    REFERENCES users(id) ON DELETE CASCADE,

    message TEXT NOT NULL,

    is_delivered BOOLEAN DEFAULT FALSE,

    created_at TIMESTAMPTZ DEFAULT NOW(),

    expires_at TIMESTAMPTZ
    DEFAULT (NOW() + INTERVAL '24 hours')
);

CREATE INDEX IF NOT EXISTS
messages_receiver_idx
ON messages(receiver_id, is_delivered);

CREATE INDEX IF NOT EXISTS
messages_expiry_idx
ON messages(expires_at);
