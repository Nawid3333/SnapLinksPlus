The options page shows **Copy links as** twice. #589 brought the block in a second time along with the #587 changes it was based on, so the page has two `<select id="CopyFormat">`. `Options.js` binds only the first one (`getElementById`), so a format chosen in the second select is never saved.

### Changes
- `options.html`: the second, identical block is removed.
- `test.Options.js`: a test that every `id` on the options page is used once. It fails on `master` (it lists `CopyFormat`) and passes with this change.

### Testing
- `npm test`: 383 passed. `npm run lint`: clean.
- Checked the options page in Firefox 160 (about:addons): one **Copy links as** select, and a change to it is saved.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
