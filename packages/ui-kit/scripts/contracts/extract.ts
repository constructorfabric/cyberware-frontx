// Contract extraction: the machine-owned half of a component contract.
//
// Reads a component's .tsx through a real ts.Program + TypeChecker (the
// package's own tsconfig.src.json compiler options, so module resolution and
// JSX match the build) instead of pattern-matching syntax. Syntax matching
// missed whatever it did not anticipate - a `type Props = ...` alias instead
// of `interface Props`, a second exported component in the same file, a cva
// config in a sibling module - and missed it silently, which is a worse
// defect than a loud failure: `cannotExtract` exists so a fact the extractor
// could not read shows up in the compiled contract instead of vanishing.
//
// Every property the checker resolves on the component's first parameter is
// filed by WHERE ITS DECLARATION LIVES, into one of three sets:
//
//   - the component's own source file           -> ownProps
//   - the primitive library's props for a part  -> apiProps
//   - React's DOM attribute types               -> forwardedProps
//
// The middle set is the one that matters most to a reader. A prop declared in
// a Base UI part's own props type - Accordion root's `multiple`, Button's
// `render`/`nativeButton` - is not something the kit merely forwards to an
// element: it IS this component's API, wearing the primitive library's
// declaration site as an accident of how the kit wraps that primitive. Filing
// it as forwarded DOM surface is what buried nine accordion-root props in a
// 233-entry generated file nobody read. React's own DOM attributes really are
// forwarded surface, and they are the same surface for every component that
// renders the same host element, which is why they are declared once per
// element kind by hand (see compile.ts's loadElementSurface) instead of
// re-derived per component.
//
// This is what a text-only extractor structurally cannot see: `Omit<X,
// 'className'>` only removes `className` from X's shape, so every other field
// X declares - including ones the component's own source never mentions - is
// still part of the checker-resolved props type.
//
// A property declared in none of the three places is filed nowhere and named
// in `unclassifiedProps`: the compiler refuses such a component rather than
// guessing which side of the API/forwarded line the prop falls on (see the
// coupling note below).
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

export interface ExtractedProp {
  name: string;
  optional: boolean;
  // checker.typeToString with NoTruncation - the real resolved type, not a
  // guess from the source text (an alias, a generic, an imported type all
  // print in full instead of "unknown").
  typeText: string;
  // Where the checker found this property declared, normalized to a
  // node_modules-relative or kit-relative path - never an absolute
  // filesystem path, which would make a committed contract machine-specific.
  declarationFile: string;
  // The JSDoc @default tag's text, when the declaring symbol carries one -
  // Base UI annotates several forwarded props this way (nativeButton,
  // focusableWhenDisabled) and it is worth keeping next to the fact it
  // documents rather than discarding it at extraction time.
  jsDocDefault?: string;
}

export interface ComponentExtraction {
  // The exported identifier (PascalCase) - compileContract matches this
  // against the directory name in PascalCase to pick one extraction out of
  // a file that may export several components.
  name: string;
  axes: Record<string, string[]>;
  // The subset of `axes` whose variant map is keyed by `true`/`false`, which
  // class-variance-authority types as a boolean prop rather than as the
  // string union its keys look like. Named alongside `axes` rather than
  // encoded into the values, so the values stay what the cva config actually
  // wrote and the compiler decides how to express them.
  booleanAxes: string[];
  defaults: Record<string, string>;
  // Declared in the component's own source file.
  ownProps: ExtractedProp[];
  // Declared in the primitive library's own props type for the part this
  // component wraps - this component's API, reached through the wrapping
  // rather than typed out again in the kit's source. Compiled into the
  // contract's own `properties` next to ownProps, not into the forwarded
  // surface.
  apiProps: ExtractedProp[];
  // Declared in React's DOM attribute types: the surface every component
  // rendering the same host element forwards, declared once per element kind
  // by hand rather than re-derived here.
  forwardedProps: ExtractedProp[];
  // Declared somewhere none of the three above covers - a second primitive
  // library, a utility package. Named rather than filed: which side of the
  // API/forwarded line such a prop belongs on is a question about that
  // library's conventions, and the compiler refuses the component instead of
  // guessing (see the module comment).
  unclassifiedProps: ExtractedProp[];
  // The host element this component renders (`button`, `div`, `table`, ...),
  // resolved through Omit/Pick and BaseUIComponentProps / ComponentProps
  // generic arguments - undefined when the props type has no such anchor (a
  // from-scratch interface with no DOM/Base UI heritage, e.g. DataTable's).
  // It decides WHICH hand-written element surface the contract names,
  // so a component with forwarded DOM props and no resolvable element kind
  // is refused rather than compiled without them.
  elementKind?: string;
  // Human-readable labels for the VariantProps<typeof X> heritage this
  // component's own Props type declares - where its cva axes come from,
  // kept for readers of the compiled contract, not consumed by the compiler.
  // The non-variant heritage carries no label of its own: which element a
  // component forwards to is stated once, as the host-element surface the
  // contract names, and a second prose copy of it was one fact in two places.
  variantSourceLabels: string[];
  cannotExtract: string[];
}

// A TS union member's trailing `| undefined` does not change what the prop
// actually holds; `React.ReactNode` and the bare `ReactNode` name the same
// type under two different printed spellings depending on how the checker's
// import context resolves it. Both are normalized away before a type text is
// compared (own-vs-surface conflict check) or classified (NORMATIVE_TYPES
// lookup), or the same fact would silently disagree with itself depending on
// which side happened to print the qualified form.
export function normalizeTypeText(typeText: string): string {
  return typeText
    .replace(/\s*\|\s*undefined\s*$/, '')
    .replace(/\bReact\.ReactNode\b/g, 'ReactNode')
    .replace(/\s+/g, ' ')
    .trim();
}

// A normalized type text that is nothing but a union of string literals
// (optionally widened with `| null`, already stripped of `| undefined` by
// normalizeTypeText) becomes a JSON Schema string enum instead of an
// annotation-only slot - the same treatment a cva axis gets, extended to a
// component's own hand-written literal union props.
export function parseStringLiteralUnion(normalizedTypeText: string): string[] | undefined {
  const members = normalizedTypeText.split(/\s*\|\s*/).filter((member) => member !== 'null');
  if (members.length === 0) return undefined;
  const values: string[] = [];
  for (const member of members) {
    const match = /^"((?:[^"\\]|\\.)*)"$/.exec(member);
    if (!match) return undefined;
    values.push(match[1].replace(/\\(.)/g, '$1'));
  }
  return values;
}

interface LiteralEntry {
  name: string;
  initializer: ts.Expression;
}

