/**
 * Top-level score dispatcher.
 *
 * Selects a model implementation based on config. The rulebook handles its
 * own clamp + calibrating cap + rate-of-change gates so score() stays a thin
 * dispatcher; future model versions can enforce the same contract without
 * duplicating logic.
 *
 * Future model versions:
 *   v1.0.0        rulebook (this file)
 *   v1.1.0 (tbd)  actuarial GLM
 *   v2.0.0 (tbd)  ML
 *
 * `score()` throws on unknown model_version to surface config drift early.
 */

import { MODEL_VERSION, rulebookV1 } from "./rulebook-v1";
import type { FeatureVector, ScoredMultiplier } from "./types";

export interface ScoreOptions {
  /** Defaults to MODEL_VERSION ("rulebook_v1.0.0"). */
  model_version?: string;
  /**
   * Optional jurisdiction treaty set. Forwarded to the rulebook for the
   * within_jurisdiction bucket. Absent ⇒ home_match / international only.
   */
  within_jurisdiction?: ReadonlySet<string>;
}

export const DEFAULT_MODEL_VERSION = MODEL_VERSION;

export function score(
  features: FeatureVector,
  opts: ScoreOptions = {},
): ScoredMultiplier {
  const version = opts.model_version ?? DEFAULT_MODEL_VERSION;

  switch (version) {
    case MODEL_VERSION:
      return rulebookV1(features, {
        ...(opts.within_jurisdiction !== undefined
          ? { within_jurisdiction: opts.within_jurisdiction }
          : {}),
      });
    default:
      throw new Error(
        `score: unknown model_version "${version}". Known: ${MODEL_VERSION}`,
      );
  }
}

export { MODEL_VERSION };
