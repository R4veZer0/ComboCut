import { EventEmitter } from 'node:events';
import type { ClipExportManager, ClipExportRequest, ClipExportResult } from './clipExportManager.js';

export type BatchJobStatus = 'queued' | 'running' | 'done' | 'error';

export interface BatchExportJob {
  jobId: string;
  pinnedClipId: number;
  label: string;
  status: BatchJobStatus;
  downloadUrl?: string;
  filename?: string;
  exportDir?: string;
  hookTitle?: string;
  hashtags?: string;
  error?: string;
  createdAt: string;
  completedAt?: string;
}

interface InternalJob {
  job: BatchExportJob;
  request: ClipExportRequest;
}

export class BatchExportQueue extends EventEmitter {
  private queue: InternalJob[] = [];
  private processing = false;

  constructor(private readonly clipExport: ClipExportManager) {
    super();
  }

  enqueue(items: Array<{ pinnedClipId: number; label: string; request: ClipExportRequest }>): BatchExportJob[] {
    const added: BatchExportJob[] = [];
    for (const item of items) {
      const job: BatchExportJob = {
        jobId: `job_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        pinnedClipId: item.pinnedClipId,
        label: item.label,
        status: 'queued',
        createdAt: new Date().toISOString(),
      };
      this.queue.push({ job, request: item.request });
      added.push(job);
    }
    this.emit('updated', this.listJobs());
    void this.processNext();
    return added;
  }

  listJobs(): BatchExportJob[] {
    return this.queue.map((entry) => ({ ...entry.job }));
  }

  removeJob(jobId: string): boolean {
    const idx = this.queue.findIndex((e) => e.job.jobId === jobId);
    if (idx === -1) return false;
    if (this.queue[idx].job.status === 'running') {
      return false;
    }
    this.queue.splice(idx, 1);
    this.emit('updated', this.listJobs());
    return true;
  }

  clearCompleted(): void {
    this.queue = this.queue.filter((e) => e.job.status === 'queued' || e.job.status === 'running');
    this.emit('updated', this.listJobs());
  }

  private async processNext(): Promise<void> {
    if (this.processing) return;
    const next = this.queue.find((e) => e.job.status === 'queued');
    if (!next) return;

    this.processing = true;
    next.job.status = 'running';
    this.emit('updated', this.listJobs());

    try {
      const result: ClipExportResult = await this.clipExport.exportClip(next.request);
      next.job.status = 'done';
      next.job.downloadUrl = result.downloadUrl;
      next.job.filename = result.filename;
      next.job.exportDir = result.exportDir;
      next.job.hookTitle = result.hookTitle;
      next.job.hashtags = result.hashtags;
      next.job.completedAt = new Date().toISOString();
    } catch (err) {
      next.job.status = 'error';
      next.job.error = err instanceof Error ? err.message : String(err);
      next.job.completedAt = new Date().toISOString();
    } finally {
      this.processing = false;
      this.emit('updated', this.listJobs());
      void this.processNext();
    }
  }
}
