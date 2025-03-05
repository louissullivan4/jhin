/**
 * python-fastapi.ts
 * 
 * Provides an IGenerator implementation that creates Python FastAPI servers from an OpenAPI spec
 */

import * as fs from 'fs';
import * as path from 'path';
import { IGenerator } from './IGenerator';
import { loadTemplates } from '../core/templates';
import { ensureOutputDir } from '../core/filesystem';
import { logMessage } from '../utils/logger';

/**
 * A set of Python reserved words to avoid naming collisions.
 */
const PYTHON_RESERVED_WORDS = new Set([
  'and', 'as', 'assert', 'break', 'class', 'continue', 'def', 'del', 'elif',
  'else', 'except', 'False', 'finally', 'for', 'from', 'global', 'if', 'import',
  'in', 'is', 'lambda', 'None', 'nonlocal', 'not', 'or', 'pass', 'raise',
  'return', 'True', 'try', 'while', 'with', 'yield',
]);

/**
 * Decodes HTML entities (e.g., &quot;, &amp;) into normal characters.
 */
function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&');
}

/**
 * Sanitizes a string into a valid Python identifier, avoiding reserved words and illegal characters.
 */
function sanitizeName(name: string): string {
  let safeName = name.replace(/[^\w]/g, '_');
  if (PYTHON_RESERVED_WORDS.has(safeName)) {
    safeName = `${safeName}_`;
  }
  if (/^\d/.test(safeName)) {
    safeName = `_${safeName}`;
  }
  return safeName;
}

/**
 * Generates an enum class name for a property that has an enum definition.
 */
function getEnumName(schemaName: string, propName: string): string {
  return sanitizeName(`${schemaName}_${propName}_Enum`);
}

/**
 * Deduces the Python type from an OpenAPI type/format/items/reference definition.
 */
function getPythonType(
  openapiType: string | undefined,
  format?: string,
  items?: any,
  ref?: string
): string {
  if (ref) {
    const refSegments = ref.split('/');
    const modelName = refSegments[refSegments.length - 1];
    return sanitizeName(modelName);
  }
  if (!openapiType) {
    return 'Any';
  }
  switch (openapiType) {
    case 'integer':
      return 'int';
    case 'number':
      if (format === 'float' || format === 'double') return 'float';
      return 'float';
    case 'boolean':
      return 'bool';
    case 'string':
      switch (format) {
        case 'date':
          return 'datetime.date';
        case 'date-time':
          return 'datetime.datetime';
        case 'uuid':
          return 'uuid.UUID';
        case 'email':
          return 'EmailStr';
        case 'uri':
        case 'url':
          return 'AnyUrl';
        case 'byte':
        case 'binary':
          return 'bytes';
        case 'password':
          return 'SecretStr';
        default:
          return 'str';
      }
    case 'array': {
      let childType = 'Any';
      if (items) {
        const childRef = items.$ref;
        childType = getPythonType(items.type, items.format, items.items, childRef);
      }
      return `List[${childType}]`;
    }
    case 'object':
      return 'Dict[str, Any]';
    default:
      return 'Any';
  }
}

/**
 * Resolves a given $ref (e.g., "#/components/schemas/SomeSchema") to its actual schema from components.
 */
function resolveRef(ref: string, components: Record<string, any>): any {
  const parts = ref.split('/');
  const name = parts[parts.length - 1];
  return components[name];
}

/**
 * Merges additional schema properties/required fields into a base schema object.
 */
function mergeInto(base: any, extra: any): void {
  if (extra.properties) {
    base.properties = { ...base.properties, ...extra.properties };
  }
  if (extra.required) {
    base.required = Array.from(new Set([...base.required, ...extra.required]));
  }
}

/**
 * Merges or transforms schemas involving allOf or oneOf. 
 * Returns a fully merged schema or an xOneOfUnion marker to indicate a union.
 */
function mergeComplexSchema(schema: any, components: Record<string, any>): any {
  if (schema.allOf) {
    logMessage('DEBUG', 'python-fastapi', 'Merging allOf schema...');
    const merged: any = { type: 'object', properties: {}, required: [] };
    for (const sub of schema.allOf) {
      if (sub.$ref) {
        const resolved = resolveRef(sub.$ref, components);
        mergeInto(merged, mergeComplexSchema(resolved, components));
      } else {
        mergeInto(merged, mergeComplexSchema(sub, components));
      }
    }
    return merged;
  }

  if (schema.oneOf) {
    logMessage('DEBUG', 'python-fastapi', 'Converting oneOf to a union marker...');
    return {
      xOneOfUnion: schema.oneOf.map((sub: any) =>
        sub.$ref ? sanitizeName(sub.$ref.split('/').pop()!) : 'Any'
      ),
    };
  }

  return schema;
}

