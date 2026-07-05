import * as path from 'path';
import Parser from 'tree-sitter';
import JavaScript from 'tree-sitter-javascript';
import TypeScriptPkg from 'tree-sitter-typescript';
import Python from 'tree-sitter-python';
import Rust from 'tree-sitter-rust';
import Go from 'tree-sitter-go';
import { ChunkRecord } from '../database/db.js';

const { typescript, tsx } = TypeScriptPkg;

// Map file extensions to languages
const LANGUAGE_EXT_MAP: Record<string, string> = {
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.ts': 'typescript',
  '.tsx': 'tsx',
  '.py': 'python',
  '.rs': 'rust',
  '.go': 'go'
};

// Readable-only formats (single file chunks, no symbol extraction)
const READABLE_EXTS = new Set([
  '.html', '.css', '.scss', '.json', '.yaml', '.yml', '.toml', '.md', '.env'
]);

function getParserForLanguage(lang: string): Parser | null {
  const parser = new Parser();
  try {
    switch (lang) {
      case 'javascript':
        parser.setLanguage(JavaScript);
        return parser;
      case 'typescript':
        parser.setLanguage(typescript);
        return parser;
      case 'tsx':
        parser.setLanguage(tsx);
        return parser;
      case 'python':
        parser.setLanguage(Python);
        return parser;
      case 'rust':
        parser.setLanguage(Rust);
        return parser;
      case 'go':
        parser.setLanguage(Go);
        return parser;
      default:
        return null;
    }
  } catch (e) {
    console.error(`Failed to load tree-sitter parser for ${lang}:`, e);
    return null;
  }
}

// Split chunk content if it exceeds 100 lines, searching for nearest empty line
export function splitContentIntoSubChunks(
  content: string,
  startLine: number
): { content: string; startLine: number; endLine: number }[] {
  const lines = content.split('\n');
  if (lines.length <= 100) {
    return [{
      content,
      startLine,
      endLine: startLine + lines.length - 1
    }];
  }

  const subChunks: { content: string; startLine: number; endLine: number }[] = [];
  let currentStart = 0;

  while (currentStart < lines.length) {
    let currentEnd = currentStart + 100;
    if (currentEnd >= lines.length) {
      currentEnd = lines.length;
    } else {
      // Look back for an empty line (up to 30 lines back)
      let foundEmpty = false;
      const minLookback = Math.max(currentStart + 70, currentStart);
      for (let i = currentEnd - 1; i >= minLookback; i--) {
        if (lines[i].trim() === '') {
          currentEnd = i + 1; // Include the empty line in current chunk
          foundEmpty = true;
          break;
        }
      }
    }

    const chunkLines = lines.slice(currentStart, currentEnd);
    subChunks.push({
      content: chunkLines.join('\n'),
      startLine: startLine + currentStart,
      endLine: startLine + currentEnd - 1
    });

    currentStart = currentEnd;
  }

  return subChunks;
}

// Extract AST nodes recursively for function and class signatures
function extractSymbolNodes(
  node: Parser.SyntaxNode,
  language: string
): { node: Parser.SyntaxNode; type: 'function' | 'class'; name: string }[] {
  const symbols: { node: Parser.SyntaxNode; type: 'function' | 'class'; name: string }[] = [];

  function traverse(n: Parser.SyntaxNode) {
    let isSymbol = false;
    let type: 'function' | 'class' = 'function';
    let name = 'anonymous';

    if (language === 'typescript' || language === 'tsx' || language === 'javascript') {
      if (n.type === 'class_declaration') {
        isSymbol = true;
        type = 'class';
        name = n.childForFieldName ? n.childForFieldName('name')?.text || 'anonymous' : 'anonymous';
      } else if (
        n.type === 'function_declaration' ||
        n.type === 'generator_function_declaration' ||
        n.type === 'method_definition'
      ) {
        isSymbol = true;
        type = 'function';
        name = n.childForFieldName ? n.childForFieldName('name')?.text || 'anonymous' : 'anonymous';
      } else if (n.type === 'variable_declarator') {
        const valueNode = n.childForFieldName ? n.childForFieldName('value') : null;
        if (valueNode && (valueNode.type === 'arrow_function' || valueNode.type === 'function_expression')) {
          isSymbol = true;
          type = 'function';
          name = n.childForFieldName ? n.childForFieldName('name')?.text || 'anonymous' : 'anonymous';
        }
      }
    } else if (language === 'python') {
      if (n.type === 'class_definition') {
        isSymbol = true;
        type = 'class';
        name = n.childForFieldName ? n.childForFieldName('name')?.text || 'anonymous' : 'anonymous';
      } else if (n.type === 'function_definition') {
        isSymbol = true;
        type = 'function';
        name = n.childForFieldName ? n.childForFieldName('name')?.text || 'anonymous' : 'anonymous';
      }
    } else if (language === 'rust') {
      if (
        n.type === 'struct_item' ||
        n.type === 'enum_item' ||
        n.type === 'union_item' ||
        n.type === 'trait_item' ||
        n.type === 'impl_item'
      ) {
        isSymbol = true;
        type = 'class';
        if (n.type === 'impl_item') {
          const typeNode = n.childForFieldName ? n.childForFieldName('type') : null;
          name = `impl:${typeNode?.text || 'anonymous'}`;
        } else {
          name = n.childForFieldName ? n.childForFieldName('name')?.text || 'anonymous' : 'anonymous';
        }
      } else if (n.type === 'function_item') {
        isSymbol = true;
        type = 'function';
        name = n.childForFieldName ? n.childForFieldName('name')?.text || 'anonymous' : 'anonymous';
      }
    } else if (language === 'go') {
      if (n.type === 'type_declaration') {
        isSymbol = true;
        type = 'class';
        const typeSpec = n.namedChild(0);
        name = typeSpec?.childForFieldName ? typeSpec.childForFieldName('name')?.text || 'anonymous' : 'anonymous';
      } else if (n.type === 'function_declaration' || n.type === 'method_declaration') {
        isSymbol = true;
        type = 'function';
        name = n.childForFieldName ? n.childForFieldName('name')?.text || 'anonymous' : 'anonymous';
      }
    }

    if (isSymbol) {
      symbols.push({ node: n, type, name });
    }

    for (let i = 0; i < n.namedChildCount; i++) {
      const child = n.namedChild(i);
      if (child) {
        traverse(child);
      }
    }
  }

  traverse(node);
  return symbols;
}