// Reads the literal (identifier- or string-keyed) members of an object
// literal; anything else - a spread, a computed key, a method - is not
// something a plain walk can attribute a value to, so it is named in
// `cannotExtract` instead of silently skipped.
// @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-extraction:p1:inst-ex-axes
function literalKeys(objLiteral: ts.ObjectLiteralExpression, where: string, cannotExtract: string[]): LiteralEntry[] {
  const keys: LiteralEntry[] = [];
  for (const prop of objLiteral.properties) {
    if (ts.isPropertyAssignment(prop) && (ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name))) {
      keys.push({ name: prop.name.text, initializer: prop.initializer });
    } else {
      cannotExtract.push(`${where}: non-literal member (${ts.SyntaxKind[prop.kind]})`);
    }
  }
  return keys;
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-extraction:p1:inst-ex-axes
}

function lastEntityName(name: ts.EntityName): string {
  return ts.isQualifiedName(name) ? name.right.text : name.text;
}

function calleeName(expr: ts.LeftHandSideExpression): string | undefined {
  if (ts.isIdentifier(expr)) return expr.text;
  if (ts.isPropertyAccessExpression(expr)) return expr.name.text;
  return undefined;
}

// True for a call whose resolved callee really is class-variance-authority's
// `cva` export - checked by symbol identity (declaration file + real name),
// not by the text at the call site, so an aliased import
// (`import { cva as makeVariants }`) or a member call
// (`cvaNs.cva(...)`) resolve the same as a plain `cva(...)`.
// @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-extraction:p1:inst-ex-axes
function isCvaCall(call: ts.CallExpression, checker: ts.TypeChecker): boolean {
  const symbol = checker.getSymbolAtLocation(call.expression);
  if (!symbol) return false;
  const resolved = symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
  if (resolved.getName() !== 'cva') return false;
  return (resolved.getDeclarations() ?? []).some((decl) =>
    /[\\/]class-variance-authority[\\/]/.test(decl.getSourceFile().fileName),
  );
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-extraction:p1:inst-ex-axes
}

// Follows an expression to the cva(...) call it ultimately names - straight
// through a `const x = cva(...)` variable, through re-exports, and through
// one variable pointing at another (`const buttonVariants = baseVariants;`).
// Bounded depth and a visited set turn a self-referential or cyclic alias
// into "not found" instead of a stack overflow.
// @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-extraction:p1:inst-ex-axes
function traceToCvaCall(
  expr: ts.Expression | undefined,
  checker: ts.TypeChecker,
  visited: Set<ts.Symbol>,
  depth: number,
): ts.CallExpression | undefined {
  if (expr === undefined || depth > 8) return undefined;
  if (ts.isParenthesizedExpression(expr) || ts.isAsExpression(expr) || ts.isSatisfiesExpression(expr)) {
    return traceToCvaCall(expr.expression, checker, visited, depth + 1);
  }
  if (ts.isCallExpression(expr)) {
    return isCvaCall(expr, checker) ? expr : undefined;
  }
  if (ts.isIdentifier(expr)) {
    const symbol = checker.getSymbolAtLocation(expr);
    return symbol ? traceSymbolToCvaCall(symbol, checker, visited, depth + 1) : undefined;
  }
  return undefined;
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-extraction:p1:inst-ex-axes
}

// @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-extraction:p1:inst-ex-axes
function traceSymbolToCvaCall(
  symbol: ts.Symbol,
  checker: ts.TypeChecker,
  visited: Set<ts.Symbol>,
  depth: number,
): ts.CallExpression | undefined {
  if (depth > 8) return undefined;
  const resolved = symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
  if (visited.has(resolved)) return undefined;
  visited.add(resolved);
  for (const decl of resolved.getDeclarations() ?? []) {
    if (ts.isVariableDeclaration(decl) && decl.initializer) {
      const found = traceToCvaCall(decl.initializer, checker, visited, depth + 1);
      if (found) return found;
    }
  }
  return undefined;
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-extraction:p1:inst-ex-axes
}

// Same identifier-following as traceToCvaCall, aimed at cva's own second
// argument: `cva(base, config)` where `config` is a variable instead of an
// inline object literal.
// @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-extraction:p1:inst-ex-axes
function traceToObjectLiteral(
  expr: ts.Expression | undefined,
  checker: ts.TypeChecker,
  visited: Set<ts.Symbol>,
  depth: number,
): ts.ObjectLiteralExpression | undefined {
  if (expr === undefined || depth > 8) return undefined;
  if (ts.isObjectLiteralExpression(expr)) return expr;
  if (ts.isParenthesizedExpression(expr) || ts.isAsExpression(expr) || ts.isSatisfiesExpression(expr)) {
    return traceToObjectLiteral(expr.expression, checker, visited, depth + 1);
  }
  if (ts.isIdentifier(expr)) {
    const symbol = checker.getSymbolAtLocation(expr);
    if (!symbol) return undefined;
    const resolved = symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
    if (visited.has(resolved)) return undefined;
    visited.add(resolved);
    for (const decl of resolved.getDeclarations() ?? []) {
      if (ts.isVariableDeclaration(decl) && decl.initializer) {
        const found = traceToObjectLiteral(decl.initializer, checker, visited, depth + 1);
        if (found) return found;
      }
    }
  }
  return undefined;
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-extraction:p1:inst-ex-axes
}

// A cva axis whose variant map is keyed by `true`/`false` is a BOOLEAN
// variant: class-variance-authority indexes it by those two keys and
// `VariantProps` types the resulting prop as `boolean`, not as the string
// union the keys look like. Compiled as a string enum, the contract stated a
// prop that only accepts the strings "true" and "false" - a shape no caller
// can satisfy, since `fullWidth` takes a boolean.
//
// The `true`-only form is the common one in real cva configs (a variant with
// no styling for the false branch), so it counts too; anything else is an
// ordinary string axis, including a map that merely happens to contain
// `true` alongside other keys.
// @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-extraction:p1:inst-ex-boolean-axis
export function isBooleanAxis(values: string[]): boolean {
  if (values.length === 0 || values.length > 2) return false;
  return values.every((value) => value === 'true' || value === 'false') && values.includes('true');
}
// @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-extraction:p1:inst-ex-boolean-axis