/**
 * Gathers any needed imports based on property definitions that require specialized Python types.
 */
function gatherImportsForProps(processedProperties: Record<string, any>): string[] {
  const imports = new Set<string>();
  for (const { type } of Object.values(processedProperties)) {
    if (typeof type !== 'string') continue;
    if (type.includes('List[')) imports.add('from typing import List');
    if (type.includes('Dict[')) imports.add('from typing import Dict, Any');
    if (type.includes('AnyUrl')) imports.add('from pydantic import AnyUrl');
    if (type.includes('EmailStr')) imports.add('from pydantic import EmailStr');
    if (type.includes('SecretStr')) imports.add('from pydantic import SecretStr');
    if (type.includes('datetime.date') || type.includes('datetime.datetime')) {
      imports.add('import datetime');
    }
    if (type.includes('uuid.UUID')) {
      imports.add('import uuid');
    }
  }
  return Array.from(imports);
}

/**
 * Finds any enum definitions in the properties, creates an enum, and replaces the property type with that enum name.
 */
function processEnums(
  schemaName: string,
  processedProperties: Record<string, any>
): Array<{ enumName: string; values: string[] }> {
  const createdEnums: Array<{ enumName: string; values: string[] }> = [];
  for (const [propKey, propObj] of Object.entries(processedProperties)) {
    const ps = propObj as any;
    if (ps.enum && Array.isArray(ps.enum)) {
      const enumName = getEnumName(schemaName, propKey);
      createdEnums.push({ enumName, values: ps.enum });
      ps.type = enumName;
    }
  }
  return createdEnums;
}

/**
 * Generates an __init__.py aggregator if multiple route files (tags) exist.
 */
function generateAggregatorFile(apisDir: string, pathsByTag: Record<string, any[]>): void {
  if (!Object.keys(pathsByTag).length) {
    logMessage('INFO', 'python-fastapi', 'No tagged paths found. Skipping aggregator file.');
    return;
  }
  logMessage('INFO', 'python-fastapi', 'Generating aggregator file for multiple tags...');
  let aggregatorContent = `from fastapi import APIRouter\n\nrouter = APIRouter()\n`;
  for (const tag of Object.keys(pathsByTag)) {
    const safeTag = tag.toLowerCase();
    aggregatorContent += `from .${safeTag} import router as ${safeTag}_router\n`;
  }
  aggregatorContent += `\n`;
  for (const tag of Object.keys(pathsByTag)) {
    const safeTag = tag.toLowerCase();
    aggregatorContent += `router.include_router(${safeTag}_router)\n`;
  }
  fs.writeFileSync(path.join(apisDir, `__init__.py`), aggregatorContent);
}

