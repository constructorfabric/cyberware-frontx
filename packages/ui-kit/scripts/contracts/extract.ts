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
// what the generated per-origin passthrough type is built from (see
// compile.ts's PassthroughSource / generated/passthrough.<origin>.json). This
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
  // Human-readable only (feeds the generated passthrough type's description
  // text); see passthroughOrigin below for the storage/id identity.
  passthroughKind?: string;
  // Storage/id key for the generated passthrough type: WHERE the inherited
  // props come from, not what DOM tag they end up rendering. Two components
  // can both forward to a `<button>` (Button itself, and a hand-rolled
  // Base UI-free `ComponentProps<'button'>` wrapper) while inheriting from
  // completely different type surfaces - keying by `passthroughKind` alone
  // let one silently overwrite the other's generated file. Derived from the
  // declaration file of the outermost heritage member the component's own
  // Props type extends: a Base UI primitive part
  // (node_modules/@base-ui/react/<component>/<part>/...) gives
  // `base_ui_<component>_<part>` (no `_<part>` when the primitive has none,
  // e.g. Button); a plain `ComponentProps<'tag'>`/`ComponentPropsWithRef<'tag'>`
  // gives `dom_<tag>`; a props type with no such heritage at all (a
  // from-scratch interface, e.g. DataTable's) leaves this undefined even
  // when passthroughKind is also undefined - the two always agree on
  // presence, since they read the same heritage graph. A single snake_case
  // token throughout, matching the GTS segment grammar (5 dot-tokens per
  // segment) ids.ts's passthroughTypeId chains this onto.
  passthroughOrigin?: string;
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
  // Which VariantProps<typeof X> heritage entry (by label) an axis/default
  // name first came from - N1: two heritage entries declaring the same axis
  // name is a real conflict, not "the later one wins"; recorded per-name so
  // the second occurrence names both sources instead of silently
  // overwriting the first one's values.
  const axisSourceLabel: Record<string, string> = {};
  const defaultSourceLabel: Record<string, string> = {};

  for (const entityName of variantSources) {
    // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-extraction:p1:inst-ex-axes
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
          axes[axis.name] = literalKeys(axis.initializer, `axis "${axis.name}"`, cannotExtract).map((v) => v.name);
          axisSourceLabel[axis.name] = label;
        }
      }
      if (name === 'defaultVariants' && ts.isObjectLiteralExpression(initializer)) {
        for (const def of literalKeys(initializer, 'defaultVariants', cannotExtract)) {
          if (!ts.isStringLiteral(def.initializer)) {
            cannotExtract.push(`default for "${def.name}" is not a string literal`);
            continue;
          }
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
          defaults[def.name] = def.initializer.text;
          defaultSourceLabel[def.name] = label;
        }
      }
    }
    // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-extraction:p1:inst-ex-axes
  }

  return { axes, defaults };
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

function declaredUnder(declarations: readonly ts.Declaration[], pattern: RegExp): boolean {
  return declarations.some((decl) => pattern.test(decl.getSourceFile().fileName));
}

function classifyHeritageReference(location: ts.Node, checker: ts.TypeChecker): HeritageShape | undefined {
  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-extraction:p1:inst-ex-heritage
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

  const parts = typeRefParts(node);
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

  // A named reference this loop does not special-case - resolve it and
  // recurse into its own declaration's heritage (interface `extends` list,
  // or a type alias's underlying type), which is how `ButtonPrimitive.Props`
  // eventually reaches Base UI's `BaseUIComponentProps<'button', ...>`. A
  // reference that resolves to no symbol at all, or to a declaration kind
  // this loop cannot unwrap (a class, an enum - anything but an interface or
  // type alias), is exactly as unclassifiable as the node-kind case above
  // and gets the same treatment: named, not silently dropped.
  const symbol = checker.getSymbolAtLocation(location);
  if (!symbol) {
    result.cannotExtract.push(`heritage: "${node.getText()}" has no resolvable symbol - cannot extract`);
    return;
  }
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
  if (!unwrapped) {
    result.cannotExtract.push(
      `heritage: "${node.getText()}" resolves to a declaration this walk cannot unwrap (not an interface or type alias) - cannot extract`,
    );
  }
}

