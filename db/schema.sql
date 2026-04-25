CREATE DATABASE IF NOT EXISTS mtgproject CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE mtgproject;

CREATE TABLE IF NOT EXISTS collection (
  uid         VARCHAR(120) NOT NULL,
  name        VARCHAR(255) NOT NULL DEFAULT '',
  qty         INT          NOT NULL DEFAULT 1,
  foil        TINYINT(1)   NOT NULL DEFAULT 0,
  scryfall_id VARCHAR(50)           DEFAULT NULL,
  data        JSON         NOT NULL,
  added_at    BIGINT       NOT NULL DEFAULT 0,
  PRIMARY KEY (uid),
  INDEX idx_name (name),
  INDEX idx_scryfall_id (scryfall_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS decks (
  id          VARCHAR(50)  NOT NULL,
  name        VARCHAR(255) NOT NULL DEFAULT '',
  format      VARCHAR(50)  NOT NULL DEFAULT '',
  data        JSON         NOT NULL,
  created_at  BIGINT       NOT NULL DEFAULT 0,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS games (
  id          VARCHAR(50)  NOT NULL,
  data        JSON         NOT NULL,
  created_at  BIGINT       NOT NULL DEFAULT 0,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS wishlist (
  uid         VARCHAR(120) NOT NULL,
  data        JSON         NOT NULL,
  added_at    BIGINT       NOT NULL DEFAULT 0,
  PRIMARY KEY (uid)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS preferences (
  key_name    VARCHAR(100) NOT NULL,
  value       JSON         NOT NULL,
  PRIMARY KEY (key_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
