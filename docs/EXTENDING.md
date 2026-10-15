# Worlds and gameplay extensions

Start by creating a local world in the launchpad, using the world editor, and exporting a save. These are data changes and do not require changing JavaScript. Generated world data cannot introduce executable scripts.

For code exploration, read an authored scenario in `js/solo-engine.js` or `js/solo-mercer.js`, then examine `js/solo-generated.js` and `js/solo-simulation.js`. Room and item definitions are data; functions implement the rules that change that data. Review matching tests before editing an action.

## Adding a mechanic

1. Define the authoritative state and its validation: what can change, who can act, and what makes an action invalid?
2. Implement a deterministic rule before adding AI dialogue or interface controls.
3. Add the interface/command path and connect it to that rule.
4. If AI can propose the action, update the allowlist, context, schema, and parser together. Never execute model-produced JavaScript.
5. Add tests for success, failure, invalid ownership, and save/load behavior. Run `node scripts/check.mjs`.

There is not yet a stable plugin API or drop-in script folder. Current mechanics are coupled across scenario, simulation, UI, and persistence modules. This guide identifies the existing extension boundaries; a supported scripting SDK and full tutorial are future work.