// Resolves every `VariantProps<typeof X>` heritage entry found on a
// component's props type into the cva axes/defaults it names. A heritage
// entry that cannot be traced to a real cva(...) call - the defect F16
// documents, a cva moved to a sibling file or masked behind an alias the old
// syntax-only walk never saw - is recorded with a `cva:` prefix so
// compileContract can fail the build on it instead of shipping a contract
// that silently lost its variant axes.
function extractVariants(
  variantSources: ts.EntityName[],
  checker: ts.TypeChecker,
  cannotExtract: string[],
): { axes: Record<string, string[]>; booleanAxes: string[]; defaults: Record<string, string> } {
  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-extraction:p1:inst-ex-axes
  const axes: Record<string, string[]> = {};
  const booleanAxes = new Set<string>();
  const defaults: Record<string, string> = {};
  // Which VariantProps<typeof X> heritage entry (by label) an axis/default
  // name first came from - N1: two heritage entries declaring the same axis
  // name is a real conflict, not "the later one wins"; recorded per-name so
  // the second occurrence names both sources instead of silently
  // overwriting the first one's values.
  const axisSourceLabel: Record<string, string> = {};
  const defaultSourceLabel: Record<string, string> = {};

  for (const entityName of variantSources) {
    const label = lastEntityName(entityName);
    const symbol = checker.getSymbolAtLocation(entityName);
    const call = symbol ? traceSymbolToCvaCall(symbol, checker, new Set(), 0) : undefined;
    if (!call) {
      cannotExtract.push(
        `cva: cannot resolve a cva(...) call for "${label}" (VariantProps<typeof ${label}> is declared, but no ` +
          `traceable cva call was found from its declaration - variant axes would be silently lost)`,
      );
      continue;
    }
    if (call.arguments.length < 2) {
      cannotExtract.push(`cva: "${label}"'s cva(...) call has fewer than 2 arguments`);
      continue;
    }
    const config = traceToObjectLiteral(call.arguments[1], checker, new Set(), 0);
    if (!config) {
      cannotExtract.push(`cva: "${label}"'s cva(...) second argument is not a resolvable object literal`);
      continue;
    }
    for (const { name, initializer } of literalKeys(config, 'cva config', cannotExtract)) {
      if (name === 'variants' && ts.isObjectLiteralExpression(initializer)) {
        for (const axis of literalKeys(initializer, 'variants', cannotExtract)) {
          if (!ts.isObjectLiteralExpression(axis.initializer)) {
            cannotExtract.push(`axis "${axis.name}": value map is not an object literal`);
            continue;
          }
          // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-extraction:p1:inst-ex-axis-conflict
          if (axis.name in axes) {
            // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-extraction:p1:inst-ex-axis-conflict-note
            cannotExtract.push(
              `cva: axis "${axis.name}" is declared by both "${axisSourceLabel[axis.name]}" and "${label}" - ` +
                `duplicate VariantProps heritage entries would otherwise silently overwrite one axis with the other`,
            );
            // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-extraction:p1:inst-ex-axis-conflict-note
            continue;
          }
          // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-extraction:p1:inst-ex-axis-conflict
          const values = literalKeys(axis.initializer, `axis "${axis.name}"`, cannotExtract).map((v) => v.name);
          axes[axis.name] = values;
          // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-extraction:p1:inst-ex-boolean-axis
          if (isBooleanAxis(values)) booleanAxes.add(axis.name);
          // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-extraction:p1:inst-ex-boolean-axis
          axisSourceLabel[axis.name] = label;
        }
      }
      if (name === 'defaultVariants' && ts.isObjectLiteralExpression(initializer)) {
        for (const def of literalKeys(initializer, 'defaultVariants', cannotExtract)) {
          // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-extraction:p1:inst-ex-boolean-axis
          // A boolean axis's default is written as a boolean, not as the
          // string key it indexes the variant map by (`fullWidth: false`, not
          // `fullWidth: 'false'`), so the two literal kinds are read as one
          // default and the boolean is stored in the text form the axis's own
          // keys already use.
          const defaultText = ts.isStringLiteral(def.initializer)
            ? def.initializer.text
            : def.initializer.kind === ts.SyntaxKind.TrueKeyword
              ? 'true'
              : def.initializer.kind === ts.SyntaxKind.FalseKeyword
                ? 'false'
                : undefined;
          if (defaultText === undefined) {
            // Prefixed `cva:` so the compiler REFUSES the contract: a default
            // this walk cannot read is a default the contract would ship
            // without, and a variant whose documented default silently
            // vanished is the same class of silent loss as an axis that
            // vanished - which the same prefix already fails the build on.
            cannotExtract.push(
              `cva: default for "${def.name}" is neither a string nor a boolean literal - the axis's own default ` +
                `would be lost from the compiled contract`,
            );
            continue;
          }
          // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-extraction:p1:inst-ex-boolean-axis
          // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-extraction:p1:inst-ex-default-conflict
          if (def.name in defaults) {
            // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-extraction:p1:inst-ex-default-conflict-note
            cannotExtract.push(
              `cva: default "${def.name}" is declared by both "${defaultSourceLabel[def.name]}" and "${label}" - ` +
                `duplicate VariantProps heritage entries would otherwise silently overwrite one default with the other`,
            );
            // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-extraction:p1:inst-ex-default-conflict-note
            continue;
          }
          // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-extraction:p1:inst-ex-default-conflict
          defaults[def.name] = defaultText;
          defaultSourceLabel[def.name] = label;
        }
      }
    }
  }
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-extraction:p1:inst-ex-axes

  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-extraction:p1:inst-ex-axes
  return { axes, booleanAxes: [...booleanAxes].sort(), defaults };
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-extraction:p1:inst-ex-axes
}

interface PropsTypeWalkResult {
  kind: string | undefined;
  variantSources: ts.EntityName[];
  // Threaded alongside kind/variantSources rather than returned separately:
  // a heritage node this walk cannot classify (a bare union, a mapped type,
  // a generic wrapper resolving to neither an interface nor a type alias)
  // is exactly as much a fact as a resolved kind or variant source, and
  // belongs on the same result so extractComponent merges it into the
  // component's cannotExtract list the same way.
  cannotExtract: string[];
}

// @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-extraction:p1:inst-ex-heritage
function typeRefParts(
  node: ts.TypeNode,
): { name: string; args: readonly ts.TypeNode[] | undefined; location: ts.Node } | undefined {
  if (ts.isTypeReferenceNode(node)) {
    return { name: lastEntityName(node.typeName), args: node.typeArguments, location: node.typeName };
  }
  if (ts.isExpressionWithTypeArguments(node)) {
    const name = calleeName(node.expression);
    if (name === undefined) return undefined;
    return { name, args: node.typeArguments, location: node.expression };
  }
  return undefined;
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-extraction:p1:inst-ex-heritage
}

