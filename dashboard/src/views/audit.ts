/**
 * Audit View
 * Shows audit loop status, start/stop controls, and streaming output.
 * Route: #/audit
 */

import toast from '@/components/toast';
import { escapeHtml } from '@/utils/escape-html';
import {
  getAuditStatus,
  getAuditOutput,
  startAudit,
  stopAudit,
  quickAudit,
} from '@/api-operations';
import type { AuditStatus } from '@/types';

// ---------------------------------------------------------------------------
// Main view
// ---------------------------------------------------------------------------

export async function renderAudit(container: HTMLElement): Promise<() => void> {
  let status: AuditStatus = { isRunning: false };
  let outputLines: string[] = [];
  let pollTimer: ReturnType<typeof setInterval> | null = null;

  try {
    status = await getAuditStatus();
  } catch {
    // Audit endpoint may not be available
  }

  function renderView(): void {
    container.innerHTML = `
      <div class="card mb-md">
        <div class="card-header">
          <div>
            <h2 class="card-title">Audit Loop</h2>
            <div class="text-xs text-fg-muted mt-xs">
              Status: <span class="badge ${status.isRunning ? 'yellow' : 'green'}">${status.isRunning ? 'Running' : 'Idle'}</span>
              ${status.iteration !== undefined ? ` \u2014 Iteration ${status.iteration}/${status.maxIterations || '\u221E'}` : ''}
              ${status.startedAt ? ` \u2014 Started ${escapeHtml(status.startedAt)}` : ''}
            </div>
          </div>
          <div class="flex gap-sm">
            ${status.isRunning ? `
              <button class="btn btn-danger btn-sm" id="audit-stop">Stop</button>
            ` : `
              <button class="btn btn-primary btn-sm" id="audit-start">Start</button>
              <button class="btn btn-secondary btn-sm" id="audit-dry">Dry Run</button>
              <button class="btn btn-secondary btn-sm" id="audit-quick">Quick Check</button>
            `}
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <h3 class="card-title">Output</h3>
          <button class="btn btn-secondary btn-sm" id="audit-clear">Clear</button>
        </div>
        <div id="audit-output" class="p-md bg-bg-secondary rounded font-mono text-xs max-h-[500px] overflow-y-auto whitespace-pre-wrap">
          ${outputLines.length > 0 ? outputLines.map((l) => escapeHtml(l)).join('\n') : '<span class="text-fg-muted">No output yet. Start an audit to see results.</span>'}
        </div>
      </div>
    `;
  }

  renderView();

  async function pollOutput(): Promise<void> {
    try {
      const data = await getAuditOutput({ offset: outputLines.length }) as { output?: string; lines?: string[] };
      const newLines = data.lines || (data.output ? data.output.split('\n') : []);
      if (newLines.length > 0) {
        outputLines.push(...newLines);
        const el = document.getElementById('audit-output');
        if (el) {
          el.innerHTML = outputLines.map((l) => escapeHtml(l)).join('\n');
          el.scrollTop = el.scrollHeight;
        }
      }
      // Re-check status
      const newStatus = await getAuditStatus();
      if (newStatus.isRunning !== status.isRunning) {
        status = newStatus;
        renderView();
        if (!status.isRunning) stopPolling();
      }
    } catch {
      // Ignore poll errors
    }
  }

  function startPolling(): void {
    stopPolling();
    pollTimer = setInterval(pollOutput, 2000);
  }

  function stopPolling(): void {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  if (status.isRunning) startPolling();

  // Event delegation
  container.addEventListener('click', async (e: MouseEvent) => {
    const target = e.target as HTMLElement;

    if (target.closest('#audit-start')) {
      try {
        await startAudit();
        status = { ...status, isRunning: true };
        outputLines = [];
        renderView();
        startPolling();
        toast.success('Audit started');
      } catch (err) { toast.error((err as Error).message); }
      return;
    }

    if (target.closest('#audit-dry')) {
      try {
        await startAudit({ dryRun: true });
        status = { ...status, isRunning: true };
        outputLines = [];
        renderView();
        startPolling();
        toast.success('Dry run started');
      } catch (err) { toast.error((err as Error).message); }
      return;
    }

    if (target.closest('#audit-quick')) {
      try {
        const result = await quickAudit() as { output?: string };
        outputLines = (result.output || 'Quick check complete').split('\n');
        renderView();
        toast.success('Quick check complete');
      } catch (err) { toast.error((err as Error).message); }
      return;
    }

    if (target.closest('#audit-stop')) {
      try {
        await stopAudit();
        status = { ...status, isRunning: false };
        stopPolling();
        renderView();
        toast.success('Audit stopped');
      } catch (err) { toast.error((err as Error).message); }
      return;
    }

    if (target.closest('#audit-clear')) {
      outputLines = [];
      renderView();
    }
  });

  return () => {
    stopPolling();
  };
}
