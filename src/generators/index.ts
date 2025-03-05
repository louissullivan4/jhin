// src/generators/index.ts
import { IGenerator } from './IGenerator';
import { pythonFastApiGenerator } from './python-fastapi';

const generatorRegistry: Record<string, IGenerator> = {
  'python-fastapi': pythonFastApiGenerator
};

export function getGenerator(language: string): IGenerator {
  const generator = generatorRegistry[language];
  if (!generator) {
    throw new Error(`No generator found for language "${language}"`);
  }
  return generator;
}