// The six heritage shapes walkPropsType/resolveTopLevelMembers special-case,
// resolved by what they actually declare (isCvaCall's own technique,
// generalized to every heritage shape rather than just cva()): the
// checker-resolved symbol's real name and the file that declares it, never
// the identifier text at the use site. An `import { ComponentProps as CP }
// from 'react'` reads the same as the unaliased form; a locally-declared
// type that merely happens to be NAMED `Omit` or `ComponentProps` reads as
// neither, and falls through to the generic named-reference unwrap below
// instead of being silently (mis)treated as React's or TypeScript's own
// utility type - exactly the M1 defect (F-class silent loss reintroduced
// through import aliasing, not file relocation).
type HeritageShape =
  | { readonly kind: 'omit-pick' }
  | { readonly kind: 'variant-props' }
  | { readonly kind: 'component-props' }
  | { readonly kind: 'base-ui-component-props' };

// @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-extraction:p1:inst-ex-heritage
function declaredUnder(declarations: readonly ts.Declaration[], pattern: RegExp): boolean {
  return declarations.some((decl) => pattern.test(decl.getSourceFile().fileName));
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-extraction:p1:inst-ex-heritage
}

// @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-extraction:p1:inst-ex-heritage
function classifyHeritageReference(location: ts.Node, checker: ts.TypeChecker): HeritageShape | undefined {
  const symbol = checker.getSymbolAtLocation(location);
  if (!symbol) return undefined;
  const resolved = symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
  const name = resolved.getName();
  const declarations = resolved.getDeclarations() ?? [];

  if ((name === 'Omit' || name === 'Pick') && declaredUnder(declarations, /[\\/]node_modules[\\/]typescript[\\/]lib[\\/]/)) {
    return { kind: 'omit-pick' };
  }
  if (name === 'VariantProps' && declaredUnder(declarations, /[\\/]node_modules[\\/]class-variance-authority[\\/]/)) {
    return { kind: 'variant-props' };
  }
  if (
    (name === 'ComponentProps' || name === 'ComponentPropsWithRef') &&
    declaredUnder(declarations, /[\\/]node_modules[\\/]@types[\\/]react[\\/]/)
  ) {
    return { kind: 'component-props' };
  }
  if (name === 'BaseUIComponentProps' && declaredUnder(declarations, /[\\/]node_modules[\\/]@base-ui[\\/]react[\\/]/)) {
    return { kind: 'base-ui-component-props' };
  }
  return undefined;
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-extraction:p1:inst-ex-heritage
}

// Walks a props type's composition graph - Omit/Pick, intersections, and
// named interfaces/aliases followed to their own heritage - looking for two
// things at once: the element kind a BaseUIComponentProps<'tag', ...> or
// ComponentProps<'tag'> generic argument names, and every VariantProps<typeof
// X> entity along the way. One walk instead of two because both anchors live
// on the same graph and a component's real heritage is rarely more than two
// or three levels deep, so re-walking it twice would mostly repeat itself.
function walkPropsType(
  node: ts.TypeNode,
  checker: ts.TypeChecker,
  result: PropsTypeWalkResult,
  visited: Set<ts.Symbol>,
  depth: number,
): void {
  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-extraction:p1:inst-ex-heritage
  if (depth > 12) return;
  if (ts.isIntersectionTypeNode(node)) {
    for (const member of node.types) walkPropsType(member, checker, result, visited, depth + 1);
    return;
  }
  if (ts.isParenthesizedTypeNode(node)) {
    walkPropsType(node.type, checker, result, visited, depth + 1);
    return;
  }
  // An inline object type literal - `{ tone: ... }` in `ComponentProps<'div'>
  // & { tone: ... }` - is a legitimate terminal: its own members are already
  // reachable through checker.getPropertiesOfType at the top level, so there
  // is nothing more for THIS walk (kind/variant discovery) to resolve here.
  // Not an error, unlike the node kinds below it has no typeRefParts either.
  if (ts.isTypeLiteralNode(node)) return;
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-extraction:p1:inst-ex-heritage

  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-extraction:p1:inst-ex-heritage
  const parts = typeRefParts(node);
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-extraction:p1:inst-ex-heritage
  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-extraction:p1:inst-ex-cannot
  if (!parts) {
    // A node kind this walk does not understand at all - a bare union, a
    // mapped type, a conditional type - in heritage position. The old walk
    // silently returned here with no kind/variantSources contributed and no
    // note that anything was skipped (N2's bare-union case, and the general
    // "unknown wrapper type" shape M1 asks for); recorded now instead of
    // dropped, since whatever this node declares (a DOM/Base UI anchor, a
    // cva axis) is exactly the kind of fact this walk exists to surface.
    result.cannotExtract.push(
      `heritage: "${node.getText()}" is a ${ts.SyntaxKind[node.kind]}, not a shape this walk can classify - cannot extract`,
    );
    return;
  }
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-extraction:p1:inst-ex-cannot
  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-extraction:p1:inst-ex-heritage
  const { args, location } = parts;
  const shape = classifyHeritageReference(location, checker);

  if (shape?.kind === 'omit-pick' && args && args.length > 0) {
    walkPropsType(args[0], checker, result, visited, depth + 1);
    return;
  }
  if (shape?.kind === 'variant-props' && args && args.length > 0 && ts.isTypeQueryNode(args[0])) {
    result.variantSources.push(args[0].exprName);
    return;
  }
  if ((shape?.kind === 'base-ui-component-props' || shape?.kind === 'component-props') && args?.length) {
    const first = args[0];
    if (ts.isLiteralTypeNode(first) && ts.isStringLiteral(first.literal) && result.kind === undefined) {
      result.kind = first.literal.text;
    }
    return;
  }
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-extraction:p1:inst-ex-heritage

  // A named reference this loop does not special-case - resolve it and
  // recurse into its own declaration's heritage (interface `extends` list,
  // or a type alias's underlying type), which is how `ButtonPrimitive.Props`
  // eventually reaches Base UI's `BaseUIComponentProps<'button', ...>`. A
  // reference that resolves to no symbol at all, or to a declaration kind
  // this loop cannot unwrap (a class, an enum - anything but an interface or
  // type alias), is exactly as unclassifiable as the node-kind case above
  // and gets the same treatment: named, not silently dropped.
  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-extraction:p1:inst-ex-heritage
  const symbol = checker.getSymbolAtLocation(location);
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-extraction:p1:inst-ex-heritage
  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-extraction:p1:inst-ex-cannot
  if (!symbol) {
    result.cannotExtract.push(`heritage: "${node.getText()}" has no resolvable symbol - cannot extract`);
    return;
  }
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-extraction:p1:inst-ex-cannot
  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-extraction:p1:inst-ex-heritage
  const resolved = symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
  if (visited.has(resolved)) return;
  visited.add(resolved);
  let unwrapped = false;
  for (const decl of resolved.getDeclarations() ?? []) {
    if (ts.isInterfaceDeclaration(decl)) {
      unwrapped = true;
      for (const clause of decl.heritageClauses ?? []) {
        for (const member of clause.types) walkPropsType(member, checker, result, visited, depth + 1);
      }
    } else if (ts.isTypeAliasDeclaration(decl)) {
      unwrapped = true;
      walkPropsType(decl.type, checker, result, visited, depth + 1);
    }
  }
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-extraction:p1:inst-ex-heritage
  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-extraction:p1:inst-ex-cannot
  if (!unwrapped) {
    result.cannotExtract.push(
      `heritage: "${node.getText()}" resolves to a declaration this walk cannot unwrap (not an interface or type alias) - cannot extract`,
    );
  }
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-extraction:p1:inst-ex-cannot
}

