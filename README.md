# QuakeDetector

QuakeDetector is a real-time, location-based earthquake monitoring and alerting platform. It ingests continuous global seismic events from the USGS, processes real-time proximity alerts and swarms, and routes low-latency, personalized notifications through an interactive Telegram bot and a live operational dashboard.

---

## Getting Started

Follow these steps to set up and run QuakeDetector locally.

### 1. Prerequisites
Ensure you have the following installed on your machine:
* **Node.js** (v18 or higher)
* **npm** (v9 or higher)
* **PostgreSQL** (with the **PostGIS** extension enabled)

### 2. Environment Configuration
Create a `.env` file in the root directory. You can use the following template:

```env
DATABASE_URL="postgresql://username:password@localhost:5432/quake_detector?schema=public"
TELEGRAM_BOT_TOKEN="your_telegram_bot_token"
DASHBOARD_URL="http://localhost:5173"
PORT=3001
NODE_ENV=development
```

### 3. Database Initialization
Prepare the PostgreSQL database and synchronize the Prisma schema:

```bash
# Push the Prisma schema directly to the database
npx prisma db push
```

### 4. Running the Application
Start the entire workspace concurrently:

```bash
# Run all services (Ingestion, API, and Dashboard)
npm run dev
```

*Alternatively, you can run individual services independently:*
```bash
# Run the API & Alerts server
npm run api

# Run the Ingestion service
npm run ingest

# Run the Dashboard web app
npm run web
```

---

## Operating the Telegram Bot

Once the services are active, the Telegram bot immediately begins listening for messages. 

1. Message the bot using your Telegram account (search for your bot's username).
2. **Auto-Registration**: Simply say "Hi" or send `/start` to instantly register your Telegram Chat ID in the database.
3. Use the following commands to test location tracking and alerting:
   * **Add Location**: Type any city name directly (e.g., `Tokyo` or `Los Angeles`) to geocode and monitor that location. Alternatively, use `/addlocation <city>`.
   * `/locations` — View your monitored locations and their current live **Risk Scores**.
   * `/removelocation <id>` — Stop monitoring a location.
   * `/status` — View live platform telemetry (latest polls, DB event count, system health).
   * `/digest` — Request an on-demand 24-hour daily summary showing magnitude breakdowns and active seismic regions.

---

## Directory Structure

* **`apps/ingestion`**: USGS poller and historical data reconciler.
* **`apps/api`**: Express API server, SSE streaming, risk calculator, and Telegram bot.
* **`apps/web`**: Operational dashboard built with React.
