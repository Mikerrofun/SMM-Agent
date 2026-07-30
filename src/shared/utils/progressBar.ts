import cliProgress from "cli-progress";

/**
 * Переиспользуемый progress bar на базе cli-progress.
 * Формат: [████████░░] 45% | 70/154 | Elapsed: 2m | ETA: 2m
 */
export class ProgressBar {
  private bar: cliProgress.SingleBar;

  constructor(label = "") {
    const prefix = label ? `${label} ` : "";
    this.bar = new cliProgress.SingleBar(
      {
        format: `${prefix}[{bar}] {percentage}% | {value}/{total} | Elapsed: {duration_formatted} | ETA: {eta_formatted}`,
        barCompleteChar: "█",
        barIncompleteChar: "░",
        hideCursor: true,
        clearOnComplete: false,
      },
      cliProgress.Presets.shades_classic
    );
  }

  start(total: number, startValue = 0): void {
    this.bar.start(total, startValue);
  }

  update(current: number): void {
    this.bar.update(current);
  }

  increment(delta = 1): void {
    this.bar.increment(delta);
  }

  stop(): void {
    this.bar.stop();
  }
}
