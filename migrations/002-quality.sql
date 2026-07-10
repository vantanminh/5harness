-- Phase C: verification metadata and trace friction

ALTER TABLE story ADD COLUMN last_verified_at TEXT;
ALTER TABLE story ADD COLUMN last_verified_result TEXT
    CHECK(last_verified_result IN ('pass','fail') OR last_verified_result IS NULL);

ALTER TABLE trace ADD COLUMN harness_friction TEXT;
