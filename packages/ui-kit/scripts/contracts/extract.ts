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
// A component's own props are whatever properties the checker resolves on
// its first parameter's type AND whose declaration lives in the component's
// own source file; every other resolved property - a Base UI primitive's
// `render`, React's `onClick`, an aria-* attribute - is inherited, and is
// what the generated per-element-kind passthrough type is built from (see
// compile.ts's PassthroughSource / generated/passthrough.<kind>.json). This
// is what a text-only extractor structurally cannot see: `Omit<X, 'className'>`
// only removes `className` from X's shape, so every other field X declares
// - including ones the component's own source never mentions - is still
// part of the checker-resolved props type.
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
  // Base UI annotates several passthrough props this way (nativeButton,
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
  defaults: Record<string, string>;
  ownProps: ExtractedProp[];
  inheritedProps: ExtractedProp[];
  // The element kind the inherited props ultimately derive from (`button`,
  // `div`, `table`, ...), resolved through Omit/Pick and BaseUIComponentProps
  // / ComponentProps generic arguments - undefined when the props type has
  // no such anchor (a from-scratch interface with no DOM/Base UI heritage).
  passthroughKind?: string;
  // Human-readable labels for the non-variant heritage this component's own
  // Props type declares - "what the component forwards to an element",
  // kept for readers of the compiled contract, not consumed by the compiler.
  passthroughSources: string[];
  // Human-readable labels for the VariantProps<typeof X> heritage this
  // component's own Props type declares - where its cva axes come from, the
  // complement of passthroughSources above.
  variantSourceLabels: string[];
  cannotExtract: string[];
}

// A TS union member's trailing `| undefined` does not change what the prop
// actually holds; `React.ReactNode` and the bare `ReactNode` name the same
// type under two different printed spellings depending on how the checker's
// import context resolves it. Both are normalized away before a type text is
// compared (own-vs-passthrough conflict check) or classified (NORMATIVE_TYPES
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
function isCvaCall(call: ts.CallExpression, checker: ts.TypeChecker): boolean {
  const symbol = checker.getSymbolAtLocation(call.expression);
  if (!symbol) return false;
  const resolved = symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
  if (resolved.getName() !== 'cva') return false;
  return (resolved.getDeclarations() ?? []).some((decl) =>
    /[\\/]class-variance-authority[\\/]/.test(decl.getSourceFile().fileName),
  );
}

// Follows an expression to the cva(...) call it ultimately names - straight
// through a `const x = cva(...)` variable, through re-exports, and through
// one variable pointing at another (`const buttonVariants = baseVariants;`).
// Bounded depth and a visited set turn a self-referential or cyclic alias
// into "not found" instead of a stack overflow.
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
}

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
}

// Same identifier-following as traceToCvaCall, aimed at cva's own second
// argument: `cva(base, config)` where `config` is a variable instead of an
// inline object literal.
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
}

// Resolves every `VariantProps<typeof X>` heritage entry found on a
// component's props type into the cva axes/defaults it names. A heritage
// entry that cannot be traced to a real cva(...) call - the defect F16
// documents, a cva moved to a sibling file or hidden behind an alias the old
// syntax-only walk never saw - is recorded with a `cva:` prefix so
// compileContract can fail the build on it instead of shipping a contract
// that silently lost its variant axes.
function extractVariants(
  variantSources: ts.EntityName[],
  checker: ts.TypeChecker,
  cannotExtract: string[],
): { axes: Record<string, string[]>; defaults: Record<string, string> } {
  const axes: Record<string, string[]> = {};
  const defaults: Record<string, string> = {};

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
          if (ts.isObjectLiteralExpression(axis.initializer)) {
            axes[axis.name] = literalKeys(axis.initializer, `axis "${axis.name}"`, cannotExtract).map((v) => v.name);
          } else {
            cannotExtract.push(`axis "${axis.name}": value map is not an object literal`);
          }
        }
      }
      if (name === 'defaultVariants' && ts.isObjectLiteralExpression(initializer)) {
        for (const def of literalKeys(initializer, 'defaultVariants', cannotExtract)) {
          if (ts.isStringLiteral(def.initializer)) {
            defaults[def.name] = def.initializer.text;
          } else {
            cannotExtract.push(`default for "${def.name}" is not a string literal`);
          }
        }
      }
    }
  }

  return { axes, defaults };
}

