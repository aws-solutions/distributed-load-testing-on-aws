module.exports = {
    roots: ['<rootDir>/lib'],
    testMatch: ['**/*.spec.js'],
    collectCoverageFrom: [
        '**/*.js'
    ],
    coverageReporters: [
        "text",
        "clover",
        "json",
        ["lcov", { "projectRoot": "../../" }]
    ]
};