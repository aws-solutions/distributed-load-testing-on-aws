module.exports = {
  roots: ["<rootDir>/test"],
  testMatch: ["**/*.test.ts"],
  transform: {
    "^.+\\.tsx?$": "ts-jest",
  },
  maxWorkers: "50%",
  workerIdleMemoryLimit: "512MB",
  coverageReporters: ["text", "clover", "json", ["lcov", { projectRoot: "../.." }]],
};