interface PropsTypeWalkResult {
  kind: string | undefined;
  variantSources: ts.EntityName[];
}

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
  if (depth > 12) return;
  if (ts.isIntersectionTypeNode(node)) {
    for (const member of node.types) walkPropsType(member, checker, result, visited, depth + 1);
    return;
  }
  if (ts.isParenthesizedTypeNode(node)) {
    walkPropsType(node.type, checker, result, visited, depth + 1);
    return;
  }

  const parts = typeRefParts(node);
  if (!parts) return;
  const { name, args, location } = parts;

  if ((name === 'Omit' || name === 'Pick') && args && args.length > 0) {
    walkPropsType(args[0], checker, result, visited, depth + 1);
    return;
  }
  if (name === 'VariantProps' && args && args.length > 0 && ts.isTypeQueryNode(args[0])) {
    result.variantSources.push(args[0].exprName);
    return;
  }
  if ((name === 'BaseUIComponentProps' || name === 'ComponentProps' || name === 'ComponentPropsWithRef') && args?.length) {
    const first = args[0];
    if (ts.isLiteralTypeNode(first) && ts.isStringLiteral(first.literal) && result.kind === undefined) {
      result.kind = first.literal.text;
    }
    return;
  }

  // A named reference this loop does not special-case - resolve it and
  // recurse into its own declaration's heritage (interface `extends` list,
  // or a type alias's underlying type), which is how `ButtonPrimitive.Props`
  // eventually reaches Base UI's `BaseUIComponentProps<'button', ...>`.
  const symbol = checker.getSymbolAtLocation(location);
  if (!symbol) return;
  const resolved = symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
  if (visited.has(resolved)) return;
  visited.add(resolved);
  for (const decl of resolved.getDeclarations() ?? []) {
    if (ts.isInterfaceDeclaration(decl)) {
      for (const clause of decl.heritageClauses ?? []) {
        for (const member of clause.types) walkPropsType(member, checker, result, visited, depth + 1);
      }
    } else if (ts.isTypeAliasDeclaration(decl)) {
      walkPropsType(decl.type, checker, result, visited, depth + 1);
    }
  }
}

// The names walkPropsType and resolveTopLevelMembers both treat as leaves -
// stop unwrapping and report the node itself, rather than continuing to
// resolve into Base UI's or React's own type declarations. Kept as one list
// so the two functions never disagree about where "the component's own
// heritage" ends and "a well-known type helper's internals" begins.
const HERITAGE_LEAF_NAMES = new Set([
  'Omit',
  'Pick',
  'VariantProps',
  'BaseUIComponentProps',
  'ComponentProps',
  'ComponentPropsWithRef',
  'NativeButtonProps',
  'NonNativeButtonProps',
]);

