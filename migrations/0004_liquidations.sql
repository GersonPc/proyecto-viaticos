CREATE TABLE travel_liquidations (
 request_id TEXT PRIMARY KEY REFERENCES travel_requests(id),
 revision INTEGER NOT NULL CHECK(revision > 0),
 status TEXT NOT NULL CHECK(status IN ('draft', 'submitted')),
 operation_key TEXT NOT NULL,
 digest TEXT NOT NULL,
 updated_at TEXT NOT NULL
);
CREATE TABLE liquidation_chunks (
 request_id TEXT NOT NULL REFERENCES travel_liquidations(request_id),
 revision INTEGER NOT NULL,
 chunk_index INTEGER NOT NULL,
 content TEXT NOT NULL,
 PRIMARY KEY(request_id, revision, chunk_index)
);
CREATE TABLE liquidation_events (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 request_id TEXT NOT NULL REFERENCES travel_liquidations(request_id),
 revision INTEGER NOT NULL,
 status TEXT NOT NULL,
 actor_email TEXT NOT NULL,
 occurred_at TEXT NOT NULL
);
CREATE TRIGGER liquidation_insert_event AFTER INSERT ON travel_liquidations BEGIN
 INSERT INTO liquidation_events(request_id,revision,status,actor_email,occurred_at)
 SELECT NEW.request_id,NEW.revision,NEW.status,owner_email,NEW.updated_at FROM travel_requests WHERE id=NEW.request_id;
END;
CREATE TRIGGER liquidation_update_event AFTER UPDATE ON travel_liquidations BEGIN
 INSERT INTO liquidation_events(request_id,revision,status,actor_email,occurred_at)
 SELECT NEW.request_id,NEW.revision,NEW.status,owner_email,NEW.updated_at FROM travel_requests WHERE id=NEW.request_id;
END;
