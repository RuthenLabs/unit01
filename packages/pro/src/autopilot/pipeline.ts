import chalk from 'chalk';
import { spawn } from 'child_process';
import { isPro, FREE_LIMITS } from '@unit01/core/tier.js';

const themeAccent = chalk.hex('#38BDF8');
const themeGold = chalk.hex('#F59E0B');
const themeRose = chalk.hex('#F87171');

export interface PipelineResult {
  success: boolean;
  iterations: number;
  logs: string[];
}

export class StructuredBuildPipeline {
  private workspaceRoot: string;
  private testCommand: string;
  private maxIterations: number;

  constructor(workspaceRoot: string, testCommand = 'npm test', maxIterations = 8) {
    this.workspaceRoot = workspaceRoot;
    this.testCommand = testCommand;
    this.maxIterations = isPro() ? maxIterations : Math.min(maxIterations, FREE_LIMITS.AUTOPILOT_ITERATIONS);
  }

  /**
   * Run the Plan-Code-Test-Healing pipeline loop.
   * Runs tests, feeds compiler warnings back to the model, and iterates.
   */
  public async executePipeline(
    applyChanges: () => Promise<void>,
    promptSelfHeal: (errorLog: string) => Promise<boolean>
  ): Promise<PipelineResult> {
    const logs: string[] = [];
    let iterations = 0;
    let success = false;
    let lastErrorFingerprint = '';
    let sameErrorCount = 0;

    console.log(`\n  ${themeAccent('pipeline')} Starting Structured Build Pipeline`);
    console.log(`  ${themeAccent('pipeline')} Active Workspace: ${this.workspaceRoot}`);
    console.log(`  ${themeAccent('pipeline')} Test command: ${this.testCommand}\n`);

    while (iterations < this.maxIterations) {
      iterations++;
      console.log(`  ${themeGold('pipeline')} [Iteration ${iterations}/${this.maxIterations}] Applying code modifications...`);
      
      // 1. Write the edits to workspace
      await applyChanges();

      // 2. Compile and run test commands inside the workspace directory
      console.log(`  ${themeAccent('pipeline')} Running compile/test verification...`);
      const testResult = await this.runBuildVerification();

      if (testResult.passed) {
        console.log(`  ${themeAccent('pipeline')} ${chalk.green('✓ Verification passed successfully!')}`);
        success = true;
        break;
      }

      console.log(`  ${themeRose('pipeline')} ✗ Build failed. Error logs captured.`);
      logs.push(`Iteration ${iterations} Failure:\n${testResult.output}`);

      // ── Sameness detection: stop if the same error repeats ──────────────
      const errorFingerprint = testResult.output.slice(0, 300).replace(/\s+/g, ' ').trim();
      if (errorFingerprint === lastErrorFingerprint) {
        sameErrorCount++;
        if (sameErrorCount >= 2) {
          console.log(`  ${themeRose('pipeline')} ✗ Same error repeated ${sameErrorCount + 1}x — self-healing is not making progress. Halting.`);
          break;
        }
      } else {
        sameErrorCount = 0;
        lastErrorFingerprint = errorFingerprint;
      }

      if (iterations >= this.maxIterations) {
        console.log(`  ${themeRose('pipeline')} ✗ Self-healing limit reached (${this.maxIterations}). Halting execution.`);
        break;
      }

      // ── Human approval gate before self-healing ──────────────────────────
      console.log(`\n  ${themeGold('pipeline')} ══════════════════════════════════════════════`);
      console.log(`  ${themeGold('pipeline')} Autopilot wants to self-heal (iteration ${iterations}/${this.maxIterations})`);
      console.log(`  ${themeGold('pipeline')} Press ENTER to let it try, or Ctrl+C to stop.`);
      console.log(`  ${themeGold('pipeline')} ══════════════════════════════════════════════\n`);

      await new Promise<void>((resolve) => {
        const stdin = process.stdin;
        const wasRaw = stdin.isRaw;
        stdin.setRawMode?.(false);
        stdin.resume();
        stdin.once('data', () => {
          stdin.setRawMode?.(wasRaw ?? false);
          resolve();
        });
      });

      // 3. Trigger Self-Healing loop
      console.log(`  ${themeGold('pipeline')} Feeding stack trace to LLM for self-correction...`);
      const healSuccessful = await promptSelfHeal(testResult.output);

      if (!healSuccessful) {
        console.log(`  ${themeRose('pipeline')} ✗ Model aborted self-healing.`);
        break;
      }
    }

    if (!success && !isPro()) {
      console.log(`\n  ${themeGold('pipeline')} 💡 Free tier only allows 1 iteration. Upgrade to Pro to enable autonomous self-healing.`);
    }

    return {
      success,
      iterations,
      logs
    };
  }

  /**
   * Run test/build command using spawn to stream output in real-time.
   */
  private runBuildVerification(): Promise<{ passed: boolean; output: string }> {
    return new Promise((resolve) => {
      const child = spawn(this.testCommand, {
        cwd: this.workspaceRoot,
        shell: true,
        env: { ...process.env, CI: 'true' }
      });

      let output = '';

      child.stdout.on('data', (data) => {
        const str = data.toString();
        process.stdout.write(str);
        output += str;
      });

      child.stderr.on('data', (data) => {
        const str = data.toString();
        process.stderr.write(str);
        output += str;
      });

      child.on('close', (code) => {
        resolve({
          passed: code === 0,
          output
        });
      });
    });
  }
}
