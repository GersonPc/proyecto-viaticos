CREATE TABLE IF NOT EXISTS employee_signatures (
	key TEXT PRIMARY KEY,
	content_type TEXT NOT NULL CHECK (content_type IN ('image/png', 'image/jpeg', 'image/webp')),
	image BLOB NOT NULL CHECK (length(image) BETWEEN 1 AND 1500000)
);
