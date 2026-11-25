**Category:** Ideas
**Title:** Settings: export and import as a file, and account syncing only if you turn it on

---

@cpriest, I have another thing I want to change and implement in this repo, and I'd like your opinion on it. It ties in with #422 and #459.

### How it works now

Under Advanced Settings you can pick **Sync storage** or **Local storage**. With sync storage, every change goes straight to your Firefox (or Google) account and on to every other browser signed into it. With local storage, the settings stay on this computer. Sync storage is the default, so most people's settings end up in their account without them ever deciding that, and many probably don't know it happens. Beyond that, you can't back up your settings, you can't move them between Firefox and Chrome, and you can't sync only when you actually want to. And if sync storage is turned off in the browser (#422, and Tor Browser in #459), Snap Links can't load its settings at all.

### What I'd like to add

**1. Export and import as a file.** An "Export settings" button that saves a JSON file, and an "Import settings" button that loads one. I've worked with settings import and export before, so I know where it usually goes wrong: the import should only accept settings Snap Links actually knows, with valid values, and a file from an older version should be migrated the same way stored settings are (`MigratePrefs()`). It works between Firefox and Chrome and needs no new permission. Plenty of add-ons already have this, uBlock Origin ("Back up to file") and Dark Reader among them.

**2. Account syncing only if you turn it on.** By default, Snap Links keeps its settings on this computer and doesn't touch your Firefox or Google account at all. Where your settings go is your data, so I think it should be your decision, the same way uBlock Origin handles it: its cloud storage is off until you turn it on yourself. Ticking "Sync my settings with my account" brings up two buttons, **Upload to my account** and **Download from my account**, so you sync when you click them and not otherwise. If you'd rather have every change synced right away, a second checkbox turns on automatic syncing.

People who use sync storage today wouldn't lose anything: the settings already in their account are copied to this computer once with the update. After that, syncing is off for them too until they turn it on.

**3. A fallback for #422.** If the browser has sync storage turned off, Snap Links uses local storage instead and says so on the options page, rather than failing to load its settings.

### How I'd do it

Two PRs: first the #422 fallback on its own, since it's a small bug fix, then export/import and the new sync options together, because they live in the same part of the options page.

### Questions

1. Would you take export and import as a file?
2. Are you OK with syncing being off by default, so people turn it on themselves? If you think it should stay on by default, for everyone or just for people who use it today, I'd like to hear why. I'm open to changing my mind on this.
3. Anything you'd like done differently, for example where it should go on the options page?
