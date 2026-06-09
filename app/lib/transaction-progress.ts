/**
 * Labels for in-flight transaction UI. Thresholds align with lock/mint flow in
 * `lockActions.ts`: build work (contract, tx, server-assembled BEEF) stays below 80;
 * ARC broadcast and persistence use 80–99; 100 completes the step.
 */
export function getTransactionProgressLabel(progress: number): string {
  if (progress < 25) return 'Preparing'
  if (progress < 80) return 'Building'
  if (progress < 100) return 'Broadcasting'
  return 'Finalizing'
}

export function formatProgressElapsedTime(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60

  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}
