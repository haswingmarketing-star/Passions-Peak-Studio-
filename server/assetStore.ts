import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export interface AssetRecord {
  assetId: string;
  sha256: string;
  ext: string;
  mimeType: string;
  sizeBytes: number;
  kind: "character_ref" | "location_plate" | "scene_frame" | "thumbnail" | "voiceover" | "bgm" | "watermark" | "overlay" | "srt" | "video" | "other";
  label?: string;
  meta?: Record<string, unknown>;
  createdAt: string;
}

const DATA_ROOT = path.resolve(process.cwd(), "data", "assets");
const INDEX_PATH = path.join(DATA_ROOT, "index.json");
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // 25 MB upload guardrail

class AssetStore {
  private index: Record<string, AssetRecord> = {};
  private initialized = false;

  async init(): Promise<void> {
    if (this.initialized) return;
    await fs.mkdir(DATA_ROOT, { recursive: true });
    try {
      const raw = await fs.readFile(INDEX_PATH, "utf-8");
      this.index = JSON.parse(raw) as Record<string, AssetRecord>;
    } catch {
      this.index = {};
      await this.persistIndex();
    }
    this.initialized = true;
  }

  private async persistIndex(): Promise<void> {
    await fs.writeFile(INDEX_PATH, JSON.stringify(this.index, null, 2), "utf-8");
  }

  private extFromMime(mimeType: string): string {
    const map: Record<string, string> = {
      "image/png": "png",
      "image/jpeg": "jpg",
      "image/webp": "webp",
      "audio/mpeg": "mp3",
      "audio/mp3": "mp3",
      "audio/wav": "wav",
      "audio/x-wav": "wav",
      "video/mp4": "mp4",
      "video/webm": "webm",
      "text/plain": "srt",
      "application/x-subrip": "srt",
    };
    return map[mimeType.toLowerCase()] ?? "bin";
  }

  async putBuffer(params: {
    buffer: Buffer;
    mimeType: string;
    kind: AssetRecord["kind"];
    label?: string;
    extOverride?: string;
    meta?: Record<string, unknown>;
  }): Promise<AssetRecord> {
    await this.init();
    if (params.buffer.byteLength > MAX_UPLOAD_BYTES) {
      throw new Error(`Asset exceeds maximum allowed size (${MAX_UPLOAD_BYTES / (1024 * 1024)} MB).`);
    }
    const sha256 = crypto.createHash("sha256").update(params.buffer).digest("hex");
    const ext = params.extOverride ?? this.extFromMime(params.mimeType);
    const assetId = `${sha256.slice(0, 24)}.${ext}`;
    const filePath = path.join(DATA_ROOT, assetId);

    if (!this.index[assetId]) {
      await fs.writeFile(filePath, params.buffer);
      this.index[assetId] = {
        assetId,
        sha256,
        ext,
        mimeType: params.mimeType,
        sizeBytes: params.buffer.byteLength,
        kind: params.kind,
        label: params.label,
        meta: params.meta,
        createdAt: new Date().toISOString(),
      };
      await this.persistIndex();
    }
    return this.index[assetId];
  }

  async putBase64(params: {
    base64Data: string;
    mimeType: string;
    kind: AssetRecord["kind"];
    label?: string;
    meta?: Record<string, unknown>;
  }): Promise<AssetRecord> {
    const clean = params.base64Data.replace(/^data:[^;]+;base64,/, "");
    const buffer = Buffer.from(clean, "base64");
    return this.putBuffer({
      buffer,
      mimeType: params.mimeType,
      kind: params.kind,
      label: params.label,
      meta: params.meta,
    });
  }

  async getRecord(assetId: string): Promise<AssetRecord | null> {
    await this.init();
    const safe = path.basename(assetId);
    return this.index[safe] ?? null;
  }

  async getBuffer(assetId: string): Promise<{ record: AssetRecord; buffer: Buffer } | null> {
    await this.init();
    const safe = path.basename(assetId);
    const record = this.index[safe];
    if (!record) return null;
    try {
      const buffer = await fs.readFile(path.join(DATA_ROOT, safe));
      return { record, buffer };
    } catch {
      return null;
    }
  }

  async getBase64(assetId: string): Promise<{ mimeType: string; data: string } | null> {
    const found = await this.getBuffer(assetId);
    if (!found) return null;
    return {
      mimeType: found.record.mimeType,
      data: found.buffer.toString("base64"),
    };
  }

  async listAll(kind?: AssetRecord["kind"]): Promise<AssetRecord[]> {
    await this.init();
    const items = Object.values(this.index);
    return kind ? items.filter((r) => r.kind === kind) : items;
  }
}

export const assetStore = new AssetStore();
