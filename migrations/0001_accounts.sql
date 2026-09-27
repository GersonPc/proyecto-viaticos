CREATE TABLE IF NOT EXISTS employee_accounts (
	email TEXT PRIMARY KEY COLLATE NOCASE,
	name TEXT NOT NULL,
	account_number TEXT,
	account_type TEXT,
	bank TEXT,
	CHECK (
		(account_number IS NULL AND account_type IS NULL AND bank IS NULL)
		OR (account_number IS NOT NULL AND account_type IS NOT NULL AND bank IS NOT NULL)
	)
);
