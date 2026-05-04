# Auto Profile Sign-In

A lightweight Microsoft Edge / Chromium extension that skips the "Pick an account"
screen on Microsoft sign-in pages by automatically using the account associated
with your current browser profile.

Source: https://github.com/vermacodes/AutoProfileSignIn

## Why

If you have multiple accounts connected to Windows or to your browser, every
sign-in to a Microsoft / Entra ID protected site (Microsoft 365, Azure portal,
GitHub Enterprise, etc.) prompts you to choose which account to use. When you
already keep one Edge profile per account, that prompt is just noise.

This project is inspired by
[novotnyllc/UseMyCurrentAccount](https://github.com/novotnyllc/UseMyCurrentAccount)
and exists because that extension stopped working.

This extension reads the email of the currently signed-in browser profile and
appends `login_hint` (and `whr` for federated tenants) to outgoing requests to
`login.microsoftonline.com`, so the chooser is bypassed.

## How it works

- A service worker reads the profile email via `chrome.identity.getProfileUserInfo`.
- Three `declarativeNetRequest` rules rewrite outbound query strings on
  `login.microsoftonline.com`:
  1. AAD `/oauth2/authorize` and `/oauth2/v2.0/authorize` – inject `login_hint`,
     strip `prompt`.
  2. `/saml2` and `/wsfed` federated endpoints – inject `whr` with your domain.
  3. `/common|organizations|consumers/{reprocess,login}` chooser pages – inject
     `login_hint`, strip `prompt`.

No data leaves the browser. The email is only attached to URLs you were already
navigating to on Microsoft's own sign-in server.

## Install (developer mode)

1. Clone or download this repository.
2. Open `edge://extensions` (or `chrome://extensions`).
3. Enable **Developer mode**.
4. Click **Load unpacked** and select the project folder.

## Usage

- Just browse to any Microsoft-protected site. The picker is skipped automatically.
- Click the extension's toolbar button to **toggle it off** when you actually
  need to choose a different account; the badge will show **Off**.
- Click again to turn it back on.

## Permissions

| Permission | Purpose |
|---|---|
| `identity`, `identity.email` | Read the current profile email locally. |
| `storage` | Persist the on/off toggle in `chrome.storage.local`. |
| `declarativeNetRequest` (+ `WithHostAccess`) | Append query parameters to Microsoft sign-in URLs. |
| `host_permissions: *://login.microsoftonline.com/*` | Scope the rules above. |

## Privacy

The extension does **not** make any network requests itself, does **not** read
cookies or page contents, and does **not** transmit your email anywhere. See the
manifest for the exhaustive permission list.

## License

MIT — see [LICENSE](LICENSE).
