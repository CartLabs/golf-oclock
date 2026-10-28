# Golf O'Clock

Read `INSTRUCTIONS.md` before analysing, suggesting, or changing anything in this repo.

Two rules from it that are easy to get wrong and expensive to miss:

1. **Pull the live file from GitHub and read it before touching it.** Never work from memory, a summary, or an earlier copy in the conversation. The tee time data now lives on the `state` branch, but the poller still writes `config/watches.json` to `main` and Kevin edits from more than one place, so a local copy can be stale without you knowing.
2. **The version lives in four places.** `web/version.json`, the line-2 comment in `web/sw.js`, `CACHE_NAME` in `web/sw.js` (a separate counter — it just has to change), and `package.json`. Update all four in the same commit.

Background and design history are in `files/`. `files/build-notes.md` is the one to read first — it has the API details, the course IDs, and the reasons behind decisions that look arbitrary.

**Try it yourself before handing it to Kevin.** If a change looks like it needs Kevin to make it by hand, attempt it first: commit and push. Only tell him it has to be done manually after a push has actually been refused, and say what the refusal was. When Kevin has asked for a fix, push it; for anything he hasn't asked for, commit and ask before pushing. He pulls in GitHub Desktop afterwards, so say when his local copy will be behind.

Never commit `data/` by hand. Those files belong to the poller, which rewrites them every few minutes; a manual commit there collides with the bot and gets rebased away.

`.github/workflows/` can be pushed like any other file — confirmed 2026-10-28, when the concurrency-lane change went out from a remote session. An earlier note here said those files had to be edited by hand; that was wrong and cost Kevin manual edits on his phone. A push to `poll.yml` (or to `src/`, `web/`, `config/`) starts a full poll, so expect one extra run.
