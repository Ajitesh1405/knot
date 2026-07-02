-- Proactive auto-draft replies: per-user opt-in flag
ALTER TABLE "UserSettings" ADD COLUMN "autoDraftEnabled" BOOLEAN NOT NULL DEFAULT false;
