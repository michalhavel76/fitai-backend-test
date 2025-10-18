-- =======================================================
-- FitAI 4.2 – Data Hub Foundation
-- Created safely 2025-10-18
-- =======================================================

CREATE TABLE "FitAI_DataHub" (
  "id" SERIAL PRIMARY KEY,
  "nutrient_key" TEXT UNIQUE NOT NULL,
  "avg_value" DOUBLE PRECISION NOT NULL,
  "region" TEXT DEFAULT 'global',
  "samples_count" INTEGER DEFAULT 0,
  "accuracy_score" DOUBLE PRECISION DEFAULT 0.85,
  "created_at" TIMESTAMP DEFAULT NOW(),
  "updated_at" TIMESTAMP DEFAULT NOW()
);
