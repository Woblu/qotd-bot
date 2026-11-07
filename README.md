# QOTD Bot

Every day at a set time, this bot pings the staff member whose turn it is for Question of the Day in a staff-server channel. The ping includes the QOTD template with the question number filled in, ready to copy into the main server:

```
@staffmember it's your turn for QOTD today! You're doing **Question 75**.
Pick a question and post it in the DDL server using this template (and start a thread on it):
┌──────────────────────────────────────────────
│ <@&ROLE_ID>  **__Question 75__**
│ **Your question here**
│
│ Discuss in the attached thread and if you want to get pinged, collect the role in <id:customize>
└──────────────────────────────────────────────
```

The template is in a code block, so the raw text is what gets copied. Once it's pasted into the main server, `<@&ROLE_ID>` turns back into the real @Daily Questions Ping mention. The question number goes up by one with each ping.

The bot runs on **Cloudflare Workers' free plan**, so it works 24/7 without your computer, and you don't need a credit card. It shows as "offline" in the member list. That's normal for this kind of bot, which only wakes up when it's needed. It only needs to be in the **staff server**.

## Setup

1. **Create the bot.** Go to https://discord.com/developers/applications, click **New Application**, open **Bot**, then **Reset Token** and copy the token. While you're on that page, turning off **Public Bot** means only you can invite it.
2. **Fill in `.env`.** The comments in the file explain how to get each ID.
3. **Create a free Cloudflare account** at https://dash.cloudflare.com/sign-up, then log in from this folder:
   ```
   npx wrangler login
   ```
4. **Deploy:**
   ```
   npm install
   npm run deploy
   ```
   If the bot isn't in the staff server yet, this prints an invite link. Someone with Manage Server opens it, adds the bot, and then you run `npm run deploy` again.
5. **Set it up in the staff server:**
   ```
   /qotd set-number 75        ← the next question number
   /qotd add @person          ← repeat for each staff member, in turn order
   /qotd schedule             ← check that everything looks right
   ```
   If you finish setup after today's ping time, the first ping goes out tomorrow. Use `/qotd ping-now` to start today instead.

## Commands

| Command | Who | What it does |
|---|---|---|
| `/qotd template [number]` | Everyone | Shows today's template (or the template for any number) |
| `/qotd schedule` | Everyone | Shows upcoming turns, dates, question numbers, and the rotation order |
| `/qotd skip` | Today's person or a manager | Passes today's turn (same question number) to the next person and pings them |
| `/qotd add @user [position]` | Manager | Adds someone to the rotation (at the end by default) |
| `/qotd remove @user` | Manager | Removes someone from the rotation |
| `/qotd set-next @user` | Manager | Makes someone next in line; the rotation continues from them |
| `/qotd set-number <n>` | Manager | Sets the question number. If today's ping already went out, it corrects it and sends the fixed template |
| `/qotd ping-now` | Manager | Sends today's ping now, or re-sends it if it already went out |

"Manager" means anyone with **Manage Server** in the staff server, plus anyone with `MANAGER_ROLE_ID` if you set one. All command replies are only visible to the person who ran the command.

## Changing things later

- **Ping time, timezone, IDs:** edit `.env`, then run `npm run deploy`.
- **Template wording:** edit `template.txt`, then run `npm run deploy`. `{number}` becomes the question number and `{role}` becomes the role mention.
- **Rotation and question number:** use the `/qotd` commands. These are saved on Cloudflare, so you don't need to redeploy.
- **If someone misses a day,** the number still goes up the next day. Use `/qotd set-number` to fix it.
- **If something seems wrong,** run `npm run logs` to watch the bot's live activity, or check the Worker's logs at https://dash.cloudflare.com.
