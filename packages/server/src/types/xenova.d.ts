/**
 * Ambient type declaration for the `@xenova/transformers` dependency.
 *
 * The package is in `packages/server/package.json` `optionalDependencies` and
 * ships prebuilt onnxruntime-node binaries (no node-gyp compile). It powers the
 * default `local-xenova` embedding provider. We use
 * `await import('@xenova/transformers')` from `local-xenova.ts` (see
 * `LocalXenovaEmbeddingProvider.getExtractor`). This shim exists only so the
 * TypeScript compiler can resolve the dynamic import without the package
 * installed; when it IS installed, its own types take precedence via module
 * resolution rules.
 */
declare module '@xenova/transformers' {
  // Minimal shape we actually use. The real package has richer types but
  // we keep this narrow so any version the user installs is acceptable.
  export interface FeatureExtractionPipeline {
    (text: string | string[], options: Record<string, unknown>): Promise<{
      data: ArrayLike<number> | Float32Array;
    }>;
  }
  export function pipeline(task: 'feature-extraction', model: string): Promise<FeatureExtractionPipeline>;
  // Default export shape for older / newer module formats.
  const _default: { pipeline: typeof pipeline };
  export default _default;
}
