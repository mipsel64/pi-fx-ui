# pi-fx-ui

Make [Pi](https://pi.dev) look like [Vercel fx](https://fx.sh): a quiet, monochrome, shell-like terminal UI.

```
π v0.87.1 · Run /help for commands

┃ fix the failing test in parser.ts

● Read src/parser.ts
└ 212 lines

● Ran npm test
└ … 18 earlier lines ctrl+o to expand
  ✔ parses empty input
  ✖ parses nested lists

● Edited src/parser.ts +3 / -1
└  41   const items = [];
  -42   if (depth > 0) return items;
  +42   if (depth > MAX_DEPTH) return items;

 Fixed: the depth guard returned before parsing nested lists.

┃

gpt-6-luna · high · 12%                                                [tinyllm]
```

## Install

```sh
pi install npm:@mipsel64/pi-fx-ui
```

Try it for one session without installing:

```sh
pi -e npm:@mipsel64/pi-fx-ui
```

For the cleanest start, hide Pi's startup resource listing in `~/.pi/agent/settings.json`:

```json
{ "quietStartup": true }
```

## What changes

| Area | fx look |
|---|---|
| Colors | `fx-dark` and `fx-light` themes: grays only, no message or tool backgrounds. Diff markers are green and red, warnings orange, errors red, links blue. |
| Header | One line: `π v<version> · Run /help for commands`. |
| Input | A `┃` rail instead of divider lines. `┃↑` and `┃↓` show scrolled text. |
| Your messages | The same `┃` rail, in bold. |
| Tools | `● Read`, `● Ran`, `● Edited +3 / -1`, `● Wrote` rows. Output hangs under `└`: the last 5 lines, or all of it with `ctrl+o`. Failed tools show a red `■`. |
| Working | `• Thinking (4s)` and `• Running (2s)`. |
| Footer | One gray line: `model · thinking · context %`. Other extensions' statuses sit on the right. |

## Themes

If your theme is Pi's built-in `dark` or `light`, the extension switches to the matching fx theme for the session. It does not change your saved setting, and custom themes are left alone.

To pin the fx themes and follow your terminal's light or dark mode:

```json
{ "theme": "fx-light/fx-dark" }
```

## Notes

- The restyled tools are `read`, `bash`, `edit`, and `write`, which Pi enables by default. They run Pi's own implementations and respect your `shellPath`, `shellCommandPrefix`, and image resize settings. Other tools keep Pi's rendering, without the colored boxes.
- Pi has no renderer hook for user messages, so the extension patches Pi's user message component while it is loaded. A future Pi release could break that part.
- Styling applies to interactive mode only. Print, JSON, and RPC modes are unchanged.

## Development

Requires Node 22.19 or newer.

```sh
npm ci
npm run check   # TypeScript
npm test        # themes and tool rendering
pi -e .         # run Pi with the working copy
```

## Release

1. Bump `version` in `package.json` and merge to `main`.
2. Tag the commit: `git tag v0.1.1 && git push origin v0.1.1`.

The release workflow checks that the tag matches `package.json`, runs the checks, publishes to npm through trusted publishing, and creates a GitHub release. Versions with a prerelease suffix, such as `v0.2.0-rc.1`, publish under the `next` tag. Trusted publishing needs the package to exist, so publish the first version by hand with `npm publish`.

## License

[MIT](LICENSE)
