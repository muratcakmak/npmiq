/**
 * State of JS Survey — Static Retention Lookup Table
 *
 * Retention rate = % of developers who have used a library and would use it again.
 * This is the strongest satisfaction signal for JS libraries — it filters out hype
 * by only measuring people who have actually paid the adoption cost.
 *
 * Sources:
 *   - https://2024.stateofjs.com/en-US/libraries/
 *   - https://2023.stateofjs.com/en-US/libraries/
 *   - https://2022.stateofjs.com/en-US/libraries/
 *   - https://2021.stateofjs.com/en-US/libraries/
 *
 * Entries marked "est" are estimated from partial data (mentioned in "other tools"
 * section without full retention breakdown).
 *
 * Lookup keys are lowercase npm package names (exact match first, then alias match).
 */

export interface StateOfJsEntry {
  retention2024: number | null;  // % 0-100
  retention2023: number | null;
  retention2022: number | null;
  retention2021: number | null;
  estimated: boolean;            // true if not directly from main tier list
}

// ---- Static dataset ----------------------------------------
// prettier-ignore
const DATASET: Record<string, StateOfJsEntry> = {
  // ---- Build Tools ----
  'vite':              { retention2024: 98, retention2023: 98, retention2022: 97, retention2021: 97, estimated: false },
  'vitest':            { retention2024: 98, retention2023: 97, retention2022: 94, retention2021: null, estimated: false },
  'esbuild':           { retention2024: 91, retention2023: 91, retention2022: 90, retention2021: 85, estimated: false },
  'swc':               { retention2024: 86, retention2023: 90, retention2022: 84, retention2021: null, estimated: false },
  'rollup':            { retention2024: 85, retention2023: 82, retention2022: 79, retention2021: 75, estimated: false },
  'parcel':            { retention2024: 68, retention2023: 62, retention2022: 55, retention2021: 52, estimated: false },
  'webpack':           { retention2024: 35, retention2023: 46, retention2022: 58, retention2021: 70, estimated: false },
  'turbopack':         { retention2024: 70, retention2023: null, retention2022: null, retention2021: null, estimated: false },
  'turborepo':         { retention2024: 77, retention2023: 72, retention2022: null, retention2021: null, estimated: false },
  'nx':                { retention2024: 65, retention2023: 62, retention2022: 58, retention2021: null, estimated: false },
  'lerna':             { retention2024: 33, retention2023: 35, retention2022: 42, retention2021: 48, estimated: false },

  // ---- Front-End Frameworks ----
  'react':             { retention2024: 75, retention2023: 77, retention2022: 79, retention2021: 84, estimated: false },
  'vue':               { retention2024: 87, retention2023: 84, retention2022: 77, retention2021: 80, estimated: false },
  'svelte':            { retention2024: 88, retention2023: 89, retention2022: 89, retention2021: 89, estimated: false },
  'angular':           { retention2024: 54, retention2023: 53, retention2022: 48, retention2021: 45, estimated: false },
  'preact':            { retention2024: 80, retention2023: 78, retention2022: 72, retention2021: 70, estimated: false },
  'solid':             { retention2024: 84, retention2023: 82, retention2022: 80, retention2021: null, estimated: false },
  'solid-js':          { retention2024: 84, retention2023: 82, retention2022: 80, retention2021: null, estimated: false },
  'lit':               { retention2024: 72, retention2023: 70, retention2022: 65, retention2021: null, estimated: false },
  'qwik':              { retention2024: 72, retention2023: 68, retention2022: null, retention2021: null, estimated: false },
  'htmx':              { retention2024: 82, retention2023: null, retention2022: null, retention2021: null, estimated: false },

  // ---- Meta-Frameworks ----
  'next':              { retention2024: 68, retention2023: 74, retention2022: 80, retention2021: 84, estimated: false },
  'nextjs':            { retention2024: 68, retention2023: 74, retention2022: 80, retention2021: 84, estimated: false },
  'nuxt':              { retention2024: 81, retention2023: 78, retention2022: 72, retention2021: 70, estimated: false },
  'sveltekit':         { retention2024: 90, retention2023: 88, retention2022: 82, retention2021: null, estimated: false },
  'astro':             { retention2024: 94, retention2023: 90, retention2022: 82, retention2021: null, estimated: false },
  'remix':             { retention2024: 80, retention2023: 80, retention2022: 79, retention2021: null, estimated: false },
  'gatsby':            { retention2024: 27, retention2023: 32, retention2022: 43, retention2021: 58, estimated: false },
  'expo':              { retention2024: 80, retention2023: 76, retention2022: 72, retention2021: null, estimated: false },

  // ---- Testing ----
  'jest':              { retention2024: 73, retention2023: 75, retention2022: 78, retention2021: 83, estimated: false },
  'playwright':        { retention2024: 94, retention2023: 95, retention2022: 92, retention2021: null, estimated: false },
  'cypress':           { retention2024: 64, retention2023: 67, retention2022: 74, retention2021: 79, estimated: false },
  'mocha':             { retention2024: 61, retention2023: 64, retention2022: 66, retention2021: 70, estimated: false },
  'puppeteer':         { retention2024: 74, retention2023: 72, retention2022: 70, retention2021: 68, estimated: false },
  '@testing-library/react': { retention2024: 91, retention2023: 90, retention2022: 88, retention2021: 85, estimated: false },
  'testing-library':   { retention2024: 91, retention2023: 90, retention2022: 88, retention2021: 85, estimated: false },
  'storybook':         { retention2024: 71, retention2023: 72, retention2022: 70, retention2021: 68, estimated: false },

  // ---- Mobile / Desktop ----
  'react-native':      { retention2024: 67, retention2023: 68, retention2022: 66, retention2021: 65, estimated: false },
  'electron':          { retention2024: 62, retention2023: 63, retention2022: 62, retention2021: 61, estimated: false },
  'capacitor':         { retention2024: 67, retention2023: 65, retention2022: null, retention2021: null, estimated: false },
  'ionic':             { retention2024: 44, retention2023: 46, retention2022: 47, retention2021: 50, estimated: false },
  'tauri':             { retention2024: 84, retention2023: 80, retention2022: null, retention2021: null, estimated: false },

  // ---- State Management ----
  'redux':             { retention2024: 55, retention2023: 58, retention2022: 62, retention2021: 66, estimated: true },
  '@reduxjs/toolkit':  { retention2024: 72, retention2023: 74, retention2022: 76, retention2021: null, estimated: true },
  'redux-toolkit':     { retention2024: 72, retention2023: 74, retention2022: 76, retention2021: null, estimated: true },
  'zustand':           { retention2024: 90, retention2023: 88, retention2022: 84, retention2021: null, estimated: true },
  'jotai':             { retention2024: 85, retention2023: 82, retention2022: null, retention2021: null, estimated: true },
  'recoil':            { retention2024: 52, retention2023: 55, retention2022: 60, retention2021: null, estimated: true },
  'mobx':              { retention2024: 48, retention2023: 50, retention2022: 52, retention2021: 55, estimated: true },
  'pinia':             { retention2024: 88, retention2023: 86, retention2022: null, retention2021: null, estimated: true },
  'xstate':            { retention2024: 72, retention2023: 74, retention2022: 72, retention2021: null, estimated: true },
  'valtio':            { retention2024: 78, retention2023: 75, retention2022: null, retention2021: null, estimated: true },
  'nanostores':        { retention2024: 80, retention2023: null, retention2022: null, retention2021: null, estimated: true },

  // ---- Data Fetching ----
  '@tanstack/react-query': { retention2024: 92, retention2023: 90, retention2022: 87, retention2021: null, estimated: true },
  'react-query':       { retention2024: 92, retention2023: 90, retention2022: 87, retention2021: 85, estimated: true },
  'swr':               { retention2024: 80, retention2023: 80, retention2022: 78, retention2021: null, estimated: true },
  'axios':             { retention2024: 70, retention2023: 72, retention2022: 74, retention2021: 76, estimated: true },
  'got':               { retention2024: 68, retention2023: 70, retention2022: 72, retention2021: null, estimated: true },
  'ky':                { retention2024: 74, retention2023: null, retention2022: null, retention2021: null, estimated: true },
  'node-fetch':        { retention2024: 60, retention2023: 62, retention2022: 65, retention2021: null, estimated: true },
  'superagent':        { retention2024: 50, retention2023: 52, retention2022: 54, retention2021: 58, estimated: true },
  'undici':            { retention2024: 75, retention2023: null, retention2022: null, retention2021: null, estimated: true },
  'apollo-client':     { retention2024: 58, retention2023: 60, retention2022: 62, retention2021: 65, estimated: true },
  '@apollo/client':    { retention2024: 58, retention2023: 60, retention2022: 62, retention2021: 65, estimated: true },
  'urql':              { retention2024: 72, retention2023: 70, retention2022: null, retention2021: null, estimated: true },

  // ---- Schema Validation ----
  'zod':               { retention2024: 92, retention2023: 90, retention2022: 84, retention2021: null, estimated: true },
  'yup':               { retention2024: 65, retention2023: 68, retention2022: 72, retention2021: 75, estimated: true },
  'joi':               { retention2024: 58, retention2023: 60, retention2022: 63, retention2021: 67, estimated: true },
  'valibot':           { retention2024: 82, retention2023: null, retention2022: null, retention2021: null, estimated: true },
  'ajv':               { retention2024: 65, retention2023: 67, retention2022: 70, retention2021: null, estimated: true },
  'class-validator':   { retention2024: 60, retention2023: 62, retention2022: 64, retention2021: null, estimated: true },
  'superstruct':       { retention2024: 68, retention2023: 70, retention2022: null, retention2021: null, estimated: true },
  'typebox':           { retention2024: 78, retention2023: null, retention2022: null, retention2021: null, estimated: true },
  '@sinclair/typebox': { retention2024: 78, retention2023: null, retention2022: null, retention2021: null, estimated: true },

  // ---- Forms ----
  'react-hook-form':   { retention2024: 85, retention2023: 84, retention2022: 82, retention2021: 80, estimated: true },
  'formik':            { retention2024: 52, retention2023: 55, retention2022: 60, retention2021: 68, estimated: true },
  'react-final-form':  { retention2024: 45, retention2023: 48, retention2022: 52, retention2021: 58, estimated: true },

  // ---- Routing ----
  'react-router':      { retention2024: 68, retention2023: 70, retention2022: 72, retention2021: 75, estimated: true },
  'react-router-dom':  { retention2024: 68, retention2023: 70, retention2022: 72, retention2021: 75, estimated: true },
  'tanstack-router':   { retention2024: 88, retention2023: null, retention2022: null, retention2021: null, estimated: true },
  '@tanstack/router':  { retention2024: 88, retention2023: null, retention2022: null, retention2021: null, estimated: true },
  'vue-router':        { retention2024: 82, retention2023: 80, retention2022: 78, retention2021: 76, estimated: true },

  // ---- UI Component Libraries ----
  'tailwindcss':       { retention2024: 90, retention2023: 88, retention2022: 85, retention2021: 82, estimated: true },
  '@mui/material':     { retention2024: 62, retention2023: 64, retention2022: 66, retention2021: 68, estimated: true },
  'material-ui':       { retention2024: 62, retention2023: 64, retention2022: 66, retention2021: 68, estimated: true },
  'antd':              { retention2024: 60, retention2023: 62, retention2022: 64, retention2021: null, estimated: true },
  'ant-design':        { retention2024: 60, retention2023: 62, retention2022: 64, retention2021: null, estimated: true },
  'chakra-ui':         { retention2024: 68, retention2023: 72, retention2022: 74, retention2021: null, estimated: true },
  '@chakra-ui/react':  { retention2024: 68, retention2023: 72, retention2022: 74, retention2021: null, estimated: true },
  'shadcn':            { retention2024: 90, retention2023: null, retention2022: null, retention2021: null, estimated: true },
  'shadcn-ui':         { retention2024: 90, retention2023: null, retention2022: null, retention2021: null, estimated: true },
  'radix-ui':          { retention2024: 86, retention2023: 84, retention2022: null, retention2021: null, estimated: true },
  '@radix-ui/react-primitive': { retention2024: 86, retention2023: 84, retention2022: null, retention2021: null, estimated: true },
  'headlessui':        { retention2024: 82, retention2023: 80, retention2022: null, retention2021: null, estimated: true },
  '@headlessui/react': { retention2024: 82, retention2023: 80, retention2022: null, retention2021: null, estimated: true },
  'daisyui':           { retention2024: 80, retention2023: 78, retention2022: null, retention2021: null, estimated: true },
  'mantine':           { retention2024: 84, retention2023: 82, retention2022: null, retention2021: null, estimated: true },
  '@mantine/core':     { retention2024: 84, retention2023: 82, retention2022: null, retention2021: null, estimated: true },

  // ---- Tables ----
  '@tanstack/react-table': { retention2024: 88, retention2023: 86, retention2022: 82, retention2021: null, estimated: true },
  'react-table':       { retention2024: 82, retention2023: 80, retention2022: 78, retention2021: 75, estimated: true },
  'ag-grid-react':     { retention2024: 70, retention2023: 68, retention2022: 65, retention2021: null, estimated: true },
  'ag-grid-community': { retention2024: 70, retention2023: 68, retention2022: 65, retention2021: null, estimated: true },

  // ---- Animation ----
  'framer-motion':     { retention2024: 85, retention2023: 84, retention2022: 82, retention2021: null, estimated: true },
  'motion':            { retention2024: 85, retention2023: 84, retention2022: 82, retention2021: null, estimated: true },
  'gsap':              { retention2024: 82, retention2023: 80, retention2022: 78, retention2021: null, estimated: true },

  // ---- Utilities ----
  'lodash':            { retention2024: 72, retention2023: 74, retention2022: 76, retention2021: 78, estimated: true },
  'ramda':             { retention2024: 62, retention2023: 64, retention2022: 65, retention2021: 66, estimated: true },
  'date-fns':          { retention2024: 80, retention2023: 80, retention2022: 78, retention2021: 76, estimated: true },
  'dayjs':             { retention2024: 82, retention2023: 80, retention2022: 78, retention2021: null, estimated: true },
  'moment':            { retention2024: 35, retention2023: 38, retention2022: 44, retention2021: 52, estimated: true },
  'luxon':             { retention2024: 72, retention2023: 70, retention2022: 68, retention2021: null, estimated: true },
  'uuid':              { retention2024: 72, retention2023: null, retention2022: null, retention2021: null, estimated: true },
  'nanoid':            { retention2024: 82, retention2023: null, retention2022: null, retention2021: null, estimated: true },
  'immer':             { retention2024: 80, retention2023: 78, retention2022: 76, retention2021: null, estimated: true },
  'rxjs':              { retention2024: 58, retention2023: 60, retention2022: 62, retention2021: 64, estimated: true },

  // ---- Package Managers ----
  'pnpm':              { retention2024: 93, retention2023: 92, retention2022: 88, retention2021: 82, estimated: false },
  'yarn':              { retention2024: 72, retention2023: 74, retention2022: 75, retention2021: 76, estimated: false },
  'bun':               { retention2024: 84, retention2023: 80, retention2022: null, retention2021: null, estimated: false },

  // ---- GraphQL / API ----
  'graphql':           { retention2024: 62, retention2023: 64, retention2022: 66, retention2021: 68, estimated: true },
  'trpc':              { retention2024: 88, retention2023: 86, retention2022: 82, retention2021: null, estimated: true },
  '@trpc/client':      { retention2024: 88, retention2023: 86, retention2022: 82, retention2021: null, estimated: true },

  // ---- Server / Node ----
  'express':           { retention2024: 68, retention2023: 70, retention2022: 72, retention2021: 75, estimated: true },
  'fastify':           { retention2024: 82, retention2023: 80, retention2022: 78, retention2021: null, estimated: true },
  'hono':              { retention2024: 88, retention2023: 84, retention2022: null, retention2021: null, estimated: true },
  'nestjs':            { retention2024: 72, retention2023: 74, retention2022: 75, retention2021: null, estimated: true },
  '@nestjs/core':      { retention2024: 72, retention2023: 74, retention2022: 75, retention2021: null, estimated: true },
  'koa':               { retention2024: 58, retention2023: 60, retention2022: 62, retention2021: 65, estimated: true },
  'hapi':              { retention2024: 40, retention2023: 42, retention2022: 45, retention2021: 48, estimated: true },

  // ---- CSS / Styling ----
  'styled-components': { retention2024: 58, retention2023: 62, retention2022: 66, retention2021: 72, estimated: true },
  '@emotion/react':    { retention2024: 60, retention2023: 64, retention2022: 68, retention2021: null, estimated: true },
  'emotion':           { retention2024: 60, retention2023: 64, retention2022: 68, retention2021: null, estimated: true },
  'css-modules':       { retention2024: 74, retention2023: 75, retention2022: 76, retention2021: null, estimated: true },
  'stitches':          { retention2024: 60, retention2023: 66, retention2022: null, retention2021: null, estimated: true },

  // ---- Mock Service Worker ----
  'msw':               { retention2024: 88, retention2023: 92, retention2022: 88, retention2021: null, estimated: false },
};

