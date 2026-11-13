import fs from "node:fs/promises";
import path from "node:path";
import { type ProjectFolder, ProjectFolderSchema } from "../src/contracts/schemas.ts";
import { createBlankProject, createPassionsPeakProject } from "../src/data/passionsPeakSeed.ts";

const DB_DIR = path.resolve(process.cwd(), "data");
const PROJECTS_PATH = path.join(DB_DIR, "projects.json");

interface ProjectsDbShape {
  activeProjectId: string;
  projects: Record<string, ProjectFolder>;
}

class ProjectDatabase {
  private state: ProjectsDbShape = {
    activeProjectId: "proj_passions_peak",
    projects: {},
  };
  private initialized = false;

  async init(): Promise<void> {
    if (this.initialized) return;
    await fs.mkdir(DB_DIR, { recursive: true });
    try {
      const raw = await fs.readFile(PROJECTS_PATH, "utf-8");
      const parsed = JSON.parse(raw) as ProjectsDbShape;
      if (parsed && parsed.projects && Object.keys(parsed.projects).length > 0) {
        this.state = parsed;
      } else {
        await this.seedDefaults();
      }
    } catch {
      await this.seedDefaults();
    }
    this.initialized = true;
  }

  private async seedDefaults(): Promise<void> {
    const passions = createPassionsPeakProject();
    this.state = {
      activeProjectId: passions.id,
      projects: {
        [passions.id]: passions,
      },
    };
    await this.persist();
  }

  private async persist(): Promise<void> {
    await fs.writeFile(PROJECTS_PATH, JSON.stringify(this.state, null, 2), "utf-8");
  }

  async listProjects(): Promise<{ activeProjectId: string; projects: ProjectFolder[] }> {
    await this.init();
    return {
      activeProjectId: this.state.activeProjectId,
      projects: Object.values(this.state.projects),
    };
  }

  async getProject(projectId: string): Promise<ProjectFolder | null> {
    await this.init();
    return this.state.projects[projectId] ?? null;
  }

  async getActiveProject(): Promise<ProjectFolder> {
    await this.init();
    const active = this.state.projects[this.state.activeProjectId];
    if (active) return active;
    const first = Object.values(this.state.projects)[0];
    if (first) {
      this.state.activeProjectId = first.id;
      await this.persist();
      return first;
    }
    const seeded = createPassionsPeakProject();
    this.state.projects[seeded.id] = seeded;
    this.state.activeProjectId = seeded.id;
    await this.persist();
    return seeded;
  }

  async setActiveProject(projectId: string): Promise<ProjectFolder> {
    await this.init();
    const target = this.state.projects[projectId];
    if (!target) {
      throw new Error(`Project folder '${projectId}' not found.`);
    }
    this.state.activeProjectId = projectId;
    await this.persist();
    return target;
  }

  async createProject(params: {
    name: string;
    genre: string;
    logline: string;
    targetRuntimeSeconds?: number;
  }): Promise<ProjectFolder> {
    await this.init();
    const proj = createBlankProject(params);
    this.state.projects[proj.id] = proj;
    this.state.activeProjectId = proj.id;
    await this.persist();
    return proj;
  }

  async saveProject(project: ProjectFolder): Promise<ProjectFolder> {
    await this.init();
    const validated = ProjectFolderSchema.parse({
      ...project,
      updatedAt: new Date().toISOString(),
    });
    this.state.projects[validated.id] = validated;
    await this.persist();
    return validated;
  }
}

export const projectDb = new ProjectDatabase();
