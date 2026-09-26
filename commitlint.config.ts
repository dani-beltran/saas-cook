// Use squash merges with a Conventional Commit PR title. Ordinary merge/revert
// messages remain accepted by commitlint's standard default ignores.
export default {
	extends: ["@commitlint/config-conventional"],
	defaultIgnores: true,
	rules: {
		"header-max-length": [2, "always", 100],
		"subject-case": [0],
	},
};
