export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [
      2,
      'always',
      [
        'feat',
        'fix',
        'docs',
        'refactor',
        'test',
        'perf',
        'build',
        'ci',
        'style',
        'chore',
        'revert',
      ],
    ],
    'scope-empty': [0],
    'scope-case': [2, 'always', 'lower-case'],
  },
}
