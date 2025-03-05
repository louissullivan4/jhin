/**
 * python-fastapi.test.ts
 *
 * A comprehensive Jest test suite for the pythonFastApiGenerator.
 * It verifies template loading, file generation, schema processing,
 * route creation, aggregator handling, and error cases.
 */

import * as fs from 'fs';
import { pythonFastApiGenerator } from '../../src/generators/python-fastapi';
import { logMessage } from '../../src/utils/logger';
import { loadTemplates } from '../../src/core/templates';

jest.mock('fs');
jest.mock('../../src/utils/logger', () => ({
  logMessage: jest.fn(),
}));
jest.mock('../../src/core/templates', () => ({
  loadTemplates: jest.fn(),
}));

describe('pythonFastApiGenerator', () => {
  const mockFs = fs as jest.Mocked<typeof fs>;
  const mockLogMessage = logMessage as jest.MockedFunction<typeof logMessage>;
  const mockLoadTemplates = loadTemplates as jest.MockedFunction<typeof loadTemplates>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockFs.writeFileSync.mockImplementation(() => {});
  });

  //
  // 1. TEMPLATE LOADING
  //
  it('should log error and throw if templates cannot be loaded', async () => {
    mockLoadTemplates.mockImplementation(() => {
      throw new Error('Template load failure');
    });

    const apiSpec = {};
    await expect(pythonFastApiGenerator.generate(apiSpec, './output'))
      .rejects.toThrow('Template load failure');

    expect(mockLogMessage).toHaveBeenCalledWith(
      'ERROR',
      'python-fastapi',
      expect.stringContaining('Failed to load templates')
    );
  });

  //
  // 2. TOP-LEVEL FILE GENERATION
  //
  it('should create main.py if "main" template is provided', async () => {
    mockLoadTemplates.mockReturnValue({
      main: () => '# main code',
      requirements: () => ''
    });
    const apiSpec = { components: {} };

    await pythonFastApiGenerator.generate(apiSpec, './output');
    expect(mockFs.writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining('main.py'),
      '# main code'
    );
    expect(mockLogMessage).toHaveBeenCalledWith('INFO', 'python-fastapi', 'Generating main.py...');
  });

  it('should skip main.py if no main template is defined', async () => {
    mockLoadTemplates.mockReturnValue({
      requirements: () => ''
    });
    const apiSpec = { components: {} };

    await pythonFastApiGenerator.generate(apiSpec, './output');
    expect(mockFs.writeFileSync).not.toHaveBeenCalledWith(
      expect.stringContaining('main.py'),
      expect.anything()
    );

    const messages = mockLogMessage.mock.calls.map(call => call[2]);
    expect(messages).not.toContain('Generating main.py...');
  });

  it('should generate requirements.txt if "requirements" template is present', async () => {
    mockLoadTemplates.mockReturnValue({
      main: () => '',
      requirements: () => '# requirements content',
    });
    const apiSpec = { components: {} };

    await pythonFastApiGenerator.generate(apiSpec, './output');
    expect(mockFs.writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining('requirements.txt'),
      '# requirements content'
    );
    expect(mockLogMessage).toHaveBeenCalledWith(
      'INFO',
      'python-fastapi',
      'Generating requirements.txt...'
    );
  });

  it('should generate README.md if template is present', async () => {
    mockLoadTemplates.mockReturnValue({
      README: () => '# My Project Docs',
      main: () => '',
      requirements: () => ''
    });
    const apiSpec = {};

    await pythonFastApiGenerator.generate(apiSpec, './output');
    expect(mockFs.writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining('README.md'),
      '# My Project Docs'
    );
    expect(mockLogMessage).toHaveBeenCalledWith('INFO', 'python-fastapi', 'Generating README.md...');
  });

  //
  // 3. SCHEMA HANDLING
  //
  it('should handle schema with empty properties by generating an empty model', async () => {
    mockLoadTemplates.mockReturnValue({
      model_class: ({ name }: any) => `class ${name}: pass\n`
    });
    const apiSpec = {
      components: {
        schemas: {
          EmptyOne: {}
        }
      }
    };

    await pythonFastApiGenerator.generate(apiSpec, './output');
    const writeCall = mockFs.writeFileSync.mock.calls.find(call =>
      call[0].toString().includes('emptyone.py')
    );
    expect(writeCall).toBeTruthy();
    expect(writeCall?.[1]).toContain('class EmptyOne: pass');
    expect(mockLogMessage).toHaveBeenCalledWith(
      'WARN',
      'python-fastapi',
      'Schema EmptyOne has no properties; creating empty model.'
    );
  });

  it('should handle schemas with allOf merging', async () => {
    mockLoadTemplates.mockReturnValue({
      main: () => '',
      requirements: () => '',
      model_class: ({ name, schema }: any) => {
        return `class ${name}:\n# merged props: ${Object.keys(schema.processedProperties).join(', ')}`;
      }
    });

    const apiSpec = {
      components: {
        schemas: {
          BasePerson: {
            properties: { baseName: { type: 'string' } },
            required: ['baseName']
          },
          ExtendedPerson: {
            allOf: [
              { $ref: '#/components/schemas/BasePerson' },
              {
                properties: {
                  extraField: { type: 'integer' }
                },
                required: ['extraField']
              }
            ]
          }
        }
      }
    };

    await pythonFastApiGenerator.generate(apiSpec, './output');
    const generated = mockFs.writeFileSync.mock.calls.find(call =>
      call[0].toString().includes('extendedperson.py')
    );
    expect(generated?.[1]).toContain('merged props: baseName, extraField');
  });

  it('should handle schemas with oneOf and create union if "one_of_union" template is present', async () => {
    mockLoadTemplates.mockReturnValue({
      one_of_union: ({ name, unionTypes }: any) => `# union: ${name} => [${unionTypes.join(', ')}]`,
      model_class: () => ''
    });
    const apiSpec = {
      components: {
        schemas: {
          ExampleOneOf: {
            oneOf: [
              { $ref: '#/components/schemas/Foo' },
              { $ref: '#/components/schemas/Bar' },
            ]
          },
          Foo: { properties: {} },
          Bar: { properties: {} },
        }
      }
    };

    await pythonFastApiGenerator.generate(apiSpec, './output');
    expect(mockFs.writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining('exampleoneof.py'),
      '# union: ExampleOneOf => [Foo, Bar]'
    );
    expect(mockLogMessage).toHaveBeenCalledWith(
      'DEBUG',
      'python-fastapi',
      'Detected oneOf union in schema: ExampleOneOf'
    );
  });

  it('should correctly interpret type "password", "object", and "byte"', async () => {
    mockLoadTemplates.mockReturnValue({
      model_class: ({ name, schema }: any) => {
        const propLines = Object.entries(schema.processedProperties)
          .map(([_, prop]) => {
            const p = prop as any;
            return `${p.name} -> ${p.type}`;
          })
          .join('\n');
        return `class ${name}:\n${propLines}\n`;
      }
    });

    const apiSpec = {
      components: {
        schemas: {
          SpecialTypes: {
            properties: {
              passwordField: { type: 'string', format: 'password' },
              binaryField: { type: 'string', format: 'binary' },
              objectField: { type: 'object' }
            }
          }
        }
      }
    };

    await pythonFastApiGenerator.generate(apiSpec, './output');
    const content = mockFs.writeFileSync.mock.calls
      .find(call => call[0].toString().includes('specialtypes.py'))?.[1] as string;

    expect(content).toContain('passwordField -> SecretStr');
    expect(content).toContain('binaryField -> bytes');
    expect(content).toContain('objectField -> Dict[str, Any]');
  });

  it('should process schemas with properties and generate model file', async () => {
    mockLoadTemplates.mockReturnValue({
      main: () => '',
      requirements: () => '',
      model_class: ({ name, schema }: any) => {
        return `class ${name}: pass # has ${Object.keys(schema.processedProperties).length} props`;
      }
    });

    const apiSpec = {
      components: {
        schemas: {
          Person: {
            properties: {
              name: { type: 'string', default: 'John' },
              age: { type: 'integer' },
            }
          }
        }
      }
    };

    await pythonFastApiGenerator.generate(apiSpec, './output');
    expect(mockFs.writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining('person.py'),
      expect.stringContaining('class Person: pass # has 2 props')
    );
    expect(mockLogMessage).toHaveBeenCalledWith('DEBUG', 'python-fastapi', 'Building properties for: Person');
    expect(mockLogMessage).toHaveBeenCalledWith('INFO', 'python-fastapi', 'Rendering model_class template for: Person');
  });

  //
  // 4. ROUTE GENERATION & AGGREGATOR FILE
  //
  it('should generate route files if api_routes template is available', async () => {
    mockLoadTemplates.mockReturnValue({
      api_routes: ({ tag, operations }: any) => `# routes for ${tag}: ${operations.length}`,
      model_class: () => ''
    });

    const apiSpec = {
      paths: {
        '/pets': {
          get: { tags: ['pets'], operationId: 'listPets' },
          post: { tags: ['pets'], operationId: 'createPet' },
        },
        '/users': {
          get: { tags: ['users'], operationId: 'listUsers' },
        }
      }
    };

    await pythonFastApiGenerator.generate(apiSpec, './output');
    expect(mockFs.writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining('pets.py'),
      '# routes for pets: 2'
    );
    expect(mockFs.writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining('users.py'),
      '# routes for users: 1'
    );
    expect(mockLogMessage).toHaveBeenCalledWith('INFO', 'python-fastapi', 'Generating route files...');
  });

  it('should skip route generation if no paths or api_routes template is absent', async () => {
    mockLoadTemplates.mockReturnValue({
      model_class: () => ''
    });
    const apiSpec = {
      paths: {
        '/skip': {
          get: { tags: ['skipTag'] }
        }
      }
    };

    await pythonFastApiGenerator.generate(apiSpec, './output');
    expect(mockLogMessage).toHaveBeenCalledWith(
      'INFO',
      'python-fastapi',
      'No paths or no api_routes template. Skipping routes.'
    );
    expect(mockFs.writeFileSync).not.toHaveBeenCalledWith(
      expect.stringContaining('skiptag.py'),
      expect.anything()
    );
  });

  it('should create aggregator file if multiple route tags are detected', async () => {
    mockLoadTemplates.mockReturnValue({
      api_routes: ({ tag }: any) => `# routes for ${tag}`,
      model_class: () => '',
      main: () => '',
      requirements: () => '',
    });

    const apiSpec = {
      paths: {
        '/items': {
          get: { tags: ['items'], operationId: 'getItems' }
        },
        '/users': {
          get: { tags: ['users'], operationId: 'getUsers' }
        }
      }
    };

    await pythonFastApiGenerator.generate(apiSpec, './output');
    const aggregatorWrite = mockFs.writeFileSync.mock.calls.find(call =>
      call[0].toString().includes('__init__.py')
    );
    expect(aggregatorWrite).toBeTruthy();
    expect(aggregatorWrite?.[1]).toContain('from .items import router as items_router');
    expect(aggregatorWrite?.[1]).toContain('from .users import router as users_router');
  });

  it('should skip aggregator file if no tagged paths exist', async () => {
    mockLoadTemplates.mockReturnValue({
      api_routes: () => '',
      model_class: () => '',
      main: () => '',
      requirements: () => '',
    });
    const apiSpec = {
      paths: {}
    };

    await pythonFastApiGenerator.generate(apiSpec, './output');
    const aggregatorWrite = mockFs.writeFileSync.mock.calls.find(call =>
      call[0].toString().includes('__init__.py')
    );
    expect(aggregatorWrite).toBeUndefined();
    expect(mockLogMessage).toHaveBeenCalledWith(
      'INFO',
      'python-fastapi',
      'No tagged paths found. Skipping aggregator file.'
    );
  });

  //
  // 5. ERROR HANDLING
  //
  it('should throw and log error if an unexpected error occurs', async () => {
    mockLoadTemplates.mockReturnValue({
      main: () => { throw new Error('Unexpected rendering error'); },
      requirements: () => ''
    });

    const apiSpec = { components: {} };
    await expect(pythonFastApiGenerator.generate(apiSpec, './output'))
      .rejects.toThrow('Unexpected rendering error');

    expect(mockLogMessage).toHaveBeenCalledWith(
      'ERROR',
      'python-fastapi',
      expect.stringContaining('Error generating main.py:')
    );
  });
});