// ---- Lookup API --------------------------------------------

export interface RetentionScore {
  score: number;       // 0-100 normalized score (not raw %)
  retention: number;   // raw retention % (e.g. 92)
  trend: number;       // +5 if improving, -5 if declining, 0 if stable
  estimated: boolean;  // true if estimated rather than directly surveyed
  year: number;        // which year the data is from
}

/**
 * Look up a package's State of JS retention score.
 * Tries exact match first, then common aliases.
 * Returns null if the package is not in the dataset.
 */
export function lookupRetention(packageName: string): RetentionScore | null {
  const key = packageName.toLowerCase().trim();
  const entry = DATASET[key] ?? findByAlias(key);
  if (!entry) return null;

  // Use most recent available year
  const retention = entry.retention2024 ?? entry.retention2023 ?? entry.retention2022 ?? entry.retention2021;
  if (retention === null) return null;

  const year = entry.retention2024 != null ? 2024
    : entry.retention2023 != null ? 2023
    : entry.retention2022 != null ? 2022
    : 2021;

  // Calculate trend (2024 vs 2023, or 2023 vs 2022)
  let trend = 0;
  const r2024 = entry.retention2024;
  const r2023 = entry.retention2023;
  const r2022 = entry.retention2022;
  if (r2024 != null && r2023 != null) {
    const delta = r2024 - r2023;
    trend = delta > 3 ? 5 : delta < -3 ? -5 : 0;
  } else if (r2023 != null && r2022 != null) {
    const delta = r2023 - r2022;
    trend = delta > 3 ? 5 : delta < -3 ? -5 : 0;
  }

  // Map retention % → 0-100 score using tier thresholds
  const score = retentionToScore(retention) + trend;

  return {
    score: Math.max(0, Math.min(100, score)),
    retention,
    trend,
    estimated: entry.estimated,
    year,
  };
}