export function chunkFile(
  filepath: string,
  relpath: string,
  content: string
): ChunkRecord[] {
  const ext = path.extname(filepath).toLowerCase();
  const language = LANGUAGE_EXT_MAP[ext];

  // 1. Readable-only files: no AST parsing, single module chunk (split if > 100 lines)
  if (READABLE_EXTS.has(ext) || ext === '.env') {
    const subChunks = splitContentIntoSubChunks(content, 1);
    return subChunks.map((sc, idx) => ({
      id: `${relpath}:readable:${sc.startLine}:${sc.endLine}`,
      filepath,
      relpath,
      language: ext.slice(1) || 'text',
      start_line: sc.startLine,
      end_line: sc.endLine,
      content: sc.content,
      chunk_type: 'module' as const,
      name: path.basename(filepath)
    }));
  }

  // 2. AST parsing languages (TS, JS, Py, Rs, Go)
  if (language) {
    const parser = getParserForLanguage(language);
    if (parser) {
      try {
        const tree = parser.parse(content, undefined, { bufferSize: Math.max(content.length * 2, 1024 * 1024) });
        const symbols = extractSymbolNodes(tree.rootNode, language);
        const chunks: ChunkRecord[] = [];

        // Track AST extracted chunks
        for (const sym of symbols) {
          const symStart = sym.node.startPosition.row + 1;
          const symEnd = sym.node.endPosition.row + 1;
          const symContent = sym.node.text;

          // Split symbols if they exceed 100 lines
          const subChunks = splitContentIntoSubChunks(symContent, symStart);
          subChunks.forEach((sc, idx) => {
            chunks.push({
              id: `${relpath}:${sym.type}:${sym.name}:${sc.startLine}:${sc.endLine}`,
              filepath,
              relpath,
              language,
              start_line: sc.startLine,
              end_line: sc.endLine,
              content: sc.content,
              chunk_type: sym.type,
              name: sym.name
            });
          });
        }

        // Always index the entire file as a "module" chunk (split into 100-line blocks)
        // so that top-level code, imports, and non-symbol contents are also searchable.
        const fileSubChunks = splitContentIntoSubChunks(content, 1);
        fileSubChunks.forEach((sc) => {
          chunks.push({
            id: `${relpath}:module:${sc.startLine}:${sc.endLine}`,
            filepath,
            relpath,
            language,
            start_line: sc.startLine,
            end_line: sc.endLine,
            content: sc.content,
            chunk_type: 'module' as const,
            name: path.basename(filepath)
          });
        });

        return chunks;
      } catch (err) {
        console.warn(`AST parsing failed for ${filepath}, falling back to regex. Error:`, err);
      }
    }
  }

  // 3. Fallback / Regex Chunking (everything else, or if parser failed)
  const subChunks = splitContentIntoSubChunks(content, 1);
  return subChunks.map((sc) => ({
    id: `${relpath}:fallback:${sc.startLine}:${sc.endLine}`,
    filepath,
    relpath,
    language: language || ext.slice(1) || 'text',
    start_line: sc.startLine,
    end_line: sc.endLine,
    content: sc.content,
    chunk_type: 'module' as const,
    name: path.basename(filepath)
  }));
}
