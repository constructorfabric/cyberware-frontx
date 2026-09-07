// Contract extraction: the machine-owned half of a component contract.
//
// Reads a component's .tsx with the TypeScript compiler API and returns the
// facts the code alone owns: CVA axis names, their value lists, the
// defaultVariants map, and the props the component declares itself (as
// opposed to props inherited from Base UI / DOM passthrough, which are
// reported by source name only). Object-literal walking, not type
// inference - anything dynamic (spread, computed key) lands in
// `cannotExtract` instead of being silently skipped.
import { readFileSync } from 'node:fs';

import ts from 'typescript';

export interface ExtractedProp {
  name: string;
  optional: boolean;
  typeText: string;
}

export interface Extraction {
  axes: Record<string, string[]>;
  defaults: Record<string, string>;
  ownProps: ExtractedProp[];
  passthrough: string[];
  cannotExtract: string[];
}

interface LiteralEntry {
  name: string;
  initializer: ts.Expression;
}

export function extractComponent(tsxPath: string): Extraction {
  const source = ts.createSourceFile(
    tsxPath,
    readFileSync(tsxPath, 'utf8'),
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    ts.ScriptKind.TSX,
  );

  const result: Extraction = { axes: {}, defaults: {}, ownProps: [], passthrough: [], cannotExtract: [] };

  const literalKeys = (objLiteral: ts.ObjectLiteralExpression, where: string): LiteralEntry[] => {
    const keys: LiteralEntry[] = [];
    for (const prop of objLiteral.properties) {
      if (ts.isPropertyAssignment(prop) && (ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name))) {
        keys.push({ name: prop.name.text, initializer: prop.initializer });
      } else {
        result.cannotExtract.push(`${where}: non-literal member (${ts.SyntaxKind[prop.kind]})`);
      }
    }
    return keys;
  };

  const visit = (node: ts.Node): void => {
    // cva(base, { variants: {...}, defaultVariants: {...} })
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'cva' &&
      node.arguments.length >= 2 &&
      ts.isObjectLiteralExpression(node.arguments[1])
    ) {
      for (const { name, initializer } of literalKeys(node.arguments[1], 'cva config')) {
        if (name === 'variants' && ts.isObjectLiteralExpression(initializer)) {
          for (const axis of literalKeys(initializer, 'variants')) {
            if (ts.isObjectLiteralExpression(axis.initializer)) {
              result.axes[axis.name] = literalKeys(axis.initializer, `axis "${axis.name}"`).map((v) => v.name);
            } else {
              result.cannotExtract.push(`axis "${axis.name}": value map is not an object literal`);
            }
          }
        }
        if (name === 'defaultVariants' && ts.isObjectLiteralExpression(initializer)) {
          for (const def of literalKeys(initializer, 'defaultVariants')) {
            if (ts.isStringLiteral(def.initializer)) {
              result.defaults[def.name] = def.initializer.text;
            } else {
              result.cannotExtract.push(`default for "${def.name}" is not a string literal`);
            }
          }
        }
      }
    }

    // The exported `<Name>Props` interface: own members become normative
    // candidates; heritage clauses are reported by name as passthrough.
    if (ts.isInterfaceDeclaration(node) && node.name.text.endsWith('Props')) {
      for (const clause of node.heritageClauses ?? []) {
        for (const type of clause.types) result.passthrough.push(type.getText(source));
      }
      for (const member of node.members) {
        if (ts.isPropertySignature(member) && ts.isIdentifier(member.name)) {
          result.ownProps.push({
            name: member.name.text,
            optional: Boolean(member.questionToken),
            typeText: member.type ? member.type.getText(source) : 'unknown',
          });
        } else {
          result.cannotExtract.push('Props interface: non-literal member');
        }
      }
    }

    ts.forEachChild(node, visit);
  };
  visit(source);

  return result;
}
