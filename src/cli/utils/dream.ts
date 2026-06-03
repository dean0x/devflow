import { promises as fs } from 'fs';

export interface DreamData {
  referencedFiles?: string[];
  description?: string;
}

/**
 * Read a dream JSON file written by the Knowledge agent.
 * Returns an empty object when the file is missing, corrupt, or non-object JSON.
 */
export async function readDream(dreamPath: string): Promise<DreamData> {
  let raw: unknown;
  try {
    raw = JSON.parse(await fs.readFile(dreamPath, 'utf8'));
  } catch {
    return {};
  }
  if (typeof raw !== 'object' || raw === null) return {};
  const data = raw as Record<string, unknown>;
  const result: DreamData = {};
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

