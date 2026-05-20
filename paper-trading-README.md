# Paper Trading MCP Server

Sistem paper trading lokal untuk Claude Code.
Uang khayalan Rp10.000.000 — harga REAL dari CoinGecko.
Tidak perlu akun exchange, tidak perlu internet beli coin beneran.

## Setup (3 langkah)

### 1. Install dependencies
```bash
cd paper-trading
npm install
```

### 2. Daftarkan ke Claude Code
```bash
claude mcp add paper-trading -- node /FULL/PATH/TO/paper-trading/src/index.js
```

Ganti `/FULL/PATH/TO/` dengan path absolut folder ini.

**Contoh di Termux:**
```bash
claude mcp add paper-trading -- node /data/data/com.termux/files/home/paper-trading/src/index.js
```

**Atau edit ~/.claude/.mcp.json langsung:**
```json
{
  "mcpServers": {
    "paper-trading": {
      "command": "node",
      "args": ["/FULL/PATH/paper-trading/src/index.js"]
    }
  }
}
```

### 3. Test di Claude Code
```
Cek harga BTC sekarang
Lihat portfolio saya
Beli ETH Rp500.000
```

## Tools yang tersedia

| Tool | Deskripsi |
|------|-----------|
| `get_price` | Harga real-time coin (USD + IDR) |
| `get_portfolio` | Lihat saldo, holdings, PnL |
| `buy` | Beli coin dengan IDR |
| `sell` | Jual % dari holdings |
| `get_trade_history` | Riwayat semua trade |
| `get_performance` | Statistik return, volume, fee |
| `analyze_market` | Cek banyak coin sekaligus |
| `reset_portfolio` | Reset ke modal awal |

## Coin yang didukung
BTC ETH BNB SOL ADA XRP DOGE DOT MATIC LINK AVAX UNI LTC ATOM TRX SHIB NEAR FTM OP ARB

## Contoh prompt ke Claude Code
```
Analisa kondisi pasar BTC, ETH, dan SOL sekarang.
Berdasarkan analisa kamu, mana yang paling layak dibeli?
Beli coin tersebut dengan Rp2.000.000 dan jelaskan alasanmu.
```

```
Cek semua posisi saya, kalau ada yang sudah +10% jual 50%
```

## Data tersimpan di
`data/portfolio.db` — SQLite lokal, tidak kemana-mana.
