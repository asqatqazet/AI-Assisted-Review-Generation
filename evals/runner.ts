import * as fs from "node:fs";
import * as path from "node:path";

import { evaluateScenario } from "./scenario-evaluator.js";
import type { GoldenEvalReport, GoldenScenario } from "./types.js";

export { evaluateScenario } from "./scenario-evaluator.js";

export function runGoldenEvaluation(goldenDir = "evals/golden"): GoldenEvalReport {
  const dirPath = path.resolve(goldenDir);
  if (!fs.existsSync(dirPath)) {
    throw new Error(`Golden scenarios directory '${dirPath}' does not exist.`);
  }

  const files = fs.readdirSync(dirPath).filter((f) => f.endsWith(".json"));
  if (files.length === 0) {
    throw new Error(`No golden scenario files found in '${dirPath}'.`);
  }

  const results: { id: string; passed: boolean; failureReason?: string | undefined }[] = [];

  for (const file of files.sort()) {
    const raw = fs.readFileSync(path.join(dirPath, file), "utf8");
    const scenario = JSON.parse(raw) as GoldenScenario;
    const result = evaluateScenario(scenario);
    results.push({
      id: scenario.id,
      passed: result.passed,
      failureReason: result.failureReason,
    });
  }

  const totalScenarios = results.length;
  const passedScenarios = results.filter((r) => r.passed).length;
  const failedScenarios = totalScenarios - passedScenarios;
  const passRate = Number((passedScenarios / totalScenarios).toFixed(4));

  const report: GoldenEvalReport = {
    totalScenarios,
    passedScenarios,
    failedScenarios,
    passRate,
    results,
    timestamp: new Date().toISOString(),
  };

  const resultsDir = path.resolve("evals/results");
  if (!fs.existsSync(resultsDir)) {
    fs.mkdirSync(resultsDir, { recursive: true });
  }
  fs.writeFileSync(
    path.join(resultsDir, "latest.json"),
    JSON.stringify(report, null, 2),
    "utf8",
  );

  return report;
}

if (process.argv[1]?.endsWith("runner.ts") || process.argv[1]?.endsWith("runner.js")) {
  const report = runGoldenEvaluation();
  console.log(`\n======================================================`);
  console.log(` GOLDEN SET EVALUATION GATE REPORT`);
  console.log(`======================================================`);
  console.log(` Total Scenarios:  ${report.totalScenarios}`);
  console.log(` Passed:           ${report.passedScenarios}`);
  console.log(` Failed:           ${report.failedScenarios}`);
  console.log(` Pass Rate:        ${(report.passRate * 100).toFixed(1)}%`);
  console.log(` Result File:      evals/results/latest.json`);
  console.log(`======================================================\n`);

  if (report.failedScenarios > 0) {
    console.error("Evaluation Failures:");
    for (const r of report.results.filter((res) => !res.passed)) {
      console.error(` - [${r.id}]: ${r.failureReason}`);
    }
  }
}
