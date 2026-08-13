"use strict";

/**
 * Architectural dependency rules for the Nx + pnpm workspace.
 * Run from the repository root:
 *   pnpm exec depcruise apps packages --config .dependency-cruiser.cjs --output-type err
 *
 * @type {import("dependency-cruiser").IConfiguration}
 */

const WORKSPACE_SOURCE = "^(?:apps|packages)/";
const WEB_BFF = "^apps/web-bff/src/";
const CONTEXT_SERVICE = "^apps/context-service/src/";
const GENERATION_SERVICE = "^apps/generation-service/src/";
const GENERATION_CORE =
  "^apps/generation-service/src/(?:application|ports)/";
const DOMAIN = "^packages/domain/src/";

const EXTERNAL_DEPENDENCY_TYPES = [
  "npm",
  "npm-bundled",
  "npm-dev",
  "npm-no-pkg",
  "npm-optional",
  "npm-peer",
  "npm-unknown",
];

const NODE_IO =
  "^(?:node:)?(?:fs(?:/promises)?|net|http|https|http2|tls|dns|dgram|child_process|cluster)(?:$|/)";

const DB_DRIVERS =
  "(?:^|/)node_modules/(?:@prisma/client|prisma|pg|postgres|knex|kysely|mysql2|better-sqlite3)(?:/|$)";

const CONFIG_CLIENTS =
  "(?:^|/)node_modules/(?:@aws-sdk/client-(?:appconfig|appconfigdata|ssm|secrets-manager)|@azure/app-configuration|@google-cloud/secret-manager|node-vault|hashi-vault-js)(?:/|$)";

const CONTROL_PLANE_READERS =
  "^(?:apps/context-service/|packages/db/src/(?:control-plane|generated/control-plane)/)";

