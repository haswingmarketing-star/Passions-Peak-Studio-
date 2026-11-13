import fs from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import { z } from "zod";
import { RenderManifestV1Schema } from "../../src/contracts/schemas.ts";

const PYTHON_KIT_DIR = path.resolve(process.cwd(), "python-kit");

// Strict patterns that must NEVER appear inside the exported Creator Kit
const SECRET_PATTERNS: Array<{ name: string; regex: RegExp }> = [
  { name: "Google API Key", regex: /AIza[0-9A-Za-z\-_]{25,}/g },
  { name: "ElevenLabs / Stripe-style Key", regex: /(?:sk_|xi-)[0-9A-Za-z\-_]{20,}/g },
  {
    name: "Hardcoded GEMINI_API_KEY assignment",
    regex: /GEMINI_API_KEY[ \t]*=[ \t]*["']?(?!YOUR_|MY_|your_|<|[ \t]*$)[A-Za-z0-9\-_]{16,}/g,
  },
  {
    name: "Hardcoded ELEVENLABS_API_KEY assignment",
    regex: /ELEVENLABS_API_KEY[ \t]*=[ \t]*["']?(?!YOUR_|MY_|your_|<|[ \t]*$)[A-Za-z0-9\-_]{16,}/g,
  },
];

const EXCLUDED_SEGMENTS = new Set([
  "__pycache__",
  ".pytest_cache",
  "venv",
  ".venv",
  "output",
  "logs",
  ".env",
]);

async function walkDir(dir: string, root: string, out: Array<{ relPath: string; fullPath: string }>): Promise<void> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (EXCLUDED_SEGMENTS.has(entry.name)) continue;
    if (entry.name.startsWith(".env") && entry.name !== ".env.example") continue;
    const fullPath = path.join(dir, entry.name);
    const relPath = path.relative(root, fullPath).replace(/\\/g, "/");
    if (entry.isDirectory()) {
      await walkDir(fullPath, root, out);
    } else if (entry.isFile()) {
      out.push({ relPath, fullPath });
    }
  }
}

export const kitService = {
  scanContentForSecrets(relPath: string, content: string): void {
    for (const pat of SECRET_PATTERNS) {
      pat.regex.lastIndex = 0;
      if (pat.regex.test(content)) {
        throw new Error(
          `SECRET_SCRUB_GATE_FAILED: Potential ${pat.name} detected in '${relPath}'. Export aborted.`
        );
      }
    }
  },

  async buildCreatorKitZip(): Promise<{ filename: string; buffer: Buffer; fileCount: number }> {
    const files: Array<{ relPath: string; fullPath: string }> = [];
    await walkDir(PYTHON_KIT_DIR, PYTHON_KIT_DIR, files);

    const zip = new JSZip();
    const rootFolder = zip.folder("vertical-video-pipeline");
    if (!rootFolder) throw new Error("Failed to initialize ZIP folder.");

    for (const file of files) {
      const buf = await fs.readFile(file.fullPath);
      const isText = /\.(py|html|js|css|md|txt|sh|bat|json|example|gitignore|yml|yaml)$/i.test(
        file.relPath
      ) || file.relPath.endsWith(".env.example") || file.relPath.endsWith(".gitignore");

      if (isText) {
        this.scanContentForSecrets(file.relPath, buf.toString("utf-8"));
      }
      rootFolder.file(file.relPath, buf);
    }

    // Inject latest shared JSON Schema generated directly from Zod contracts
    const manifestSchema = z.toJSONSchema(RenderManifestV1Schema);
    rootFolder.file("schemas/manifest.schema.json", JSON.stringify(manifestSchema, null, 2));

    // Ensure clean runtime directories exist with .gitkeep
    rootFolder.file("projects/.gitkeep", "");
    rootFolder.file("output/.gitkeep", "");
    rootFolder.file("static/uploads/.gitkeep", "");
    rootFolder.file("assets/watermarks/.gitkeep", "");
    rootFolder.file("assets/bgm/.gitkeep", "");
    rootFolder.file("assets/stock/.gitkeep", "");

    const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
    return {
      filename: "PassionsPeak_Creator_Kit_v1.0.0.zip",
      buffer,
      fileCount: files.length + 1,
    };
  },
};
