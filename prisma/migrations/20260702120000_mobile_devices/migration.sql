-- Mobile API: pairing codes + paired device bearer tokens

CREATE TABLE "MobilePairCode" (
    "code" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MobilePairCode_pkey" PRIMARY KEY ("code")
);

CREATE INDEX "MobilePairCode_userId_idx" ON "MobilePairCode"("userId");

CREATE TABLE "MobileDevice" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "name" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MobileDevice_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MobileDevice_token_key" ON "MobileDevice"("token");

CREATE INDEX "MobileDevice_userId_idx" ON "MobileDevice"("userId");