// Unwraps a props type node down to the constituents that actually carry
// meaning for a reader: an intersection's members, and a plain named
// reference (`ButtonProps`, `AlertProps`, ...) followed into whatever ITS
// interface `extends` or type alias underlying type is. Stops at the same
// leaves walkPropsType stops at (Omit/Pick/VariantProps/BaseUIComponentProps/
// ComponentProps/NativeButtonProps) so the two functions describe the same
// graph - one for kind/variant resolution, this one for the read-only labels
// x-uikit.passthrough and x-uikit.variant_sources carry.
function resolveTopLevelMembers(
  node: ts.TypeNode,
  checker: ts.TypeChecker,
  visited: Set<ts.Symbol>,
  depth: number,
): ts.TypeNode[] {
  if (depth > 12) return [node];
  if (ts.isIntersectionTypeNode(node)) {
    return node.types.flatMap((member) => resolveTopLevelMembers(member, checker, visited, depth + 1));
  }
  if (ts.isParenthesizedTypeNode(node)) {
    return resolveTopLevelMembers(node.type, checker, visited, depth + 1);
  }
  const parts = typeRefParts(node);
  if (!parts || HERITAGE_LEAF_NAMES.has(parts.name)) return [node];

  const symbol = checker.getSymbolAtLocation(parts.location);
  if (!symbol) return [node];
  const resolved = symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
  if (visited.has(resolved)) return [node];
  visited.add(resolved);

  const members: ts.TypeNode[] = [];
  for (const decl of resolved.getDeclarations() ?? []) {
    if (ts.isInterfaceDeclaration(decl)) {
      for (const clause of decl.heritageClauses ?? []) {
        for (const member of clause.types) members.push(...resolveTopLevelMembers(member, checker, visited, depth + 1));
      }
    } else if (ts.isTypeAliasDeclaration(decl)) {
      members.push(...resolveTopLevelMembers(decl.type, checker, visited, depth + 1));
    }
  }
  // A named reference this loop cannot unwrap further (an inline object
  // type literal, a type with no heritage) is itself the leaf.
  return members.length > 0 ? members : [node];
}

// x-uikit.passthrough / x-uikit.variant_sources: what the component's own
// props type extends, split into forwarded-to-an-element vs
// where-its-own-cva-axes-come-from. Each passthrough label carries the
// declaration file the checker resolved it to (a node_modules- or
// kit-relative path) alongside the heritage text, so a reader sees not just
// "Omit<ButtonPrimitive.Props, 'className'>" but which file that type
// actually comes from.
function topLevelHeritageLabels(
  node: ts.TypeNode,
  checker: ts.TypeChecker,
  kitRoot: string,
): { passthroughSources: string[]; variantSourceLabels: string[] } {
  const members = resolveTopLevelMembers(node, checker, new Set(), 0);
  const passthroughSources: string[] = [];
  const variantSourceLabels: string[] = [];
  for (const member of members) {
    const parts = typeRefParts(member);
    if (parts?.name === 'VariantProps') {
      variantSourceLabels.push(member.getText());
      continue;
    }
    const text = member.getText();
    // For `Omit<X, 'className'>` the informative location is X, not the
    // built-in Omit utility type itself (which would always resolve to
    // TypeScript's own lib.es5.d.ts and tell a reader nothing about which
    // component library the props actually come from).
    const location =
      parts && (parts.name === 'Omit' || parts.name === 'Pick') && parts.args?.length
        ? typeRefParts(parts.args[0])?.location
        : parts?.location;
    if (location) {
      const symbol = checker.getSymbolAtLocation(location);
      const resolved = symbol && (symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol);
      const decl = resolved?.getDeclarations()?.[0];
      if (decl) {
        passthroughSources.push(`${text} (${relativeDeclarationFile(decl.getSourceFile().fileName, kitRoot)})`);
        continue;
      }
    }
    passthroughSources.push(text);
  }
  return { passthroughSources, variantSourceLabels };
}

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

function isReactComponentCandidate(node: ts.Node): node is ts.FunctionDeclaration | ts.VariableDeclaration {
  if (ts.isFunctionDeclaration(node) && node.name && /^[A-Z]/.test(node.name.text)) return true;
  if (
    ts.isVariableDeclaration(node) &&
    ts.isIdentifier(node.name) &&
    /^[A-Z]/.test(node.name.text) &&
    node.initializer &&
    (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
  ) {
    return true;
  }
  return false;
}

function containsJsx(node: ts.Node): boolean {
  if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)) return true;
  let found = false;
  ts.forEachChild(node, (child) => {
    if (found) return;
    if (containsJsx(child)) found = true;
  });
  return found;
}

function functionBody(node: ts.FunctionDeclaration | ts.VariableDeclaration): ts.Node | undefined {
  if (ts.isFunctionDeclaration(node)) return node.body;
  if (node.initializer && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))) {
    return node.initializer.body;
  }
  return undefined;
}

function firstParameter(
  node: ts.FunctionDeclaration | ts.VariableDeclaration,
): ts.ParameterDeclaration | undefined {
  if (ts.isFunctionDeclaration(node)) return node.parameters[0];
  if (node.initializer && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))) {
    return node.initializer.parameters[0];
  }
  return undefined;
}

