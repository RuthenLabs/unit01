declare module 'tree-sitter' {
  class Parser {
    setLanguage(lang: any): void;
    parse(input: string): Parser.Tree;
  }
  namespace Parser {
    interface Tree {
      rootNode: SyntaxNode;
    }
    interface SyntaxNode {
      type: string;
      text: string;
      startPosition: Point;
      endPosition: Point;
      children: SyntaxNode[];
      child(index: number): SyntaxNode | null;
      namedChild(index: number): SyntaxNode | null;
      childCount: number;
      namedChildCount: number;
      firstChild: SyntaxNode | null;
      lastChild: SyntaxNode | null;
      nextSibling: SyntaxNode | null;
      previousSibling: SyntaxNode | null;
    }
    interface Point {
      row: number;
      column: number;
    }
  }
  export default Parser;
}

declare module 'tree-sitter-javascript';
declare module 'tree-sitter-typescript';
declare module 'tree-sitter-python';
declare module 'tree-sitter-rust';
declare module 'tree-sitter-go';
declare module 'cli-highlight';
declare module 'marked-terminal';
