import {
  resolveTargetFromOptions,
  type TargetOptions,
} from "../infrastructure/context.js";
import { formatDoctorReport, runDoctor } from "../application/doctor.js";

export type DoctorCliOptions = TargetOptions & {
  json?: boolean;
};

export function executeDoctor(options: DoctorCliOptions = {}): void {
  const { targetDir } = resolveTargetFromOptions(options);
  const report = runDoctor(targetDir);
  const output = formatDoctorReport(report, Boolean(options.json));
  console.log(output);

  if (!report.healthy) {
    process.exitCode = 1;
  }
}
