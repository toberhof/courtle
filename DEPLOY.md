# Courtle Deployment Guide

Courtle is designed to be extremely lightweight, fast, and easy to deploy. It runs inside a single Docker container utilizing a robust **PHP 8.2 + Apache + SQLite** setup. All external assets (fonts, icons) are downloaded during the Docker build process, meaning **no CDNs are contacted at runtime**, protecting your users' privacy and enabling fully offline/local deployments.

---

## 1. Quick Start via Docker Compose (Standard Setup)

For external users or local testing, running Courtle via `docker compose` is the fastest method.

### Prerequisites
* [Docker](https://docs.docker.com/) and [Docker Compose](https://docs.docker.com/compose/) installed on your host system.

### Quick Start Instructions

1. **Clone the repository**:
   ```bash
   git clone https://github.com/your-org/courtle.git
   cd courtle
   ```

2. **Start the container**:
   ```bash
   docker compose up -d
   ```

3. **Access the application**:
   Open **http://localhost:8012** in your browser.
   * *Note: The default port mapped in `docker-compose.yml` is `8012`. If you wish to use another port (e.g., `8080`), modify the ports mapping in `docker-compose.yml` beforehand.*

4. **Initial Setup**:
   On your first visit, Courtle will detect that the database is empty and guide you through the interactive setup to define your group/team name and create your first administrator player.

---

## 2. SQLite Database Persistence

Because Courtle uses a lightweight, zero-maintenance SQLite database, ensuring database persistence across container restarts and updates is vital.

### Docker Volume (Default)
The default `docker-compose.yml` utilizes a managed named volume (`courtle_data`) mapped to the database directory inside the container `/var/www/courtle_data`.
```yaml
services:
  courtle:
    build: .
    volumes:
      - courtle_data:/var/www/courtle_data
```
This is the recommended approach for most Docker systems as it avoids permission mapping friction between the host machine and the container's Apache user (`www-data`).

### Local Directory Bind Mount (Alternative)
If you prefer to have direct filesystem access to the `courtle.db` file from the host (e.g., for simple file backups), you can use a local directory bind mount:

1. Create a local folder on your host:
   ```bash
   mkdir -p courtle_data
   ```
2. Update the `volumes` mapping in your `docker-compose.yml` to point to the host directory:
   ```yaml
   volumes:
     - ./courtle_data:/var/www/courtle_data
   ```
3. Start the container. The entrypoint script (`docker-entrypoint.sh`) will automatically adjust the folder permissions inside the container to make it writable by `www-data`.

---

## 3. Deployment with Coolify (Self-Hosted PaaS)

If you use **[Coolify](https://coolify.io/)** to host your self-hosted applications, Courtle deploys beautifully with almost zero manual intervention.

### Step-by-Step Coolify Setup

1. **Create a New Application**:
   * Go to your Coolify Dashboard.
   * Click **Sources** to connect your GitHub/GitLab account if you haven't already.
   * Navigate to your Project -> Environment -> Click **+ New Resource** and select **Application**.
   * Select **Private Repository (GitHub)** or **Public Repository** and pick the `courtle` repository.

2. **Configure Build Settings**:
   * Coolify will scan the repository and detect the existing `Dockerfile`.
   * Under **Build Pack**, make sure **Dockerfile** is selected.

3. **Configure Domains & Ports**:
   * **Domain**: Set your desired domain or subdomain (e.g., `https://courtle.my-domain.com`). Coolify will automatically provision Let's Encrypt SSL certificates for you.
   * **Ports**: In the application settings under **Ports**, set the **Port Mapping** or **Exposed Port** to **80** (which is the internal Apache webserver port used inside our container).

4. **Setup Persistent Storage (Volumes)**:
   * Navigate to the **Storage / Volumes** tab of your application in Coolify.
   * Click **Add Volume** to configure persistent storage for your SQLite database.
   * **Destination Path (in container)**: `/var/www/courtle_data`
   * *This is critical. If you do not mount a volume to `/var/www/courtle_data`, your SQLite database and player registry will be wiped every time the application is redeployed or updated.*

5. **Deploy**:
   * Click **Deploy** in the top right.
   * Once the build finishes, open your configured domain. You will be greeted by the Courtle initial setup wizard!

---

## 4. Advanced Environment Configuration

Courtle keeps configuration simple by housing app-level settings (costs, rules, schedules) directly in the database. However, the system-level database path is highly flexible.

### Database Path Override
By default, the SQLite database is located at `/var/www/courtle_data/courtle.db`. If you need to customize this path (for instance, to mount it somewhere else or test locally without Docker), you can pass one of the following environment variables:

| Environment Variable | Description | Example Value |
|----------------------|-------------|---------------|
| `COURTLE_DB_PATH` | The primary env variable to override the SQLite database path | `/tmp/test-courtle.db` |
| `DB_PATH` | A standard fallback environment variable for database paths | `/custom/path/courtle.db` |

---

## 5. Reverse Proxy, SSL, and Cloudflare Trust

When deploying web apps behind reverse proxies (like Coolify's built-in Traefik proxy, Nginx, or Cloudflare), the container needs to trust forwarding headers to ensure:
* SSL/HTTPS is correctly detected (preventing mixed-content errors).
* Correct player IP addresses are recorded in the security logs (rather than the internal proxy IP).

Courtle handles this automatically:
1. The `Dockerfile` enables the Apache `mod_remoteip` and `mod_rewrite` modules.
2. The `courtle.conf` Apache configuration file trusts standard private networks and proxy ranges.
3. The PHP backend (`api.php`) checks `HTTP_X_FORWARDED_PROTO` to enforce secure cookie headers and handle correct protocol resolution.

No additional reverse proxy configurations are needed on your end!