// Unwraps a props type node down to the constituents that actually carry
// meaning for a reader: an intersection's members, and a plain named
// reference (`ButtonProps`, `AlertProps`, ...) followed into whatever ITS
// interface `extends` or type alias underlying type is. Stops at the same
// six shapes walkPropsType stops at (classifyHeritageReference, resolved by
// symbol - not a hand-kept name list, so the two functions can never
// disagree about where "the component's own heritage" ends and "a
// well-known type helper's internals" begins) - one for kind/variant
// resolution, this one for the read-only labels x-uikit.variant_sources
// carries. A node this walk genuinely cannot classify
// (see walkPropsType's matching branches) is named in `cannotExtract`
// instead of silently becoming an opaque label (N2/M1): the label-only
// consumer downstream still gets a leaf back so it has something to render,
// but the fact that the walk gave up on it is no longer lost.
function resolveTopLevelMembers(
  node: ts.TypeNode,
  checker: ts.TypeChecker,
  visited: Set<ts.Symbol>,
  depth: number,
  cannotExtract: string[],
): ts.TypeNode[] {
  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-extraction:p1:inst-ex-heritage
  if (depth > 12) return [node];
  if (ts.isIntersectionTypeNode(node)) {
    return node.types.flatMap((member) => resolveTopLevelMembers(member, checker, visited, depth + 1, cannotExtract));
  }
  if (ts.isParenthesizedTypeNode(node)) {
    return resolveTopLevelMembers(node.type, checker, visited, depth + 1, cannotExtract);
  }
  if (ts.isTypeLiteralNode(node)) return [node];

  const parts = typeRefParts(node);
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-extraction:p1:inst-ex-heritage
  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-extraction:p1:inst-ex-cannot
  if (!parts) {
    cannotExtract.push(
      `heritage: "${node.getText()}" is a ${ts.SyntaxKind[node.kind]}, not a shape this walk can classify - cannot extract`,
    );
    return [node];
  }
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-extraction:p1:inst-ex-cannot
  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-extraction:p1:inst-ex-heritage
  if (classifyHeritageReference(parts.location, checker)) return [node];

  const symbol = checker.getSymbolAtLocation(parts.location);
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-extraction:p1:inst-ex-heritage
  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-extraction:p1:inst-ex-cannot
  if (!symbol) {
    cannotExtract.push(`heritage: "${node.getText()}" has no resolvable symbol - cannot extract`);
    return [node];
  }
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-extraction:p1:inst-ex-cannot
  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-extraction:p1:inst-ex-heritage
  const resolved = symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
  if (visited.has(resolved)) return [node];
  visited.add(resolved);

  const members: ts.TypeNode[] = [];
  let unwrapped = false;
  for (const decl of resolved.getDeclarations() ?? []) {
    if (ts.isInterfaceDeclaration(decl)) {
      unwrapped = true;
      for (const clause of decl.heritageClauses ?? []) {
        for (const member of clause.types) members.push(...resolveTopLevelMembers(member, checker, visited, depth + 1, cannotExtract));
      }
    } else if (ts.isTypeAliasDeclaration(decl)) {
      unwrapped = true;
      members.push(...resolveTopLevelMembers(decl.type, checker, visited, depth + 1, cannotExtract));
    }
  }
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-extraction:p1:inst-ex-heritage
  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-extraction:p1:inst-ex-cannot
  if (!unwrapped) {
    cannotExtract.push(
      `heritage: "${node.getText()}" resolves to a declaration this walk cannot unwrap (not an interface or type alias) - cannot extract`,
    );
  }
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-extraction:p1:inst-ex-cannot
  // A named reference with no heritage of its own (an inline object type
  // literal, an interface/type alias declaring no `extends`) is itself the
  // leaf - legitimate, not an error; `unwrapped` above already distinguishes
  // that case from a genuinely opaque one.
  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-extraction:p1:inst-ex-heritage
  return members.length > 0 ? members : [node];
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-extraction:p1:inst-ex-heritage
}

// x-uikit.variant_sources: where this component's own cva axes come from,
// read off the VariantProps<typeof X> entries of its props type's heritage.
// The walk covers the whole heritage rather than the variant entries alone
// because a node it cannot classify is a fact worth recording either way
// (resolveTopLevelMembers writes it into `cannotExtract`), and because the
// non-variant entries are what the walk has to step over to find the variant
// ones.
function variantSourceLabelsOf(
  node: ts.TypeNode,
  checker: ts.TypeChecker,
  cannotExtract: string[],
): string[] {
  const members = resolveTopLevelMembers(node, checker, new Set(), 0, cannotExtract);
  const labels: string[] = [];
  for (const member of members) {
    const parts = typeRefParts(member);
    const shape = parts && classifyHeritageReference(parts.location, checker);
    if (shape?.kind === 'variant-props') labels.push(member.getText());
  }
  return labels;
}

// Where a prop's declaration lives decides which of the three sets it is
// filed into (see the module comment). Two prefixes, checked against the
// already-relativized declaration path rather than against a symbol, because
// the question is genuinely about the FILE: the same helper type
// (BaseUIComponentProps) contributes `render` and `style`, and React's own
// DOM attribute interfaces contribute everything else, and no symbol name
// separates them.
//
// The primitive-library prefix is the whole of this harness's coupling to a
// specific headless library. A component whose props come from a different
// one (Radix, react-aria, Ariakit) files every such prop as unclassified and
// is refused by the compiler rather than described with the wrong half of its
// API buried in a forwarded surface. Adding a library is one more prefix here
// plus whatever its own declaration layout requires - new design work on this
// classifier, not a config toggle.
// @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-extraction:p1:inst-ex-file-class
const PRIMITIVE_LIBRARY_PREFIX = '@base-ui/react/';
const REACT_DOM_TYPES_PREFIX = '@types/react/';

export type PropDeclarationSite = 'primitive-library' | 'react-dom' | 'elsewhere';

