-- CreateTable
CREATE TABLE "SkillSetting" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "skill" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SkillSetting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SkillSetting_userId_idx" ON "SkillSetting"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "SkillSetting_userId_skill_key" ON "SkillSetting"("userId", "skill");
