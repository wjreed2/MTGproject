CREATE DATABASE IF NOT EXISTS mtgproject CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE mtgproject;

CREATE TABLE IF NOT EXISTS accounts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  email VARCHAR(255) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  created_at BIGINT NOT NULL,
  role ENUM('user','admin') NOT NULL DEFAULT 'user',
  last_login_at BIGINT NULL DEFAULT NULL,
  changelog_ack_at BIGINT NULL DEFAULT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_accounts_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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

CREATE TABLE IF NOT EXISTS collection (
  account_id BIGINT UNSIGNED NOT NULL,
  uid VARCHAR(120) NOT NULL,
  name VARCHAR(255) NOT NULL DEFAULT '',
  qty INT NOT NULL DEFAULT 1,
  foil TINYINT(1) NOT NULL DEFAULT 0,
  scryfall_id VARCHAR(50) DEFAULT NULL,
  oracle_id CHAR(36) DEFAULT NULL,
  role_tags_json JSON DEFAULT NULL,
  data JSON NOT NULL,
  added_at BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (account_id, uid),
  INDEX idx_name (name),
  INDEX idx_scryfall_id (scryfall_id),
  INDEX idx_collection_account_oracle (account_id, oracle_id),
  CONSTRAINT fk_collection_account FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS decks (
  account_id BIGINT UNSIGNED NOT NULL,
  id VARCHAR(50) NOT NULL,
  name VARCHAR(255) NOT NULL DEFAULT '',
  format VARCHAR(50) NOT NULL DEFAULT '',
  data JSON NOT NULL,
  created_at BIGINT NOT NULL DEFAULT 0,
  updated_at BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (account_id, id),
  CONSTRAINT fk_decks_account FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS deck_cards (
  account_id BIGINT UNSIGNED NOT NULL,
  deck_id VARCHAR(50) NOT NULL,
  card_uid VARCHAR(120) NOT NULL,
  scryfall_id VARCHAR(50) DEFAULT NULL,
  card_name VARCHAR(255) NOT NULL DEFAULT '',
  qty INT NOT NULL DEFAULT 1,
  is_commander TINYINT(1) NOT NULL DEFAULT 0,
  sort_order INT NOT NULL DEFAULT 0,
  card_data JSON NOT NULL,
  PRIMARY KEY (account_id, deck_id, card_uid),
  INDEX idx_deck_cards_scryfall (scryfall_id),
  INDEX idx_deck_cards_name (card_name),
  CONSTRAINT fk_deck_cards_deck FOREIGN KEY (account_id, deck_id) REFERENCES decks(account_id, id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS deck_card_tags (
  account_id BIGINT UNSIGNED NOT NULL,
  deck_id VARCHAR(50) NOT NULL,
  card_uid VARCHAR(120) NOT NULL,
  tag_name VARCHAR(100) NOT NULL,
  PRIMARY KEY (account_id, deck_id, card_uid, tag_name),
  INDEX idx_deck_card_tags_tag (tag_name),
  CONSTRAINT fk_deck_card_tags_card FOREIGN KEY (account_id, deck_id, card_uid)
    REFERENCES deck_cards(account_id, deck_id, card_uid) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS games (
  account_id BIGINT UNSIGNED NOT NULL,
  id VARCHAR(50) NOT NULL,
  data JSON NOT NULL,
  created_at BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (account_id, id),
  CONSTRAINT fk_games_account FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS wishlist (
  account_id BIGINT UNSIGNED NOT NULL,
  uid VARCHAR(120) NOT NULL,
  data JSON NOT NULL,
  added_at BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (account_id, uid),
  CONSTRAINT fk_wishlist_account FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS preferences (
  account_id BIGINT UNSIGNED NOT NULL,
  key_name VARCHAR(100) NOT NULL,
  value JSON NOT NULL,
  PRIMARY KEY (account_id, key_name),
  CONSTRAINT fk_preferences_account FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Reference data: Magic keyword abilities (CR 702) and ability words (CR 207.2c)
-- that have a CONDITION that must be met, plus a metric used to decide whether a
-- deck should be recommended a card carrying that term. Seeded from
-- data/conditional-keywords.json by ensureConditionalKeywordsTable() in server.js.
CREATE TABLE IF NOT EXISTS mtg_conditional_keywords (
  id                    INT UNSIGNED NOT NULL AUTO_INCREMENT,
  term                  VARCHAR(60)  NOT NULL,
  category              ENUM('ability_word','keyword_ability') NOT NULL,
  rule_ref              VARCHAR(20)  NOT NULL,
  `condition`           TEXT         NOT NULL,
  recommendation_metric TEXT         NOT NULL,
  metric_key            VARCHAR(60)  NULL,
  metric_threshold      INT          NULL,
  created_at            BIGINT       NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_mck_term (term),
  INDEX idx_mck_category (category),
  INDEX idx_mck_metric_key (metric_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Definitions of each metric_key referenced by mtg_conditional_keywords (the deck-signal a
-- recommender computes to decide whether a conditional card is supportable). Seeded/updated from
-- the _metric_keys block in data/conditional-keywords.json by ensureMetricKeysTable() in server.js.
CREATE TABLE IF NOT EXISTS mtg_metric_keys (
  metric_key  VARCHAR(60) NOT NULL,
  description  TEXT        NOT NULL,
  updated_at   BIGINT      NOT NULL,
  PRIMARY KEY (metric_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS app_changelog (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  entry_key     VARCHAR(80) NULL,
  published_at  BIGINT NOT NULL,
  area          VARCHAR(80) NULL,
  title         VARCHAR(512) NOT NULL,
  summary       TEXT NOT NULL,
  created_at    BIGINT NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_app_changelog_entry_key (entry_key),
  INDEX idx_app_changelog_published (published_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
