module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  testMatch: ["**/*.test.ts", "**/*.spec.ts"],
  testPathIgnorePatterns: ["/node_modules/", "/dist/"],
  testTimeout: 60000, // 60s — up to 10 attempts × 1.1s each per test
  forceExit: true
};