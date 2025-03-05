// src/generators/IGenerator.ts
export interface IGenerator {
    generate(api: any, outputDir: string): Promise<void>;
}
