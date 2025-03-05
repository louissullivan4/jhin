# Jhin

## Introduction

Jhin is a code generation tool used to generate server code based on your OpenAPI specification. This service helps you quickly scaffold API endpoints defined in your OpenAPI file, allowing you to focus on implementing business logic rather than boilerplate code.

## Support Languages/Frameworks

### Server Code Generation

- Python FastAPI

### Installing

`npm install jhin-generator`

### Running

#### Library

`import { generateCode } from 'jhin-generator';`
`generateCode('openapi.yaml', 'python-fastapi', './generated-server')`

#### CLI
`npx jhin-generator --in openapi.yaml --lang python-fastapi --out ./generated-server`