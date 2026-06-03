import { promises as fs } from 'fs';

export interface SidecarData {
  referencedFiles?: string[];
  description?: string;
}

/**
 * Read a sidecar JSON file written by the Knowledge agent.
 * Returns an empty object when the file is missing, corrupt, or non-object JSON.
 */
export async function readSidecar(sidecarPath: string): Promise<SidecarData> {
  let raw: unknown;
  try {
    raw = JSON.parse(await fs.readFile(sidecarPath, 'utf8'));
  } catch {
    return {};
  }
  if (typeof raw !== 'object' || raw === null) return {};
  const data = raw as Record<string, unknown>;
  const result: SidecarData = {};
  if (Array.isArray(data.referencedFiles)) {
    result.referencedFiles = data.referencedFiles.filter(
      (f): f is string => typeof f === 'string'
    );
  }
  if (typeof data.description === 'string') {
    result.description = data.description;
  }
  return result;
}
