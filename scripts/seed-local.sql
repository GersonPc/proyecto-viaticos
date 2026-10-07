INSERT OR IGNORE INTO employee_accounts (email, name, account_number, account_type, bank)
VALUES ('dev@tecnasa.com', 'Prueba Local', '0000000000', 'Monetaria', 'Banco de Prueba');

-- Local-only administrator for exercising the complete review flow.
INSERT OR IGNORE INTO request_administrators (email, is_owner) VALUES ('dev@tecnasa.com', 1);