// Unwraps a props type node down to the constituents that actually carry
// meaning for a reader: an intersection's members, and a plain named
// reference (`ButtonProps`, `AlertProps`, ...) followed into whatever ITS
// interface `extends` or type alias underlying type is. Stops at the same
// six shapes walkPropsType stops at (classifyHeritageReference, resolved by
// symbol - not a hand-kept name list, so the two functions can never
// disagree about where "the component's own heritage" ends and "a
// well-known type helper's internals" begins) - one for kind/variant
// resolution, this one for the read-only labels x-uikit.passthrough and
// x-uikit.variant_sources carry. A node this walk genuinely cannot classify
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
  if (depth > 12) return [node];
  if (ts.isIntersectionTypeNode(node)) {
    return node.types.flatMap((member) => resolveTopLevelMembers(member, checker, visited, depth + 1, cannotExtract));
  }
  if (ts.isParenthesizedTypeNode(node)) {
    return resolveTopLevelMembers(node.type, checker, visited, depth + 1, cannotExtract);
  }
  if (ts.isTypeLiteralNode(node)) return [node];

  const parts = typeRefParts(node);
  if (!parts) {
    cannotExtract.push(
      `heritage: "${node.getText()}" is a ${ts.SyntaxKind[node.kind]}, not a shape this walk can classify - cannot extract`,
    );
    return [node];
  }
  if (classifyHeritageReference(parts.location, checker)) return [node];

  const symbol = checker.getSymbolAtLocation(parts.location);
  if (!symbol) {
    cannotExtract.push(`heritage: "${node.getText()}" has no resolvable symbol - cannot extract`);
    return [node];
  }
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
  if (!unwrapped) {
    cannotExtract.push(
      `heritage: "${node.getText()}" resolves to a declaration this walk cannot unwrap (not an interface or type alias) - cannot extract`,
    );
  }
  // A named reference with no heritage of its own (an inline object type
  // literal, an interface/type alias declaring no `extends`) is itself the
  // leaf - legitimate, not an error; `unwrapped` above already distinguishes
  // that case from a genuinely opaque one.
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
  cannotExtract: string[],
): { passthroughSources: string[]; variantSourceLabels: string[] } {
  const members = resolveTopLevelMembers(node, checker, new Set(), 0, cannotExtract);
  const passthroughSources: string[] = [];
  const variantSourceLabels: string[] = [];
  for (const member of members) {
    const parts = typeRefParts(member);
    const shape = parts && classifyHeritageReference(parts.location, checker);
    if (shape?.kind === 'variant-props') {
      variantSourceLabels.push(member.getText());
      continue;
    }
    const text = member.getText();
    // For `Omit<X, 'className'>` the informative location is X, not the
    // built-in Omit utility type itself (which would always resolve to
    // TypeScript's own lib.es5.d.ts and tell a reader nothing about which
    // component library the props actually come from).
    const location =
      parts && shape?.kind === 'omit-pick' && parts.args?.length ? typeRefParts(parts.args[0])?.location : parts?.location;
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

// A declaration file already relativized by relativeDeclarationFile (so it
// reads "@base-ui/react/accordion/root/AccordionRoot.d.mts", never an
// absolute path) into the origin token resolvePassthroughOrigin needs: the
// package's own directory layout is `<component>/<part?>/<File>.d.mts` -
// Button has no part directory (button/Button.d.mts), Accordion's parts each
// get one (accordion/root/AccordionRoot.d.mts). Anything not under
// `@base-ui/react/` is not a Base UI origin at all - undefined, not a guess.
function baseUiOriginFromDeclarationFile(relativeFile: string): string | undefined {
  const prefix = '@base-ui/react/';
  if (!relativeFile.startsWith(prefix)) return undefined;
  const segments = relativeFile.slice(prefix.length).split('/');
  // Last segment is always the file itself; everything before the leading
  // component name is a part directory (zero or more - none for Button, one
  // for every Accordion part seen so far, and this generalizes to a deeper
  // package layout without change).
  if (segments.length < 2) return undefined;
  const [component, ...rest] = segments;
  const part = rest.slice(0, -1);
  return ['base_ui', component, ...part].map((token) => token.replace(/-/g, '_')).join('_');
}

// Classifies ONE heritage type reference - either a component's direct
// extends-clause member, or what an Omit/Pick's first argument names - into
// a passthrough origin token. Two shapes are recognized: a bare
// `ComponentProps<'tag'>`/`ComponentPropsWithRef<'tag'>` (React's own DOM
// props helper, no Base UI involved - the literal tag argument is the whole
// story) and anything else, resolved through the checker to the file that
// actually declares it. A reference to neither (an inline object type, a
// kit-local interface with no DOM/Base UI heritage of its own) yields
// undefined, which is exactly right for DataTable's from-scratch props.
function originFromTypeRef(node: ts.TypeNode, checker: ts.TypeChecker, kitRoot: string): string | undefined {
  const parts = typeRefParts(node);
  if (!parts) return undefined;
  const shape = classifyHeritageReference(parts.location, checker);
  if (shape?.kind === 'component-props' && parts.args?.length) {
    const first = parts.args[0];
    // GTS tokens are snake_case; a custom element tag (`<my-custom-element>`)
    // is a real, ordinary ComponentProps<'tag'> argument and carries a
    // hyphen the base_ui branch below already strips - M2: without this the
    // dom_ branch was the one place a hyphen leaked into an id grammar that
    // is snake_case everywhere else.
    return ts.isLiteralTypeNode(first) && ts.isStringLiteral(first.literal)
      ? `dom_${first.literal.text.replace(/-/g, '_')}`
      : undefined;
  }
  const symbol = checker.getSymbolAtLocation(parts.location);
  const resolved = symbol && (symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol);
  const decl = resolved?.getDeclarations()?.[0];
  if (!decl) return undefined;
  return baseUiOriginFromDeclarationFile(relativeDeclarationFile(decl.getSourceFile().fileName, kitRoot));
}

// The origin (see ComponentExtraction.passthroughOrigin) of a component's
// inherited props: the FIRST top-level heritage member that resolves to one
// (matching walkPropsType's "first found wins" rule for domTag, so the two
// never disagree about whether a component has a passthrough at all -
// resolveTopLevelMembers stops at the same six shapes walkPropsType's own
// kind detection eventually bottoms out past, which is what makes this the
// OUTERMOST resolvable reference rather than the deepest one: Accordion's
// Trigger resolves against `AccordionPrimitive.Trigger.Props` here, never
// unwrapping into the Header+Trigger composition underneath it the way
// walkPropsType's kind walk does to reach the literal 'button' tag.
export function resolvePassthroughOrigin(
  node: ts.TypeNode,
  checker: ts.TypeChecker,
  kitRoot: string,
  cannotExtract: string[],
): string | undefined {
  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-extraction:p1:inst-ex-origin
  for (const member of resolveTopLevelMembers(node, checker, new Set(), 0, cannotExtract)) {
    const parts = typeRefParts(member);
    if (!parts) continue;
    const shape = classifyHeritageReference(parts.location, checker);
    if (shape?.kind === 'variant-props') continue;
    const target = shape?.kind === 'omit-pick' && parts.args?.length ? parts.args[0] : member;
    const origin = originFromTypeRef(target, checker, kitRoot);
    if (origin) return origin;
  }
  return undefined;
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-extraction:p1:inst-ex-origin
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
function isReactWrapperCall(call: ts.CallExpression, checker: ts.TypeChecker, wrapperName: 'forwardRef' | 'memo'): boolean {
  const symbol = checker.getSymbolAtLocation(call.expression);
  if (!symbol) return false;
  const resolved = symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
  if (resolved.getName() !== wrapperName) return false;
  return declaredUnder(resolved.getDeclarations() ?? [], /[\\/]node_modules[\\/]@types[\\/]react[\\/]/);
}

// Unwraps `forwardRef(...)`/`memo(...)` call wrappers around a component
// function, straight through nesting (`memo(forwardRef((props, ref) =>
// ...))`) - M8: the initializer becomes a CallExpression instead of a
// function value, which the old arrow/function-expression-only check
// silently read as "not component-shaped," undercounting check.ts's own
// coverage report by miscounting a real, unwrapped component as one of the
// exports it intentionally skips. `forwardRef`'s render function and
// `memo`'s wrapped component are both their call's first argument - the
// only argument shape either wrapper accepts there.
function unwrapComponentInitializer(expr: ts.Expression | undefined, checker: ts.TypeChecker, depth = 0): ts.Expression | undefined {
  if (expr === undefined || depth > 4 || !ts.isCallExpression(expr)) return expr;
  if (isReactWrapperCall(expr, checker, 'forwardRef') || isReactWrapperCall(expr, checker, 'memo')) {
    return unwrapComponentInitializer(expr.arguments[0], checker, depth + 1);
  }
  return expr;
}

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

function functionBody(node: ts.FunctionDeclaration | ts.VariableDeclaration, checker: ts.TypeChecker): ts.Node | undefined {
  if (ts.isFunctionDeclaration(node)) return node.body;
  const inner = unwrapComponentInitializer(node.initializer, checker);
  if (inner && (ts.isArrowFunction(inner) || ts.isFunctionExpression(inner))) return inner.body;
  return undefined;
}

function firstParameter(
  node: ts.FunctionDeclaration | ts.VariableDeclaration,
  checker: ts.TypeChecker,
): ts.ParameterDeclaration | undefined {
  if (ts.isFunctionDeclaration(node)) return node.parameters[0];
  const inner = unwrapComponentInitializer(node.initializer, checker);
  if (inner && (ts.isArrowFunction(inner) || ts.isFunctionExpression(inner))) return inner.parameters[0];
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

// @cpt-algo:cpt-frontx-ui-kit-algo-component-contracts-extraction:p1
// @cpt-dod:cpt-frontx-ui-kit-dod-component-contracts-extraction:p1
export function extractComponent(tsxPath: string): ComponentExtraction[] {
  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-extraction:p1:inst-ex-program
  const options = loadCompilerOptions();
  const program = ts.createProgram({ rootNames: [tsxPath], options });
  const checker = program.getTypeChecker();
  const source = program.getSourceFile(tsxPath);
  if (!source) {
    throw new Error(`extract: ${tsxPath} was not found by the TypeScript program`);
  }
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-extraction:p1:inst-ex-program

  const extractions: ComponentExtraction[] = [];

  for (const statement of source.statements) {
    const candidates: (ts.FunctionDeclaration | ts.VariableDeclaration)[] = [];
    if (ts.isFunctionDeclaration(statement) && isNodeExported(statement)) {
      candidates.push(statement);
    } else if (ts.isVariableStatement(statement) && isNodeExported(statement)) {
      for (const decl of statement.declarationList.declarations) candidates.push(decl);
    }

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
      const inheritedProps: ExtractedProp[] = [];
      let passthroughKind: string | undefined;
      let passthroughOrigin: string | undefined;
      let passthroughSources: string[] = [];
      let variantSourceLabels: string[] = [];
      let axes: Record<string, string[]> = {};
      let defaults: Record<string, string> = {};

      if (param) {
        const paramType = checker.getTypeAtLocation(param);
        const walk: PropsTypeWalkResult = { kind: undefined, variantSources: [], cannotExtract: [] };
        if (param.type) {
          walkPropsType(param.type, checker, walk, new Set(), 0);
          const labels = topLevelHeritageLabels(param.type, checker, kitRoot, cannotExtract);
          passthroughSources = labels.passthroughSources;
          variantSourceLabels = labels.variantSourceLabels;
          passthroughOrigin = resolvePassthroughOrigin(param.type, checker, kitRoot, cannotExtract);
        }
        passthroughKind = walk.kind;
        cannotExtract.push(...walk.cannotExtract);

        const variantsResult = extractVariants(walk.variantSources, checker, cannotExtract);
        axes = variantsResult.axes;
        defaults = variantsResult.defaults;
        const axisNames = new Set(Object.keys(axes));

        for (const prop of checker.getPropertiesOfType(paramType)) {
          const propName = prop.getName();
          if (axisNames.has(propName)) continue;

          const declarations = prop.getDeclarations() ?? [];
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
          if (ownDeclaration) {
            ownProps.push(extracted);
          } else {
            inheritedProps.push(extracted);
          }
          // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-extraction:p1:inst-ex-props
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
      ownProps.sort(byName);
      inheritedProps.sort(byName);

      extractions.push({
        name,
        axes,
        defaults,
        ownProps,
        inheritedProps,
        passthroughKind,
        passthroughOrigin,
        passthroughSources,
        variantSourceLabels,
        cannotExtract,
      });
      // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-extraction:p1:inst-ex-return
    }
  }

  return extractions;
}

// Every top-level exported declaration name in a file, component or not -
// used only by check.ts's coverage report (T6: data-table.tsx exports
// DataTable/DataTableSortButton alongside four non-component helpers/types -
// dataTableColumnHelper, dataTableFeatures, dataTableSelectionColumn,
// DataTableSelectionColumnLabels). extractComponent already excludes these
// correctly (isReactComponentCandidate requires an uppercase, JSX-returning
// function/const; an interface or type alias is not even a value
// declaration), so coverage's "N of M" count was never wrong - what was
// missing is a way to SHOW which exports were excluded and why, rather than
// leaving a reader to wonder if 2 of 6 exports means four are undescribed
// gaps or four were never components at all.
export function listExportedDeclarationNames(tsxPath: string): string[] {
  const options = loadCompilerOptions();
  const program = ts.createProgram({ rootNames: [tsxPath], options });
  const source = program.getSourceFile(tsxPath);
  if (!source) return [];

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
