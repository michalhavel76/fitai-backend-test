// =======================================================
// FitAI 4.9 – Scientific Run Engine
// Full Automatic Cycle: Correction → Calibration → Summary
// Compatible with existing FitAI 4.8 backend
// =======================================================

import { Pool } from "pg";
import scientificCorrection from "./scientific-correction.js";
import { scientificCalibrate } from "./scientific-calibration.js";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// =======================================================
// 🧬 MAIN ENGINE
// =======================================================
const scientificRun = async (req, res) => {
  console.log("🚀 Starting FitAI Scientific Run 4.9...");
  const client = await pool.connect();

  const batchStart = new Date();
  const batchId = `run_${batchStart.toISOString()}`;

  try {
    // ✅ Step 1 – Run correction
    console.log("🧪 Step 1: Running scientific correction...");
    const correctionResult = await new Promise((resolve, reject) => {
      // Simulace volání endpointu bez HTTP
      const mockRes = {
        json: (data) => resolve(data),
        status: () => ({ json: (err) => reject(err) }),
      };
      scientificCorrection({}, mockRes);
    });

    // ✅ Step 2 – Run calibration
    console.log("🔬 Step 2: Running scientific calibration...");
    const calibrationResult = await new Promise((resolve, reject) => {
      const mockRes = {
        json: (data) => resolve(data),
        status: () => ({ json: (err) => reject(err) }),
      };
      scientificCalibrate({}, mockRes);
    });

    // ✅ Step 3 – Calculate improvement
    const improvement =
      (Number(calibrationResult.averageAccuracy || 0) -
        Number(req.body.prevAccuracy || 0)) *
      100;

    // ✅ Step 4 – Save batch summary
    await client.query(
      `INSERT INTO food_audit_log (action, details, created_at)
       VALUES ($1, $2, NOW())`,
      [
        "scientific_batch",
        JSON.stringify({
          batchId,
          correction: correctionResult,
          calibration: calibrationResult,
          improvement: `${improvement.toFixed(2)}%`,
        }),
      ]
    );

    const summary = {
      success: true,
      batchId,
      correction: correctionResult,
      calibration: calibrationResult,
      improvement: `${improvement.toFixed(2)}%`,
      message: "Full scientific batch completed successfully",
      date: new Date().toISOString(),
    };

    console.log("✅ Scientific Run 4.9 finished:", summary);
    res.json(summary);
  } catch (err) {
    console.error("❌ Scientific Run error:", err);
    res.status(500).json({ error: "Scientific run failed", details: err.message });
  } finally {
    client.release();
  }
};

// =======================================================
// ✅ Default export (compatible with index.ts import)
// =======================================================
export default scientificRun;
