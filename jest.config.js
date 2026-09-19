/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  moduleNameMapper: {
    '\\.(css|less|scss|sass)$': '<rootDir>/src/__tests__/__mocks__/styleMock.js',
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  testMatch: ['**/src/__tests__/**/*.test.ts'],
};
