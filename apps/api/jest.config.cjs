module.exports = {
  rootDir: __dirname,
  testRegex: '.*\\.spec\\.ts$',
  transform: { '^.+\\.tsx?$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }] },
  moduleNameMapper: {
    '^@myvoice/config$': '<rootDir>/../../packages/config/src/index.ts',
    '^@myvoice/shared$': '<rootDir>/../../packages/shared/src/index.ts'
  },
  collectCoverageFrom: ['src/**/*.ts', '!src/main.ts', '!src/worker.ts']
};
