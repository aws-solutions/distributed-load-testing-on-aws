module.exports = {
  roots: ["<rootDir>/test"],
  testMatch: ["**/*.test.ts"],
  transform: {
    "^.+\\.tsx?$": "ts-jest",
  },
  coverageReporters: ["text", "clover", "json", ["lcov", { projectRoot: "../.." }]],
};
