import { runAutonomousExecution } from "@/server/execution/autonomous-execution";

export async function runAutonomousExecutionProcessor(): Promise<void> {
  await runAutonomousExecution();
}