export function classifyDeclarationSite(declarationFile: string): PropDeclarationSite {
  if (declarationFile.startsWith(PRIMITIVE_LIBRARY_PREFIX)) return 'primitive-library';
  if (declarationFile.startsWith(REACT_DOM_TYPES_PREFIX)) return 'react-dom';
  return 'elsewhere';
}
// @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-extraction:p1:inst-ex-file-class

function jsDocDefault(symbol: ts.Symbol): string | undefined {
  const tag = symbol.getJsDocTags().find((t) => t.name === 'default');
  if (!tag || !tag.text) return undefined;
  return tag.text.map((part) => part.text).join('');
}

// Normalizes a declaration's source file to something safe to commit: the
// package-relative path under node_modules for a third-party type, or the
// kit-relative path for another file in this package. An absolute
// filesystem path would make the compiled contract different on every
// machine that regenerates it.
function relativeDeclarationFile(absolutePath: string, kitRoot: string): string {
  const marker = '/node_modules/';
  const idx = absolutePath.lastIndexOf(marker);
  if (idx !== -1) return absolutePath.slice(idx + marker.length);
  return relative(kitRoot, absolutePath).split('\\').join('/');
}

// TypeScript's printer inlines an `import("<absolute path>")` qualifier
// whenever NoTruncation forces a structural (unnamed) type to print in full
// and the checker has no nominal name to fall back to - real for DataTable's
// `columns` (T6), whose element type traces back to an inferred
// `tableFeatures(...)` return type with no name of its own. Left alone, the
// printed type text embeds the machine's own absolute filesystem path into a
// COMMITTED contract - the exact portability bug relativeDeclarationFile
// above exists to prevent for declaration files, here reused for the same
// paths when they show up INSIDE a printed type instead of as the
// declaration location.
function normalizeImportPathsInTypeText(typeText: string, kitRoot: string): string {
  return typeText.replace(/import\("([^"]*)"\)/g, (_match, path: string) => `import("${relativeDeclarationFile(path, kitRoot)}")`);
}

// True for a call whose resolved callee really is React's own `forwardRef`
// or `memo` export - checked by symbol identity the same way isCvaCall
// checks cva, so an aliased import resolves the same as the plain form.
// @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-extraction:p1:inst-ex-candidates
function isReactWrapperCall(call: ts.CallExpression, checker: ts.TypeChecker, wrapperName: 'forwardRef' | 'memo'): boolean {
  const symbol = checker.getSymbolAtLocation(call.expression);
  if (!symbol) return false;
  const resolved = symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
  if (resolved.getName() !== wrapperName) return false;
  return declaredUnder(resolved.getDeclarations() ?? [], /[\\/]node_modules[\\/]@types[\\/]react[\\/]/);
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-extraction:p1:inst-ex-candidates
}

// Unwraps `forwardRef(...)`/`memo(...)` call wrappers around a component
// function, straight through nesting (`memo(forwardRef((props, ref) =>
// ...))`) - M8: the initializer becomes a CallExpression instead of a
// function value, which the old arrow/function-expression-only check
// silently read as "not component-shaped," undercounting check.ts's own
// enrollment report by miscounting a real, unwrapped component as one of the
// exports it intentionally skips. `forwardRef`'s render function and
// `memo`'s wrapped component are both their call's first argument - the
// only argument shape either wrapper accepts there.
// @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-extraction:p1:inst-ex-candidates
function unwrapComponentInitializer(expr: ts.Expression | undefined, checker: ts.TypeChecker, depth = 0): ts.Expression | undefined {
  if (expr === undefined || depth > 4 || !ts.isCallExpression(expr)) return expr;
  if (isReactWrapperCall(expr, checker, 'forwardRef') || isReactWrapperCall(expr, checker, 'memo')) {
    return unwrapComponentInitializer(expr.arguments[0], checker, depth + 1);
  }
  return expr;
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-extraction:p1:inst-ex-candidates
}

// @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-extraction:p1:inst-ex-candidates
function isReactComponentCandidate(
  node: ts.Node,
  checker: ts.TypeChecker,
): node is ts.FunctionDeclaration | ts.VariableDeclaration {
  if (ts.isFunctionDeclaration(node) && node.name && /^[A-Z]/.test(node.name.text)) return true;
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && /^[A-Z]/.test(node.name.text)) {
    const inner = unwrapComponentInitializer(node.initializer, checker);
    if (inner && (ts.isArrowFunction(inner) || ts.isFunctionExpression(inner))) return true;
  }
  return false;
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-extraction:p1:inst-ex-candidates
}

// @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-extraction:p1:inst-ex-candidates
function containsJsx(node: ts.Node): boolean {
  if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)) return true;
  let found = false;
  ts.forEachChild(node, (child) => {
    if (found) return;
    if (containsJsx(child)) found = true;
  });
  return found;
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-extraction:p1:inst-ex-candidates
}

// @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-extraction:p1:inst-ex-candidates
function functionBody(node: ts.FunctionDeclaration | ts.VariableDeclaration, checker: ts.TypeChecker): ts.Node | undefined {
  if (ts.isFunctionDeclaration(node)) return node.body;
  const inner = unwrapComponentInitializer(node.initializer, checker);
  if (inner && (ts.isArrowFunction(inner) || ts.isFunctionExpression(inner))) return inner.body;
  return undefined;
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-extraction:p1:inst-ex-candidates
}

// @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-extraction:p1:inst-ex-heritage
function firstParameter(
  node: ts.FunctionDeclaration | ts.VariableDeclaration,
  checker: ts.TypeChecker,
): ts.ParameterDeclaration | undefined {
  if (ts.isFunctionDeclaration(node)) return node.parameters[0];
  const inner = unwrapComponentInitializer(node.initializer, checker);
  if (inner && (ts.isArrowFunction(inner) || ts.isFunctionExpression(inner))) return inner.parameters[0];
  return undefined;
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-extraction:p1:inst-ex-heritage
}

// @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-extraction:p1:inst-ex-candidates
function isNodeExported(node: ts.Node): boolean {
  const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
  return (modifiers ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-extraction:p1:inst-ex-candidates
}

const kitRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

// One parsed tsconfig.src.json for every extraction in the process - the
// compiler options that decide module resolution and JSX must match what
// actually ships, and re-reading/re-parsing the config file per component
// would be wasted work across a kit-wide run (see T4's enrollment report).
let cachedCompilerOptions: ts.CompilerOptions | undefined;
// @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-extraction:p1:inst-ex-program
function loadCompilerOptions(): ts.CompilerOptions {
  if (cachedCompilerOptions) return cachedCompilerOptions;
  const configPath = resolve(kitRoot, 'tsconfig.src.json');
  const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
  if (configFile.error) {
    throw new Error(`extract: failed to read ${configPath}: ${ts.flattenDiagnosticMessageText(configFile.error.messageText, ' ')}`);
  }
  const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, dirname(configPath));
  cachedCompilerOptions = parsed.options;
  return cachedCompilerOptions;
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-extraction:p1:inst-ex-program
}

