-- Run once against an existing database to add the role column and reset tokens table.
-- Safe to re-run: uses IF NOT EXISTS / column existence checks.

-- Skip if column already exists (MySQL 8.0+ supports IF NOT EXISTS; older: check first)
ALTER TABLE accounts
  ADD COLUMN role ENUM('user','admin') NOT NULL DEFAULT 'user';

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  account_id BIGINT UNSIGNED NOT NULL,
  token_hash VARCHAR(255) NOT NULL,
  expires_at BIGINT NOT NULL,
  used_at BIGINT DEFAULT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_prt_token (token_hash),
  KEY idx_prt_account (account_id),
  CONSTRAINT fk_prt_account FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Grant admin role to your account (replace with your email):
-- UPDATE accounts SET role = 'admin' WHERE email = 'your@email.com';
