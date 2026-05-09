export default {
  preset: "ts-jest/presets/default-esm",
  testEnvironment: "node",
  extensionsToTreatAsEsm: [".ts"],
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
    "^@cognitive-substrate/core-types$": "<rootDir>/../../../packages/core-types/src/index.ts",
    "^@cognitive-substrate/kafka-bus$": "<rootDir>/../../../packages/kafka-bus/src/index.ts",
    "^@cognitive-substrate/memory-opensearch$": "<rootDir>/../../../packages/memory-opensearch/src/index.ts",
    "^@cognitive-substrate/memory-objectstore$": "<rootDir>/../../../packages/memory-objectstore/src/index.ts",
    "^@cognitive-substrate/telemetry-otel$": "<rootDir>/../../../packages/telemetry-otel/src/index.ts",
  },
  transform: {
    "^.+\\.ts$": ["ts-jest", { useESM: true, tsconfig: "./tsconfig.test.json" }],
  },
};
