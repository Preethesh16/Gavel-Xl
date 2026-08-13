-- CreateEnum
CREATE TYPE "RoomPhase" AS ENUM ('LOBBY', 'PREPARING_DATA', 'GENERATING_POOL', 'READY', 'REVEALING', 'BIDDING', 'RESOLVING', 'SOLD', 'UNSOLD', 'FORCED_ASSIGNMENT', 'CHECKPOINT', 'NEXT_LOT', 'FINALIZING', 'EVALUATING', 'RESULTS', 'COMPLETE');

-- CreateEnum
CREATE TYPE "CandidateKind" AS ENUM ('PLAYER', 'MANAGER');

-- CreateEnum
CREATE TYPE "AcquisitionKind" AS ENUM ('AUCTION', 'FORCED', 'EMERGENCY');

-- CreateTable
CREATE TABLE "Room" (
    "id" TEXT NOT NULL,
    "code" VARCHAR(6) NOT NULL,
    "title" TEXT NOT NULL,
    "phase" "RoomPhase" NOT NULL DEFAULT 'LOBBY',
    "revision" INTEGER NOT NULL DEFAULT 0,
    "state" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "Room_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoomEvent" (
    "id" TEXT NOT NULL,
    "roomCode" VARCHAR(6) NOT NULL,
    "sequence" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RoomEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoomMember" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "displayName" VARCHAR(24) NOT NULL,
    "avatar" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "isHost" BOOLEAN NOT NULL DEFAULT false,
    "isReady" BOOLEAN NOT NULL DEFAULT false,
    "isSpectator" BOOLEAN NOT NULL DEFAULT false,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "budgetEUR" BIGINT NOT NULL,
    "spentEUR" BIGINT NOT NULL DEFAULT 0,
    "emergencyAllocations" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "RoomMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Game" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "seedCommitment" TEXT NOT NULL,
    "revealedSeed" TEXT,
    "snapshotId" TEXT NOT NULL,
    "auctionSequence" INTEGER NOT NULL DEFAULT 0,
    "resolvedCycles" INTEGER NOT NULL DEFAULT 0,
    "hiddenState" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "Game_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GameSettings" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "formationName" TEXT NOT NULL,
    "budgetEUR" BIGINT NOT NULL,
    "bidIncrementEUR" BIGINT NOT NULL,
    "auctionTimerSeconds" INTEGER NOT NULL,
    "revealSeconds" INTEGER NOT NULL,
    "antiSnipeSeconds" INTEGER NOT NULL,
    "soundEnabled" BOOLEAN NOT NULL,
    "budgetMode" TEXT NOT NULL,
    "formLookback" TEXT NOT NULL,

    CONSTRAINT "GameSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Formation" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slotsJson" JSONB NOT NULL,

    CONSTRAINT "Formation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DataSnapshot" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sourceUpdatedAt" TIMESTAMP(3) NOT NULL,
    "payload" JSONB NOT NULL,

    CONSTRAINT "DataSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlayerSnapshot" (
    "id" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "canonicalId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "valuationValue" BIGINT,
    "valuationType" TEXT NOT NULL,
    "valuationSource" TEXT NOT NULL,

    CONSTRAINT "PlayerSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ManagerSnapshot" (
    "id" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "canonicalId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "reserveEstimate" BIGINT,
    "valuationType" TEXT NOT NULL,
    "valuationSource" TEXT NOT NULL,

    CONSTRAINT "ManagerSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PositionCycle" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "position" TEXT NOT NULL,
    "slotIndex" INTEGER NOT NULL,
    "revealOrder" INTEGER NOT NULL,
    "resolved" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "PositionCycle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Candidate" (
    "id" TEXT NOT NULL,
    "cycleId" TEXT NOT NULL,
    "kind" "CandidateKind" NOT NULL,
    "playerSnapshotId" TEXT,
    "managerSnapshotId" TEXT,
    "tier" TEXT NOT NULL,
    "openingBidEUR" BIGINT NOT NULL,
    "revealIndex" INTEGER NOT NULL,

    CONSTRAINT "Candidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuctionLot" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "openingBidEUR" BIGINT NOT NULL,
    "originalOpeningBidEUR" BIGINT NOT NULL,
    "returnCount" INTEGER NOT NULL DEFAULT 0,
    "openedAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "outcome" TEXT,
    "winnerMemberId" TEXT,
    "soldPriceEUR" BIGINT,

    CONSTRAINT "AuctionLot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Bid" (
    "id" TEXT NOT NULL,
    "lotId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "amountEUR" BIGINT NOT NULL,
    "auctionSequence" INTEGER NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "accepted" BOOLEAN NOT NULL,
    "rejectionCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Bid_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UnsoldEntry" (
    "id" TEXT NOT NULL,
    "lotId" TEXT NOT NULL,
    "returnReserveEUR" BIGINT NOT NULL,
    "returnCount" INTEGER NOT NULL,
    "requeuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UnsoldEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SquadEntry" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "cycleId" TEXT NOT NULL,
    "slotId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "purchasePriceEUR" BIGINT NOT NULL,
    "marketValueEUR" BIGINT,
    "acquisition" "AcquisitionKind" NOT NULL,
    "acquiredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SquadEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BudgetLedger" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "amountEUR" BIGINT NOT NULL,
    "balanceEUR" BIGINT NOT NULL,
    "reason" TEXT NOT NULL,
    "referenceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BudgetLedger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Checkpoint" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "checkpointNo" INTEGER NOT NULL,
    "resolvedCycles" INTEGER NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Checkpoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Evaluation" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "overallJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Evaluation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MetricScore" (
    "id" TEXT NOT NULL,
    "evaluationId" TEXT NOT NULL,
    "metricIndex" INTEGER NOT NULL,
    "category" TEXT NOT NULL,
    "metricName" TEXT NOT NULL,
    "scores" JSONB NOT NULL,
    "winnerIds" JSONB NOT NULL,

    CONSTRAINT "MetricScore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Award" (
    "id" TEXT NOT NULL,
    "evaluationId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "detail" TEXT NOT NULL,

    CONSTRAINT "Award_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GameEvent" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GameEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Room_code_key" ON "Room"("code");

-- CreateIndex
CREATE INDEX "RoomEvent_roomCode_at_idx" ON "RoomEvent"("roomCode", "at");

-- CreateIndex
CREATE UNIQUE INDEX "RoomEvent_roomCode_sequence_key" ON "RoomEvent"("roomCode", "sequence");

-- CreateIndex
CREATE INDEX "RoomMember_roomId_joinedAt_idx" ON "RoomMember"("roomId", "joinedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Game_roomId_key" ON "Game"("roomId");

-- CreateIndex
CREATE UNIQUE INDEX "GameSettings_gameId_key" ON "GameSettings"("gameId");

-- CreateIndex
CREATE UNIQUE INDEX "Formation_name_key" ON "Formation"("name");

-- CreateIndex
CREATE UNIQUE INDEX "PlayerSnapshot_snapshotId_canonicalId_key" ON "PlayerSnapshot"("snapshotId", "canonicalId");

-- CreateIndex
CREATE UNIQUE INDEX "ManagerSnapshot_snapshotId_canonicalId_key" ON "ManagerSnapshot"("snapshotId", "canonicalId");

-- CreateIndex
CREATE UNIQUE INDEX "PositionCycle_gameId_position_slotIndex_key" ON "PositionCycle"("gameId", "position", "slotIndex");

-- CreateIndex
CREATE UNIQUE INDEX "AuctionLot_gameId_sequence_key" ON "AuctionLot"("gameId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "Bid_idempotencyKey_key" ON "Bid"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "UnsoldEntry_lotId_key" ON "UnsoldEntry"("lotId");

-- CreateIndex
CREATE UNIQUE INDEX "SquadEntry_candidateId_key" ON "SquadEntry"("candidateId");

-- CreateIndex
CREATE UNIQUE INDEX "SquadEntry_gameId_memberId_cycleId_key" ON "SquadEntry"("gameId", "memberId", "cycleId");

-- CreateIndex
CREATE UNIQUE INDEX "SquadEntry_gameId_candidateId_key" ON "SquadEntry"("gameId", "candidateId");

-- CreateIndex
CREATE UNIQUE INDEX "Checkpoint_gameId_checkpointNo_key" ON "Checkpoint"("gameId", "checkpointNo");

-- CreateIndex
CREATE UNIQUE INDEX "Evaluation_gameId_key" ON "Evaluation"("gameId");

-- CreateIndex
CREATE UNIQUE INDEX "MetricScore_evaluationId_metricIndex_key" ON "MetricScore"("evaluationId", "metricIndex");

-- CreateIndex
CREATE INDEX "GameEvent_gameId_at_idx" ON "GameEvent"("gameId", "at");

-- CreateIndex
CREATE UNIQUE INDEX "GameEvent_gameId_sequence_key" ON "GameEvent"("gameId", "sequence");

-- AddForeignKey
ALTER TABLE "RoomEvent" ADD CONSTRAINT "RoomEvent_roomCode_fkey" FOREIGN KEY ("roomCode") REFERENCES "Room"("code") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomMember" ADD CONSTRAINT "RoomMember_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Game" ADD CONSTRAINT "Game_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Game" ADD CONSTRAINT "Game_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "DataSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameSettings" ADD CONSTRAINT "GameSettings_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayerSnapshot" ADD CONSTRAINT "PlayerSnapshot_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "DataSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManagerSnapshot" ADD CONSTRAINT "ManagerSnapshot_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "DataSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PositionCycle" ADD CONSTRAINT "PositionCycle_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Candidate" ADD CONSTRAINT "Candidate_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "PositionCycle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Candidate" ADD CONSTRAINT "Candidate_playerSnapshotId_fkey" FOREIGN KEY ("playerSnapshotId") REFERENCES "PlayerSnapshot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Candidate" ADD CONSTRAINT "Candidate_managerSnapshotId_fkey" FOREIGN KEY ("managerSnapshotId") REFERENCES "ManagerSnapshot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuctionLot" ADD CONSTRAINT "AuctionLot_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuctionLot" ADD CONSTRAINT "AuctionLot_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuctionLot" ADD CONSTRAINT "AuctionLot_winnerMemberId_fkey" FOREIGN KEY ("winnerMemberId") REFERENCES "RoomMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bid" ADD CONSTRAINT "Bid_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "AuctionLot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bid" ADD CONSTRAINT "Bid_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "RoomMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnsoldEntry" ADD CONSTRAINT "UnsoldEntry_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "AuctionLot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SquadEntry" ADD CONSTRAINT "SquadEntry_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SquadEntry" ADD CONSTRAINT "SquadEntry_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "RoomMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SquadEntry" ADD CONSTRAINT "SquadEntry_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "PositionCycle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SquadEntry" ADD CONSTRAINT "SquadEntry_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetLedger" ADD CONSTRAINT "BudgetLedger_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "RoomMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Checkpoint" ADD CONSTRAINT "Checkpoint_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evaluation" ADD CONSTRAINT "Evaluation_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MetricScore" ADD CONSTRAINT "MetricScore_evaluationId_fkey" FOREIGN KEY ("evaluationId") REFERENCES "Evaluation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Award" ADD CONSTRAINT "Award_evaluationId_fkey" FOREIGN KEY ("evaluationId") REFERENCES "Evaluation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameEvent" ADD CONSTRAINT "GameEvent_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;
