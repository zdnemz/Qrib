# Scanning a QR with a phone (PWA camera test)

The PWA reads the QR with the phone's camera via `getUserMedia` + jsQR. Two
browser rules make this awkward, and both have to be satisfied:

1. **`getUserMedia` needs a secure context** — HTTPS, or `localhost`. A LAN IP
   over plain HTTP does **not** count.
2. **The phone must be able to reach your laptop.** `localhost` on your laptop
   is not `localhost` on your phone.

There are two ways through. Pick one.

---

## Option A — LAN + Chrome's insecure-origin flag (no install)

Fastest, and fine for a one-off camera check. Requires an Android phone with
Chrome (Safari/iOS has no equivalent flag).

1. **Find your laptop's LAN IP and make sure the phone is on the same Wi-Fi.**
   ```sh
   hostname -I | awk '{print $1}'      # e.g. 192.168.1.5
   ```

2. **Start the API, allowing the phone's origin** (`http://<LAN-IP>:3100`):
   ```sh
   cd /home/zidane/code/projects/qris-wallet
   set -a; . ./.env.payment1; set +a
   ALLOWED_ORIGINS="http://192.168.1.5:3100,http://localhost:3100" pnpm dev
   ```
   The API already binds all interfaces, so `http://192.168.1.5:3000/health`
   should answer from the phone.

3. **Start the PWA bound to the LAN** (plain `next dev` is localhost-only):
   ```sh
   cd web
   NEXT_PUBLIC_API_URL="http://192.168.1.5:3000" pnpm dev:lan
   ```

4. **On the phone**, open Chrome and go to:
   ```
   chrome://flags/#unsafely-treat-insecure-origin-as-secure
   ```
   Enable it, and in the text box add exactly:
   ```
   http://192.168.1.5:3100
   ```
   Relaunch Chrome as prompted.

5. **Visit `http://192.168.1.5:3100/scan`** on the phone. Chrome will ask for
   camera permission — allow it. Point it at a QRIS code.

**If it fails:** check the phone and laptop are on the same network (guest Wi-Fi
and AP isolation will block this), and that the laptop firewall allows ports
3000 and 3100.

---

## Option B — HTTPS tunnel (cleaner, needs an install)

Gives a real HTTPS URL, so no browser flags and it also works on iOS. Best if
you will test repeatedly.

```sh
# install once
brew install cloudflared        # or your package manager

# terminal 1 — api
cd /home/zidane/code/projects/qris-wallet
set -a; . ./.env.payment1; set +a
pnpm dev

# terminal 2 — pwa
cd web && pnpm dev

# terminal 3 — expose the pwa
cloudflared tunnel --url http://localhost:3100
```
Cloudflare prints an `https://<random>.trycloudflare.com` URL. Two things then:

1. Put that URL in `ALLOWED_ORIGINS` and restart the API (CORS must name the
   exact origin).
2. Set `NEXT_PUBLIC_API_URL` to a tunnel to port 3000 as well, or the browser
   will block the API calls as mixed content (an HTTPS page cannot call
   `http://192.168…`).

```sh
# terminal 4 — expose the api too, then restart web with that URL
cloudflared tunnel --url http://localhost:3000
```

Then open the `trycloudflare.com` URL for the web app on the phone.

---

## What to actually test

The parser is already unit-tested and has been proven against a real payload.
What has **never** been exercised is the camera path:

- [ ] Camera permission prompt appears and is grantable
- [ ] The rear camera is selected (`facingMode: environment`)
- [ ] A QRIS code in view is decoded within a couple of seconds
- [ ] A **static** QR leads to the amount-entry screen (`next: enter-amount`)
- [ ] A **dynamic** QR shows the detected amount (`next: confirm`)
- [ ] A non-QRIS QR (a URL, a Wi-Fi code) is rejected with a clear message
      rather than crashing
- [ ] Denying camera permission falls back to the paste-payload box instead of
      a blank screen

Note the last two: those are the paths most likely to be broken, because they
are error branches that only a real phone can reach.

---

## Recording the result

Whichever option you use, note in the M5 tally whether the camera path worked.
It is the single largest untested surface in the product (§17 calls for a
mobile-web-first PWA), and it is the one thing automated tests cannot cover.