// A ts.Program is not a parse of one file: it is the parse, bind and module
// resolution of that file AND its whole transitive closure - React, Base UI,
// the DOM lib, every .d.ts they reach - and the kit's components share almost
// all of that closure. The enrollment report built two programs per directory,
// 126 for 63 components, and spent nearly all of its runtime re-reading the
// same declaration files. Measured over those 63 entry files: 126 programs
// 33.5s, 63 programs 16.0s, one program over all 63 roots 0.73s.
//
// One shared program is NOT, however, a free substitution for the per-file
// programs, and this is the reason the split below exists. Two things
// checker.typeToString prints are program-global rather than file-local:
//  - the module specifier inside an `import("...")` type - the same Base UI
//    event type prints as `import("@base-ui/react/types/index")` out of a
//    one-root program and `import("@base-ui/react/index")` out of a 63-root
//    one, because the specifier is chosen from the modules the program can
//    already reach;
//  - the ORDER of a union's members, which follows internal type ids and so
//    follows the order the program bound its files - `"none" | "off" | ...`
//    became `"off" | "none" | ...`.
// Both land in a compiled contract, in the prose a property with no schema
// shape carries. Sharing a program for extraction would therefore make a
// component's committed artifacts depend on which OTHER components happened
// to be in the same run - the exact machine-independence the sort in
// `extractComponent` (N3) and the import-path normalization above already
// exist to protect. Measured, not assumed: the freshness comparison reports
// every one of those descriptions as a difference.
//
// So the split is by what the answer is USED for, not by what is convenient:
// extraction that produces artifacts keeps its own per-file program, and only
// the two questions whose answers are counted rather than written - which
// exports are components, and what every export is called - are allowed to
// share, or to skip a program altogether.

// One extraction per tsxPath for the life of the process - resolveTargetExtraction,
// compileContract and compileInstance each resolve a directory's extraction
// independently (compileInstance calls compileContract, which calls
// resolveTargetExtraction, and callers routinely call resolveTargetExtraction
// again directly), so a single freshness check for one component builds this
// same ts.createProgram several times over for the same source file. That
// program build is several seconds on a CI-class runner, so the redundant
// builds are what pushed the contract test suites past vitest's default
// timeout. Caching by tsxPath is safe here because nothing in this process
// edits the component source between calls - a fresh process (a fresh test
// run, or `contracts:compile` invoked again) starts with an empty cache.
const extractionCache = new Map<string, ComponentExtraction[]>();

// The walk itself, over one already-resolved source file. Split from the
// program building below so the same walk can serve a per-file program (the
// artifact path) and a shared one (the counting path) without either being a
// copy of the other.
function extractFromSource(source: ts.SourceFile, checker: ts.TypeChecker): ComponentExtraction[] {
  const extractions: ComponentExtraction[] = [];

  for (const statement of source.statements) {
    // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-extraction:p1:inst-ex-candidates
    const candidates: (ts.FunctionDeclaration | ts.VariableDeclaration)[] = [];
    if (ts.isFunctionDeclaration(statement) && isNodeExported(statement)) {
      candidates.push(statement);
    } else if (ts.isVariableStatement(statement) && isNodeExported(statement)) {
      for (const decl of statement.declarationList.declarations) candidates.push(decl);
    }
    // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-extraction:p1:inst-ex-candidates

    for (const candidate of candidates) {
      // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-extraction:p1:inst-ex-candidates
      if (!isReactComponentCandidate(candidate, checker)) continue;
      const body = functionBody(candidate, checker);
      if (!body || !containsJsx(body)) continue;
      const name = ts.isFunctionDeclaration(candidate) ? candidate.name!.text : (candidate.name as ts.Identifier).text;
      // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-extraction:p1:inst-ex-candidates

      const cannotExtract: string[] = [];
      const param = firstParameter(candidate, checker);
      const ownProps: ExtractedProp[] = [];
      const apiProps: ExtractedProp[] = [];
      const forwardedProps: ExtractedProp[] = [];
      const unclassifiedProps: ExtractedProp[] = [];
      let elementKind: string | undefined;
      let variantSourceLabels: string[] = [];
      let axes: Record<string, string[]> = {};
      let booleanAxes: string[] = [];
      let defaults: Record<string, string> = {};

      if (param) {
        // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-extraction:p1:inst-ex-heritage
        const paramType = checker.getTypeAtLocation(param);
        const walk: PropsTypeWalkResult = { kind: undefined, variantSources: [], cannotExtract: [] };
        if (param.type) {
          walkPropsType(param.type, checker, walk, new Set(), 0);
          // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-extraction:p1:inst-ex-heritage
          variantSourceLabels = variantSourceLabelsOf(param.type, checker, cannotExtract);
        }
        // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-extraction:p1:inst-ex-heritage
        elementKind = walk.kind;
        // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-extraction:p1:inst-ex-heritage
        // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-extraction:p1:inst-ex-cannot
        cannotExtract.push(...walk.cannotExtract);
        // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-extraction:p1:inst-ex-cannot

        // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-extraction:p1:inst-ex-axes
        const variantsResult = extractVariants(walk.variantSources, checker, cannotExtract);
        axes = variantsResult.axes;
        booleanAxes = variantsResult.booleanAxes;
        defaults = variantsResult.defaults;
        // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-extraction:p1:inst-ex-axes
        // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-extraction:p1:inst-ex-props
        const axisNames = new Set(Object.keys(axes));

        for (const prop of checker.getPropertiesOfType(paramType)) {
          const propName = prop.getName();
          if (axisNames.has(propName)) continue;

          const declarations = prop.getDeclarations() ?? [];
          // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-extraction:p1:inst-ex-props
          // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-extraction:p1:inst-ex-undeclared-prop
          if (declarations.length === 0) {
            // A synthetic/computed property symbol (e.g. one instantiated
            // from a mapped type like `Record<'a' | 'b', string>`) carries
            // no declaration to point at - N4: own-vs-inherited classification
            // and declarationFile both depend on having one, so there is
            // nothing honest to report beyond "this prop could not be read."
            // The old code filled the gap with the literal string 'unknown'
            // as if it were real data instead of surfacing the gap itself.
            cannotExtract.push(`prop "${propName}": no declaration found (a synthetic/computed property symbol) - cannot extract`);
            continue;
          }
          // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-extraction:p1:inst-ex-undeclared-prop
          // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-extraction:p1:inst-ex-props
          const ownDeclaration = declarations.find((d) => d.getSourceFile().fileName === source.fileName);
          const declaration = ownDeclaration ?? declarations[0];
          const propType = checker.getTypeOfSymbolAtLocation(prop, param);
          const typeText = normalizeImportPathsInTypeText(
            checker.typeToString(propType, param, ts.TypeFormatFlags.NoTruncation),
            kitRoot,
          );
          const extracted: ExtractedProp = {
            name: propName,
            optional: (prop.flags & ts.SymbolFlags.Optional) !== 0,
            typeText,
            declarationFile: relativeDeclarationFile(declaration.getSourceFile().fileName, kitRoot),
            jsDocDefault: jsDocDefault(prop),
          };
          // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-extraction:p1:inst-ex-props
          // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-extraction:p1:inst-ex-file-class
          if (ownDeclaration) {
            ownProps.push(extracted);
          } else {
            switch (classifyDeclarationSite(extracted.declarationFile)) {
              case 'primitive-library':
                apiProps.push(extracted);
                break;
              case 'react-dom':
                forwardedProps.push(extracted);
                break;
              default:
                unclassifiedProps.push(extracted);
            }
          }
          // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-extraction:p1:inst-ex-file-class
        }
      }

      // Sorted by name before returning - N3: `checker.getPropertiesOfType`'s
      // iteration order is an undocumented TypeScript-internal detail (its
      // own symbol-table/intersection-merge order), not a fact about the
      // component. Left unsorted, a routine `typescript` version bump could
      // reorder a committed contract with no real prop change behind the
      // diff, or make a fresh compile on a different TypeScript patch
      // version disagree byte-for-byte with the commit that produced it -
      // exactly the machine-independence the rest of this file (absolute
      // path stripping, import(...) path normalization) already goes out of
      // its way to guarantee.
      // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-extraction:p1:inst-ex-return
      const byName = (a: ExtractedProp, b: ExtractedProp): number => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
      for (const list of [ownProps, apiProps, forwardedProps, unclassifiedProps]) list.sort(byName);

      extractions.push({
        name,
        axes,
        booleanAxes,
        defaults,
        ownProps,
        apiProps,
        forwardedProps,
        unclassifiedProps,
        elementKind,
        variantSourceLabels,
        cannotExtract,
      });
      // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-extraction:p1:inst-ex-return
    }
  }

  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-extraction:p1:inst-ex-return
  return extractions;
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-extraction:p1:inst-ex-return
}

