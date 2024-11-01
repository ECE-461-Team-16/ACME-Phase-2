module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    collectCoverage: true,
    collectCoverageFrom: [
        "src/**/*.ts", // Collect from all TypeScript files in src/
        "!src/**/index.ts" // Optionally exclude certain files (like entry points)
    ],
    coverageDirectory: "coverage",
    coverageReporters: ["text", "lcov"],
    testMatch: ["**/__tests__/**/*.ts", "**/?(*.)+(spec|test).ts"],
    coveragePathIgnorePatterns: [
      "/node_modules/",
      "/dist/",
      "cli.ts"
    ],
    transform: {
      "^.+\\.ts$": "ts-jest"
    },
    testTimeout: 30000  // Global test timeout of 30 seconds
  };
  