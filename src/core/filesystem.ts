// src/core/filesystem.ts
import * as fs from 'fs';

export function ensureOutputDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}