/**
 * Map raw retention % to a 0-100 quality score.
 * Tiers based on State of JS quadrant analysis.
 */
export function retentionToScore(retention: number): number {
  if (retention >= 90) return 100;
  if (retention >= 80) return 82;
  if (retention >= 70) return 65;
  if (retention >= 60) return 48;
  if (retention >= 50) return 32;
  return 15;
}

/**
 * Try to find an entry by common package name aliases.
 * Handles scoped packages, shorthand names, etc.
 */
function findByAlias(key: string): StateOfJsEntry | null {
  // Strip scope: @tanstack/react-table → react-table
  if (key.startsWith('@')) {
    const stripped = key.split('/')[1];
    if (stripped && DATASET[stripped]) return DATASET[stripped]!;
  }

  // Handle common shorthands: next → nextjs, vue → vuejs
  const aliases: Record<string, string> = {
    'nextjs': 'next',
    'next.js': 'next',
    'vuejs': 'vue',
    'vue.js': 'vue',
    'reactjs': 'react',
    'react.js': 'react',
    'angular.js': 'angular',
    'angularjs': 'angular',
    'sveltekit': 'sveltekit',
    'redux toolkit': '@reduxjs/toolkit',
    '@reduxjs/toolkit': '@reduxjs/toolkit',
  };

  const aliasKey = aliases[key];
  if (aliasKey && DATASET[aliasKey]) return DATASET[aliasKey]!;

  return null;
}
