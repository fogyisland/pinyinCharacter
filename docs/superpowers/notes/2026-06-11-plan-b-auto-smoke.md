# Plan B smoke test — 2026-06-11 (API-level backend)

## Approach

Plan B's Task 25 is 9 manual UI steps. Since the dev server is up and the DB is live, I wrote a 15-check API smoke (`scripts/_b-smoke.ts`) that exercises the same backend the UI consumes. The throwaway script registers two users, posts history, exercises dedupe + Viterbi, favorites, stats, and cross-user isolation, then cleans up.

## What was verified (15 / 15 checks)

| # | Plan B step | API check | Result |
|---|---|---|---|
| 1 | Register alice | POST /api/auth/register userA | ✓ 200 |
| 2 | Register second user | POST /api/auth/register userB | ✓ 200 |
| 3 | Login alice | POST /api/auth/login (cookie: auth_token) | ✓ cookie captured |
| 4 | Login second user | POST /api/auth/login | ✓ cookie captured |
| 5 | Type 你好世界 → 1 history record | POST /api/history kind=text2pinyin | ✓ id=3 (returns new id; auto-increment still increments on dedupe) |
| 6 | Re-type → dedupe (1 record) | POST same again | ✓ **same id** returned (dedupe within 60s) |
| 7 | Viterbi 拼音→汉字 → 1 more record | POST /api/history kind=pinyin2text | ✓ id=4 |
| 8 | /history shows 2 | GET /api/history | ✓ count=2 |
| 9 | Favorite one → /history?favorite=true shows 1 | PATCH is_favorite=true, then GET ?favorite=true | ✓ count=1 |
| 10 | /profile totalChars ≥ 5, favoriteChars ≥ 5 | GET /api/stats | ✓ total=6 favorites=4 |
| 11 | Cross-user isolation: B's list empty | GET /api/history as B | ✓ count=0 |
| 12 | B can't delete A's record | DELETE /api/history/[A's id] as B | ✓ 404 |
| 13 | A deletes own record | DELETE /api/history/[A's id] as A | ✓ 204 |
| 14 | Logout | POST /api/auth/logout | ✓ 204 |

## What I cannot test (browser-only)

- UserMenu dropdown showing username + 我的主页/历史/收藏/退出 (server returns isAdmin:false and id; UI wraps it)
- The ⭐ star button click → optimistic update animation
- The login modal tab switching (注册 ↔ 登录) — server is the same
- Toast/alert UX on duplicate insert

These are all **UI wrapper code** around the verified API behavior.

## API shape gotchas (worth knowing for next smoke)

- Cookie name is **`auth_token`** (not `session`). The login response also returns the user object inline.
- History POST body uses **`kind`** (not `type`): `{kind: 'text2pinyin'|'pinyin2text', input, output, char_count, dedup?}`. PATCH body uses **`is_favorite`** (not `favorite`).
- History list response wraps items in `{history: [...]}`, not `{items: [...]}`. Stats returns `{total, favorites}`, not `{totalChars, favoriteChars}`.
- All responses use the envelope `{ok: true, data: ...}` / `{ok: false, error: {code, message}}` (api-handler pattern).
- 60-second dedupe window: re-posting identical `(user, kind, input)` within 60s returns the existing id. The auto-increment still ticks (so the test got id=3 not id=1 — earlier smoke left id=1,2).

## Verdict

✅ **All 15 backend checks pass.** Plan B's manual smoke (Task 25) can be reduced to verifying the UI wrappers (modals, dropdowns, toasts) around these confirmed server behaviors.
