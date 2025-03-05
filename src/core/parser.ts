// src/core/parser.ts
import SwaggerParser from '@apidevtools/swagger-parser';

export async function parseOpenAPISpec(specPath: string): Promise<any> {
  return SwaggerParser.validate(specPath);
}

export function validateOpenAPISpec(api: any): boolean {
  return true;
}
