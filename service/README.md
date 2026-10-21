# Headless daily service

The service runs the actual extension in Playwright's full headless Chromium. It uses a dedicated server-side profile, submits no board input, and runs all eight games sequentially. The Linux user timer runs daily at **04:30 America/Los_Angeles** and catches up after downtime. It does not require a desktop session on the server.

## Install

On an x86_64 Linux server with Docker Compose, systemd user services, and UID 1000:

```sh
git clone git@github.com:nqrwhal/linkedin-puzzles.git
cd linkedin-puzzles
./service/install.sh
./service/puzzles smoke
```

Enable lingering once if it is not already enabled: `loginctl enable-linger "$USER"`. The installer preserves `service/data`. A different host UID needs ownership aligned with the container's configured UID 1000. No LinkedIn cookies or desktop browser files are imported.

## Separate server login

Start the temporary login container:

```sh
ssh yufeihl 'cd ~/linkedin-puzzles && ./service/puzzles login'
ssh -N -L 6080:127.0.0.1:6080 yufeihl
```

Keep the tunnel running, then open [the server login window](http://localhost:6080/vnc.html?autoconnect=1&resize=scale). Sign in directly to LinkedIn and handle any account verification. Credentials go into LinkedIn's own browser page, not a service form. The window closes after an authenticated feed/game page loads; the profile is flushed to disk. Close the tunnel afterward. If necessary, `./service/puzzles login-stop` closes it manually.

Login uses a virtual display and noVNC only during sign-in; scheduled solves use true headless mode. Port 6080 is bound to the server's loopback interface and should only be accessed through SSH. Do not publish this port: the remote browser controls the signed-in profile. No browser debugging port is exposed.

A login window expires after 30 minutes. Login and solve runs take the same kernel lock. While login is open, a scheduled/manual solve exits with status 75 rather than sharing the profile. Run manually after finishing login if it overlapped the schedule.

## Operations

From `~/linkedin-puzzles` on the server:

```sh
./service/puzzles run          # Solve now, independently verify each game
./service/puzzles status       # Latest report and next scheduled run
./service/puzzles logs         # Scheduled-run logs
./service/puzzles login-logs   # Login readiness/completion
./service/puzzles smoke        # Isolated offline extension integration test
```

Reports live in `service/data/latest.json` and `service/data/runs/` (last 30 runs). Each game is marked `solved`, `already_completed`, `failed`, or `login_required`. A successful run requires all eight to be independently verified. Failures do not prevent other games running, except an authentication challenge, which stops the run for manual login. Re-running is safe: completed boards are rechecked without another save.

The runner opens only Play/Start/Resume/Skip tutorial controls. It never clicks cells, uses hints, types answers, or drags paths. Solve commands go through extension-internal messages. A successful extension message or HTTP response is insufficient: the runner must see LinkedIn's own **See results** control, navigate freshly to that same game, and see persisted completion again. New-account onboarding that cannot reach a board using these controls needs attention in the login window.

No automatic CAPTCHA solving or credential handling is implemented. If the session expires, open login again. The service does not export credentials, raw network capture, or browser screenshots to reports. Treat the private profile directory as signed-in account access; it is ignored by Git and excluded from the image build.

## Schedule and upgrades

```sh
systemctl --user list-timers linkedin-puzzles.timer
systemctl --user stop linkedin-puzzles.timer    # Pause
systemctl --user start linkedin-puzzles.timer   # Resume
systemctl --user edit linkedin-puzzles.timer   # Override OnCalendar (clear it first)
```

For upgrades, stop any open login window, `git pull --ff-only`, then `./service/puzzles build`. The next run uses the rebuilt image with the same login profile. Run the smoke test and a manual run before relying on a changed save protocol. `install.sh` re-applies the default 04:30 Pacific schedule.

The image and npm dependency are pinned to the same Playwright version. `init` reaps browser processes; shared memory is 1 GB. The container runs as an unprivileged user with no Docker socket or host home mount. The systemd run is limited to 20 minutes; each game has a bounded solve wait. Chromium uses Playwright's container launch defaults.

## Validation

`npm test` at the repository root covers the extension and service decisions, including rejection of unverified success, one-shot dispatch after a lost response, per-game failure isolation, login stopping, and completed-board skips. `service/puzzles smoke` runs the actual installed extension headlessly against intercepted offline responses in a disposable profile. It is a wiring test, not evidence of a live LinkedIn win. Live acceptance requires initially unsolved signed-in boards and fresh-page persisted completion for all eight games.

On October 20, 2026 (Pacific), the rebuilt v0.8.2 service on `yufeihl` completed initially unsolved Queens, Tango, Zip, Patches, and Wend boards after fixing the missing SDUI action-routing parameter. Each completion was independently verified after fresh navigation. Mini Sudoku, Crossclimb, and Pinpoint were already completed and were rechecked without another save. The run through the installed systemd service verified all eight games and exited successfully. All 31 Node tests, 20 offline browser tests, and the rebuilt image's smoke test also passed; the browser fixture reproduced HTTP 400 before the fix.

On September 9, 2026, the deployed headless service on `yufeihl` completed initially unsolved Mini Sudoku, Queens, Tango, Crossclimb, and Pinpoint boards and independently verified each after fresh navigation. Zip, Patches, and Wend were already completed; the runner independently rechecked and skipped them. A final run verified all eight. The timed new solves took roughly 5.4–6.5 seconds including page loads and verification; Pinpoint took 3.7 seconds. This validates the server integration and skip behavior, but is not a new unsolved-board test of Zip, Patches, or Wend.