module.exports = {
  forbidden: [
    {
      name: "not-to-unresolvable",
      severity: "error",
      from: { path: WORKSPACE_SOURCE },
      to: { couldNotResolve: true },
    },
    {
      name: "no-circular",
      severity: "error",
      from: { path: WORKSPACE_SOURCE },
      to: { path: WORKSPACE_SOURCE, circular: true },
    },
    {
      name: "no-cross-deployable-imports",
      severity: "error",
      from: { path: "^apps/([^/]+)/src/" },
      to: {
        path: "^apps/",
        pathNot: "^apps/$1/",
      },
    },
    {
      name: "packages-never-import-deployables",
      severity: "error",
      from: { path: "^packages/" },
      to: { path: "^apps/" },
    },

    // packages/domain is a closed, in-process module. Tests may have test-only
    // dependencies; production source may import only other domain source files.
    {
      name: "domain-no-workspace-dependencies",
      severity: "error",
      from: { path: DOMAIN },
      to: {
        path: WORKSPACE_SOURCE,
        pathNot: "^packages/domain/",
      },
    },
    {
      name: "domain-never-imports-db-or-llm",
      severity: "error",
      from: { path: DOMAIN },
      to: { path: "^packages/(?:db|llm)/" },
    },
    {
      name: "domain-no-node-builtins",
      severity: "error",
      from: { path: DOMAIN },
      to: { dependencyTypes: ["core"] },
    },
    {
      name: "domain-no-external-dependencies",
      severity: "error",
      from: { path: DOMAIN },
      to: { dependencyTypes: EXTERNAL_DEPENDENCY_TYPES },
    },

    // The BFF crosses owned remote seams through its own HTTP adapters. It has
    // no direct or transitive path to database implementation.
    {
      name: "web-bff-cannot-reach-db",
      severity: "error",
      from: { path: WEB_BFF },
      to: {
        path: "^packages/db/",
        reachable: true,
      },
    },
    {
      name: "web-bff-no-database-drivers",
      severity: "error",
      from: { path: WEB_BFF },
      to: { path: DB_DRIVERS, reachable: true },
    },

    // Configuration is a required value at the generation interface. The
    // execution plane cannot reach the context deployable or its storage adapter.
    {
      name: "generation-cannot-reach-context-service",
      severity: "error",
      from: { path: GENERATION_SERVICE },
      to: {
        path: "^apps/context-service/",
        reachable: true,
      },
    },
    {
      name: "generation-cannot-reach-control-plane-readers",
      severity: "error",
      from: { path: GENERATION_SERVICE },
      to: {
        path: CONTROL_PLANE_READERS,
        reachable: true,
      },
    },
    {
      name: "generation-cannot-reach-context-client-contracts",
      severity: "error",
      from: { path: GENERATION_SERVICE },
      to: {
        path: "^packages/contracts/src/context/",
        reachable: true,
      },
    },
    {
      name: "generation-db-imports-execution-plane-only",
      severity: "error",
      from: { path: GENERATION_SERVICE },
      to: {
        path: "^packages/db/src/",
        pathNot: "^packages/db/src/execution-plane/",
      },
    },
    {
      name: "generation-no-direct-db-or-config-clients",
      severity: "error",
      from: { path: GENERATION_SERVICE },
      to: {
        path: [DB_DRIVERS, CONFIG_CLIENTS],
        reachable: true,
      },
    },
    {
      name: "generation-no-direct-node-io",
      severity: "error",
      from: { path: GENERATION_SERVICE },
      to: {
        path: NODE_IO,
        dependencyTypes: ["core"],
      },
    },
    {
      name: "generation-core-no-io-dependencies",
      severity: "error",
      from: { path: GENERATION_CORE },
      to: {
        pathNot:
          "^(?:apps/generation-service/src/(?:application|ports)/|packages/domain/src/)",
      },
    },
    {
      name: "generation-core-no-external-runtime-dependencies",
      severity: "error",
      from: { path: GENERATION_CORE },
      to: {
        dependencyTypes: ["core", ...EXTERNAL_DEPENDENCY_TYPES],
      },
    },

    // Context and Generation use different database entry points, generated
    // clients, and runtime roles. Neither adapter module can reach the other.
    {
      name: "context-db-imports-control-plane-only",
      severity: "error",
      from: { path: CONTEXT_SERVICE },
      to: {
        path: "^packages/db/src/",
        pathNot: "^packages/db/src/control-plane/",
      },
    },
    {
      name: "db-execution-plane-cannot-reach-control-plane",
      severity: "error",
      from: { path: "^packages/db/src/execution-plane/" },
      to: {
        path: "^packages/db/src/(?:control-plane|generated/control-plane)/",
        reachable: true,
      },
    },
    {
      name: "db-control-plane-cannot-reach-execution-plane",
      severity: "error",
      from: { path: "^packages/db/src/control-plane/" },
      to: {
        path: "^packages/db/src/(?:execution-plane|generated/execution-plane)/",
        reachable: true,
      },
    },
    {
      name: "db-common-cannot-reach-role-adapters",
      severity: "error",
      from: { path: "^packages/db/src/(?:common|internal/common)/" },
      to: {
        path: "^packages/db/src/(?:control-plane|execution-plane|generated)/",
        reachable: true,
      },
    },
    {
      name: "no-db-root-or-internal-imports",
      severity: "error",
      from: { path: "^(?:apps|packages)/(?!db/)" },
      to: {
        path: "^packages/db/src/(?:index\\.[cm]?[jt]sx?|common/|internal/)",
      },
    },

    // Complete direct workspace allow-lists. Adding a seventh package does not
    // silently make it reachable from every deployable.
    {
      name: "web-bff-workspace-dependencies",
      severity: "error",
      from: { path: WEB_BFF },
      to: {
        path: WORKSPACE_SOURCE,
        pathNot:
          "^(?:apps/web-bff/|packages/(?:domain|contracts|observability)/)",
      },
    },
    {
      name: "context-service-workspace-dependencies",
      severity: "error",
      from: { path: CONTEXT_SERVICE },
      to: {
        path: WORKSPACE_SOURCE,
        pathNot:
          "^(?:apps/context-service/|packages/(?:domain|contracts|db|observability)/)",
      },
    },
    {
      name: "generation-service-workspace-dependencies",
      severity: "error",
      from: { path: GENERATION_SERVICE },
      to: {
        path: WORKSPACE_SOURCE,
        pathNot:
          "^(?:apps/generation-service/|packages/(?:domain|contracts|llm|db|observability)/)",
      },
    },
    {
      name: "contracts-workspace-dependencies",
      severity: "error",
      from: { path: "^packages/contracts/src/" },
      to: {
        path: WORKSPACE_SOURCE,
        pathNot: "^packages/contracts/",
      },
    },
    {
      name: "llm-workspace-dependencies",
      severity: "error",
      from: { path: "^packages/llm/src/" },
      to: {
        path: WORKSPACE_SOURCE,
        pathNot: "^packages/(?:llm|domain)/",
      },
    },
    {
      name: "db-workspace-dependencies",
      severity: "error",
      from: { path: "^packages/db/src/" },
      to: {
        path: WORKSPACE_SOURCE,
        pathNot: "^packages/(?:db|domain)/",
      },
    },
    {
      name: "observability-workspace-dependencies",
      severity: "error",
      from: { path: "^packages/observability/src/" },
      to: {
        path: WORKSPACE_SOURCE,
        pathNot: "^packages/observability/",
      },
    },

    // ADR-004 rejects this candidate package. Review Formats are versioned data,
    // not executable plugins.
    {
      name: "no-plugins-package-imports",
      severity: "error",
      from: { path: WORKSPACE_SOURCE },
      to: { path: "^packages/plugins/" },
    },
  ],

  required: [
    {
      name: "generation-handler-validates-wire-request",
      severity: "error",
      module: {
        path: "^apps/generation-service/src/transport/http/generate-handler\\.ts$",
      },
      to: {
        path: "^packages/contracts/src/generation/generation-request\\.ts$",
        reachable: true,
      },
    },
    {
      name: "generation-execute-depends-on-effective-config-snapshot",
      severity: "error",
      module: {
        path: "^apps/generation-service/src/application/execute-generation\\.ts$",
      },
      to: {
        path: "^packages/domain/src/configuration/effective-configuration-snapshot\\.ts$",
        reachable: true,
      },
    },
  ],

  options: {
    tsConfig: {
      fileName: "tsconfig.base.json",
    },
    tsPreCompilationDeps: "specify",
    detectProcessBuiltinModuleCalls: true,
    doNotFollow: {
      dependencyTypes: EXTERNAL_DEPENDENCY_TYPES,
    },
    exclude: {
      path: "^(?:dist|coverage|\\.nx)/|/(?:dist|coverage)/",
    },
    skipAnalysisNotInRules: true,
  },
};