export const pythonFastApiGenerator: IGenerator = {
  async generate(api: any, outputDir: string): Promise<void> {
    logMessage('INFO', 'python-fastapi', 'Starting generation process...');
    try {
      ensureOutputDir(outputDir);
      const modelsDir = path.join(outputDir, 'models');
      const apisDir = path.join(outputDir, 'apis');
      ensureOutputDir(modelsDir);
      ensureOutputDir(apisDir);

      let templates;
      try {
        templates = loadTemplates('python-fastapi');
        logMessage('INFO', 'python-fastapi', 'Templates loaded successfully.');
      } catch (err) {
        logMessage('ERROR', 'python-fastapi', `Failed to load templates: ${String(err)}`);
        throw err;
      }

      if (templates['main']) {
        try {
          logMessage('INFO', 'python-fastapi', 'Generating main.py...');
          fs.writeFileSync(path.join(outputDir, 'main.py'), templates['main'](api));
        } catch (err) {
          logMessage('ERROR', 'python-fastapi', `Error generating main.py: ${String(err)}`);
          throw err;
        }
      }

      if (templates['requirements']) {
        try {
          logMessage('INFO', 'python-fastapi', 'Generating requirements.txt...');
          fs.writeFileSync(
            path.join(outputDir, 'requirements.txt'),
            templates['requirements'](api)
          );
        } catch (err) {
          logMessage('ERROR', 'python-fastapi', `Error generating requirements.txt: ${String(err)}`);
          throw err;
        }
      }

      if (templates['README']) {
        try {
          logMessage('INFO', 'python-fastapi', 'Generating README.md...');
          fs.writeFileSync(
            path.join(outputDir, 'README.md'),
            templates['README'](api)
          );
        } catch (err) {
          logMessage('ERROR', 'python-fastapi', `Error generating README.md: ${String(err)}`);
          throw err;
        }
      }

      const components = (api.components && api.components.schemas) || {};
      for (const [schemaName, schemaDef] of Object.entries(components)) {
        logMessage('DEBUG', 'python-fastapi', `Processing schema: ${schemaName}...`);
        let sch = schemaDef as any;
        sch = mergeComplexSchema(sch, components);

        if (sch.xOneOfUnion) {
          logMessage('DEBUG', 'python-fastapi', `Detected oneOf union in schema: ${schemaName}`);
          if (templates['one_of_union']) {
            try {
              const content = templates['one_of_union']({
                name: schemaName,
                unionTypes: sch.xOneOfUnion,
              });
              fs.writeFileSync(path.join(modelsDir, `${schemaName.toLowerCase()}.py`), content);
            } catch (err) {
              logMessage('ERROR', 'python-fastapi', `Error generating oneOf union model: ${String(err)}`);
              throw err;
            }
          }
          continue;
        }

        if (sch.properties) {
          logMessage('DEBUG', 'python-fastapi', `Building properties for: ${schemaName}`);
          const processedProperties: Record<string, any> = {};
          for (const [propName, propSchema] of Object.entries(sch.properties)) {
            const ps = propSchema as any;
            const sanitizedName = sanitizeName(propName);
            const pyType = getPythonType(ps.type, ps.format, ps.items, ps.$ref);

            let regex;
            if (ps.pattern) {
              const decoded = decodeHtmlEntities(ps.pattern);
              regex = `r"${decoded}"`;
            }

            let defVal: any = ps.default;
            if (typeof defVal === 'boolean') {
              defVal = defVal ? 'True' : 'False';
            } else if (typeof defVal === 'string') {
              defVal = `"${defVal}"`;
            }

            const example = typeof ps.example === 'string' ? `"${ps.example}"` : ps.example;

            processedProperties[sanitizedName] = {
              originalName: propName,
              name: sanitizedName,
              type: pyType,
              default: defVal,
              example,
              regex,
              description: ps.description || '',
              enum: ps.enum,
            };
          }

          sch.processedProperties = processedProperties;

          logMessage('DEBUG', 'python-fastapi', `Checking for enum fields in: ${schemaName}`);
          const createdEnums = processEnums(schemaName, processedProperties);
          const importsList = gatherImportsForProps(processedProperties);

          if (templates['model_class']) {
            try {
              logMessage('INFO', 'python-fastapi', `Rendering model_class template for: ${schemaName}`);
              const content = templates['model_class']({
                name: schemaName,
                schema: sch,
                importsList,
                createdEnums,
              });
              fs.writeFileSync(path.join(modelsDir, `${schemaName.toLowerCase()}.py`), content);
            } catch (err) {
              logMessage('ERROR', 'python-fastapi', `Error generating model for ${schemaName}: ${String(err)}`);
              throw err;
            }
          }
        } else {
          logMessage('WARN', 'python-fastapi', `Schema ${schemaName} has no properties; creating empty model.`);
          if (templates['model_class']) {
            try {
              const content = templates['model_class']({
                name: schemaName,
                schema: sch,
                importsList: [],
                createdEnums: [],
              });
              fs.writeFileSync(path.join(modelsDir, `${schemaName.toLowerCase()}.py`), content);
            } catch (err) {
              logMessage('ERROR', 'python-fastapi', `Error generating empty model for ${schemaName}: ${String(err)}`);
              throw err;
            }
          }
        }
      }

      if (api.paths && templates['api_routes']) {
        logMessage('INFO', 'python-fastapi', 'Generating route files...');
        const pathsByTag: Record<string, any[]> = {};
        for (const [pathUrl, pathItem] of Object.entries(api.paths)) {
          for (const [method, operation] of Object.entries(pathItem as any)) {
            if (!operation || typeof operation !== 'object') continue;
            const tags = (operation as any).tags || ['api'];
            const tag = tags[0];
            if (!pathsByTag[tag]) {
              pathsByTag[tag] = [];
            }
            pathsByTag[tag].push({ path: pathUrl, method, operation });
          }
        }

        for (const [tag, operations] of Object.entries(pathsByTag)) {
          logMessage('DEBUG', 'python-fastapi', `Rendering api_routes for tag: ${tag}`);
          try {
            const routesContent = templates['api_routes']({ tag, operations });
            fs.writeFileSync(path.join(apisDir, `${tag.toLowerCase()}.py`), routesContent);
          } catch (err) {
            logMessage('ERROR', 'python-fastapi', `Error generating routes for tag ${tag}: ${String(err)}`);
            throw err;
          }
        }

        generateAggregatorFile(apisDir, pathsByTag);
      } else {
        logMessage('INFO', 'python-fastapi', 'No paths or no api_routes template. Skipping routes.');
      }

      logMessage('INFO', 'python-fastapi', 'Python FastAPI Code Generation complete.');
    } catch (globalError) {
      logMessage('ERROR', 'python-fastapi', `Generation failed: ${String(globalError)}`);
      throw globalError;
    }
  },
};
