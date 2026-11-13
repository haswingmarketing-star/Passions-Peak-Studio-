import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import path from "node:path";
import type { Request, Response } from "express";
import type { Job } from "../src/contracts/schemas.ts";

const JOBS_PATH = path.resolve(process.cwd(), "data", "jobs.json");

interface JobEventRecord {
  eventId: number;
  job: Job;
}

class JobEngine extends EventEmitter {
  private jobs: Record<string, Job> = {};
  private eventLog: JobEventRecord[] = [];
  private nextEventId = 1;
  private initialized = false;

  async init(): Promise<void> {
    if (this.initialized) return;
    await fs.mkdir(path.dirname(JOBS_PATH), { recursive: true });
    try {
      const raw = await fs.readFile(JOBS_PATH, "utf-8");
      this.jobs = JSON.parse(raw) as Record<string, Job>;
      // Recover any jobs left "running" during a crash/restart
      let dirty = false;
      for (const job of Object.values(this.jobs)) {
        if (job.status === "running" || job.status === "queued") {
          job.status = "failed";
          job.message = "Interrupted by server restart; safe to retry.";
          job.updatedAt = new Date().toISOString();
          dirty = true;
        }
      }
      if (dirty) await this.persist();
    } catch {
      this.jobs = {};
      await this.persist();
    }
    this.initialized = true;
  }

  private async persist(): Promise<void> {
    await fs.writeFile(JOBS_PATH, JSON.stringify(this.jobs, null, 2), "utf-8");
  }

  async createJob(params: {
    projectId: string;
    episodeId?: string;
    parentJobId?: string;
    type: Job["type"];
    phase: string;
    message: string;
    idempotencyKey?: string;
  }): Promise<Job> {
    await this.init();
    if (params.idempotencyKey) {
      const existing = Object.values(this.jobs).find(
        (j) => j.idempotencyKey === params.idempotencyKey && j.status !== "failed"
      );
      if (existing) return existing;
    }

    const now = new Date().toISOString();
    const job: Job = {
      id: `job_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      parentJobId: params.parentJobId,
      projectId: params.projectId,
      episodeId: params.episodeId,
      type: params.type,
      status: "queued",
      progress: 0,
      phase: params.phase,
      message: params.message,
      idempotencyKey: params.idempotencyKey,
      outputAssetIds: [],
      outputMeta: {},
      createdAt: now,
      updatedAt: now,
    };

    this.jobs[job.id] = job;
    await this.persist();
    this.broadcast(job);
    return job;
  }

  async updateJob(
    jobId: string,
    patch: Partial<Pick<Job, "status" | "progress" | "phase" | "message" | "outputAssetIds" | "outputMeta" | "error">>
  ): Promise<Job> {
    await this.init();
    const current = this.jobs[jobId];
    if (!current) throw new Error(`Job '${jobId}' not found.`);
    const updated: Job = {
      ...current,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    this.jobs[jobId] = updated;
    await this.persist();
    this.broadcast(updated);
    return updated;
  }

  async getJob(jobId: string): Promise<Job | null> {
    await this.init();
    return this.jobs[jobId] ?? null;
  }

  async listJobs(projectId?: string): Promise<Job[]> {
    await this.init();
    const all = Object.values(this.jobs).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return projectId ? all.filter((j) => j.projectId === projectId) : all;
  }

  private broadcast(job: Job): void {
    const rec: JobEventRecord = {
      eventId: this.nextEventId++,
      job,
    };
    this.eventLog.push(rec);
    if (this.eventLog.length > 400) {
      this.eventLog = this.eventLog.slice(-300);
    }
    this.emit("job_event", rec);
  }

  attachSseClient(req: Request, res: Response): void {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });

    const lastIdHeader = req.headers["last-event-id"];
    const lastId = typeof lastIdHeader === "string" ? parseInt(lastIdHeader, 10) : 0;

    if (!Number.isNaN(lastId) && lastId > 0) {
      for (const missed of this.eventLog) {
        if (missed.eventId > lastId) {
          res.write(`id: ${missed.eventId}\nevent: job\ndata: ${JSON.stringify(missed.job)}\n\n`);
        }
      }
    } else {
      res.write(`event: ready\ndata: ${JSON.stringify({ ok: true })}\n\n`);
    }

    const onEvent = (rec: JobEventRecord) => {
      res.write(`id: ${rec.eventId}\nevent: job\ndata: ${JSON.stringify(rec.job)}\n\n`);
    };

    this.on("job_event", onEvent);

    const heartbeat = setInterval(() => {
      res.write(`: keepalive\n\n`);
    }, 15000);

    req.on("close", () => {
      clearInterval(heartbeat);
      this.off("job_event", onEvent);
    });
  }
}

export const jobEngine = new JobEngine();
