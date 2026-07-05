/** @type {import('jest').Config} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/src"],
  testMatch: ["**/__tests__/**/*.test.ts"],
  transform: {
    "^.+\\.ts$": ["ts-jest", {
      tsconfig: {
        module: "CommonJS",
        moduleResolution: "Node",
      },
    }],
  },
  moduleFileExtensions: ["ts", "js", "json"],
  clearMocks: true,
  testTimeout: 15000,
};
