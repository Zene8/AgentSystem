# Coding Standards

## Language-Agnostic
- Keep files focused (one responsibility per file).
- Default to no comments; add only when WHY is non-obvious.
- Use linting tools: enforce via git hooks.
- Test coverage: minimum 80% for new features.

## Naming
- Functions/methods: camelCase (JavaScript), snake_case (Python/Go)
- Constants: SCREAMING_SNAKE_CASE
- Files: match primary export name

## Testing
- Test behavior, not implementation.
- Test structure: Arrange → Act → Assert
- Async tests: explicit done() or return Promise

## Code Review
- Approve only if you'd deploy this confidently.
- Flag: hardcoded values, missing tests, security issues.
- No style nits unless they change meaning.