// The extraction a contract is compiled from: its own program, over that file
// alone, so the result depends on the file and nothing else.
// @cpt-algo:cpt-frontx-ui-kit-algo-component-contracts-extraction:p1
// @cpt-dod:cpt-frontx-ui-kit-dod-component-contracts-extraction:p1
export function extractComponent(tsxPath: string): ComponentExtraction[] {
  const cached = extractionCache.get(tsxPath);
  if (cached) return cached;

  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-extraction:p1:inst-ex-program
  const program = ts.createProgram({ rootNames: [tsxPath], options: loadCompilerOptions() });
  const source = program.getSourceFile(tsxPath);
  if (!source) {
    throw new Error(`extract: ${tsxPath} was not found by the TypeScript program`);
  }
  const extractions = extractFromSource(source, program.getTypeChecker());
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-extraction:p1:inst-ex-program

  extractionCache.set(tsxPath, extractions);
  return extractions;
}

// Which exports of each given file are React components, for every file in
// one program instead of one program per file. Names only, and deliberately
// so: a name is not one of the things a shared program can move (see the
// note above the split), while the type text next to it is - so this answers
// the enrollment report's "n of m exports" and the guard's "does this directory
// describe every component it exports", and nothing that gets written down.
// It keeps its own cache for the same reason: an extraction taken from here
// must never reach compileContract through the artifact cache.
// @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-extraction:p1:inst-ex-shared-program
const componentNameCache = new Map<string, string[]>();

export function listComponentExportNames(tsxPaths: string[]): Map<string, string[]> {
  const wanted = tsxPaths.map((path) => resolve(path));
  const missing = wanted.filter((path) => !componentNameCache.has(path));
  if (missing.length > 0) {
    const program = ts.createProgram({ rootNames: missing, options: loadCompilerOptions() });
    const checker = program.getTypeChecker();
    for (const path of missing) {
      const source = program.getSourceFile(path);
      // A file the walk cannot read reports no components rather than
      // failing the whole batch - the enrollment report it feeds is never
      // supposed to fail a build, and one unreadable directory must not
      // take the other 62 down with it.
      let names: string[] = [];
      try {
        if (source) names = extractFromSource(source, checker).map((extraction) => extraction.name);
      } catch {
        names = [];
      }
      componentNameCache.set(path, names);
    }
  }
  return new Map(wanted.map((path) => [path, componentNameCache.get(path) ?? []]));
}
// @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-extraction:p1:inst-ex-shared-program

// Every top-level exported declaration name in a file, component or not -
// used only by check.ts's enrollment report (T6: data-table.tsx exports
// DataTable/DataTableSortButton alongside four non-component helpers/types -
// dataTableColumnHelper, dataTableFeatures, dataTableSelectionColumn,
// DataTableSelectionColumnLabels). extractComponent already excludes these
// correctly (isReactComponentCandidate requires an uppercase, JSX-returning
// function/const; an interface or type alias is not even a value
// declaration), so the enrollment report's "N of M" count was never wrong - what was
// missing is a way to SHOW which exports were excluded and why, rather than
// leaving a reader to wonder if 2 of 6 exports means four are undescribed
// gaps or four were never components at all.
export function listExportedDeclarationNames(tsxPath: string): string[] {
  // Parsed, not compiled: every answer below is read off the syntax tree, so
  // building a program - and with it React, Base UI and the whole DOM lib -
  // to reach `source.statements` was 63 programs' worth of module resolution
  // spent on a question no checker was ever asked.
  const text = ts.sys.readFile(tsxPath);
  if (text === undefined) return [];
  const source = ts.createSourceFile(tsxPath, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

  const names: string[] = [];
  for (const statement of source.statements) {
    if (!isNodeExported(statement)) continue;
    if (ts.isFunctionDeclaration(statement) && statement.name) {
      names.push(statement.name.text);
    } else if (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement) || ts.isClassDeclaration(statement)) {
      if (statement.name) names.push(statement.name.text);
    } else if (ts.isVariableStatement(statement)) {
      for (const decl of statement.declarationList.declarations) {
        if (ts.isIdentifier(decl.name)) names.push(decl.name.text);
      }
    }
  }
  return names;
}
