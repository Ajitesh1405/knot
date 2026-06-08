-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "UserSettings" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'personal',
    "emailRange" TEXT NOT NULL DEFAULT 'new_only',
    "gmailRefreshToken" TEXT,
    "outlookRefreshToken" TEXT,
    "briefingsEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PendingDraft" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "chatId" TEXT,
    "messageId" TEXT,
    "recipient" TEXT NOT NULL DEFAULT '',
    "subject" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'awaiting_approval',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PendingDraft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MeetingDraft" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "chatId" TEXT,
    "messageId" TEXT,
    "summary" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'awaiting_approval',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MeetingDraft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MeetingBriefing" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "briefedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MeetingBriefing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GmailWatermark" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "lastMessageId" TEXT,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GmailWatermark_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserSettings_userId_key" ON "UserSettings"("userId");

-- CreateIndex
CREATE INDEX "PendingDraft_userId_status_idx" ON "PendingDraft"("userId", "status");

-- CreateIndex
CREATE INDEX "PendingDraft_status_createdAt_idx" ON "PendingDraft"("status", "createdAt");

-- CreateIndex
CREATE INDEX "MeetingDraft_userId_status_idx" ON "MeetingDraft"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "MeetingBriefing_userId_eventId_key" ON "MeetingBriefing"("userId", "eventId");

-- CreateIndex
CREATE UNIQUE INDEX "GmailWatermark_userId_key" ON "GmailWatermark"("userId");