function isNodeExported(node: ts.Node): boolean {
  const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
  return (modifiers ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
}

const kitRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

// One parsed tsconfig.src.json for every extraction in the process - the
// compiler options that decide module resolution and JSX must match what
// actually ships, and re-reading/re-parsing the config file per component
// would be wasted work across a kit-wide run (see T4's coverage report).
let cachedCompilerOptions: ts.CompilerOptions | undefined;
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
}

export function extractComponent(tsxPath: string): ComponentExtraction[] {
  const options = loadCompilerOptions();
  const program = ts.createProgram({ rootNames: [tsxPath], options });
  const checker = program.getTypeChecker();
  const source = program.getSourceFile(tsxPath);
  if (!source) {
    throw new Error(`extract: ${tsxPath} was not found by the TypeScript program`);
  }

  const extractions: ComponentExtraction[] = [];

  for (const statement of source.statements) {
    const candidates: (ts.FunctionDeclaration | ts.VariableDeclaration)[] = [];
    if (ts.isFunctionDeclaration(statement) && isNodeExported(statement)) {
      candidates.push(statement);
    } else if (ts.isVariableStatement(statement) && isNodeExported(statement)) {
      for (const decl of statement.declarationList.declarations) candidates.push(decl);
    }

    for (const candidate of candidates) {
      if (!isReactComponentCandidate(candidate)) continue;
      const body = functionBody(candidate);
      if (!body || !containsJsx(body)) continue;
      const name = ts.isFunctionDeclaration(candidate) ? candidate.name!.text : (candidate.name as ts.Identifier).text;

      const cannotExtract: string[] = [];
      const param = firstParameter(candidate);
      const ownProps: ExtractedProp[] = [];
      const inheritedProps: ExtractedProp[] = [];
      let passthroughKind: string | undefined;
      let passthroughSources: string[] = [];
      let variantSourceLabels: string[] = [];
      let axes: Record<string, string[]> = {};
      let defaults: Record<string, string> = {};

      if (param) {
        const paramType = checker.getTypeAtLocation(param);
        const walk: PropsTypeWalkResult = { kind: undefined, variantSources: [] };
        if (param.type) {
          walkPropsType(param.type, checker, walk, new Set(), 0);
          const labels = topLevelHeritageLabels(param.type, checker, kitRoot);
          passthroughSources = labels.passthroughSources;
          variantSourceLabels = labels.variantSourceLabels;
        }
        passthroughKind = walk.kind;

        const variantsResult = extractVariants(walk.variantSources, checker, cannotExtract);
        axes = variantsResult.axes;
        defaults = variantsResult.defaults;
        const axisNames = new Set(Object.keys(axes));

        for (const prop of checker.getPropertiesOfType(paramType)) {
          const propName = prop.getName();
          if (axisNames.has(propName)) continue;

          const declarations = prop.getDeclarations() ?? [];
          const ownDeclaration = declarations.find((d) => d.getSourceFile().fileName === source.fileName);
          const declaration = ownDeclaration ?? declarations[0];
          const propType = checker.getTypeOfSymbolAtLocation(prop, param);
          const typeText = checker.typeToString(propType, param, ts.TypeFormatFlags.NoTruncation);
          const extracted: ExtractedProp = {
            name: propName,
            optional: (prop.flags & ts.SymbolFlags.Optional) !== 0,
            typeText,
            declarationFile: declaration ? relativeDeclarationFile(declaration.getSourceFile().fileName, kitRoot) : 'unknown',
            jsDocDefault: jsDocDefault(prop),
          };
          if (ownDeclaration) {
            ownProps.push(extracted);
          } else {
            inheritedProps.push(extracted);
          }
        }
      }

      extractions.push({
        name,
        axes,
        defaults,
        ownProps,
        inheritedProps,
        passthroughKind,
        passthroughSources,
        variantSourceLabels,
        cannotExtract,
      });
    }
  }

  return extractions;
}
