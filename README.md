# pi-kimi-usage

A Pi extension that shows Kimi Coding quota progress and reset countdowns in the Pi footer.

## Features

- Displays per-quota ASCII progress bars for the 5-hour and weekly Kimi Coding limits.
- Shows reset countdowns like `1h42m` or `2d6h` next to each quota.
- Shows optional Moonshot PAYG balance.
- Only activates while a `kimi-coding` model is selected.
- Refreshes quota data every 5 minutes; countdowns repaint every minute locally.

## Install

```bash
pi install npm:pi-kimi-usage
```

Or install from git:

```bash
pi install git:github.com/ShumaoHou/pi-kimi-usage
```

## Usage

Select any `kimi-coding` model and the footer will update automatically. Run `/kimi-usage` for a detailed notification.

## Credentials

- Kimi Coding: resolved from Pi's `kimi-coding` provider auth, then `KIMI_API_KEY`, then a stored OAuth token.
- Moonshot PAYG: `MOONSHOT_API_KEY`.
