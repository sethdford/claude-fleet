# Audit Loop Command

## YOUR MISSION

You have ONE goal: **Make this codebase production-ready.**

You are NOT done until:
1. `fleet audit` passes (typecheck, lint, tests, build)
2. `npm run e2e:all` passes (all E2E tests)
3. No critical TODOs remain
4. Documentation matches reality

**Keep iterating until ALL criteria are met. Do not stop early.**

---

## THE LOOP

Each iteration, run through this checklist. Fix issues as you find them.

### Phase 1: Automated Checks (MUST PASS)

```bash
fleet audit          # Must show "All checks passed"
npm run e2e:all      # Must show all tests passing
```

If either fails, fix the issues and re-run. Do not proceed until green.

### Phase 2: Code Quality Scan

| Check | Command/Action | Pass Criteria |
|-------|----------------|---------------|
| Dead code | Search for unused exports | None found |
| TODOs | `grep -r "TODO\|FIXME" src/` | Only intentional deferrals |
| Type safety | No `any` types | `grep -r ": any" src/` returns nothing |
| Long files | Files > 500 lines | Split or justify |
| Long functions | Functions > 50 lines | Split or justify |

### Phase 3: Integration Verification

| Feature | How to Verify | Expected Result |
|---------|---------------|-----------------|
| Server starts | `npm run start` | No errors, port 3847 |
| Health check | `fleet health` | `{"status":"ok"}` |
| Auth works | `fleet auth test-user test-team` | Returns JWT token |
| CLI works | `fleet --help` | Shows all commands |
| Workers | `fleet workers` | Returns list (may be empty) |

### Phase 4: Documentation Accuracy

| Doc | Check | Action if Wrong |
|-----|-------|-----------------|
| README.md | Commands match CLI help | Update README |
| CLAUDE.md | Test counts accurate | Update counts |
| API docs | Endpoints match routes | Update OpenAPI |

---

## COMPLETION CRITERIA

You are ONLY done when you can truthfully check ALL boxes:

- [ ] `fleet audit` shows 4/4 checks passed
- [ ] `npm run e2e:all` shows all tests passed
- [ ] `grep -r "TODO" src/` shows no critical items
- [ ] `grep -r ": any" src/` returns no results
- [ ] README.md CLI section matches `fleet --help`
- [ ] No uncommitted changes that should be committed

---

## RESPONSE FORMAT

After each iteration:

```markdown
## Audit Iteration #N

### Automated Checks
- fleet audit: PASS/FAIL (details)
- e2e tests: PASS/FAIL (X/Y passed)

### Issues Found & Fixed
1. [Issue] → [Fix applied]
2. ...

### Remaining Blockers
1. [What still blocks completion]
2. ...

### Status: CONTINUE / COMPLETE
```

---

## TERMINATION

When ALL completion criteria are met, respond with:

```
AUDIT COMPLETE - All criteria met:
✓ fleet audit: 4/4 passed
✓ E2E tests: all passed
✓ No critical TODOs
✓ No unsafe types
✓ Docs accurate
✓ Repo clean
```

**DO NOT say "AUDIT COMPLETE" unless every criterion is verified.**

---

## RULES

1. **Fix, don't report** - Every issue found must be fixed before moving on
2. **Verify fixes** - Re-run tests after every change
3. **No shortcuts** - Don't skip checks to finish faster
4. **Commit progress** - Commit after each significant fix
5. **Be persistent** - Keep iterating until truly complete
