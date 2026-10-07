-- Additive migration: existing accounts and signatures remain intact.
CREATE TABLE request_administrators (
 email TEXT PRIMARY KEY COLLATE NOCASE,
 is_owner INTEGER NOT NULL DEFAULT 0 CHECK (is_owner IN (0, 1)),
 CHECK (email = lower(trim(email)) AND email LIKE '%@tecnasa.com')
);
CREATE TABLE travel_requests (
 id TEXT PRIMARY KEY,
 owner_email TEXT NOT NULL COLLATE NOCASE,
 status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'rejected')),
 revision INTEGER NOT NULL CHECK (revision > 0),
 snapshot_revision INTEGER NOT NULL DEFAULT 1,
 submission_key TEXT NOT NULL UNIQUE,
 snapshot_digest TEXT NOT NULL,
 name TEXT NOT NULL,
 request_date TEXT NOT NULL,
 departure_date TEXT NOT NULL,
 return_date TEXT NOT NULL,
 total_cents INTEGER NOT NULL CHECK (total_cents > 0),
 kilometers_hundredths INTEGER NOT NULL CHECK (kilometers_hundredths >= 0),
 summary_json TEXT NOT NULL,
 created_at TEXT NOT NULL,
 submitted_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 reviewed_by TEXT,
 review_reason TEXT NOT NULL DEFAULT '',
 CHECK ((status = 'pending' AND reviewed_by IS NULL) OR (status <> 'pending' AND reviewed_by IS NOT NULL))
);
CREATE INDEX travel_requests_owner ON travel_requests(owner_email, submitted_at DESC, id DESC);
CREATE INDEX travel_requests_status ON travel_requests(status, submitted_at DESC, id DESC);
-- Immutable, versioned snapshots, split to keep attachments below D1 row limits.
CREATE TABLE request_snapshot_chunks (
 request_id TEXT NOT NULL REFERENCES travel_requests(id),
 revision INTEGER NOT NULL,
 chunk_index INTEGER NOT NULL,
 content TEXT NOT NULL,
 PRIMARY KEY (request_id, revision, chunk_index)
);
CREATE TABLE request_events (
 id INTEGER PRIMARY KEY,
 request_id TEXT NOT NULL REFERENCES travel_requests(id),
 revision INTEGER NOT NULL,
 status TEXT NOT NULL,
 actor_email TEXT NOT NULL,
 reason TEXT NOT NULL,
 occurred_at TEXT NOT NULL
);
CREATE INDEX request_events_request ON request_events(request_id, id);
CREATE TRIGGER travel_requests_created AFTER INSERT ON travel_requests BEGIN
 INSERT INTO request_events(request_id, revision, status, actor_email, reason, occurred_at)
 VALUES (NEW.id, NEW.revision, NEW.status, NEW.owner_email, '', NEW.updated_at);
END;
CREATE TRIGGER travel_requests_changed AFTER UPDATE ON travel_requests BEGIN
 INSERT INTO request_events(request_id, revision, status, actor_email, reason, occurred_at)
 VALUES (NEW.id, NEW.revision, NEW.status, coalesce(NEW.reviewed_by, NEW.owner_email), NEW.review_reason, NEW.updated_at);
END;

INSERT INTO request_administrators(email, is_owner) VALUES ('gpac@tecnasa.com', 1);
CREATE TABLE administrator_events (id INTEGER PRIMARY KEY, actor_email TEXT NOT NULL, target_email TEXT NOT NULL, action TEXT NOT NULL, occurred_at TEXT NOT NULL);
