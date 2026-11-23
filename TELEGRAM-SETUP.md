# Nexus AI Telegram bot setup

This patch adds the Telegram bot to the existing Render Express service. It uses the existing Gemini provider and Neon connection. Telegram chat history is stored in separate Neon tables and never appears in the website's shared conversations.

## 1. Files and behaviour

- `POST /api/telegram/webhook` receives Telegram updates.
- The webhook is mounted before the website's shared Basic Auth, but accepts requests only with Telegram's `X-Telegram-Bot-Api-Secret-Token` header.
- Updates are acknowledged quickly and placed in a durable PostgreSQL queue. A worker in the Render process handles them.
- `telegram_users`, `telegram_messages`, `telegram_update_queue`, and `telegram_processed_updates` are created automatically by the existing PostgreSQL schema initialization.
- Private chats only are supported. Group chats are told to use a private chat.
- `/start`, `/help`, and `/reset` are supported.
- Each Telegram account has an independent history. `/reset` deletes that account's Telegram message history.
- Rate limits use `CHAT_RATE_LIMIT_PER_MINUTE` both per Telegram account and across the Telegram bot, to protect the Gemini quota.

## 2. Deploy the code first

Apply the patch to the repository, run the checks listed in the patch instructions, commit, and push to `main`. Let Render deploy the new commit before registering the webhook.

## 3. Configure Render environment variables

In Render > `nexus-ai-portfolio` > Environment, add:

- `TELEGRAM_BOT_TOKEN`: the token from @BotFather.
- `TELEGRAM_WEBHOOK_SECRET`: a generated secret of 32-256 characters, using only letters, numbers, `_`, or `-`.

Keep the existing `DATABASE_URL` pointing to the `portfolio-demo` Neon branch, plus the existing Gemini and production login variables. Never place the bot token in source code or GitHub.

After saving, wait for Render to finish the redeploy. On startup, the server creates the Telegram tables and starts the queue worker.

## 4. Register the webhook from PowerShell

The helper script reads the token and secret from environment variables (or the root `.env`) and uses the public Render URL. It never prints the token or secret.

In PowerShell, generate the webhook secret and keep the terminal open:

```powershell
$bytes = New-Object byte[] 32
$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
$rng.GetBytes($bytes)
$rng.Dispose()
$webhookSecret = [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
$env:TELEGRAM_WEBHOOK_SECRET = $webhookSecret
Write-Host "Add this value to Render as TELEGRAM_WEBHOOK_SECRET: $webhookSecret"
```

Copy that value into Render as `TELEGRAM_WEBHOOK_SECRET` and wait for the Render redeploy to finish.

Then prompt for the bot token without echoing it to the screen, set the webhook URL, and register it:

```powershell
$secureToken = Read-Host "Enter the Telegram bot token" -AsSecureString
$tokenPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureToken)
try {
    $env:TELEGRAM_BOT_TOKEN = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($tokenPointer)
} finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($tokenPointer)
}
$env:TELEGRAM_WEBHOOK_URL = "https://nexus-ai-goo0.onrender.com/api/telegram/webhook"
npm run telegram:set-webhook -w server
```

On success, the script reports the public webhook URL and confirms that `message` updates are subscribed. It does not print the bot token or webhook secret.

Clear the temporary PowerShell environment values after registration:

```powershell
$env:TELEGRAM_BOT_TOKEN = $null
$env:TELEGRAM_WEBHOOK_SECRET = $null
$env:TELEGRAM_WEBHOOK_URL = $null
$secureToken = $null
$webhookSecret = $null
```

Keep `TELEGRAM_BOT_TOKEN` and `TELEGRAM_WEBHOOK_SECRET` in Render. They do not need to remain in the local `.env`.

## 5. Test in Telegram

Open https://t.me/Nex_usai_bot and send:

1. `/start`
2. `/help`
3. `Remember this: my favourite colour is blue.`
4. `What is my favourite colour?`
5. `/reset`

The answer to step 4 should use that Telegram account's saved history. `/reset` clears that Telegram account's message history. Try the bot from a second Telegram account to verify histories do not cross.

## Notes

- Telegram requires an HTTPS webhook URL. Render provides HTTPS on the `onrender.com` service URL.
- If Render's free instance is asleep, the first Telegram message may take longer while the service wakes.
- Telegram text replies are sent as plain text (without Telegram Markdown parsing) to avoid formatting/entity injection and malformed Markdown failures.
- Telegram data is stored in Neon; keep the bot token and webhook secret private.
