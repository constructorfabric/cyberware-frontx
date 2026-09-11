/**
 * Module Federation Manifest Type Definitions
 *
 * MfManifest contains package-level Module Federation 2.0 metadata shared
 * across all entries from the same MFE package. Per-module data (expose chunk
 * paths) is carried by MfeEntryMF.exposeAssets, not here.
 *
 * @packageDocumentation
 */
// @cpt-dod:cpt-frontx-dod-mfe-loading-manifest-field-discovery:p1

/**
 * Asset file lists for a module or shared dependency.
 */
export interface MfManifestAssets {
  js: {
    /** Synchronous JS chunks loaded eagerly at module evaluation time. */
    sync: string[];
    /** Asynchronous (lazy) JS chunks. */
    async: string[];
  };
  css: {
    /** Synchronous CSS files injected at mount time. */
    sync: string[];
    /** Asynchronous CSS files. */
    async: string[];
  };
}

/**
 * A single shared dependency entry from `MfManifest.shared[]`.
 * Declares a standalone ESM dependency with a resolved version and an
 * MFE-relative chunkPath to its standalone bundle.
 */
export interface MfManifestShared {
  /** npm package name (e.g. 'react', '@gears-frontx/mfes'). */
  name: string;
  /** Concrete resolved version (e.g. '19.2.4'). */
  version: string;
  /**
   * Path to the standalone ESM file for this dependency, relative to
   * the MFE's publicPath (e.g. "shared/react.js"). The handler resolves
   * this against publicPath to form the fetch URL.
   */
  chunkPath: string;
  /**
   * Named export key to unwrap the module from the chunk.
   * Null when the chunk exports the module directly (no unwrap needed).
   */
  unwrapKey: string | null;
  /**
   * Optional content hash of this entry's emitted chunk, published by the
   * producing build. When present, the runtime's cross-MFE shared-dep
   * source-text cache keys reuse on this hash rather than on name@version
   * alone, so reuse only ever happens between loads that agree on the
   * identity of the emitted build (see `cpt-frontx-adr-shared-dep-dedup-key`).
   * Absent for producing builds that have not adopted it.
   */
  contentHash?: string;
}

/**
 * RemoteEntry descriptor from `MfManifestMetaData.remoteEntry`.
 */
export interface MfManifestRemoteEntry {
  /** Filename of the remote entry (e.g. 'remoteEntry.js'). */
  name: string;
  /** Path prefix relative to publicPath. Empty string means publicPath root. */
  path: string;
  /** Module type: 'module' (ESM) or 'global' (IIFE/UMD). */
  type: string;
}

/**
 * Build information from `MfManifestMetaData.buildInfo`.
 */
export interface MfManifestBuildInfo {
  buildVersion: string;
  buildName: string;
}

/**
 * Package-level metadata from `MfManifest.metaData`.
 * Contains everything needed to locate and load remote chunks.
 */
export interface MfManifestMetaData {
  /** MFE application/library name. */
  name: string;
  /** Application type (e.g. 'app', 'lib'). */
  type: string;
  /** Build metadata. */
  buildInfo: MfManifestBuildInfo;
  /** Remote entry file descriptor. */
  remoteEntry: MfManifestRemoteEntry;
  /**
   * Global variable name used by the MF 2.0 runtime, when emitted.
   * Optional to match the `mf_manifest.v1` GTS schema, which does not
   * require this field.
   */
  globalName?: string;
  /**
   * Public URL base path for all chunk assets.
   * All relative chunk paths in shared[].assets and expose assets are
   * resolved against this value (e.g. 'http://localhost:3001/' or '/').
   */
  publicPath: string;
}

/**
 * MFE manifest — package-level metadata for an MFE package.
 *
 * Contains metaData (publicPath, remoteEntry descriptor) and shared[]
 * (standalone ESM deps with resolved versions and chunkPaths).
 *
 * Per-module expose chunk paths are stored separately on MfeEntryMF.exposeAssets.
 *
 * GTS Type: gts.frontx.mfes.mfe.mf_manifest.v1~
 */
export interface MfManifest {
  /** The GTS type ID for this manifest. */
  id: string;
  /** Human-readable MFE name, matches metaData.name. */
  name: string;
  /** Package-level metadata: publicPath, remoteEntry descriptor, etc. */
  metaData: MfManifestMetaData;
  /** Shared dependency declarations with chunk paths and unwrap keys. */
  shared: MfManifestShared[];
}
