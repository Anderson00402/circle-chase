/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as admin from "../admin.js";
import type * as blocks from "../blocks.js";
import type * as clips from "../clips.js";
import type * as counters from "../counters.js";
import type * as crons from "../crons.js";
import type * as dashboard from "../dashboard.js";
import type * as exports from "../exports.js";
import type * as http from "../http.js";
import type * as lib_compare from "../lib/compare.js";
import type * as lib_digest from "../lib/digest.js";
import type * as lib_filters from "../lib/filters.js";
import type * as lib_pack from "../lib/pack.js";
import type * as lib_rules from "../lib/rules.js";
import type * as lib_series from "../lib/series.js";
import type * as lib_stats from "../lib/stats.js";
import type * as live from "../live.js";
import type * as migrations from "../migrations.js";
import type * as participants from "../participants.js";
import type * as presence from "../presence.js";
import type * as ratings from "../ratings.js";
import type * as replays from "../replays.js";
import type * as runs from "../runs.js";
import type * as sessions from "../sessions.js";
import type * as sim from "../sim.js";
import type * as summary from "../summary.js";
import type * as trials from "../trials.js";
import type * as validators from "../validators.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  admin: typeof admin;
  blocks: typeof blocks;
  clips: typeof clips;
  counters: typeof counters;
  crons: typeof crons;
  dashboard: typeof dashboard;
  exports: typeof exports;
  http: typeof http;
  "lib/compare": typeof lib_compare;
  "lib/digest": typeof lib_digest;
  "lib/filters": typeof lib_filters;
  "lib/pack": typeof lib_pack;
  "lib/rules": typeof lib_rules;
  "lib/series": typeof lib_series;
  "lib/stats": typeof lib_stats;
  live: typeof live;
  migrations: typeof migrations;
  participants: typeof participants;
  presence: typeof presence;
  ratings: typeof ratings;
  replays: typeof replays;
  runs: typeof runs;
  sessions: typeof sessions;
  sim: typeof sim;
  summary: typeof summary;
  trials: typeof trials;
  validators: typeof validators;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
