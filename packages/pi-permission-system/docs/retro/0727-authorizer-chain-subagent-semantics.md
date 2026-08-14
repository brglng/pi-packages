---
issue: 727
issue_title: "pi-permission-system: authorizerChain links are skipped for subagent requests, so configured authorizers never adjudicate them"
---

# Retro: #727 — authorizerChain links skipped for subagent requests

## Stage: Planning (2026-08-14T04:05:54Z)

### Session summary

Traced the reported defect through `authorizer-selection.ts`, `forwarded-request-server.ts`, and `pi-permission-model-judge`'s `typo-reviewer.ts`, then measured the operator's own 9167-record review log to separate the populations behind the 43 `authorizer_chain_unregistered_link` records.
Two of the issue's three claims did not survive: the serving node's chain does adjudicate a forwarded ask, and the missing `model_judge.decision` is a `pattern-miss` short-circuit that logs at debug level, not a link that never ran.
Produced a plan that settles the semantics (one chain per node, the relaying node delegates), fixes the false-alarm log, adds per-ask consultation records, and pins the parent-side invariant with an end-to-end regression test.

### Observations

- The measured log was decisive and cheap.
  A `node -e` scan gave 43 warnings against 1426 local asks, and a per-day breakdown split them into 15 correlated with `forwarded_permission.request_created` (the child-relay false alarm) and 23 on a single day with zero forwarding (a genuinely unregistered link).
  That split is the whole reason the fix suppresses the event only on a relaying node instead of deleting or downgrading it — a code-only reading would have gotten this wrong.
- `ask_user` answers drove the plan: parent-only semantics codified, one `authorizer_chain_delegated` record per ask, an `authorizer_chain_resolved` record naming consulted links, and [#699] endorsed in the ADR but implemented separately (PR [#702] is open against it).
- Rejected making `AuthorizerRegistry` process-global.
  It would double-adjudicate every deferring ask and let a link short-circuit before the serving node ever sees the request — a privilege change dressed as plumbing.
- `AuthorizerSelection` must not re-derive "is this a relaying node?"
  from `detection.isSubagent(ctx)`: `selectAuthorizer` tests `hasUI` first, so a subagent with UI decides locally.
  Hence `selectAuthorizer` returns a `SelectedAuthority` product rather than a bare terminal — the decision keeps one home.
- Confirmed the change is not breaking: `selectAuthorizer` and `TerminalAuthorizer` are absent from `dist/public.d.ts`; only `Authorizer`, `AuthorizerVerdict`, `AuthorizerLog`, and friends are public.
- Filed [#732] while reading `pi-permission-model-judge`'s `config-loader.ts`: its `defaultAgentDir()` hardcodes `~/.pi/agent` and ignores `PI_CODING_AGENT_DIR`, diverging from pi-permission-system's SDK `getAgentDir()`.
  That is one concrete way the "link configured but never registered" state arises, which is what the 2026-08-05 cluster looks like.
- Step 2 of the TDD order is a characterization test that is green on arrival.
  It is deliberate: the issue's core doubt is an invariant no test currently pins, because `forwarded-request-server.test.ts` injects a `{ escalate }` stub for the chain owner.

## Stage: Implementation — TDD (2026-08-14T04:30:39Z)

### Session summary

Executed the plan in eight commits: two preparatory tidy commits from the `tidy-first-assessor`, the plan's four TDD steps, the docs commit, and one reviewer-driven fixup.
`selectAuthorizer` now returns a `SelectedAuthority` value object, a relaying subagent node composes no chain links and records `authorizer_chain_delegated`, and an adjudicating node records `authorizer_chain_resolved` with the names it consulted.
Test count went 2757 → 2769 (+12) in pi-permission-system; `check`, root `lint`, `test`, and `fallow dead-code` are all green.

### Observations

- The `tidy-first-assessor` caught a real gap in the plan's step 1: the extraction list (`makeDeps`, `makeInvokingPrompter`, `register`) was not self-contained.
  `makePrompterApi` is a hard dependency of `makeAuthorizerSelectionDeps`'s own default and is called directly at four sites, and `makeDetection` was byte-identical in both test files.
  It also proposed a second commit — migrating `authorizer.test.ts` onto the shared fixtures *before* the return-type change — which kept the compile-breaking step 3 a pure `.terminal` edit with no fixture untangling folded in.
  Both landed; neither is in the plan's TDD Order, which is expected for tidy-first commits.
- Step 2's characterization test was green on arrival, as planned.
  Non-vacuity was measured, not argued: flipping `getAuthorizerChain` to `[]` made it fail with `denied_with_reason` missing, then the probe was reverted.
- The relaying-node tests deliberately use the recording prompter rather than the invoking one.
  Running the real `ParentAuthorizer` terminal would reach `resolvePermissionForwardingTarget`, which reads `process.env` and the filesystem; asserting `prompter.prompt` was called with `expect.any(ParentAuthorizer)` proves zero links were composed (with one link the composed value is an anonymous object) without any of that.
- One deviation from the plan's ordering: the `authorizer_chain_resolved` tests were drafted alongside the step 4 tests and then pulled back out so the delegation fix and the observability addition stayed separate commits.
- Pre-completion reviewer: WARN (1 non-blocking finding) — the extracted fixtures typed `prompt` as `ReturnType<typeof vi.fn>` rather than `Mock<Sig>`, a pre-existing pattern carried in verbatim.
  Fixed in `7d285aed` rather than deferred, since the file is new in this change and two test files now import it.

[#699]: https://github.com/gotgenes/pi-packages/issues/699
[#702]: https://github.com/gotgenes/pi-packages/pull/702
[#732]: https://github.com/gotgenes/pi-packages/issues/732
