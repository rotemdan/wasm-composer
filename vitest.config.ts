import { defineConfig, configDefaults } from 'vitest/config'

export default defineConfig({
	test: {
		reporters: ['default'],
		disableConsoleIntercept: false,

		exclude: [
			...configDefaults.exclude,
			'**/node_modules/**',
			'**/dist/**',
		],
	},
})
