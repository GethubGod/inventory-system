/** @type {import('jest').Config} */
module.exports = {
  testMatch: ['**/src/__tests__/**/*.test.ts'],
  testPathIgnorePatterns: ['/node_modules/', '/\\.claude/'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: {
        module: 'commonjs',
        moduleResolution: 'node',
        esModuleInterop: true,
        strict: true,
        jsx: 'react',
        allowImportingTsExtensions: true,
        paths: { '@/*': ['./src/*'] },
        baseUrl: '.',
      },
    }],
  },
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
};
