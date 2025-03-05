// src/index.ts
import { getGenerator } from './generators';
import { parseOpenAPISpec, validateOpenAPISpec } from './core/parser';

export async function generateCode(
  specPath: string,
  language: string,
  outputDir: string
): Promise<void> {
  const api = await parseOpenAPISpec(specPath);
  if (!validateOpenAPISpec(api)) {
    throw new Error('Invalid OpenAPI specification.');
  }

  const generator = getGenerator(language);

  await generator.generate(api, outputDir);
}
