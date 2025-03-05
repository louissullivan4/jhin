// src/core/templates.ts
import * as fs from 'fs';
import * as path from 'path';
import Handlebars from 'handlebars';

export function loadTemplates(language: string): Record<string, Handlebars.TemplateDelegate> {
  const templatesDir = path.join(__dirname, '..', '..', 'templates', language);

  if (!fs.existsSync(templatesDir)) {
    throw new Error(`Templates for language '${language}' not found in ${templatesDir}`);
  }

  const files = fs.readdirSync(templatesDir);
  const templates: Record<string, Handlebars.TemplateDelegate> = {};

  files.forEach((file) => {
    if (file.endsWith('.hbs')) {
      const templateName = file.replace('.hbs', '');
      const content = fs.readFileSync(path.join(templatesDir, file), 'utf-8');
      templates[templateName] = Handlebars.compile(content);
    }
  });

  Handlebars.registerHelper('lower', (str: string) => str.toLowerCase());
  Handlebars.registerHelper('sanitizePath', (str: string) => str.replace(/[\/{}]/g, '_'));
  Handlebars.registerHelper('extractRefName', function(refString: string) {
    if (!refString || typeof refString !== 'string') return '';
    const parts = refString.split('/');
    return parts[parts.length - 1];
  });
  Handlebars.registerHelper('or', function(...args) {
    const opts = args.pop();
    return args.some(Boolean);
  });

  return templates;
}
