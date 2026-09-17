# Coding style

Keep the flow visible. Someone reading a file should be able to follow the work from top to bottom without stepping through layers of helpers.

These conventions apply to new TypeScript and JavaScript in velora, including tests. They complement [CONTRIBUTING.md](CONTRIBUTING.md).

## Structure and functions

- Put the main flow at the top, after imports. Do not wrap a script in `main()` just to give it a name.
- Use early `return` statements inside functions for conditions that stop the work. At the CLI module level, where a top-level return is not valid, an explicit process exit is appropriate for a completed early path.
- Give each file one clear responsibility and at most one callable exported function. Executable entry points and test files do not need an export.
- Put private helpers below the flow, in order of first use. Use function declarations so hoisting works naturally.
- Keep logic used once inline. Extract a helper when the same logic is needed at least three times. Do not create a helper just to make the caller look shorter.
- Before adding a function, check whether an existing function already does the job. Before introducing a data-access method or API, look for an established, tested pattern in the project.
- Framework callbacks stay where they are registered when used once. Do not turn them into extra layers merely to satisfy a file layout.

## Variables and values

- Use `var`, not `const` or `let`. Write constant names in uppercase, such as `CLI_PATH`.
- Declare a variable where its value is first assigned. Do not initialize it with `null` or an empty value just because the real assignment happens inside a later block. Remember that `var` is function-scoped.
- Use English names. Keep established domain terms in their original language when appropriate.
- Calculate an intermediate result once and pass it on instead of rebuilding it.
- Use TypeScript inference for obvious types. Type external boundaries and shared contracts explicitly when needed; do not hide uncertainty behind `any`.

## Control flow

- Prefer guard clauses over nested `if`/`else` branches for failure cases.
- Use classic `for` or `for...of` loops. Do not use `.map()`, `.filter()`, `.join()`, or functional array chains as substitutes for a direct loop.
- Do not use ternary expressions.
- Build arrays with `push()` and strings with `+=` when iterating. Each line should do one clear thing.
- Validate at real boundaries, such as user input and external API responses. Do not add speculative checks for states that the surrounding code cannot produce.

```ts
export function describeModels(models: string[]): string {
    if (models.length === 0) {
        return 'No models available.';
    }

    var output = 'Available models:\n';

    for (var model of models) {
        output += '  ' + model + '\n';
    }

    return output;
}
```

## Files and formatting

- Use descriptive file names tied to responsibility, such as `cli.ts`. Create folders when implemented features need them.
- Use normal TypeScript imports to connect modules. Do not copy include mechanisms from other environments.
- Use four spaces, single quotes in TypeScript and JavaScript, and semicolons, following the existing source.
- When a file has several genuinely distinct sections, `//#region Name` and `//#endregion` may make them easier to navigate. Do not add regions to a short, single-purpose file.
- Keep source in `src/`, behavior tests in `tests/`, and generated output in `dist/`. Commit the dependency lockfile, not generated output or installed dependencies.

## Comments and language

- Prefer readable names and code over comments. Explain only a non-obvious reason, constraint, invariant, or workaround.
- Keep comments plain. No decorative separators or banners.
- Do not refer to the current task, caller, or fix in comments. Change history belongs in the pull request or commit message.
- Use real umlauts and ß in German text. Do not substitute `ae`, `oe`, `ue`, or `ss` for those letters.
- Do not use em dashes in code, comments, or documentation.
- Do not separate log fields with pipe characters. Write a readable message instead.
- Always write the product name as `velora`, including headings and the start of sentences.
- User-facing copy is English. Follow the writing guidance in [CONTRIBUTING.md](CONTRIBUTING.md).

## Keep changes proportional

Three similar lines can be clearer than an abstraction built for hypothetical future features. Reuse a suitable existing library or project pattern before writing another implementation.

Tests should exercise observable behavior and catch meaningful failures. Do not create tests that only repeat the implementation. Run `bun run test` and `bun run check` before submitting code changes; report anything that could not be checked.

These conventions originated in a different development environment. PortalScript-specific rules for `FileResultset`, `sync()`, `createFile()`, `getFieldValue()`, and `#import` do not apply to velora. Preserve the readable structure without introducing APIs from that environment. If a real TypeScript or framework constraint requires an exception, explain it in the pull request.
