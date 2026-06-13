/**
 * Ambient type declaration for the optional `@xenova/transformers` dependency.
 *
 * The package is NOT in `package.json` — it's an opt-in install. We use
 * `await import('@xenova/transformers')` from `local-xenova.ts` (see
 * `LocalXenovaEmbeddingProvider.getExtractor`). This shim exists only so the
 * TypeScript compiler can resolve the dynamic import without the user having
 * the package installed.
 *
 * When the user installs `@xenova/transformers`, its own types will take
 * precedence over this shim via module resolution rules.
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
