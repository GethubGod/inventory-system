/** @type {import('jest').Config} */
module.exports = {
  testMatch: ['**/src/__tests__/**/*.test.ts'],
  testPathIgnorePatterns: ['/node_modules/', '/\\.claude/'],
  modulePathIgnorePatterns: ['<rootDir>/.claude/'],
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
    // Untransformed ESM under ts-jest — see test-mocks/reanimatedSwipeable.tsx.
    '^react-native-gesture-handler/ReanimatedSwipeable$':
      '<rootDir>/test-mocks/reanimatedSwipeable.tsx',
  },
};
