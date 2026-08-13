CREATE TABLE "PlayerCatalog" (
    "canonicalId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "source" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PlayerCatalog_pkey" PRIMARY KEY ("canonicalId")
);

CREATE TABLE "ManagerCatalog" (
    "canonicalId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "source" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ManagerCatalog_pkey" PRIMARY KEY ("canonicalId")
);

CREATE TABLE "CatalogImport" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "playerCount" INTEGER NOT NULL,
    "managerCount" INTEGER NOT NULL,
    "payloadHash" TEXT NOT NULL,
    CONSTRAINT "CatalogImport_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PlayerCatalog_source_updatedAt_idx" ON "PlayerCatalog"("source", "updatedAt");
CREATE INDEX "ManagerCatalog_source_updatedAt_idx" ON "ManagerCatalog"("source", "updatedAt");
