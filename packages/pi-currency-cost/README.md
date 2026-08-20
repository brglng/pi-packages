# @brglng/pi-currency-cost

> For a Chinese version, see [README.zh.md](README.zh.md).

A [Pi coding agent](https://pi.dev/) extension that converts configured
provider/model usage costs to USD on every finalized assistant message, so
all costs and totals are shown in a single currency even when your providers
bill in different currencies.

## Installation

```bash
pi install npm:@brglng/pi-currency-cost
```

## Configuration

The extension reads two optional JSON files and merges them, with the project
file taking precedence over the global file:

- Global: `~/.pi/agent/extensions/pi-currency-cost/config.json`
- Project: `<cwd>/.pi/extensions/pi-currency-cost/config.json`

```json
{
  "currencies": {
    "CNY": { "usdRate": 0.147 }
  },
  "providers": {
    "bailian": { "currency": "CNY" }
  },
  "rateSource": { "type": "frankfurter" }
}
```

A ready-to-edit template is provided in
[`config/config.example.json`](config/config.example.json).

### currencies

All rates are **USD per one unit of the source currency** (for example, 0.147
USD per 1 CNY). Every configured non-USD currency must provide a `usdRate`
— a positive, finite number — before it can be converted. `usdRate` is the
only required field; conversion never happens without it:

```json
{
  "currencies": {
    "CNY": { "usdRate": 0.147 },
    "EUR": { "usdRate": 1.083 }
  }
}
```

`usdRate` is the value used for conversion. When a fresh rate is fetched by
the extension, it is written back into this same field (along with `updatedAt`).

### providers

Only the providers listed here are converted; any provider that is not listed
is left untouched. Each entry names the currency Pi reports that provider's
usage costs in, with optional per-model overrides on top:

```json
{
  "providers": {
    "bailian": { "currency": "CNY" },
    "my-gateway": {
      "currency": "EUR",
      "models": {
        "euro-model": { "currency": "EUR" },
        "usd-model": { "currency": "USD" }
      }
    }
  }
}
```

A provider whose currency is `USD` (and any provider not listed) is left
untouched. A model with no override falls back to its provider's currency.

### rateSource

The default is Frankfurter, a common reference-rate service:

```json
{
  "rateSource": {
    "type": "frankfurter"
  }
}
```

If you prefer a mainland-China–oriented source, you can use Bank of China
instead:

```json
{
  "rateSource": {
    "type": "boc"
  }
}
```

Both sources use bounded timeouts.

## Commands

- `/currency-cost status` shows the config paths, the active rate source,
  each currency rate (including its update time), and the provider/model
  currency mappings.
- `/currency-cost refresh` fetches current USD rates for every configured
  non-USD currency and saves them as `usdRate`.
- `/currency-cost help` lists the available subcommands.

## How conversion works

On every finalized assistant message, the extension converts the message's
cost components — input, output, cache reads, and cache writes — from the
configured source currency into USD, and recomputes the total from those
converted components. Session totals, status views, and history all end up in
USD. A message is converted at most once, so the same cost is never converted
twice.

If a mapped currency has no usable `usdRate`, the message is left in its
original currency and a warning is shown.

## Automatic updates

At the start of each session, the extension fetches the latest rate for every
configured non-USD currency and saves it back to the same `usdRate` field, so
conversion always uses the most recent rate the extension can obtain. You can
also trigger this manually at any time with `/currency-cost refresh`.

## Network and fallback

Rate fetches require network access, which cannot be guaranteed in every
environment. If a rate source is unreachable or times out, the extension does
not fail: the configured `usdRate` value is kept and stays in effect, and
startup is never blocked.

## Limitations

Exchange rates are estimates, and the resulting USD figures may differ from
what your provider actually bills. Pricing also changes over time and varies
by provider, region, and plan, so treat converted costs as an approximation
rather than an exact invoice.

## License

MPL-2.0
