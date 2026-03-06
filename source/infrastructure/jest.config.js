module.exports = {
  roots: ["<rootDir>/test"],
  testMatch: ["**/*.test.ts"],
  transform: {
    "^.+\\.tsx?$": "ts-jest",
  },
  maxWorkers: "50%",
  coverageReporters: ["text", "clover", "json", ["lcov", { projectRoot: "../.." }]],
};
